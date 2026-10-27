import crypto from 'node:crypto';
import { query, toUser } from './db.js';

const COOKIE = 'fsl_session';
const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
// Secure cookies need HTTPS; set COOKIE_SECURE=false only if the site is served over plain http.
const SECURE_COOKIE = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';

export const MIN_PASSWORD = 8;

// ---- Passwords (scrypt, per-user salt) ----
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// ---- Sessions (random token in an HTTP-only cookie, only its hash is stored) ----
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  await query('DELETE FROM sessions WHERE expires_at <= ?', [new Date(now)]);
  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
    sha256(token),
    userId,
    new Date(now + SESSION_MS),
  ]);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE_COOKIE,
    maxAge: SESSION_MS,
    path: '/',
  });
}

export async function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await query('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
  res.clearCookie(COOKIE, { path: '/' });
}

export async function endUserSessions(userId) {
  await query('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

export const isActive = (u) => u.status === 'active';

export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  email: u.email,
  role: u.role,
  status: u.status,
  google: Boolean(u.googleId),
  hasPassword: Boolean(u.passwordHash),
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
});

// ---- Middleware ----
export async function requireAuth(req, res, next) {
  try {
    const token = readCookie(req, COOKIE);
    const [row] = token
      ? await query(
          'SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?',
          [sha256(token), new Date()]
        )
      : [];
    const user = toUser(row);
    if (!user || !isActive(user)) return res.status(401).json({ error: 'Please sign in.' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  next();
}

// ---- Login throttling: 10 failed attempts per IP+username per 15 minutes ----
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const failures = new Map();

export function isThrottled(key) {
  const entry = failures.get(key);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= MAX_FAILS;
}

export function recordFailure(key) {
  const entry = failures.get(key);
  if (!entry || entry.resetAt < Date.now()) failures.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else entry.count += 1;
}

export const clearFailures = (key) => failures.delete(key);

// ---- First run: make sure an admin account exists ----
// Skipped when ADMIN_EMAIL is set: that Google account becomes admin on its first sign-in instead.
export async function ensureAdmin() {
  if (process.env.ADMIN_EMAIL) return;
  if ((await query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1")).length) return;
  const username = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  await query(
    "INSERT INTO users (id, name, username, password_hash, role, status, created_at) VALUES (?, 'Administrator', ?, ?, 'admin', 'active', ?)",
    [crypto.randomUUID(), username, hashPassword(password), new Date()]
  );
  console.log(`\nCreated admin account "${username}".`);
  if (generated) console.log(`Temporary password: ${password}\nSign in and change it under "My Account".\n`);
}
