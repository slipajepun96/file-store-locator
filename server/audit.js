import { query } from './db.js';
import { clean, id, likeText, route } from './util.js';
import { requireManager } from './auth.js';

// ---- Audit trail ----
// Every change anyone makes (create, edit, remove, approve, sign in and out) gets one row in audit_log, with who
// did it, when, and a readable summary. Entries are only ever added, never edited or removed through the app.
//
// auditTrail (mounted on /api) writes the row once a POST/PUT/PATCH/DELETE has succeeded. A route describes what
// it did with audit(res, { summary, ... }); a change without one is still written, with its method and path.
// Failed requests are skipped unless the route sets always: true (e.g. a wrong password).

const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const VERB = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };
// The first path segment after /api names what was changed.
const TARGETS = {
  auth: 'auth',
  users: 'account',
  offices: 'office',
  areas: 'area',
  boxes: 'box',
  files: 'file',
  letters: 'letter',
  'letter-statuses': 'status',
  departments: 'department',
  settings: 'settings',
};
export const AUDIT_TARGETS = [...new Set(Object.values(TARGETS))];

const MAX_SUMMARY = 500;
const MAX_DETAILS = 4000;

// Adds to the description of what this request did.
export const audit = (res, entry) => {
  res.locals.audit = { ...res.locals.audit, ...entry };
};

// Lists changed fields as { field: [before, after] }, leaving out the ones that stayed the same.
export function changes(before, after) {
  const out = {};
  for (const [key, value] of Object.entries(after)) {
    const old = before[key] ?? null;
    if ((value ?? null) !== old) out[key] = [old, value ?? null];
  }
  return out;
}

// "name: A → B, box: X → Y", for summaries.
export const describeChanges = (diff) =>
  Object.entries(diff)
    .map(([field, [from, to]]) => `${field}: ${from ?? '—'} → ${to ?? '—'}`)
    .join(', ');

function targetOf(path) {
  const [, , segment, targetId] = path.split('/'); // '', 'api', 'files', '<id>'
  return { targetType: TARGETS[segment] ?? segment ?? null, targetId: targetId && targetId.length <= 64 ? targetId : null };
}

const cut = (text, max) => (text && text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Writes one row. actor is the signed-in user (or the account a sign-in was for); req gives the IP and path.
export async function recordAudit(req, { actor, at, method, path, statusCode, ...entry }) {
  const target = targetOf(path ?? '');
  const action = entry.action ?? `${target.targetType ?? 'request'}.${VERB[method] ?? 'view'}`;
  const details = entry.details && Object.keys(entry.details).length ? cut(JSON.stringify(entry.details), MAX_DETAILS) : null;
  await query(
    `INSERT INTO audit_log (id, created_at, user_id, user_name, user_role, office_id, action, target_type, target_id, summary,
       details, method, path, status_code, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id(),
      at ?? new Date(),
      actor?.id ?? null,
      cut(entry.userName ?? actor?.name ?? null, 200),
      actor?.role ?? null,
      entry.officeId !== undefined ? entry.officeId : actor?.officeId ?? null,
      action,
      entry.targetType ?? target.targetType,
      entry.targetId ?? target.targetId,
      cut(entry.summary ?? `${method} ${path}`, MAX_SUMMARY),
      details,
      method ?? null,
      cut(path ?? null, 300),
      statusCode ?? null,
      req.ip ?? null,
    ]
  );
}

export function auditTrail(req, res, next) {
  if (!CHANGES.has(req.method)) return next();
  const at = new Date();
  res.on('finish', () => {
    const entry = res.locals.audit ?? {};
    if (entry.skip || (res.statusCode >= 400 && !entry.always)) return;
    recordAudit(req, {
      ...entry,
      actor: entry.actor !== undefined ? entry.actor : req.user,
      at,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      statusCode: res.statusCode,
    }).catch((err) => console.error('Could not write audit entry:', err.message));
  });
  next();
}

// ---- Reading the trail (admins see everything; an office admin sees their own office's entries) ----
const PAGE_SIZE = 50;
// An ISO time from the query string, or null.
const readTime = (value) => {
  const t = new Date(clean(value));
  return clean(value) && !Number.isNaN(t.getTime()) ? t : null;
};

const toEntry = (r) => ({
  id: r.id,
  createdAt: r.created_at,
  userId: r.user_id,
  userName: r.user_name,
  userRole: r.user_role,
  officeId: r.office_id,
  officeName: r.office_name ?? null,
  action: r.action,
  targetType: r.target_type,
  targetId: r.target_id,
  summary: r.summary,
  details: r.details ? safeJson(r.details) : null,
  ip: r.ip,
});

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function registerAuditRoutes(app) {
  // ?q= searches summaries and names; ?type=, ?userId=, ?from= and ?to= (ISO times, to is exclusive) narrow it down.
  // Newest first, PAGE_SIZE at a time: pass the last entry's ?before=<createdAt ISO>&beforeId=<id> for the next page.
  app.get('/api/audit', requireManager, route(async (req, res) => {
    const where = [];
    const params = [];
    if (req.user.role !== 'admin') {
      where.push('audit_log.office_id = ?');
      params.push(req.user.officeId);
    }
    const q = clean(req.query.q);
    if (q) {
      where.push('(audit_log.summary LIKE ? OR audit_log.user_name LIKE ?)');
      params.push(likeText(q), likeText(q));
    }
    const type = clean(req.query.type);
    if (type) {
      where.push('audit_log.target_type = ?');
      params.push(type);
    }
    const userId = clean(req.query.userId);
    if (userId) {
      where.push('audit_log.user_id = ?');
      params.push(userId);
    }
    const from = readTime(req.query.from);
    if (from) {
      where.push('audit_log.created_at >= ?');
      params.push(from);
    }
    const to = readTime(req.query.to);
    if (to) {
      where.push('audit_log.created_at < ?');
      params.push(to);
    }
    const before = readTime(req.query.before);
    if (before) {
      where.push('(audit_log.created_at < ? OR (audit_log.created_at = ? AND audit_log.id < ?))');
      params.push(before, before, clean(req.query.beforeId));
    }
    const rows = await query(
      `SELECT audit_log.*, offices.name AS office_name FROM audit_log
       LEFT JOIN offices ON offices.id = audit_log.office_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY audit_log.created_at DESC, audit_log.id DESC
       LIMIT ?`,
      [...params, PAGE_SIZE + 1]
    );
    res.json({ entries: rows.slice(0, PAGE_SIZE).map(toEntry), more: rows.length > PAGE_SIZE, types: AUDIT_TARGETS });
  }));
}
