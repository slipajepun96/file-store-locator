import './env.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, initDb, pool, query, saveSettings } from './db.js';

// One-time move from the old data.json store into MySQL: npm run db:import [path/to/data.json]
// Run it before the first start so the database is still empty. Sessions aren't copied; everyone signs in again.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || path.join(process.env.DATA_DIR || __dirname, 'data.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const date = (v) => (v ? new Date(v) : null);

await initDb();
for (const table of ['users', 'areas', 'boxes', 'files']) {
  const [{ count }] = await query(`SELECT COUNT(*) AS count FROM ${table}`);
  if (count > 0) {
    console.error(`The ${table} table already has rows. Import into an empty database.`);
    process.exit(1);
  }
}

const insert = (conn, table, columns, rows) =>
  rows.length && conn.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ?`, [rows]);

const conn = await pool.getConnection();
try {
  await conn.beginTransaction();
  await insert(
    conn,
    'users',
    ['id', 'name', 'username', 'email', 'google_id', 'password_hash', 'role', 'status', 'created_at', 'approved_at', 'approved_by', 'last_login_at'],
    (data.users ?? []).map((u) => [
      u.id, u.name, u.username ?? null, u.email ?? null, u.googleId ?? null, u.passwordHash ?? null, u.role,
      u.status ?? 'active', date(u.createdAt) ?? new Date(), date(u.approvedAt), u.approvedBy ?? null, date(u.lastLoginAt),
    ])
  );
  await insert(conn, 'areas', ['id', 'name'], (data.areas ?? []).map((a) => [a.id, a.name]));
  await insert(
    conn,
    'boxes',
    ['id', 'name', 'area_id', 'created_at'],
    (data.boxes ?? []).map((b) => [b.id, b.name, b.areaId, date(b.createdAt) ?? new Date()])
  );
  await insert(
    conn,
    'files',
    ['id', 'file_number', 'name', 'box_id', 'created_by', 'created_by_name', 'created_at', 'updated_by', 'updated_by_name', 'updated_at'],
    (data.files ?? []).map((f) => [
      f.id, f.fileNumber, f.name, f.boxId, f.createdBy ?? null, f.createdByName ?? null, date(f.createdAt) ?? new Date(),
      f.updatedBy ?? null, f.updatedByName ?? null, date(f.updatedAt),
    ])
  );
  await conn.commit();
} catch (err) {
  await conn.rollback();
  throw err;
} finally {
  conn.release();
}

const settings = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).filter((k) => k in (data.settings ?? {})).map((k) => [k, data.settings[k]]));
if (Object.keys(settings).length) await saveSettings(settings);

console.log(
  `Imported ${data.users?.length ?? 0} users, ${data.areas?.length ?? 0} areas, ${data.boxes?.length ?? 0} boxes and ${data.files?.length ?? 0} files from ${file}.`
);
await pool.end();
