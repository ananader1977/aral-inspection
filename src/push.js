// Phone notifications for the ARAL mobile app (Android and iPhone), with no extra packages.
//   Android: Firebase Cloud Messaging HTTP v1 (FCM_SERVICE_ACCOUNT = the Firebase service-account JSON).
//   iPhone:  Apple Push Notification service, token auth (APNS_KEY .p8, APNS_KEY_ID, APNS_TEAM_ID).
// Without these settings nothing is sent and the app works as before. Sending never blocks or breaks the
// action that caused it: errors are logged, and phones that were uninstalled are forgotten.
import crypto from 'node:crypto';
import http2 from 'node:http2';
import { HttpError } from './http.js';
import { can } from './roles.js';
import { clampStr } from './util.js';

const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');

export function createPush(ctx) {
  const { db } = ctx;
  const cfg = ctx.config.push || {};
  const fcm = cfg.fcm?.clientEmail && cfg.fcm?.privateKey && cfg.fcm?.projectId ? cfg.fcm : null;
  const apns = cfg.apns?.key && cfg.apns?.keyId && cfg.apns?.teamId ? cfg.apns : null;
  const enabled = () => ({ android: !!fcm, ios: !!apns });
  let fcmToken = null, apnsJwt = null;

  // ---------- devices ----------
  function register(user, { token, platform, name, app_version }) {
    const tok = clampStr(token, 4096);
    if (!tok || tok.length < 20) throw new HttpError(400, 'Missing device token.');
    if (!['android', 'ios'].includes(platform)) throw new HttpError(400, 'Unknown phone type.');
    db.prepare(`INSERT INTO devices(user_id, platform, token, name, app_version, created_at, last_seen_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, platform=excluded.platform, name=excluded.name, app_version=excluded.app_version, last_seen_at=excluded.last_seen_at`)
      .run(user.id, platform, tok, clampStr(name, 80), clampStr(app_version, 20), ctx.now(), ctx.now());
    return { ok: true, push: enabled()[platform] };
  }
  const unregister = (user, token) => { db.prepare('DELETE FROM devices WHERE token=? AND user_id=?').run(String(token || ''), user.id); return { ok: true }; };
  const listFor = (userId) => db.prepare('SELECT id, platform, name, app_version, created_at, last_seen_at FROM devices WHERE user_id=? ORDER BY last_seen_at DESC').all(userId);
  const forget = (token) => db.prepare('DELETE FROM devices WHERE token=?').run(token);

  // ---------- Android (FCM) ----------
  async function googleToken() {
    if (fcmToken && fcmToken.exp > Date.now() + 60000) return fcmToken.value;
    const tokenUrl = fcm.tokenUrl || 'https://oauth2.googleapis.com/token';
    const iat = Math.floor(Date.now() / 1000);
    const unsigned = `${b64u({ alg: 'RS256', typ: 'JWT' })}.${b64u({ iss: fcm.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: tokenUrl, iat, exp: iat + 3600 })}`;
    const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), fcm.privateKey).toString('base64url');
    const res = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }), signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(`Firebase sign-in failed: ${data.error_description || data.error || res.status}`);
    fcmToken = { value: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
    return fcmToken.value;
  }
  async function sendAndroid(token, m) {
    const url = `${fcm.apiUrl || 'https://fcm.googleapis.com'}/v1/projects/${encodeURIComponent(fcm.projectId)}/messages:send`;
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${await googleToken()}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ message: {
      token, notification: { title: m.title, body: m.body }, data: { url: m.url || '' },
      android: { priority: 'high', notification: { sound: 'default', tag: m.tag || undefined } },
    } }) });
    if (res.ok) return 'sent';
    const data = await res.json().catch(() => ({}));
    const code = data?.error?.details?.find?.((d) => d.errorCode)?.errorCode || data?.error?.status;
    if (res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && code === 'INVALID_ARGUMENT')) return 'gone';
    throw new Error(`FCM ${res.status}: ${data?.error?.message || ''}`);
  }

  // ---------- iPhone (APNs) ----------
  function appleJwt() {
    if (apnsJwt && apnsJwt.at > Date.now() - 50 * 60000) return apnsJwt.value; // Apple wants a new one at most every 20–60 min
    const unsigned = `${b64u({ alg: 'ES256', kid: apns.keyId })}.${b64u({ iss: apns.teamId, iat: Math.floor(Date.now() / 1000) })}`;
    const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: apns.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    apnsJwt = { value: `${unsigned}.${sig}`, at: Date.now() };
    return apnsJwt.value;
  }
  function sendIos(session, token, m) {
    return new Promise((resolve, reject) => {
      const req = session.request({ ':method': 'POST', ':path': `/3/device/${token}`, authorization: `bearer ${appleJwt()}`, 'apns-topic': apns.bundleId, 'apns-push-type': 'alert', 'apns-priority': '10', 'content-type': 'application/json' });
      let status = 0, body = '';
      req.setTimeout(15000, () => { req.close(); reject(new Error('APNs timed out')); });
      req.on('response', (h) => { status = h[':status']; });
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (status === 200) return resolve('sent');
        let reason = ''; try { reason = JSON.parse(body).reason; } catch { /* empty */ }
        if (status === 410 || ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(reason)) return resolve('gone');
        reject(new Error(`APNs ${status}: ${reason}`));
      });
      req.on('error', reject);
      req.end(JSON.stringify({ aps: { alert: { title: m.title, body: m.body }, sound: 'default', 'thread-id': m.tag || undefined }, url: m.url || '' }));
    });
  }

  /** Sends one message to every phone of these users. Returns counts; never throws. */
  async function toUsers(userIds, msg) {
    const ids = [...new Set([].concat(userIds).filter(Boolean))];
    const out = { sent: 0, gone: 0, failed: 0 };
    if (!ids.length || (!fcm && !apns)) return out;
    const m = { title: clampStr(msg.title, 120), body: clampStr(msg.body, 400), url: msg.url || '', tag: msg.tag || '' };
    const devs = db.prepare(`SELECT token, platform FROM devices WHERE user_id IN (${ids.map(() => '?').join(',')})`).all(...ids)
      .filter((d) => (d.platform === 'android' ? fcm : apns));
    let session = null;
    try {
      for (const d of devs) {
        try {
          let r;
          if (d.platform === 'android') r = await sendAndroid(d.token, m);
          else { session ||= http2.connect(apns.host || 'https://api.push.apple.com'); session.on('error', () => {}); r = await sendIos(session, d.token, m); }
          if (r === 'gone') { forget(d.token); out.gone++; } else out.sent++;
        } catch (e) { out.failed++; console.warn(`[push] ${d.platform}: ${e.message}`); }
      }
    } finally { session?.close(); }
    return out;
  }
  const activeUsers = (where, ...a) => db.prepare(`SELECT id, role FROM users WHERE active=1 AND ${where}`).all(...a);
  const toInspector = (inspectorId, msg) => (inspectorId ? toUsers(activeUsers('inspector_id=?', inspectorId).map((u) => u.id), msg) : Promise.resolve({ sent: 0 }));
  const toPermission = (perm, msg, { except } = {}) => toUsers(activeUsers("role<>'client'").filter((u) => can(u.role, perm) && u.id !== except).map((u) => u.id), msg);
  /** Fire and forget: used inside actions so a slow push service never delays the screen. */
  const later = (p) => { Promise.resolve().then(p).catch((e) => console.warn(`[push] ${e.message}`)); };

  return { enabled, register, unregister, listFor, toUsers, toInspector, toPermission, later };
}

/** FCM_SERVICE_ACCOUNT may be the JSON itself or the JSON in base64 (easier to paste on Render). */
export function pushConfig(env) {
  let sa = null;
  const rawSa = (env.FCM_SERVICE_ACCOUNT || '').trim();
  if (rawSa) {
    try { sa = JSON.parse(rawSa.startsWith('{') ? rawSa : Buffer.from(rawSa, 'base64').toString('utf8')); }
    catch { console.warn('[config] FCM_SERVICE_ACCOUNT is not valid JSON: Android notifications are off.'); }
  }
  const pem = (s) => String(s || '').replace(/\\n/g, '\n').trim();
  return {
    fcm: sa ? { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: pem(sa.private_key), tokenUrl: env.FCM_TOKEN_URL || '', apiUrl: env.FCM_API_URL || '' } : null,
    apns: env.APNS_KEY ? { key: pem(env.APNS_KEY), keyId: (env.APNS_KEY_ID || '').trim(), teamId: (env.APNS_TEAM_ID || '').trim(), bundleId: (env.APNS_BUNDLE_ID || 'com.aralinspection.app').trim(),
      host: env.APNS_HOST || (env.APNS_SANDBOX === 'true' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com') } : null,
  };
}
