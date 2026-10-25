import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { ROLES_2FA, STAFF_ROLES } from './roles.js';

const SESSION_COOKIE = 'aral_session';
const SESSION_TTL_MS = 12 * 3600 * 1000;
// The ARAL phone app (user agent "ARALApp/…") stays signed in for a week; the app locks itself with Face ID / fingerprint.
const APP_SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
export const isMobileApp = (req) => /\bARALApp\//.test(req?.headers?.['user-agent'] || '');
const PENDING_TTL_MS = 5 * 60 * 1000; // password accepted, waiting for the 2FA code

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function validatePasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Password must be at least 10 characters.');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new HttpError(400, 'Password must contain letters and numbers.');
}

export const randomPassword = () => crypto.randomBytes(9).toString('base64url') + '7a';

// ---------- TOTP (RFC 6238, the codes shown by Google Authenticator / Microsoft Authenticator) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));
export function totpCode(secret, ts, step = 30) {
  const counter = Math.floor(ts / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = mac[mac.length - 1] & 15;
  const bin = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1e6).padStart(6, '0');
}
/** Accepts the current code and one step either side (clock drift). */
export function verifyTotp(secret, code, ts) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return false;
  return [-1, 0, 1].some((d) => safeEqual(totpCode(secret, ts + d * 30000), c));
}
export const otpauthUri = (secret, email, issuer = 'A R A L Inspection') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

function sign(secret, data) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${payload}.${hmac(secret, payload)}`;
}
function unsign(secret, token, now) {
  if (!token || !String(token).includes('.')) return null;
  const [payload, sig] = String(token).split('.');
  if (!safeEqual(sig, hmac(secret, payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > now ? data : null;
  } catch {
    return null;
  }
}

export function createAuth(ctx) {
  const secret = () => ctx.db.prepare("SELECT value FROM settings WHERE key='_secret'").get().value;
  const needs2fa = (u) => ctx.config.require2fa && ROLES_2FA.includes(u.role);

  function startSession(res, user, req) {
    // pv = password version: changing the password signs out other devices
    const ttl = isMobileApp(req) && user.role !== 'super_admin' ? APP_SESSION_TTL_MS : SESSION_TTL_MS;
    res.setCookie(SESSION_COOKIE, sign(secret(), { uid: user.id, pv: user.password_hash.slice(-12), exp: ctx.now() + ttl }), { maxAge: ttl / 1000, secure: ctx.config.secureCookies });
  }
  function endSession(res) {
    res.setCookie(SESSION_COOKIE, '', { maxAge: 0, secure: ctx.config.secureCookies });
  }
  /** Short-lived token issued after the password is right, exchanged for a session with the 2FA code. */
  const pendingToken = (user) => sign(secret(), { uid: user.id, stage: '2fa', exp: ctx.now() + PENDING_TTL_MS });
  const readPending = (token) => { const d = unsign(secret(), token, ctx.now()); return d?.stage === '2fa' ? d.uid : null; };

  /**
   * A link for one download that works for 5 minutes without the session cookie. The phone app opens PDFs and Excel
   * files in the phone's own viewer, which does not share the app's sign-in. Only for GET, only for that one path.
   */
  function downloadLink(user, target) {
    const u = new URL(String(target || ''), 'http://x');
    if (!u.pathname.startsWith('/api/app/')) throw new HttpError(400, 'Not a download.');
    const full = ctx.db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id);
    u.searchParams.set('dl', sign(secret(), { uid: user.id, pv: full.password_hash.slice(-12), p: u.pathname, dl: 1, exp: ctx.now() + 5 * 60 * 1000 }));
    return `${ctx.config.baseUrl}${u.pathname}${u.search}`;
  }
  function currentUser(req) {
    let s = unsign(secret(), req.cookies[SESSION_COOKIE], ctx.now());
    if (s?.dl) s = null; // a download link is never a session
    if (!s && req.query?.dl && (req.method === 'GET' || req.method === 'HEAD')) {
      const d = unsign(secret(), req.query.dl, ctx.now());
      if (d?.dl && d.p === req.path) s = d;
    }
    if (!s || !s.uid) return null;
    const u = ctx.db.prepare('SELECT id,email,name,role,ui_lang,totp_secret,password_hash,inspector_id,client_id FROM users WHERE id=? AND active=1').get(s.uid);
    if (!u || u.password_hash.slice(-12) !== s.pv) return null;
    const out = { id: u.id, email: u.email, name: u.name, role: u.role, ui_lang: u.ui_lang, inspector_id: u.inspector_id, client_id: u.client_id, has2fa: !!u.totp_secret };
    out.must_setup_2fa = needs2fa(u) && !u.totp_secret;
    return out;
  }
  /**
   * Middleware: signed-in staff user. Changes also need the CSRF header.
   * Users who must use 2FA but have not set it up can only reach the 2FA set-up routes.
   */
  function requireUser(req) {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Please sign in.');
    if (!STAFF_ROLES.includes(user.role)) throw new HttpError(403, 'This account cannot use the staff app.');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-requested-with'] !== 'aral') throw new HttpError(403, 'Missing CSRF header.');
    if (user.must_setup_2fa && !req.path.startsWith('/api/me')) throw new HttpError(403, 'Set up two-step sign-in first.', { setup_2fa: true });
    req.user = user;
  }
  return { startSession, endSession, currentUser, requireUser, pendingToken, readPending, needs2fa, downloadLink };
}

/** Creates the Super Admin on first start. A SUPERADMIN_PASSWORD set in the environment resets the password on every start. */
export function ensureSuperAdmin(ctx) {
  const sa = ctx.config.superAdmin;
  const row = ctx.db.prepare('SELECT id FROM users WHERE email=?').get(sa.email);
  if (row) {
    if (sa.password) ctx.db.prepare("UPDATE users SET password_hash=?, active=1, role='super_admin' WHERE id=?").run(hashPassword(sa.password), row.id);
    return [];
  }
  const password = sa.password || randomPassword();
  ctx.db.prepare("INSERT INTO users(email,name,role,password_hash,created_at) VALUES(?,?,'super_admin',?,?)").run(sa.email, sa.name, hashPassword(password), ctx.now());
  return [{ email: sa.email, role: 'super_admin', password: sa.password ? null : password }];
}
