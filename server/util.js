import crypto from 'node:crypto';

// Small helpers shared by the route modules.
export const id = () => crypto.randomUUID();
export const clean = (v) => (typeof v === 'string' ? v.trim() : '');
// Escapes LIKE wildcards so a search for "50%" matches literally.
export const likeText = (v) => `%${v.replace(/[\\%_]/g, '\\$&')}%`;
// Express 4 doesn't catch rejected promises, so async handlers pass their errors on to the error handler.
export const route = (fn) => (req, res, next) => fn(req, res, next).catch(next);
