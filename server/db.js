import crypto from 'node:crypto';
import mysql from 'mysql2/promise';

// Connect with DATABASE_URL (mysql://user:pass@host:3306/dbname) or the separate MYSQL_* settings.
const connection = process.env.DATABASE_URL
  ? { uri: process.env.DATABASE_URL }
  : {
      host: process.env.MYSQL_HOST || 'localhost',
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'file_store_locator',
    };

export const pool = mysql.createPool({
  ...connection,
  connectionLimit: 10,
  timezone: 'Z', // store and read DATETIMEs as UTC
  decimalNumbers: true,
  charset: 'utf8mb4',
});

export async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export const isDbError = (err, code) => err?.code === code;

// Text columns use a case-insensitive collation, so unique names ignore case like before.
const TABLE_OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    username VARCHAR(100) NULL UNIQUE,
    email VARCHAR(254) NULL,
    google_id VARCHAR(255) NULL UNIQUE,
    password_hash VARCHAR(255) NULL,
    role ENUM('admin', 'office_admin', 'worker') NOT NULL DEFAULT 'worker',
    status ENUM('active', 'pending', 'rejected') NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL,
    approved_at DATETIME(3) NULL,
    approved_by VARCHAR(36) NULL,
    last_login_at DATETIME(3) NULL,
    office_id CHAR(36) NULL,
    INDEX users_email (email),
    INDEX users_status (status)
  ) ${TABLE_OPTIONS}`,
  // Only a hash of each session token is stored.
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    INDEX sessions_expires (expires_at),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,
  `CREATE TABLE IF NOT EXISTS offices (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    created_at DATETIME(3) NOT NULL
  ) ${TABLE_OPTIONS}`,
  // Area names are unique within an office; box names and file numbers are unique across all offices.
  // RESTRICT keeps an office with areas, an area with boxes, or a box with files, from being removed.
  `CREATE TABLE IF NOT EXISTS areas (
    id CHAR(36) PRIMARY KEY,
    office_id CHAR(36) NOT NULL,
    name VARCHAR(200) NOT NULL,
    UNIQUE KEY areas_office_name (office_id, name),
    CONSTRAINT areas_office FOREIGN KEY (office_id) REFERENCES offices (id) ON DELETE RESTRICT
  ) ${TABLE_OPTIONS}`,
  `CREATE TABLE IF NOT EXISTS boxes (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    area_id CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    FOREIGN KEY (area_id) REFERENCES areas (id) ON DELETE RESTRICT
  ) ${TABLE_OPTIONS}`,
  // created_by has no foreign key: removing a user keeps the files they recorded, with their name.
  // letter_counter is the last letter number (Bil.) used in the file; the next letter filed in it gets one more.
  `CREATE TABLE IF NOT EXISTS files (
    id CHAR(36) PRIMARY KEY,
    file_number VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(500) NOT NULL,
    box_id CHAR(36) NOT NULL,
    letter_counter INT NOT NULL DEFAULT 0,
    created_by CHAR(36) NULL,
    created_by_name VARCHAR(200) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_by CHAR(36) NULL,
    updated_by_name VARCHAR(200) NULL,
    updated_at DATETIME(3) NULL,
    INDEX files_created (created_at),
    FOREIGN KEY (box_id) REFERENCES boxes (id) ON DELETE RESTRICT
  ) ${TABLE_OPTIONS}`,
  `CREATE TABLE IF NOT EXISTS settings (
    name VARCHAR(64) PRIMARY KEY,
    value DECIMAL(6, 1) NOT NULL
  ) ${TABLE_OPTIONS}`,
  // ---- Letters (inbound and outbound) ----
  // Statuses and departments are set by admins under Settings and shared by every office.
  // Inbound and outbound letters each have their own list of statuses.
  `CREATE TABLE IF NOT EXISTS letter_statuses (
    id CHAR(36) PRIMARY KEY,
    direction ENUM('inbound', 'outbound') NOT NULL DEFAULT 'inbound',
    name VARCHAR(100) NOT NULL,
    position INT NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY letter_statuses_direction_name (direction, name)
  ) ${TABLE_OPTIONS}`,
  `CREATE TABLE IF NOT EXISTS departments (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    created_at DATETIME(3) NOT NULL
  ) ${TABLE_OPTIONS}`,
  // An inbound letter has a sender and the date it was received; an outbound letter has a recipient and the date
  // it was sent (blank while it's still a draft). content is the letter's text, read from photos of it (the photos
  // themselves are never kept). RESTRICT keeps a status or department that letters still use from being removed.
  `CREATE TABLE IF NOT EXISTS letters (
    id CHAR(36) PRIMARY KEY,
    office_id CHAR(36) NOT NULL,
    direction ENUM('inbound', 'outbound') NOT NULL DEFAULT 'inbound',
    reference_no VARCHAR(100) NULL,
    sender VARCHAR(300) NULL,
    recipient VARCHAR(300) NULL,
    subject VARCHAR(500) NOT NULL,
    letter_date DATE NULL,
    received_date DATE NULL,
    sent_date DATE NULL,
    status_id CHAR(36) NOT NULL,
    department_id CHAR(36) NULL,
    notes TEXT NULL,
    content MEDIUMTEXT NULL,
    created_by CHAR(36) NULL,
    created_by_name VARCHAR(200) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_by CHAR(36) NULL,
    updated_by_name VARCHAR(200) NULL,
    updated_at DATETIME(3) NULL,
    INDEX letters_received (received_date),
    CONSTRAINT letters_office FOREIGN KEY (office_id) REFERENCES offices (id) ON DELETE RESTRICT,
    CONSTRAINT letters_status FOREIGN KEY (status_id) REFERENCES letter_statuses (id) ON DELETE RESTRICT,
    CONSTRAINT letters_department FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE RESTRICT
  ) ${TABLE_OPTIONS}`,
  // Files a letter is filed into, each with the letter's number in that file (its code is "<file number>/Bil. (<bil_no>)").
  // Removing a letter or a file just drops the link; its number isn't reused.
  `CREATE TABLE IF NOT EXISTS letter_files (
    letter_id CHAR(36) NOT NULL,
    file_id CHAR(36) NOT NULL,
    bil_no INT NOT NULL,
    PRIMARY KEY (letter_id, file_id),
    UNIQUE KEY letter_files_file_bil (file_id, bil_no),
    CONSTRAINT letter_files_letter FOREIGN KEY (letter_id) REFERENCES letters (id) ON DELETE CASCADE,
    CONSTRAINT letter_files_file FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,
  // A letter's history: each status or department change, with the names as they were at the time.
  `CREATE TABLE IF NOT EXISTS letter_updates (
    id CHAR(36) PRIMARY KEY,
    letter_id CHAR(36) NOT NULL,
    status_name VARCHAR(100) NULL,
    department_name VARCHAR(200) NULL,
    note TEXT NULL,
    created_by CHAR(36) NULL,
    created_by_name VARCHAR(200) NULL,
    created_at DATETIME(3) NOT NULL,
    INDEX letter_updates_letter (letter_id, created_at),
    CONSTRAINT letter_updates_letter FOREIGN KEY (letter_id) REFERENCES letters (id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,
  // The audit trail: one row per change anyone makes (see audit.js). Names are copied in, and there are no foreign
  // keys, so entries stay as they were even after the user or thing they mention is removed.
  `CREATE TABLE IF NOT EXISTS audit_log (
    id CHAR(36) PRIMARY KEY,
    created_at DATETIME(3) NOT NULL,
    user_id CHAR(36) NULL,
    user_name VARCHAR(200) NULL,
    user_role VARCHAR(20) NULL,
    office_id CHAR(36) NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NULL,
    target_id VARCHAR(64) NULL,
    summary VARCHAR(500) NOT NULL,
    details TEXT NULL,
    method VARCHAR(10) NULL,
    path VARCHAR(300) NULL,
    status_code SMALLINT NULL,
    ip VARCHAR(64) NULL,
    INDEX audit_created (created_at, id),
    INDEX audit_user (user_id, created_at),
    INDEX audit_office (office_id, created_at),
    INDEX audit_target (target_type, created_at)
  ) ${TABLE_OPTIONS}`,
];

const DEFAULT_LETTER_STATUSES = {
  inbound: ['Received', 'In progress', 'Replied', 'Closed'],
  outbound: ['Draft', 'Awaiting approval', 'Sent'],
};

// Each direction starts with a few statuses; admins can rename, reorder or remove them.
async function seedLetterStatuses() {
  for (const [direction, names] of Object.entries(DEFAULT_LETTER_STATUSES)) {
    const [{ count }] = await query('SELECT COUNT(*) AS count FROM letter_statuses WHERE direction = ?', [direction]);
    if (count > 0) continue;
    const now = new Date();
    const rows = names.map((name, i) => [crypto.randomUUID(), direction, name, i + 1, now]);
    await query('INSERT INTO letter_statuses (id, direction, name, position, created_at) VALUES ?', [rows]);
  }
}

// Letter tables made before outbound letters existed: every letter and status there is inbound.
// Databases from before letter numbers: give each file a running number, and number the letters already in each
// file 1, 2, 3… in the order they were recorded.
async function migrateLetterNumbers() {
  if (!(await hasColumn('files', 'letter_counter'))) {
    await query('ALTER TABLE files ADD COLUMN letter_counter INT NOT NULL DEFAULT 0 AFTER box_id');
  }
  if (!(await hasColumn('letter_files', 'bil_no'))) {
    await query('ALTER TABLE letter_files ADD COLUMN bil_no INT NULL AFTER file_id');
    await query(
      `UPDATE letter_files JOIN (
         SELECT lf.letter_id, lf.file_id, ROW_NUMBER() OVER (PARTITION BY lf.file_id ORDER BY l.created_at, l.id) AS n
         FROM letter_files lf JOIN letters l ON l.id = lf.letter_id
       ) numbered ON numbered.letter_id = letter_files.letter_id AND numbered.file_id = letter_files.file_id
       SET letter_files.bil_no = numbered.n`
    );
    await query(
      `UPDATE files JOIN (SELECT file_id, MAX(bil_no) AS last FROM letter_files GROUP BY file_id) used ON used.file_id = files.id
       SET files.letter_counter = GREATEST(files.letter_counter, used.last)`
    );
    await query(
      `ALTER TABLE letter_files
         MODIFY bil_no INT NOT NULL,
         DROP INDEX letter_files_file,
         ADD UNIQUE KEY letter_files_file_bil (file_id, bil_no)`
    );
  }
}

async function migrateLetterDirections() {
  if (!(await hasColumn('letter_statuses', 'direction'))) {
    await query(
      `ALTER TABLE letter_statuses
         ADD COLUMN direction ENUM('inbound', 'outbound') NOT NULL DEFAULT 'inbound' AFTER id,
         DROP INDEX name,
         ADD UNIQUE KEY letter_statuses_direction_name (direction, name)`
    );
  }
  if (!(await hasColumn('letters', 'direction'))) {
    await query(
      `ALTER TABLE letters
         ADD COLUMN direction ENUM('inbound', 'outbound') NOT NULL DEFAULT 'inbound' AFTER office_id,
         MODIFY sender VARCHAR(300) NULL,
         ADD COLUMN recipient VARCHAR(300) NULL AFTER sender,
         MODIFY received_date DATE NULL,
         ADD COLUMN sent_date DATE NULL AFTER received_date`
    );
  }
}

export async function initDb() {
  for (const sql of SCHEMA) await query(sql);
  await migrateToOffices();
  await migrateLetterDirections();
  await migrateLetterNumbers();
  if (!(await hasColumn('letters', 'content'))) await query('ALTER TABLE letters ADD COLUMN content MEDIUMTEXT NULL AFTER notes');
  await seedLetterStatuses();
}

const hasColumn = async (table, column) =>
  (
    await query(
      'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
      [table, column]
    )
  ).length > 0;

// Databases created before offices existed: put every existing area into a "Main office",
// and give users a home office and the office_admin role.
async function migrateToOffices() {
  if (!(await hasColumn('users', 'office_id'))) {
    await query('ALTER TABLE users ADD COLUMN office_id CHAR(36) NULL');
  }
  const [roleCol] = await query(
    "SELECT column_type AS type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'role'"
  );
  if (!roleCol.type.includes('office_admin')) {
    await query("ALTER TABLE users MODIFY role ENUM('admin', 'office_admin', 'worker') NOT NULL DEFAULT 'worker'");
  }
  if (!(await hasColumn('areas', 'office_id'))) {
    await query('ALTER TABLE areas ADD COLUMN office_id CHAR(36) NULL AFTER id');
    const [{ count }] = await query('SELECT COUNT(*) AS count FROM areas');
    if (count > 0) {
      const officeId = await ensureDefaultOffice();
      await query('UPDATE areas SET office_id = ?', [officeId]);
    }
    await query(
      `ALTER TABLE areas
         MODIFY office_id CHAR(36) NOT NULL,
         DROP INDEX name,
         ADD UNIQUE KEY areas_office_name (office_id, name),
         ADD CONSTRAINT areas_office FOREIGN KEY (office_id) REFERENCES offices (id) ON DELETE RESTRICT`
    );
    console.log('Added offices: existing areas were moved into "Main office". Rename it under Admin → Offices.');
  }
}

// Returns the first office, creating "Main office" if there is none (used when moving older data in).
export async function ensureDefaultOffice(conn = pool) {
  const [[existing]] = await conn.query('SELECT id FROM offices ORDER BY created_at LIMIT 1');
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await conn.query("INSERT INTO offices (id, name, created_at) VALUES (?, 'Main office', ?)", [id, new Date()]);
  return id;
}

// ---- Rows → API objects ----
export const toUser = (r) =>
  r && {
    id: r.id,
    name: r.name,
    username: r.username,
    email: r.email,
    googleId: r.google_id,
    passwordHash: r.password_hash,
    role: r.role,
    status: r.status,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
    approvedBy: r.approved_by,
    lastLoginAt: r.last_login_at,
    officeId: r.office_id ?? null,
  };

export const toOffice = (r) => r && { id: r.id, name: r.name, createdAt: r.created_at };

export const toArea = (r) => r && { id: r.id, name: r.name, officeId: r.office_id };

// Box rows read with BOXES_WITH_OFFICE also carry their area's office.
export const toBox = (r) =>
  r && {
    id: r.id,
    name: r.name,
    areaId: r.area_id,
    createdAt: r.created_at,
    ...('office_id' in r && { officeId: r.office_id }),
  };

export const toFile = (r) =>
  r && {
    id: r.id,
    fileNumber: r.file_number,
    name: r.name,
    boxId: r.box_id,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedByName: r.updated_by_name,
    updatedAt: r.updated_at,
    letterCounter: r.letter_counter ?? 0,
    ...('box_name' in r && {
      boxName: r.box_name ?? '—',
      areaName: r.area_name ?? '—',
      officeId: r.office_id ?? null,
      officeName: r.office_name ?? '—',
    }),
  };

// ---- Settings (label sizes), stored as name/value rows over these defaults ----
export const DEFAULT_SETTINGS = { labelWidthMm: 30, labelHeightMm: 200, fileLabelWidthMm: 100, fileLabelHeightMm: 50 };

export async function getSettings() {
  const rows = await query('SELECT name, value FROM settings');
  const settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.name in settings) settings[r.name] = Number(r.value);
  return settings;
}

export async function saveSettings(values) {
  const rows = Object.entries(values).map(([name, value]) => [name, value]);
  await query('INSERT INTO settings (name, value) VALUES ? ON DUPLICATE KEY UPDATE value = VALUES(value)', [rows]);
}
