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
    role ENUM('admin', 'worker') NOT NULL DEFAULT 'worker',
    status ENUM('active', 'pending', 'rejected') NOT NULL DEFAULT 'active',
    created_at DATETIME(3) NOT NULL,
    approved_at DATETIME(3) NULL,
    approved_by VARCHAR(36) NULL,
    last_login_at DATETIME(3) NULL,
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
  `CREATE TABLE IF NOT EXISTS areas (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE
  ) ${TABLE_OPTIONS}`,
  // RESTRICT keeps an area with boxes, or a box with files, from being removed.
  `CREATE TABLE IF NOT EXISTS boxes (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    area_id CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    FOREIGN KEY (area_id) REFERENCES areas (id) ON DELETE RESTRICT
  ) ${TABLE_OPTIONS}`,
  // created_by has no foreign key: removing a user keeps the files they recorded, with their name.
  `CREATE TABLE IF NOT EXISTS files (
    id CHAR(36) PRIMARY KEY,
    file_number VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(500) NOT NULL,
    box_id CHAR(36) NOT NULL,
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
];

export async function initDb() {
  for (const sql of SCHEMA) await query(sql);
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
  };

export const toArea = (r) => r && { id: r.id, name: r.name };

export const toBox = (r) => r && { id: r.id, name: r.name, areaId: r.area_id, createdAt: r.created_at };

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
    ...('box_name' in r && { boxName: r.box_name ?? '—', areaName: r.area_name ?? '—' }),
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
