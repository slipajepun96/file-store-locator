import { requireAuth } from './auth.js';

// ---- Live updates ----
// Everyone signed in keeps one connection to GET /api/events (Server-Sent Events). After any change succeeds, every
// connection is told what kind of thing changed, e.g. { type: 'letter', id }, and each open page reloads what it
// shows. The event carries no data: the page fetches it again through the usual routes, so everyone only ever sees
// what they're allowed to.
//
// Types follow the first part of the path (see TYPES): letter, file, box, area, office, account, status, department,
// correspondent, settings.
//
// Behind a proxy, the connection must not be buffered: Nginx is told so by the X-Accel-Buffering header; others may
// need it turned off for /api/events. Over plain HTTP/1.1 a browser allows about 6 connections per site, and each
// open tab uses one; HTTPS with HTTP/2 has no such limit.

const TYPES = {
  letters: 'letter',
  files: 'file',
  boxes: 'box',
  areas: 'area',
  offices: 'office',
  users: 'account',
  'letter-statuses': 'status',
  departments: 'department',
  correspondents: 'correspondent',
  settings: 'settings',
};

// Changes that don't change anything others see.
const QUIET = ['/api/auth/', '/api/letters/read-text', '/api/letters/read-fields'];
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Comments keep the connection open through proxies that drop quiet ones.
const HEARTBEAT_MS = 25_000;

const clients = new Set();

// Tells every open page that something of `type` changed.
export function broadcast(type, id = null) {
  const message = `event: change\ndata: ${JSON.stringify({ type, id })}\n\n`;
  for (const res of clients) res.write(message);
}

// Sends an event after each successful change made through the API.
export function liveEvents(req, res, next) {
  if (!MUTATIONS.has(req.method)) return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const path = req.originalUrl.split('?')[0];
    if (QUIET.some((p) => path.startsWith(p))) return;
    const [, , segment, id] = path.split('/'); // '', 'api', 'letters', '<id>'
    const type = TYPES[segment];
    if (type) broadcast(type, id && id.length <= 64 ? id : null);
  });
  next();
}

export function registerEventRoutes(app) {
  app.get('/api/events', requireAuth, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // How long the browser waits before reconnecting after the connection drops.
    res.write('retry: 5000\n\n');
    clients.add(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
  });
}
