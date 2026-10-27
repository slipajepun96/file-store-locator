import './env.js';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getSettings, initDb, isDbError, query, saveSettings, toArea, toBox, toFile, toUser } from './db.js';
import {
  MIN_PASSWORD,
  clearFailures,
  endSession,
  endUserSessions,
  ensureAdmin,
  hashPassword,
  isActive,
  isThrottled,
  publicUser,
  recordFailure,
  requireAdmin,
  requireAuth,
  startSession,
  verifyPassword,
} from './auth.js';
import { finishGoogleLogin, googleConfigured, startGoogleLogin } from './google.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
// Cloud hosts provide PORT; API_PORT keeps local dev on 3001 next to Vite.
const PORT = process.env.API_PORT || process.env.PORT || 3001;

const id = () => crypto.randomUUID();
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
// Escapes LIKE wildcards so a search for "50%" matches literally.
const likeText = (v) => `%${v.replace(/[\\%_]/g, '\\$&')}%`;
const ROLES = ['admin', 'worker'];
const STATUSES = ['active', 'pending', 'rejected'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Express 4 doesn't catch rejected promises, so async handlers pass their errors on to the error handler.
const route = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const findUser = async (userId) => toUser((await query('SELECT * FROM users WHERE id = ?', [userId]))[0]);

await initDb();
await ensureAdmin();

const app = express();
app.set('trust proxy', 1); // behind the cloud host's HTTPS proxy
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- Auth ----
// Tells the login page which sign-in options to show.
app.get('/api/auth/config', route(async (req, res) => {
  const withPassword = await query('SELECT 1 FROM users WHERE password_hash IS NOT NULL LIMIT 1');
  res.json({ google: googleConfigured(), password: withPassword.length > 0 });
}));

app.get('/api/auth/google', startGoogleLogin);
app.get('/api/auth/google/callback', finishGoogleLogin);

// Username/password sign-in, kept as a fallback for the built-in admin account.
app.post('/api/auth/login', route(async (req, res) => {
  const username = clean(req.body.username).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const key = `${req.ip}|${username}`;
  if (isThrottled(key)) return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  const user = toUser((await query('SELECT * FROM users WHERE username = ?', [username]))[0]);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    recordFailure(key);
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  clearFailures(key);
  if (!isActive(user)) return res.status(403).json({ error: 'This account is not approved.' });
  await startSession(res, user.id);
  res.json(publicUser(user));
}));

app.post('/api/auth/logout', route(async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
}));

// ---- Public file lookup (no sign-in) ----
// Finds files by name and says where they're stored. Only the name, number, box and area are shown, never who
// recorded them, and a short query plus a result cap stop it from being used to list every file.
const PUBLIC_MIN_QUERY = 2;
const PUBLIC_MAX_RESULTS = 25;

app.get('/api/public/files', route(async (req, res) => {
  const q = clean(req.query.q);
  if (q.length < PUBLIC_MIN_QUERY)
    return res.status(400).json({ error: `Type at least ${PUBLIC_MIN_QUERY} characters of the file name.` });
  const rows = await query(
    `SELECT files.file_number, files.name, boxes.name AS box_name, areas.name AS area_name
     FROM files
     LEFT JOIN boxes ON boxes.id = files.box_id
     LEFT JOIN areas ON areas.id = boxes.area_id
     WHERE files.name LIKE ?
     ORDER BY files.name
     LIMIT ?`,
    [likeText(q), PUBLIC_MAX_RESULTS + 1]
  );
  res.json({
    files: rows.slice(0, PUBLIC_MAX_RESULTS).map((r) => ({
      fileNumber: r.file_number,
      name: r.name,
      boxName: r.box_name ?? '—',
      areaName: r.area_name ?? '—',
    })),
    more: rows.length > PUBLIC_MAX_RESULTS,
  });
}));

// Everything below needs a signed-in user.
app.use('/api', requireAuth);

app.get('/api/auth/me', route(async (req, res) => {
  const me = publicUser(req.user);
  if (req.user.role === 'admin') {
    const [{ count }] = await query("SELECT COUNT(*) AS count FROM users WHERE status = 'pending'");
    me.pendingCount = count;
  }
  res.json(me);
}));

app.put('/api/auth/password', route(async (req, res) => {
  const { currentPassword = '', newPassword = '' } = req.body;
  if (!req.user.passwordHash) return res.status(400).json({ error: 'This account signs in with Google.' });
  if (!verifyPassword(currentPassword, req.user.passwordHash))
    return res.status(400).json({ error: 'Current password is wrong.' });
  if (newPassword.length < MIN_PASSWORD)
    return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD} characters.` });
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), req.user.id]);
  // Sign out other devices, keep this one.
  await endUserSessions(req.user.id);
  await startSession(res, req.user.id);
  res.status(204).end();
}));

// ---- Users (admin) ----
app.get('/api/users', requireAdmin, route(async (req, res) => {
  const rows = await query('SELECT * FROM users ORDER BY created_at');
  res.json(rows.map((r) => publicUser(toUser(r))));
}));

// Pre-approve a Google account by email so the person gets straight in on first sign-in.
app.post('/api/users', requireAdmin, route(async (req, res) => {
  const name = clean(req.body.name);
  const email = clean(req.body.email).toLowerCase();
  const role = ROLES.includes(req.body.role) ? req.body.role : 'worker';
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid Google email address.' });
  if ((await query('SELECT 1 FROM users WHERE email = ?', [email])).length)
    return res.status(409).json({ error: 'An account with this email already exists.' });
  const now = new Date();
  const user = { id: id(), name, email, role, status: 'active', createdAt: now, approvedAt: now, approvedBy: req.user.id };
  await query(
    'INSERT INTO users (id, name, email, role, status, created_at, approved_at, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [user.id, name, email, role, user.status, now, now, req.user.id]
  );
  res.status(201).json(publicUser(user));
}));

// Approve, reject, rename or change the role of an account.
app.put('/api/users/:id', requireAdmin, route(async (req, res) => {
  const user = await findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { role, status } = req.body;
  const name = clean(req.body.name);
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (user.id === req.user.id && ((role && role !== user.role) || (status && status !== 'active')))
    return res.status(400).json({ error: 'You cannot change your own role or access.' });
  if (role) user.role = role;
  if (name) user.name = name;
  if (status && status !== user.status) {
    user.status = status;
    if (status === 'active') {
      user.approvedAt = new Date();
      user.approvedBy = req.user.id;
    } else {
      await endUserSessions(user.id);
    }
  }
  await query('UPDATE users SET role = ?, name = ?, status = ?, approved_at = ?, approved_by = ? WHERE id = ?', [
    user.role,
    user.name,
    user.status,
    user.approvedAt,
    user.approvedBy,
    user.id,
  ]);
  res.json(publicUser(user));
}));

app.put('/api/users/:id/password', requireAdmin, route(async (req, res) => {
  const user = await findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!user.passwordHash) return res.status(400).json({ error: 'This account signs in with Google and has no password.' });
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (password.length < MIN_PASSWORD)
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), user.id]);
  await endUserSessions(user.id);
  res.status(204).end();
}));

app.delete('/api/users/:id', requireAdmin, route(async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot remove your own account.' });
  // Files keep the recorder's name, so removing a user never loses history. Sessions go with the user.
  await query('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.status(204).end();
}));

// ---- Settings ----
const LABEL_MIN_MM = 10;
const LABEL_MAX_MM = 400;

app.get('/api/settings', route(async (req, res) => res.json(await getSettings())));

// Saves the default size for box labels, or for file labels with { kind: 'file' }.
app.put('/api/settings', requireAdmin, route(async (req, res) => {
  const width = Number(req.body.labelWidthMm);
  const height = Number(req.body.labelHeightMm);
  const valid = (v) => Number.isFinite(v) && v >= LABEL_MIN_MM && v <= LABEL_MAX_MM;
  if (!valid(width) || !valid(height))
    return res.status(400).json({ error: `Label width and height must be between ${LABEL_MIN_MM} and ${LABEL_MAX_MM} mm.` });
  const [wKey, hKey] = req.body.kind === 'file' ? ['fileLabelWidthMm', 'fileLabelHeightMm'] : ['labelWidthMm', 'labelHeightMm'];
  await saveSettings({ [wKey]: Math.round(width * 10) / 10, [hKey]: Math.round(height * 10) / 10 });
  res.json(await getSettings());
}));

// ---- Areas ----
app.get('/api/areas', route(async (req, res) => res.json((await query('SELECT * FROM areas ORDER BY name')).map(toArea))));

app.post('/api/areas', requireAdmin, route(async (req, res) => {
  const name = clean(req.body.name);
  if (!name) return res.status(400).json({ error: 'Area name is required.' });
  const area = { id: id(), name };
  try {
    await query('INSERT INTO areas (id, name) VALUES (?, ?)', [area.id, name]);
  } catch (err) {
    if (isDbError(err, 'ER_DUP_ENTRY')) return res.status(409).json({ error: 'Area already exists.' });
    throw err;
  }
  res.status(201).json(area);
}));

app.delete('/api/areas/:id', requireAdmin, route(async (req, res) => {
  try {
    await query('DELETE FROM areas WHERE id = ?', [req.params.id]);
  } catch (err) {
    if (isDbError(err, 'ER_ROW_IS_REFERENCED_2'))
      return res.status(409).json({ error: 'Area still has file boxes and cannot be removed.' });
    throw err;
  }
  res.status(204).end();
}));

// ---- File boxes ----
app.get('/api/boxes', route(async (req, res) => res.json((await query('SELECT * FROM boxes ORDER BY name')).map(toBox))));

app.get('/api/boxes/:id', route(async (req, res) => {
  const box = toBox((await query('SELECT * FROM boxes WHERE id = ?', [req.params.id]))[0]);
  if (!box) return res.status(404).json({ error: 'File box not found.' });
  const [areas, files] = await Promise.all([
    query('SELECT * FROM areas WHERE id = ?', [box.areaId]),
    query('SELECT * FROM files WHERE box_id = ? ORDER BY created_at', [box.id]),
  ]);
  res.json({ ...box, area: toArea(areas[0]) ?? null, files: files.map(toFile) });
}));

app.post('/api/boxes', requireAdmin, route(async (req, res) => {
  const name = clean(req.body.name);
  const areaId = clean(req.body.areaId);
  if (!name) return res.status(400).json({ error: 'File box name is required.' });
  const box = { id: id(), name, areaId, createdAt: new Date() };
  try {
    await query('INSERT INTO boxes (id, name, area_id, created_at) VALUES (?, ?, ?, ?)', [box.id, name, areaId, box.createdAt]);
  } catch (err) {
    if (isDbError(err, 'ER_NO_REFERENCED_ROW_2')) return res.status(400).json({ error: 'Choose a valid area.' });
    if (isDbError(err, 'ER_DUP_ENTRY')) return res.status(409).json({ error: 'File box name already exists.' });
    throw err;
  }
  res.status(201).json(box);
}));

app.delete('/api/boxes/:id', requireAdmin, route(async (req, res) => {
  try {
    await query('DELETE FROM boxes WHERE id = ?', [req.params.id]);
  } catch (err) {
    if (isDbError(err, 'ER_ROW_IS_REFERENCED_2'))
      return res.status(409).json({ error: 'File box still contains files and cannot be removed.' });
    throw err;
  }
  res.status(204).end();
}));

// ---- Files ----
// Each file is shown with the names of its box and area.
const FILES_WITH_LOCATION = `
  SELECT files.*, boxes.name AS box_name, areas.name AS area_name
  FROM files
  LEFT JOIN boxes ON boxes.id = files.box_id
  LEFT JOIN areas ON areas.id = boxes.area_id`;

app.get('/api/files', route(async (req, res) => {
  const q = clean(req.query.q);
  const rows = q
    ? await query(`${FILES_WITH_LOCATION} WHERE files.file_number LIKE ? OR files.name LIKE ? ORDER BY files.created_at DESC`, [
        likeText(q),
        likeText(q),
      ])
    : await query(`${FILES_WITH_LOCATION} ORDER BY files.created_at DESC`);
  res.json(rows.map(toFile));
}));

app.get('/api/files/:id', route(async (req, res) => {
  const file = toFile((await query(`${FILES_WITH_LOCATION} WHERE files.id = ?`, [req.params.id]))[0]);
  if (!file) return res.status(404).json({ error: 'File not found.' });
  res.json(file);
}));

// Turns a duplicate number or unknown box into a clear message for the file forms.
function fileSaveError(err, res, fileNumber) {
  if (isDbError(err, 'ER_NO_REFERENCED_ROW_2')) return res.status(400).json({ error: 'Choose a valid file box.' });
  if (isDbError(err, 'ER_DUP_ENTRY')) return res.status(409).json({ error: `File number ${fileNumber} is already recorded.` });
  throw err;
}

app.post('/api/files', route(async (req, res) => {
  const fileNumber = clean(req.body.fileNumber);
  const name = clean(req.body.name);
  const boxId = clean(req.body.boxId);
  if (!fileNumber || !name) return res.status(400).json({ error: 'File number and file name are required.' });
  const file = {
    id: id(),
    fileNumber,
    name,
    boxId,
    createdBy: req.user.id,
    createdByName: req.user.name,
    createdAt: new Date(),
  };
  try {
    await query(
      'INSERT INTO files (id, file_number, name, box_id, created_by, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [file.id, fileNumber, name, boxId, file.createdBy, file.createdByName, file.createdAt]
    );
  } catch (err) {
    return fileSaveError(err, res, fileNumber);
  }
  res.status(201).json(file);
}));

// Edit a file's number, name or box. Anyone signed in can, since files get moved between boxes;
// removing stays limited to admins and the recorder.
app.put('/api/files/:id', route(async (req, res) => {
  const fileNumber = clean(req.body.fileNumber);
  const name = clean(req.body.name);
  const boxId = clean(req.body.boxId);
  if (!fileNumber || !name) return res.status(400).json({ error: 'File number and file name are required.' });
  let result;
  try {
    result = await query(
      'UPDATE files SET file_number = ?, name = ?, box_id = ?, updated_by = ?, updated_by_name = ?, updated_at = ? WHERE id = ?',
      [fileNumber, name, boxId, req.user.id, req.user.name, new Date(), req.params.id]
    );
  } catch (err) {
    return fileSaveError(err, res, fileNumber);
  }
  if (result.affectedRows === 0) return res.status(404).json({ error: 'File not found.' });
  res.json(toFile((await query('SELECT * FROM files WHERE id = ?', [req.params.id]))[0]));
}));

app.delete('/api/files/:id', route(async (req, res) => {
  const file = toFile((await query('SELECT * FROM files WHERE id = ?', [req.params.id]))[0]);
  if (!file) return res.status(404).json({ error: 'File not found.' });
  if (req.user.role !== 'admin' && file.createdBy !== req.user.id)
    return res.status(403).json({ error: 'Only an admin or the person who recorded this file can remove it.' });
  await query('DELETE FROM files WHERE id = ?', [file.id]);
  res.status(204).end();
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Serve the built React app (npm run build) so one server hosts everything.
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

app.use((err, req, res, next) => {
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Something went wrong.' });
});

app.listen(PORT, () => console.log(`File Store Locator on http://localhost:${PORT}`));
