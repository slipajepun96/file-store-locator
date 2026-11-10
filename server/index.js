import './env.js';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSettings, initDb, isDbError, query, saveSettings, toArea, toBox, toFile, toOffice, toUser } from './db.js';
import {
  MIN_PASSWORD,
  canManageOffice,
  clearFailures,
  endSession,
  endUserSessions,
  ensureAdmin,
  hashPassword,
  isActive,
  isManager,
  isThrottled,
  publicUser,
  recordFailure,
  requireAdmin,
  requireAuth,
  requireManager,
  sessionUser,
  startSession,
  verifyPassword,
} from './auth.js';
import { audit, auditTrail, changes, describeChanges, registerAuditRoutes } from './audit.js';
import { finishGoogleLogin, googleConfigured, startGoogleLogin } from './google.js';
import { registerLetterRoutes } from './letters.js';
import { clean, id, likeText, route } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
// Cloud hosts provide PORT; API_PORT keeps local dev on 3001 next to Vite.
const PORT = process.env.API_PORT || process.env.PORT || 3001;

const ROLES = ['admin', 'office_admin', 'worker'];
const STATUSES = ['active', 'pending', 'rejected'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


const findUser = async (userId) => toUser((await query('SELECT * FROM users WHERE id = ?', [userId]))[0]);
const findOffice = async (officeId) => toOffice((await query('SELECT * FROM offices WHERE id = ?', [officeId]))[0]);

await initDb();
await ensureAdmin();

const app = express();
app.set('trust proxy', 1); // behind the cloud host's HTTPS proxy
app.disable('x-powered-by');
// Room for a letter's full text (see MAX_CONTENT in letters.js). Photos for reading text use their own limit.
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Records every change made through the API (see audit.js).
app.use('/api', auditTrail);

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
    audit(res, {
      always: true,
      action: 'auth.login_failed',
      actor: user ?? null,
      userName: user?.name ?? username,
      summary: `Failed password sign-in for "${username}"`,
    });
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  clearFailures(key);
  if (!isActive(user)) return res.status(403).json({ error: 'This account is not approved.' });
  await startSession(res, user.id);
  audit(res, { action: 'auth.login', actor: user, summary: 'Signed in with password' });
  res.json(publicUser(user));
}));

app.post('/api/auth/logout', route(async (req, res) => {
  const user = await sessionUser(req);
  audit(res, user ? { action: 'auth.logout', actor: user, summary: 'Signed out' } : { skip: true });
  await endSession(req, res);
  res.status(204).end();
}));

// ---- Public file lookup (no sign-in) ----
// Finds files by name across every office and says where they're stored. Only the name, number, office, box and
// area are shown, never who
// recorded them, and a short query plus a result cap stop it from being used to list every file.
const PUBLIC_MIN_QUERY = 2;
const PUBLIC_MAX_RESULTS = 25;

app.get('/api/public/files', route(async (req, res) => {
  const q = clean(req.query.q);
  if (q.length < PUBLIC_MIN_QUERY)
    return res.status(400).json({ error: `Type at least ${PUBLIC_MIN_QUERY} characters of the file name.` });
  const rows = await query(
    `SELECT files.file_number, files.name, boxes.name AS box_name, areas.name AS area_name, offices.name AS office_name
     FROM files
     LEFT JOIN boxes ON boxes.id = files.box_id
     LEFT JOIN areas ON areas.id = boxes.area_id
     LEFT JOIN offices ON offices.id = areas.office_id
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
      officeName: r.office_name ?? '—',
    })),
    more: rows.length > PUBLIC_MAX_RESULTS,
  });
}));

// Everything below needs a signed-in user.
app.use('/api', requireAuth);

app.get('/api/auth/me', route(async (req, res) => {
  const me = publicUser(req.user);
  if (isManager(req.user)) {
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
  audit(res, { action: 'auth.password', summary: 'Changed own password' });
  res.status(204).end();
}));

// ---- Users (admins and office admins) ----
// Admins manage every account. An office admin sees the sign-up requests and the workers of their own office:
// they can approve requests as workers of their office, and block, rename or remove their office's workers.
const isOfficeAdmin = (u) => u.role !== 'admin';
const officeAdminMayEdit = (me, target) =>
  target.status === 'pending' || (target.role === 'worker' && target.officeId === me.officeId);

const ROLE_LABELS = { admin: 'admin', office_admin: 'office admin', worker: 'worker' };
const officeName = async (officeId) => (officeId ? (await findOffice(officeId))?.name ?? 'a removed office' : 'no office');

// What an account edit did, in words: "Approved Ali", "Blocked Ali", or "Updated Ali: role: worker → admin".
async function describeUserChange(before, after) {
  const diff = changes(
    { name: before.name, role: ROLE_LABELS[before.role], office: await officeName(before.officeId) },
    { name: after.name, role: ROLE_LABELS[after.role], office: await officeName(after.officeId) }
  );
  const base = { targetId: after.id, officeId: after.officeId ?? before.officeId, details: diff };
  if (before.status !== after.status) {
    const verb = after.status === 'rejected' ? (before.status === 'pending' ? 'Rejected' : 'Blocked') : before.status === 'pending' ? 'Approved' : 'Restored access for';
    const rest = describeChanges(diff);
    return { ...base, action: `account.${after.status === 'active' ? 'approve' : 'reject'}`, summary: `${verb} ${after.name}${rest ? ` (${rest})` : ''}` };
  }
  if (!Object.keys(diff).length) return { ...base, summary: `Saved ${after.name}'s account (no changes)` };
  return { ...base, summary: `Updated ${before.name}'s account: ${describeChanges(diff)}` };
}

// Checks an office id sent by an admin: '' or null means no office.
async function readOfficeId(value) {
  const officeId = clean(value);
  if (!officeId) return { officeId: null };
  if (!(await findOffice(officeId))) return { error: 'Choose a valid office.' };
  return { officeId };
}

app.get('/api/users', requireManager, route(async (req, res) => {
  const rows = isOfficeAdmin(req.user)
    ? await query(
        "SELECT * FROM users WHERE status = 'pending' OR (role = 'worker' AND office_id = ?) OR id = ? ORDER BY created_at",
        [req.user.officeId, req.user.id]
      )
    : await query('SELECT * FROM users ORDER BY created_at');
  res.json(rows.map((r) => publicUser(toUser(r))));
}));

// Pre-approve a Google account by email so the person gets straight in on first sign-in.
app.post('/api/users', requireManager, route(async (req, res) => {
  const name = clean(req.body.name);
  const email = clean(req.body.email).toLowerCase();
  let role = ROLES.includes(req.body.role) ? req.body.role : 'worker';
  let officeId = req.user.officeId;
  if (isOfficeAdmin(req.user)) {
    role = 'worker';
  } else {
    const office = await readOfficeId(req.body.officeId);
    if (office.error) return res.status(400).json({ error: office.error });
    officeId = office.officeId;
  }
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid Google email address.' });
  if (role === 'office_admin' && !officeId) return res.status(400).json({ error: 'Choose the office this office admin runs.' });
  if ((await query('SELECT 1 FROM users WHERE email = ?', [email])).length)
    return res.status(409).json({ error: 'An account with this email already exists.' });
  const now = new Date();
  const user = { id: id(), name, email, role, officeId, status: 'active', createdAt: now, approvedAt: now, approvedBy: req.user.id };
  await query(
    'INSERT INTO users (id, name, email, role, office_id, status, created_at, approved_at, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [user.id, name, email, role, officeId, user.status, now, now, req.user.id]
  );
  audit(res, {
    targetId: user.id,
    officeId,
    summary: `Pre-approved ${name} <${email}> as ${ROLE_LABELS[role]}${officeId ? ` of ${await officeName(officeId)}` : ''}`,
  });
  res.status(201).json(publicUser(user));
}));

// Approve, reject, rename, or change the role or office of an account.
app.put('/api/users/:id', requireManager, route(async (req, res) => {
  const user = await findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const before = { ...user };
  const { role, status } = req.body;
  const name = clean(req.body.name);
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (user.id === req.user.id && ((role && role !== user.role) || (status && status !== 'active')))
    return res.status(400).json({ error: 'You cannot change your own role or access.' });
  if (isOfficeAdmin(req.user)) {
    if (!officeAdminMayEdit(req.user, user))
      return res.status(403).json({ error: 'Office admins can only manage sign-up requests and the workers of their own office.' });
    if (role && role !== 'worker') return res.status(403).json({ error: 'Only an admin can make someone an admin or office admin.' });
    // Approving a request makes the person a worker of this office admin's office.
    if (status === 'active' && user.status === 'pending') {
      user.role = 'worker';
      user.officeId = req.user.officeId;
    }
  } else if (req.body.officeId !== undefined) {
    const office = await readOfficeId(req.body.officeId);
    if (office.error) return res.status(400).json({ error: office.error });
    user.officeId = office.officeId;
  }
  if (role) user.role = role;
  if (name) user.name = name;
  if (user.role === 'office_admin' && !user.officeId)
    return res.status(400).json({ error: 'Choose the office this office admin runs.' });
  if (status && status !== user.status) {
    user.status = status;
    if (status === 'active') {
      user.approvedAt = new Date();
      user.approvedBy = req.user.id;
    } else {
      await endUserSessions(user.id);
    }
  }
  await query('UPDATE users SET role = ?, name = ?, status = ?, office_id = ?, approved_at = ?, approved_by = ? WHERE id = ?', [
    user.role,
    user.name,
    user.status,
    user.officeId,
    user.approvedAt,
    user.approvedBy,
    user.id,
  ]);
  audit(res, await describeUserChange(before, user));
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
  audit(res, { action: 'account.password', officeId: user.officeId, summary: `Reset the password of ${user.name}` });
  res.status(204).end();
}));

app.delete('/api/users/:id', requireManager, route(async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot remove your own account.' });
  const user = await findUser(req.params.id);
  if (isOfficeAdmin(req.user) && user && !officeAdminMayEdit(req.user, user))
    return res.status(403).json({ error: 'Office admins can only remove the workers of their own office.' });
  if (user) audit(res, { officeId: user.officeId, summary: `Removed the account of ${user.name} (${user.email || user.username})` });
  else audit(res, { skip: true });
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
  const size = { [wKey]: Math.round(width * 10) / 10, [hKey]: Math.round(height * 10) / 10 };
  await saveSettings(size);
  audit(res, {
    officeId: null,
    summary: `Set the default ${req.body.kind === 'file' ? 'file' : 'box'} label size to ${size[wKey]} × ${size[hKey]} mm`,
  });
  res.json(await getSettings());
}));

// ---- Offices (admin) ----
app.get('/api/offices', route(async (req, res) => res.json((await query('SELECT * FROM offices ORDER BY name')).map(toOffice))));

const officeSaveError = (err, res) => {
  if (isDbError(err, 'ER_DUP_ENTRY')) return res.status(409).json({ error: 'An office with this name already exists.' });
  throw err;
};

app.post('/api/offices', requireAdmin, route(async (req, res) => {
  const name = clean(req.body.name);
  if (!name) return res.status(400).json({ error: 'Office name is required.' });
  const office = { id: id(), name, createdAt: new Date() };
  try {
    await query('INSERT INTO offices (id, name, created_at) VALUES (?, ?, ?)', [office.id, name, office.createdAt]);
  } catch (err) {
    return officeSaveError(err, res);
  }
  audit(res, { targetId: office.id, officeId: office.id, summary: `Added office "${name}"` });
  res.status(201).json(office);
}));

app.put('/api/offices/:id', requireAdmin, route(async (req, res) => {
  const name = clean(req.body.name);
  if (!name) return res.status(400).json({ error: 'Office name is required.' });
  const old = await findOffice(req.params.id);
  if (old) audit(res, { officeId: old.id, summary: `Renamed office "${old.name}" to "${name}"` });
  let result;
  try {
    result = await query('UPDATE offices SET name = ? WHERE id = ?', [name, req.params.id]);
  } catch (err) {
    return officeSaveError(err, res);
  }
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Office not found.' });
  res.json(await findOffice(req.params.id));
}));

app.delete('/api/offices/:id', requireAdmin, route(async (req, res) => {
  if ((await query("SELECT 1 FROM users WHERE role = 'office_admin' AND office_id = ? LIMIT 1", [req.params.id])).length)
    return res.status(409).json({ error: 'Office still has office admins. Move them to another office first.' });
  const office = await findOffice(req.params.id);
  audit(res, office ? { officeId: office.id, summary: `Removed office "${office.name}"` } : { skip: true });
  try {
    await query('DELETE FROM offices WHERE id = ?', [req.params.id]);
  } catch (err) {
    if (isDbError(err, 'ER_ROW_IS_REFERENCED_2'))
      return res.status(409).json({ error: 'Office still has areas or letters and cannot be removed.' });
    throw err;
  }
  // Workers of a removed office are kept, without a home office.
  await query('UPDATE users SET office_id = NULL WHERE office_id = ?', [req.params.id]);
  res.status(204).end();
}));

// ---- Areas ----
// ?officeId=… lists one office's areas; without it, every office's.
app.get('/api/areas', route(async (req, res) => {
  const officeId = clean(req.query.officeId);
  const rows = officeId
    ? await query('SELECT * FROM areas WHERE office_id = ? ORDER BY name', [officeId])
    : await query('SELECT * FROM areas ORDER BY name');
  res.json(rows.map(toArea));
}));

app.post('/api/areas', requireManager, route(async (req, res) => {
  const name = clean(req.body.name);
  const officeId = clean(req.body.officeId);
  if (!name) return res.status(400).json({ error: 'Area name is required.' });
  if (!canManageOffice(req.user, officeId)) return res.status(403).json({ error: 'You can only add areas to your own office.' });
  const area = { id: id(), name, officeId };
  try {
    await query('INSERT INTO areas (id, office_id, name) VALUES (?, ?, ?)', [area.id, officeId, name]);
  } catch (err) {
    if (isDbError(err, 'ER_NO_REFERENCED_ROW_2')) return res.status(400).json({ error: 'Choose a valid office.' });
    if (isDbError(err, 'ER_DUP_ENTRY')) return res.status(409).json({ error: 'This office already has an area with that name.' });
    throw err;
  }
  audit(res, { targetId: area.id, officeId, summary: `Added area "${name}" in ${await officeName(officeId)}` });
  res.status(201).json(area);
}));

app.delete('/api/areas/:id', requireManager, route(async (req, res) => {
  const area = toArea((await query('SELECT * FROM areas WHERE id = ?', [req.params.id]))[0]);
  if (!area) return res.status(404).json({ error: 'Area not found.' });
  if (!canManageOffice(req.user, area.officeId)) return res.status(403).json({ error: 'You can only remove areas of your own office.' });
  try {
    await query('DELETE FROM areas WHERE id = ?', [area.id]);
  } catch (err) {
    if (isDbError(err, 'ER_ROW_IS_REFERENCED_2'))
      return res.status(409).json({ error: 'Area still has file boxes and cannot be removed.' });
    throw err;
  }
  audit(res, { officeId: area.officeId, summary: `Removed area "${area.name}" from ${await officeName(area.officeId)}` });
  res.status(204).end();
}));

// ---- File boxes ----
// Each box comes with its area's office.
const BOXES_WITH_OFFICE = 'SELECT boxes.*, areas.office_id FROM boxes JOIN areas ON areas.id = boxes.area_id';
const findBox = async (boxId) => toBox((await query(`${BOXES_WITH_OFFICE} WHERE boxes.id = ?`, [boxId]))[0]);

app.get('/api/boxes', route(async (req, res) => {
  const officeId = clean(req.query.officeId);
  const rows = officeId
    ? await query(`${BOXES_WITH_OFFICE} WHERE areas.office_id = ? ORDER BY boxes.name`, [officeId])
    : await query(`${BOXES_WITH_OFFICE} ORDER BY boxes.name`);
  res.json(rows.map(toBox));
}));

app.get('/api/boxes/:id', route(async (req, res) => {
  const box = await findBox(req.params.id);
  if (!box) return res.status(404).json({ error: 'File box not found.' });
  const [areas, offices, files] = await Promise.all([
    query('SELECT * FROM areas WHERE id = ?', [box.areaId]),
    query('SELECT * FROM offices WHERE id = ?', [box.officeId]),
    query('SELECT * FROM files WHERE box_id = ? ORDER BY created_at', [box.id]),
  ]);
  res.json({ ...box, area: toArea(areas[0]) ?? null, office: toOffice(offices[0]) ?? null, files: files.map(toFile) });
}));

app.post('/api/boxes', requireManager, route(async (req, res) => {
  const name = clean(req.body.name);
  const areaId = clean(req.body.areaId);
  if (!name) return res.status(400).json({ error: 'File box name is required.' });
  const area = toArea((await query('SELECT * FROM areas WHERE id = ?', [areaId]))[0]);
  if (!area) return res.status(400).json({ error: 'Choose a valid area.' });
  if (!canManageOffice(req.user, area.officeId)) return res.status(403).json({ error: 'You can only add boxes to your own office.' });
  const box = { id: id(), name, areaId, officeId: area.officeId, createdAt: new Date() };
  try {
    await query('INSERT INTO boxes (id, name, area_id, created_at) VALUES (?, ?, ?, ?)', [box.id, name, areaId, box.createdAt]);
  } catch (err) {
    if (isDbError(err, 'ER_NO_REFERENCED_ROW_2')) return res.status(400).json({ error: 'Choose a valid area.' });
    if (isDbError(err, 'ER_DUP_ENTRY')) return res.status(409).json({ error: 'File box name already exists (in this or another office).' });
    throw err;
  }
  audit(res, { targetId: box.id, officeId: area.officeId, summary: `Added file box "${name}" in area "${area.name}"` });
  res.status(201).json(box);
}));

app.delete('/api/boxes/:id', requireManager, route(async (req, res) => {
  const box = await findBox(req.params.id);
  if (!box) return res.status(404).json({ error: 'File box not found.' });
  if (!canManageOffice(req.user, box.officeId)) return res.status(403).json({ error: 'You can only remove boxes of your own office.' });
  try {
    await query('DELETE FROM boxes WHERE id = ?', [box.id]);
  } catch (err) {
    if (isDbError(err, 'ER_ROW_IS_REFERENCED_2'))
      return res.status(409).json({ error: 'File box still contains files and cannot be removed.' });
    throw err;
  }
  audit(res, { officeId: box.officeId, summary: `Removed file box "${box.name}"` });
  res.status(204).end();
}));

// ---- Files ----
// Each file is shown with the names of its box, area and office.
const FILES_WITH_LOCATION = `
  SELECT files.*, boxes.name AS box_name, areas.name AS area_name, areas.office_id, offices.name AS office_name
  FROM files
  LEFT JOIN boxes ON boxes.id = files.box_id
  LEFT JOIN areas ON areas.id = boxes.area_id
  LEFT JOIN offices ON offices.id = areas.office_id`;
const findFile = async (fileId) => toFile((await query(`${FILES_WITH_LOCATION} WHERE files.id = ?`, [fileId]))[0]);

// ?q=… searches file numbers and names; ?officeId=… keeps to one office.
app.get('/api/files', route(async (req, res) => {
  const q = clean(req.query.q);
  const officeId = clean(req.query.officeId);
  const where = [];
  const params = [];
  if (q) {
    where.push('(files.file_number LIKE ? OR files.name LIKE ?)');
    params.push(likeText(q), likeText(q));
  }
  if (officeId) {
    where.push('areas.office_id = ?');
    params.push(officeId);
  }
  const rows = await query(
    `${FILES_WITH_LOCATION} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY files.created_at DESC`,
    params
  );
  res.json(rows.map(toFile));
}));

app.get('/api/files/:id', route(async (req, res) => {
  const file = await findFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found.' });
  res.json(file);
}));

// Turns a duplicate number or unknown box into a clear message for the file forms.
function fileSaveError(err, res, fileNumber) {
  if (isDbError(err, 'ER_NO_REFERENCED_ROW_2')) return res.status(400).json({ error: 'Choose a valid file box.' });
  if (isDbError(err, 'ER_DUP_ENTRY'))
    return res.status(409).json({ error: `File number ${fileNumber} is already recorded (in this or another office).` });
  throw err;
}

// A file's letter running number: the last letter number (Bil.) already used in it. Blank means none yet (0).
const MAX_LETTER_COUNTER = 1_000_000;
function readLetterCounter(value) {
  if (value === undefined || value === null || value === '') return { counter: 0 };
  const counter = Number(value);
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_LETTER_COUNTER)
    return { error: 'Letter running number must be a whole number, 0 or more.' };
  return { counter };
}

app.post('/api/files', route(async (req, res) => {
  const fileNumber = clean(req.body.fileNumber);
  const name = clean(req.body.name);
  const boxId = clean(req.body.boxId);
  if (!fileNumber || !name) return res.status(400).json({ error: 'File number and file name are required.' });
  const { counter, error } = readLetterCounter(req.body.letterCounter);
  if (error) return res.status(400).json({ error });
  const fileId = id();
  try {
    await query(
      'INSERT INTO files (id, file_number, name, box_id, letter_counter, created_by, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [fileId, fileNumber, name, boxId, counter, req.user.id, req.user.name, new Date()]
    );
  } catch (err) {
    return fileSaveError(err, res, fileNumber);
  }
  const file = await findFile(fileId);
  audit(res, {
    targetId: fileId,
    officeId: file.officeId,
    summary: `Registered file ${fileNumber} "${name}" in box ${file.boxName}`,
  });
  res.status(201).json(file);
}));

// Edit a file's number, name, box or letter running number, including moving it to a box in another office.
// Anyone signed in can, since files get moved between boxes; removing stays limited to admins, the file's office
// admin and the recorder. The running number can be corrected, but not below a number a letter already has.
app.put('/api/files/:id', route(async (req, res) => {
  const fileNumber = clean(req.body.fileNumber);
  const name = clean(req.body.name);
  const boxId = clean(req.body.boxId);
  if (!fileNumber || !name) return res.status(400).json({ error: 'File number and file name are required.' });
  const file = await findFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found.' });
  const { counter, error } = req.body.letterCounter === undefined ? { counter: file.letterCounter } : readLetterCounter(req.body.letterCounter);
  if (error) return res.status(400).json({ error });
  let result;
  try {
    // The subquery check keeps a letter numbered at the same moment from slipping under the new running number.
    result = await query(
      `UPDATE files SET file_number = ?, name = ?, box_id = ?, letter_counter = ?, updated_by = ?, updated_by_name = ?, updated_at = ?
       WHERE id = ? AND ? >= (SELECT COALESCE(MAX(bil_no), 0) FROM letter_files WHERE file_id = ?)`,
      [fileNumber, name, boxId, counter, req.user.id, req.user.name, new Date(), file.id, counter, file.id]
    );
  } catch (err) {
    return fileSaveError(err, res, fileNumber);
  }
  if (result.affectedRows === 0) {
    const [{ last }] = await query('SELECT COALESCE(MAX(bil_no), 0) AS last FROM letter_files WHERE file_id = ?', [file.id]);
    return res.status(409).json({ error: `Letter running number can't be lower than ${last}, the number of a letter already in this file.` });
  }
  const saved = await findFile(file.id);
  const diff = changes(
    { number: file.fileNumber, name: file.name, box: file.boxName, office: file.officeName, 'letter running number': file.letterCounter },
    { number: saved.fileNumber, name: saved.name, box: saved.boxName, office: saved.officeName, 'letter running number': saved.letterCounter }
  );
  audit(res, {
    action: diff.box ? 'file.move' : 'file.update',
    officeId: saved.officeId,
    details: diff,
    summary: Object.keys(diff).length
      ? `${diff.box ? 'Moved' : 'Edited'} file ${file.fileNumber}: ${describeChanges(diff)}`
      : `Saved file ${file.fileNumber} (no changes)`,
  });
  res.json(saved);
}));

app.delete('/api/files/:id', route(async (req, res) => {
  const file = await findFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found.' });
  if (!canManageOffice(req.user, file.officeId) && file.createdBy !== req.user.id)
    return res.status(403).json({ error: "Only an admin, this office's admin or the person who recorded this file can remove it." });
  await query('DELETE FROM files WHERE id = ?', [file.id]);
  audit(res, { officeId: file.officeId, summary: `Removed file ${file.fileNumber} "${file.name}" from box ${file.boxName}` });
  res.status(204).end();
}));

registerLetterRoutes(app);
registerAuditRoutes(app);

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
