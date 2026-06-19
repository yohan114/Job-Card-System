'use strict';

/**
 * Authentication & sessions, built on Node's crypto only.
 * - Passwords are hashed with scrypt + per-user salt.
 * - Sessions are server-side (in-memory Map) keyed by a random cookie id.
 *   (In-memory is fine for a single-process demo; swap for a store to scale.)
 */

const crypto = require('crypto');
const db = require('./db');

const SESSION_COOKIE = 'jcs_sid';
const sessions = new Map(); // sid -> { userId, flash }

// --- passwords -------------------------------------------------------------
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(plain, stored) {
  if (!stored || !stored.salt || !stored.hash) return false;
  const hash = crypto.scryptSync(plain, stored.salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(stored.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- cookies ---------------------------------------------------------------
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

// --- sessions --------------------------------------------------------------
function createSession(res, userId) {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { userId });
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`);
  return sid;
}

function destroySession(req, res) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
}

/** Attaches req.user and req.session. Returns the user (or null). */
function loadUser(req) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  const session = sid && sessions.get(sid);
  if (!session) return null;
  const user = db.find('users', session.userId);
  if (!user || !user.active) return null;
  req.session = session;
  req.sid = sid;
  req.user = user;
  return user;
}

// One-shot flash messages stored on the session.
function setFlash(req, type, message) {
  if (req.sid && sessions.has(req.sid)) sessions.get(req.sid).flash = { type, message };
}

function takeFlash(req) {
  if (!req.sid || !sessions.has(req.sid)) return null;
  const s = sessions.get(req.sid);
  const flash = s.flash || null;
  delete s.flash;
  return flash;
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  parseCookies,
  createSession,
  destroySession,
  loadUser,
  setFlash,
  takeFlash,
};
