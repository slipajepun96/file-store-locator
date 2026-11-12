import express from 'express';
import { isDbError, pool, query, toFile } from './db.js';
import { claudeEnabled, readLetterFields, readLetterImage } from './claude.js';
import { isPhoto, readText } from './ocr.js';
import { canManageOffice, requireAdmin } from './auth.js';
import { clean, id, likeText, route } from './util.js';
import { audit, changes, describeChanges } from './audit.js';

// ---- Letters, inbound and outbound ----
// An inbound letter has a sender and a date received; an outbound one has a recipient and a date sent (blank while
// it's a draft). Each direction has its own statuses; departments are shared. A letter's direction is set when
// it's recorded and doesn't change.
// Anyone signed in can record a letter, file it into files, and update its status or department.
// Removing a letter is for admins, the letter's office admin and the person who recorded it.
//
// Letter numbers: each file keeps a running number (files.letter_counter). A letter filed in a file takes the next
// number, inbound or outbound alike, and its code there is "<file number>/Bil. (<number>)". A letter in several
// files has a number in each. Numbers aren't reused when a letter is removed or taken out of a file.
//
// Letter text: photos of a letter are read into text so letters can be searched by what they say. With an Anthropic
// API key, Claude reads them (server/claude.js) and also picks out the letter's details for the form; otherwise, or
// if Claude can't be reached, Tesseract reads the text on this server (server/ocr.js). A photo is only held in
// memory while it's read, then dropped; only the text is saved, with the letter.
// Admins keep the lists of letter statuses and departments under Settings.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// About 200 pages of text.
const MAX_CONTENT = 500_000;
// Photos are shrunk on the phone before upload (to ~2400px), so a few MB is plenty.
const MAX_PHOTO = '12mb';
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DIRECTIONS = ['inbound', 'outbound'];
const readDirection = (v) => (DIRECTIONS.includes(v) ? v : 'inbound');
// DATE columns come back as midnight UTC (the pool uses timezone 'Z'); the API sends plain YYYY-MM-DD.
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ?? null);

const toStatus = (r) => r && { id: r.id, direction: r.direction, name: r.name, position: r.position };
const toDepartment = (r) => r && { id: r.id, name: r.name };

const toLetter = (r) =>
  r && {
    id: r.id,
    officeId: r.office_id,
    officeName: r.office_name ?? '—',
    direction: r.direction,
    referenceNo: r.reference_no ?? '',
    sender: r.sender ?? '',
    recipient: r.recipient ?? '',
    subject: r.subject,
    letterDate: day(r.letter_date),
    receivedDate: day(r.received_date),
    sentDate: day(r.sent_date),
    statusId: r.status_id,
    statusName: r.status_name ?? '—',
    statusPosition: r.status_position ?? 0,
    departmentId: r.department_id ?? null,
    departmentName: r.department_name ?? null,
    notes: r.notes ?? '',
    content: r.content ?? '',
    fileCount: Number(r.file_count ?? 0),
    letterNos: r.letter_nos ? r.letter_nos.split(LETTER_NO_SEPARATOR) : [],
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedByName: r.updated_by_name,
    updatedAt: r.updated_at,
  };

const toUpdate = (r) => ({
  id: r.id,
  statusName: r.status_name,
  departmentName: r.department_name,
  note: r.note ?? '',
  createdByName: r.created_by_name,
  createdAt: r.created_at,
});

// The SQL for a letter's code in a file, e.g. "F-100/Bil. (24)".
const LETTER_NO_SQL = "CONCAT(files.file_number, '/Bil. (', letter_files.bil_no, ')')";
const LETTER_NO_SEPARATOR = '\u001f';

const LETTERS = `
  SELECT letters.*, offices.name AS office_name, letter_statuses.name AS status_name,
         letter_statuses.position AS status_position, departments.name AS department_name,
         (SELECT COUNT(*) FROM letter_files WHERE letter_files.letter_id = letters.id) AS file_count,
         (SELECT GROUP_CONCAT(${LETTER_NO_SQL} ORDER BY files.file_number SEPARATOR '${LETTER_NO_SEPARATOR}')
            FROM letter_files JOIN files ON files.id = letter_files.file_id
            WHERE letter_files.letter_id = letters.id) AS letter_nos
  FROM letters
  JOIN offices ON offices.id = letters.office_id
  JOIN letter_statuses ON letter_statuses.id = letters.status_id
  LEFT JOIN departments ON departments.id = letters.department_id`;

// Up to ~160 characters of a letter's text around the first match of q, for search results; null when q isn't in it.
const SNIPPET_CONTEXT = 70;
function snippet(content, q) {
  if (!content || !q) return null;
  const at = content.toLowerCase().indexOf(q.toLowerCase());
  if (at === -1) return null;
  const start = Math.max(0, at - SNIPPET_CONTEXT);
  const end = Math.min(content.length, at + q.length + SNIPPET_CONTEXT);
  const text = content.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${text}${end < content.length ? '…' : ''}`;
}

const findLetter = async (letterId) => toLetter((await query(`${LETTERS} WHERE letters.id = ?`, [letterId]))[0]);

const FILES_WITH_LOCATION = `
  SELECT files.*, boxes.name AS box_name, areas.name AS area_name, areas.office_id, offices.name AS office_name,
         letter_files.bil_no, ${LETTER_NO_SQL} AS letter_no
  FROM letter_files
  JOIN files ON files.id = letter_files.file_id
  LEFT JOIN boxes ON boxes.id = files.box_id
  LEFT JOIN areas ON areas.id = boxes.area_id
  LEFT JOIN offices ON offices.id = areas.office_id`;

// Reads and checks the letter form for a letter going in `direction`. Returns { error } or { values }.
async function readLetter(body, direction, { requireStatus }) {
  const inbound = direction === 'inbound';
  const values = {
    officeId: clean(body.officeId),
    referenceNo: clean(body.referenceNo) || null,
    sender: inbound ? clean(body.sender) : null,
    recipient: inbound ? null : clean(body.recipient),
    subject: clean(body.subject),
    letterDate: clean(body.letterDate) || null,
    receivedDate: inbound ? clean(body.receivedDate) : null,
    sentDate: inbound ? null : clean(body.sentDate) || null,
    notes: clean(body.notes) || null,
    content: clean(body.content) || null,
    fileIds: Array.isArray(body.fileIds) ? [...new Set(body.fileIds.filter((f) => typeof f === 'string' && f))] : [],
  };
  if (!values.officeId) return { error: `Choose the office that ${inbound ? 'received' : 'sent'} the letter.` };
  if (inbound && !values.sender) return { error: 'Enter who the letter is from.' };
  if (!inbound && !values.recipient) return { error: 'Enter who the letter is to.' };
  if (!values.subject) return { error: 'Enter the subject of the letter.' };
  if (inbound && !DATE_RE.test(values.receivedDate)) return { error: 'Enter the date the letter was received.' };
  if (values.sentDate && !DATE_RE.test(values.sentDate)) return { error: 'Date sent must be a valid date.' };
  if (values.letterDate && !DATE_RE.test(values.letterDate)) return { error: 'Letter date must be a valid date.' };
  if (values.content && values.content.length > MAX_CONTENT) return { error: 'The letter text is too long.' };
  if (requireStatus) {
    const status = await readStatus(body.statusId, direction);
    if (status.error) return status;
    const department = await readDepartment(body.departmentId);
    if (department.error) return department;
    values.status = status.status;
    values.department = department.department;
  }
  return { values };
}

// A status is required and must belong to the letter's direction; with none given, that direction's first one
// (e.g. "Received" or "Draft") is used.
async function readStatus(statusId, direction) {
  const sid = clean(statusId);
  const [row] = sid
    ? await query('SELECT * FROM letter_statuses WHERE id = ? AND direction = ?', [sid, direction])
    : await query('SELECT * FROM letter_statuses WHERE direction = ? ORDER BY position LIMIT 1', [direction]);
  if (!row) return { error: sid ? 'Choose a valid status.' : `Add an ${direction} letter status under Settings first.` };
  return { status: toStatus(row) };
}

// A department is optional: '' or null means none.
async function readDepartment(departmentId) {
  const did = clean(departmentId);
  if (!did) return { department: null };
  const [row] = await query('SELECT * FROM departments WHERE id = ?', [did]);
  if (!row) return { error: 'Choose a valid department.' };
  return { department: toDepartment(row) };
}

// Thrown inside a transaction when a chosen file has gone; turned into a 400 by the route.
class MissingFileError extends Error {}

// Makes the letter's files exactly fileIds. Files it stays in keep their numbers; each newly added file gives the
// letter its next number. LAST_INSERT_ID(expr) bumps the file's counter and reads it back in one atomic step,
// so two letters saved at once never get the same number.
async function setLetterFiles(conn, letterId, fileIds) {
  const [current] = await conn.query('SELECT file_id FROM letter_files WHERE letter_id = ?', [letterId]);
  const have = new Set(current.map((r) => r.file_id));
  const removed = [...have].filter((f) => !fileIds.includes(f));
  if (removed.length) await conn.query('DELETE FROM letter_files WHERE letter_id = ? AND file_id IN (?)', [letterId, removed]);
  for (const fileId of fileIds) {
    if (have.has(fileId)) continue;
    const [bump] = await conn.query('UPDATE files SET letter_counter = LAST_INSERT_ID(letter_counter + 1) WHERE id = ?', [fileId]);
    if (bump.affectedRows === 0) throw new MissingFileError();
    await conn.query('INSERT INTO letter_files (letter_id, file_id, bil_no) VALUES (?, ?, ?)', [letterId, fileId, bump.insertId]);
  }
}

// Runs fn(conn) in a transaction.
async function inTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// How a letter is named in the audit trail: its reference, or its subject when it has none.
const letterLabel = (l) => `${l.direction} letter ${l.referenceNo ? `${l.referenceNo} ` : ''}"${l.subject}"`;
const findName = async (table, rowId) => (await query(`SELECT name FROM ${table} WHERE id = ?`, [rowId]))[0]?.name;

const letterSaveError = (err, res) => {
  if (err instanceof MissingFileError || isDbError(err, 'ER_NO_REFERENCED_ROW_2'))
    return res.status(400).json({ error: 'The office or one of the files no longer exists. Reload and try again.' });
  throw err;
};

export function registerLetterRoutes(app) {
  // ---- Letter text from a photo ----
  // Send one photo as the request body (Content-Type image/jpeg, png or webp); get back { text, fields }. fields holds
  // the details Claude found on the page ({ referenceNo, letterDate, sender, recipient, subject }, '' when not shown),
  // or is null when the page was read by Tesseract. The photo is read in memory and dropped afterwards: it's never
  // saved. The text and details go into the letter form to check and save.
  app.post('/api/letters/read-text', express.raw({ type: PHOTO_TYPES, limit: MAX_PHOTO }), route(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !isPhoto(req.body))
      return res.status(400).json({ error: 'Send a photo (JPEG, PNG or WebP) of the letter.' });
    let result = null;
    if (claudeEnabled()) {
      try {
        result = await readLetterImage(req.body, req.get('content-type').split(';')[0].trim());
      } catch (err) {
        console.error('Reading a letter with Claude failed; reading it with Tesseract instead:', err.status ?? '', err.message ?? err);
      }
    }
    if (!result) {
      try {
        result = { text: await readText(req.body), fields: null };
      } catch (err) {
        console.error('Reading letter text failed:', err.message ?? err);
        return res.status(422).json({ error: "Couldn't read this photo. Try a clearer, flatter photo in good light." });
      }
    }
    const by = result.fields ? 'Claude' : 'Tesseract';
    audit(res, { action: 'letter.read_text', targetId: null, summary: `Read text from a letter photo with ${by} (${result.text.length} characters)` });
    res.json(result);
  }));

  // ---- Letter details from its text ----
  // For a PDF that already holds its text: send { text }, get back { fields } as above, or { fields: null } when
  // Claude isn't set up or couldn't read it (the form then just isn't filled in).
  app.post('/api/letters/read-fields', route(async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, MAX_CONTENT) : '';
    if (!text || !claudeEnabled()) return res.json({ fields: null });
    try {
      res.json({ fields: await readLetterFields(text) });
    } catch (err) {
      console.error('Reading letter details with Claude failed:', err.status ?? '', err.message ?? err);
      res.json({ fields: null });
    }
  }));

  // ---- Letter statuses (admin) ----
  // ?direction=inbound|outbound lists one direction's statuses; without it, both.
  app.get('/api/letter-statuses', route(async (req, res) => {
    const direction = clean(req.query.direction);
    const rows = DIRECTIONS.includes(direction)
      ? await query('SELECT * FROM letter_statuses WHERE direction = ? ORDER BY position, name', [direction])
      : await query('SELECT * FROM letter_statuses ORDER BY direction, position, name');
    res.json(rows.map(toStatus));
  }));

  const nameTaken = (what) => `A ${what} with this name already exists${what === 'status' ? ' for these letters' : ''}.`;

  app.post('/api/letter-statuses', requireAdmin, route(async (req, res) => {
    const name = clean(req.body.name);
    if (!name) return res.status(400).json({ error: 'Status name is required.' });
    const direction = readDirection(req.body.direction);
    const [{ next }] = await query('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM letter_statuses WHERE direction = ?', [direction]);
    const status = { id: id(), direction, name, position: next };
    try {
      await query('INSERT INTO letter_statuses (id, direction, name, position, created_at) VALUES (?, ?, ?, ?, ?)', [
        status.id,
        direction,
        name,
        next,
        new Date(),
      ]);
    } catch (err) {
      if (isDbError(err, 'ER_DUP_ENTRY')) return res.status(409).json({ error: nameTaken('status') });
      throw err;
    }
    audit(res, { targetId: status.id, officeId: null, summary: `Added ${direction} letter status "${name}"` });
    res.status(201).json(status);
  }));

  app.put('/api/letter-statuses/:id', requireAdmin, route(async (req, res) => {
    const name = clean(req.body.name);
    if (!name) return res.status(400).json({ error: 'Status name is required.' });
    const [old] = await query('SELECT * FROM letter_statuses WHERE id = ?', [req.params.id]);
    if (old) audit(res, { officeId: null, summary: `Renamed ${old.direction} letter status "${old.name}" to "${name}"` });
    try {
      const result = await query('UPDATE letter_statuses SET name = ? WHERE id = ?', [name, req.params.id]);
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Status not found.' });
    } catch (err) {
      if (isDbError(err, 'ER_DUP_ENTRY')) return res.status(409).json({ error: nameTaken('status') });
      throw err;
    }
    res.status(204).end();
  }));

  // Moves a status one place up or down its direction's list (the order the status pickers show).
  app.post('/api/letter-statuses/:id/move', requireAdmin, route(async (req, res) => {
    const up = req.body.direction === 'up';
    const [moving] = await query('SELECT * FROM letter_statuses WHERE id = ?', [req.params.id]);
    if (!moving) return res.status(404).json({ error: 'Status not found.' });
    const rows = (await query('SELECT * FROM letter_statuses WHERE direction = ? ORDER BY position, name', [moving.direction])).map(toStatus);
    const i = rows.findIndex((s) => s.id === req.params.id);
    if (i === -1) return res.status(404).json({ error: 'Status not found.' });
    const j = up ? i - 1 : i + 1;
    if (j >= 0 && j < rows.length) {
      [rows[i], rows[j]] = [rows[j], rows[i]];
      await inTransaction(async (conn) => {
        for (const [n, s] of rows.entries()) await conn.query('UPDATE letter_statuses SET position = ? WHERE id = ?', [n + 1, s.id]);
      });
    }
    audit(res, {
      action: 'status.move',
      officeId: null,
      summary: `Moved ${moving.direction} letter status "${moving.name}" ${up ? 'up' : 'down'} (now ${rows.findIndex((s) => s.id === moving.id) + 1} of ${rows.length})`,
    });
    res.status(204).end();
  }));

  app.delete('/api/letter-statuses/:id', requireAdmin, route(async (req, res) => {
    const [old] = await query('SELECT * FROM letter_statuses WHERE id = ?', [req.params.id]);
    audit(res, old ? { officeId: null, summary: `Removed ${old.direction} letter status "${old.name}"` } : { skip: true });
    try {
      await query('DELETE FROM letter_statuses WHERE id = ?', [req.params.id]);
    } catch (err) {
      if (isDbError(err, 'ER_ROW_IS_REFERENCED_2'))
        return res.status(409).json({ error: 'Letters still have this status. Move them to another status first.' });
      throw err;
    }
    res.status(204).end();
  }));

  // ---- Departments (admin) ----
  app.get('/api/departments', route(async (req, res) => {
    res.json((await query('SELECT * FROM departments ORDER BY name')).map(toDepartment));
  }));

  app.post('/api/departments', requireAdmin, route(async (req, res) => {
    const name = clean(req.body.name);
    if (!name) return res.status(400).json({ error: 'Department name is required.' });
    const department = { id: id(), name };
    try {
      await query('INSERT INTO departments (id, name, created_at) VALUES (?, ?, ?)', [department.id, name, new Date()]);
    } catch (err) {
      if (isDbError(err, 'ER_DUP_ENTRY')) return res.status(409).json({ error: nameTaken('department') });
      throw err;
    }
    audit(res, { targetId: department.id, officeId: null, summary: `Added department "${name}"` });
    res.status(201).json(department);
  }));

  app.put('/api/departments/:id', requireAdmin, route(async (req, res) => {
    const name = clean(req.body.name);
    if (!name) return res.status(400).json({ error: 'Department name is required.' });
    const oldName = await findName('departments', req.params.id);
    if (oldName) audit(res, { officeId: null, summary: `Renamed department "${oldName}" to "${name}"` });
    try {
      const result = await query('UPDATE departments SET name = ? WHERE id = ?', [name, req.params.id]);
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Department not found.' });
    } catch (err) {
      if (isDbError(err, 'ER_DUP_ENTRY')) return res.status(409).json({ error: nameTaken('department') });
      throw err;
    }
    res.status(204).end();
  }));

  app.delete('/api/departments/:id', requireAdmin, route(async (req, res) => {
    const oldName = await findName('departments', req.params.id);
    audit(res, oldName ? { officeId: null, summary: `Removed department "${oldName}"` } : { skip: true });
    try {
      await query('DELETE FROM departments WHERE id = ?', [req.params.id]);
    } catch (err) {
      if (isDbError(err, 'ER_ROW_IS_REFERENCED_2'))
        return res.status(409).json({ error: 'Letters are still assigned to this department. Reassign them first.' });
      throw err;
    }
    res.status(204).end();
  }));

  // ---- Letters ----
  // ?q=… searches reference, sender, recipient, subject, the letter's text, and its codes and file numbers.
  // Each result carries a short snippet of its text around the match (contentSnippet), not the whole text.
  // ?direction=, ?officeId=, ?statusId= and ?departmentId= narrow the list ('none' as departmentId means unassigned).
  app.get('/api/letters', route(async (req, res) => {
    const q = clean(req.query.q);
    const where = [];
    const params = [];
    if (q) {
      where.push(`(letters.reference_no LIKE ? OR letters.sender LIKE ? OR letters.recipient LIKE ? OR letters.subject LIKE ?
        OR letters.content LIKE ? OR letters.id IN (
        SELECT letter_files.letter_id FROM letter_files JOIN files ON files.id = letter_files.file_id WHERE ${LETTER_NO_SQL} LIKE ?))`);
      params.push(...Array(6).fill(likeText(q)));
    }
    for (const [key, column] of [['direction', 'letters.direction'], ['officeId', 'letters.office_id'], ['statusId', 'letters.status_id']]) {
      const value = clean(req.query[key]);
      if (value) {
        where.push(`${column} = ?`);
        params.push(value);
      }
    }
    const departmentId = clean(req.query.departmentId);
    if (departmentId === 'none') where.push('letters.department_id IS NULL');
    else if (departmentId) {
      where.push('letters.department_id = ?');
      params.push(departmentId);
    }
    const rows = await query(
      // Newest first: by date received or sent, and by when it was recorded for drafts not sent yet.
      `${LETTERS} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY COALESCE(letters.received_date, letters.sent_date, DATE(letters.created_at)) DESC, letters.created_at DESC`,
      params
    );
    res.json(
      rows.map((r) => {
        const { content, ...letter } = toLetter(r);
        return { ...letter, hasContent: Boolean(content), contentSnippet: snippet(content, q) };
      })
    );
  }));

  app.get('/api/letters/:id', route(async (req, res) => {
    const letter = await findLetter(req.params.id);
    if (!letter) return res.status(404).json({ error: 'Letter not found.' });
    const [files, updates] = await Promise.all([
      query(`${FILES_WITH_LOCATION} WHERE letter_files.letter_id = ? ORDER BY files.file_number`, [letter.id]),
      query('SELECT * FROM letter_updates WHERE letter_id = ? ORDER BY created_at DESC', [letter.id]),
    ]);
    res.json({
      ...letter,
      files: files.map((r) => ({ ...toFile(r), bilNo: r.bil_no, letterNo: r.letter_no })),
      updates: updates.map(toUpdate),
    });
  }));

  app.post('/api/letters', route(async (req, res) => {
    const direction = readDirection(req.body.direction);
    const { values: v, error } = await readLetter(req.body, direction, { requireStatus: true });
    if (error) return res.status(400).json({ error });
    const letterId = id();
    const now = new Date();
    try {
      await inTransaction(async (conn) => {
        await conn.query(
          `INSERT INTO letters (id, office_id, direction, reference_no, sender, recipient, subject, letter_date, received_date, sent_date,
             status_id, department_id, notes, content, created_by, created_by_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [letterId, v.officeId, direction, v.referenceNo, v.sender, v.recipient, v.subject, v.letterDate, v.receivedDate, v.sentDate,
            v.status.id, v.department?.id ?? null, v.notes, v.content, req.user.id, req.user.name, now]
        );
        await setLetterFiles(conn, letterId, v.fileIds);
        await conn.query(
          'INSERT INTO letter_updates (id, letter_id, status_name, department_name, note, created_by, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id(), letterId, v.status.name, v.department?.name ?? null, 'Letter recorded.', req.user.id, req.user.name, now]
        );
      });
    } catch (err) {
      return letterSaveError(err, res);
    }
    const created = await findLetter(letterId);
    audit(res, {
      targetId: letterId,
      officeId: created.officeId,
      summary: `Recorded ${letterLabel(created)}${created.letterNos.length ? ` as ${created.letterNos.join(', ')}` : ''}`,
    });
    res.status(201).json(created);
  }));

  // Edit a letter's details and the files it's in. Status and department change through /updates, so each
  // change is kept in the letter's history.
  app.put('/api/letters/:id', route(async (req, res) => {
    const letter = await findLetter(req.params.id);
    if (!letter) return res.status(404).json({ error: 'Letter not found.' });
    const { values: v, error } = await readLetter(req.body, letter.direction, { requireStatus: false });
    if (error) return res.status(400).json({ error });
    try {
      await inTransaction(async (conn) => {
        await conn.query(
          `UPDATE letters SET office_id = ?, reference_no = ?, sender = ?, recipient = ?, subject = ?, letter_date = ?, received_date = ?,
             sent_date = ?, notes = ?, content = ?, updated_by = ?, updated_by_name = ?, updated_at = ? WHERE id = ?`,
          [v.officeId, v.referenceNo, v.sender, v.recipient, v.subject, v.letterDate, v.receivedDate, v.sentDate, v.notes,
            v.content, req.user.id, req.user.name, new Date(), letter.id]
        );
        await setLetterFiles(conn, letter.id, v.fileIds);
      });
    } catch (err) {
      return letterSaveError(err, res);
    }
    const saved = await findLetter(letter.id);
    const fields = (l) => ({
      office: l.officeName,
      reference: l.referenceNo || null,
      sender: l.sender || null,
      recipient: l.recipient || null,
      subject: l.subject,
      'letter date': l.letterDate,
      'received date': l.receivedDate,
      'sent date': l.sentDate,
      notes: l.notes || null,
      files: l.letterNos.join(', ') || null,
    });
    const diff = changes(fields(letter), fields(saved));
    // The letter's text can be long, so only say that it changed.
    if (letter.content !== saved.content) diff.text = ['(old text)', '(new text)'];
    audit(res, {
      officeId: saved.officeId,
      details: diff,
      summary: Object.keys(diff).length
        ? `Edited ${letterLabel(letter)}: ${describeChanges(diff)}`
        : `Saved ${letterLabel(letter)} (no changes)`,
    });
    res.json(saved);
  }));

  // Update a letter's status and/or department, with an optional note. Each update is added to its history.
  app.post('/api/letters/:id/updates', route(async (req, res) => {
    const letter = await findLetter(req.params.id);
    if (!letter) return res.status(404).json({ error: 'Letter not found.' });
    const status = await readStatus(req.body.statusId || letter.statusId, letter.direction);
    if (status.error) return res.status(400).json({ error: status.error });
    const department = await readDepartment(req.body.departmentId === undefined ? letter.departmentId : req.body.departmentId);
    if (department.error) return res.status(400).json({ error: department.error });
    const note = clean(req.body.note) || null;
    const statusChanged = status.status.id !== letter.statusId;
    const departmentChanged = (department.department?.id ?? null) !== letter.departmentId;
    if (!statusChanged && !departmentChanged && !note)
      return res.status(400).json({ error: 'Change the status or department, or add a note.' });
    const now = new Date();
    await inTransaction(async (conn) => {
      await conn.query(
        'UPDATE letters SET status_id = ?, department_id = ?, updated_by = ?, updated_by_name = ?, updated_at = ? WHERE id = ?',
        [status.status.id, department.department?.id ?? null, req.user.id, req.user.name, now, letter.id]
      );
      await conn.query(
        'INSERT INTO letter_updates (id, letter_id, status_name, department_name, note, created_by, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id(), letter.id, status.status.name, department.department?.name ?? null, note, req.user.id, req.user.name, now]
      );
    });
    const diff = changes(
      { status: letter.statusName, department: letter.departmentName },
      { status: status.status.name, department: department.department?.name ?? null }
    );
    audit(res, {
      action: 'letter.status',
      targetId: letter.id,
      officeId: letter.officeId,
      details: { ...diff, ...(note && { note }) },
      summary: `Updated ${letterLabel(letter)}: ${[describeChanges(diff), note && `note: ${note}`].filter(Boolean).join(', ')}`,
    });
    res.status(201).json(await findLetter(letter.id));
  }));

  app.delete('/api/letters/:id', route(async (req, res) => {
    const letter = await findLetter(req.params.id);
    if (!letter) return res.status(404).json({ error: 'Letter not found.' });
    if (!canManageOffice(req.user, letter.officeId) && letter.createdBy !== req.user.id)
      return res.status(403).json({ error: "Only an admin, this office's admin or the person who recorded this letter can remove it." });
    await query('DELETE FROM letters WHERE id = ?', [letter.id]);
    audit(res, { officeId: letter.officeId, summary: `Removed ${letterLabel(letter)}` });
    res.status(204).end();
  }));
}
