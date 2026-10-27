import crypto from 'node:crypto';
import { query, toUser } from './db.js';
import { startSession } from './auth.js';

// Google OAuth 2.0 (authorization code + PKCE), done on the server so no secret reaches the browser.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const STATE_COOKIE = 'fsl_oauth';
const STATE_MS = 10 * 60 * 1000;
const SECURE_COOKIE = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';

export const googleConfigured = () => Boolean(CLIENT_ID && CLIENT_SECRET);
export const adminEmailConfigured = () => Boolean(ADMIN_EMAIL);

// APP_URL pins the public address; otherwise use the address the browser used (works behind Vite's proxy too).
function redirectUri(req) {
  const base = process.env.APP_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
  return `${base}/api/auth/google/callback`;
}

const b64url = (buf) => buf.toString('base64url');

export function startGoogleLogin(req, res) {
  if (!googleConfigured()) return res.redirect('/login?status=google-off');
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  res.cookie(STATE_COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE_COOKIE,
    maxAge: STATE_MS,
    path: '/api/auth/google',
  });
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  res.redirect(`${AUTH_URL}?${params}`);
}

function readStateCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === STATE_COOKIE) {
      const [state, verifier] = decodeURIComponent(v.join('=')).split('.');
      return { state, verifier };
    }
  }
  return {};
}

async function exchangeCode(req, code, verifier) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri(req),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
  const { id_token: idToken } = await response.json();
  // The ID token came straight from Google over TLS, so its claims can be read without
  // re-checking the signature; audience, issuer and expiry are still checked.
  const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
  if (claims.aud !== CLIENT_ID || !ISSUERS.includes(claims.iss) || claims.exp * 1000 < Date.now())
    throw new Error('Google ID token failed validation');
  return {
    sub: claims.sub,
    email: (claims.email || '').toLowerCase(),
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: claims.name || claims.email,
  };
}

// Find the account for a Google profile, creating a pending request for newcomers.
export async function resolveGoogleUser(profile) {
  if (!profile.emailVerified || !profile.email) return null;
  const now = new Date();
  const [byGoogle] = await query('SELECT * FROM users WHERE google_id = ?', [profile.sub]);
  const row =
    byGoogle ??
    // An admin may have pre-approved this email before the person first signed in.
    (await query('SELECT * FROM users WHERE google_id IS NULL AND email = ? LIMIT 1', [profile.email]))[0];
  const isNew = !row;
  const user = toUser(row) ?? {
    id: crypto.randomUUID(),
    name: profile.name,
    role: 'worker',
    status: 'pending',
    createdAt: now,
    approvedAt: null,
    approvedBy: null,
  };
  user.googleId = profile.sub;
  user.email = profile.email;
  if (!user.name) user.name = profile.name;

  if (ADMIN_EMAIL && profile.email === ADMIN_EMAIL && (user.status !== 'active' || user.role !== 'admin')) {
    user.role = 'admin';
    user.status = 'active';
    user.approvedAt = now;
    user.approvedBy = 'ADMIN_EMAIL';
  }
  user.lastLoginAt = now;

  const values = [user.name, user.email, user.googleId, user.role, user.status, user.approvedAt, user.approvedBy, now];
  if (isNew)
    await query(
      'INSERT INTO users (name, email, google_id, role, status, approved_at, approved_by, last_login_at, id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [...values, user.id, user.createdAt]
    );
  else
    await query(
      'UPDATE users SET name = ?, email = ?, google_id = ?, role = ?, status = ?, approved_at = ?, approved_by = ?, last_login_at = ? WHERE id = ?',
      [...values, user.id]
    );
  return user;
}

export async function finishGoogleLogin(req, res) {
  const { state, verifier } = readStateCookie(req);
  res.clearCookie(STATE_COOKIE, { path: '/api/auth/google' });
  if (req.query.error) return res.redirect('/login?status=cancelled');
  if (!state || !verifier || req.query.state !== state || typeof req.query.code !== 'string')
    return res.redirect('/login?status=error');
  try {
    const user = await resolveGoogleUser(await exchangeCode(req, req.query.code, verifier));
    if (!user) return res.redirect('/login?status=unverified');
    if (user.status === 'pending') return res.redirect('/login?status=pending');
    if (user.status === 'rejected') return res.redirect('/login?status=rejected');
    await startSession(res, user.id);
    res.redirect('/');
  } catch (err) {
    console.error(err.message);
    res.redirect('/login?status=error');
  }
}
