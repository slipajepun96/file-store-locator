import { isDbError, query } from './db.js';
import { requireAdmin } from './auth.js';
import { clean, id, route } from './util.js';
import { audit } from './audit.js';

// ---- Senders and recipients ----
// One shared list of the organisations letters come from and go to, offered in a letter's From / To field. Admins
// keep it tidy under Settings (add, rename, remove). Anyone signed in can add a name that isn't on it yet, from the
// letter form, and a letter saved with a new name adds that name too.
// A letter keeps the name itself as text (letters.sender / recipient), so removing a name from the list leaves the
// letters as they are. Renaming one renames it on the letters that use it, so they can still be found by it.
// Names are unique, ignoring case (the table's collation).

const MAX_NAME = 300;

const toCorrespondent = (r) => ({ id: r.id, name: r.name, letterCount: Number(r.letter_count ?? 0) });

// Adds name to the list if it isn't there (with any capitalisation). conn is a pool or a transaction's connection.
export async function rememberCorrespondent(conn, name, user) {
  if (!name) return;
  await conn.query('INSERT IGNORE INTO correspondents (id, name, created_by_name, created_at) VALUES (?, ?, ?, ?)', [
    id(),
    name.slice(0, MAX_NAME),
    user?.name ?? null,
    new Date(),
  ]);
}

// When the list is first made, it starts with every name already on a letter.
export async function seedCorrespondents() {
  await query(
    `INSERT IGNORE INTO correspondents (id, name, created_at)
     SELECT UUID(), name, NOW(3) FROM (
       SELECT TRIM(sender) AS name FROM letters WHERE sender IS NOT NULL AND TRIM(sender) <> ''
       UNION SELECT TRIM(recipient) FROM letters WHERE recipient IS NOT NULL AND TRIM(recipient) <> ''
     ) names`
  );
}

const nameTaken = { error: 'This name is already on the list.' };

export function registerCorrespondentRoutes(app) {
  // The whole list, A–Z, each with how many letters use it (as sender or recipient). The form filters it as you type.
  app.get('/api/correspondents', route(async (req, res) => {
    const rows = await query(
      `SELECT correspondents.*,
         (SELECT COUNT(*) FROM letters WHERE letters.sender = correspondents.name OR letters.recipient = correspondents.name) AS letter_count
       FROM correspondents ORDER BY name`
    );
    res.json(rows.map(toCorrespondent));
  }));

  // Anyone signed in can add a name. Adding one that's already there (any capitalisation) returns that one.
  app.post('/api/correspondents', route(async (req, res) => {
    const name = clean(req.body.name).replace(/\s+/g, ' ');
    if (!name) return res.status(400).json({ error: 'Enter a name.' });
    if (name.length > MAX_NAME) return res.status(400).json({ error: `Keep the name under ${MAX_NAME} characters.` });
    const [existing] = await query('SELECT * FROM correspondents WHERE name = ?', [name]);
    if (existing) {
      audit(res, { skip: true });
      return res.json(toCorrespondent(existing));
    }
    const correspondent = { id: id(), name, letterCount: 0 };
    try {
      await query('INSERT INTO correspondents (id, name, created_by_name, created_at) VALUES (?, ?, ?, ?)', [
        correspondent.id,
        name,
        req.user.name,
        new Date(),
      ]);
    } catch (err) {
      if (isDbError(err, 'ER_DUP_ENTRY')) return res.status(409).json(nameTaken);
      throw err;
    }
    audit(res, { targetId: correspondent.id, officeId: null, summary: `Added "${name}" to senders and recipients` });
    res.status(201).json(correspondent);
  }));

  // Rename a name, and the letters that use it with it.
  app.put('/api/correspondents/:id', requireAdmin, route(async (req, res) => {
    const name = clean(req.body.name).replace(/\s+/g, ' ');
    if (!name) return res.status(400).json({ error: 'Enter a name.' });
    if (name.length > MAX_NAME) return res.status(400).json({ error: `Keep the name under ${MAX_NAME} characters.` });
    const [old] = await query('SELECT * FROM correspondents WHERE id = ?', [req.params.id]);
    if (!old) return res.status(404).json({ error: 'Name not found.' });
    try {
      await query('UPDATE correspondents SET name = ? WHERE id = ?', [name, old.id]);
    } catch (err) {
      if (isDbError(err, 'ER_DUP_ENTRY')) return res.status(409).json(nameTaken);
      throw err;
    }
    const sent = await query('UPDATE letters SET sender = ? WHERE sender = ?', [name, old.name]);
    const received = await query('UPDATE letters SET recipient = ? WHERE recipient = ?', [name, old.name]);
    const letters = sent.affectedRows + received.affectedRows;
    audit(res, {
      officeId: null,
      details: { name: [old.name, name] },
      summary: `Renamed sender/recipient "${old.name}" to "${name}"${letters ? ` (${letters} letter${letters > 1 ? 's' : ''} updated)` : ''}`,
    });
    res.json({ id: old.id, name, letterCount: letters });
  }));

  // Takes the name off the list. Letters that use it keep it.
  app.delete('/api/correspondents/:id', requireAdmin, route(async (req, res) => {
    const [old] = await query('SELECT * FROM correspondents WHERE id = ?', [req.params.id]);
    audit(res, old ? { officeId: null, summary: `Removed "${old.name}" from senders and recipients` } : { skip: true });
    await query('DELETE FROM correspondents WHERE id = ?', [req.params.id]);
    res.status(204).end();
  }));
}
