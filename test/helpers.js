import { loadConfig } from '../src/config.js';
import { createContext, createWebApp } from '../src/app.js';
import { totpCode } from '../src/auth.js';

// Fixed clock: 21 Oct 2026, 10:00 Dubai time.
export const START = Date.UTC(2026, 9, 21, 6, 0, 0);
export const SA = { email: 'owner@test.local', password: 'SuperPass12345' };

export async function startTestApp(overrides = {}) {
  let t = START;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const base = loadConfig({ SUPERADMIN_EMAIL: SA.email, SUPERADMIN_PASSWORD: SA.password, SUPERADMIN_NAME: 'Owner' });
  const config = { ...base, dbPath: ':memory:', disableRateLimit: true, require2fa: false, ...overrides };
  const ctx = createContext({ config, now: clock.now });
  const server = createWebApp(ctx).server();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  config.baseUrl = url;
  const jars = {};

  /** Signs in; if the account has 2FA, completes it with the current code. */
  async function login(who, email, password) {
    const res = await fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const body = await res.json();
    if (res.status !== 200) return { status: res.status, body };
    if (body.need_code) {
      const secret = ctx.db.prepare('SELECT totp_secret FROM users WHERE email=?').get(email).totp_secret;
      const r2 = await fetch(`${url}/api/login/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: body.token, code: totpCode(secret, clock.now()) }) });
      if (r2.status !== 200) return { status: r2.status, body: await r2.json() };
      jars[who] = r2.headers.get('set-cookie').split(';')[0];
      return { status: 200, body: { code: true } };
    }
    jars[who] = res.headers.get('set-cookie').split(';')[0];
    return { status: 200, body };
  }
  async function call(who, method, path, body, { csrf = true, raw = false } = {}) {
    const h = {};
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (who && jars[who]) h.Cookie = jars[who];
    if (csrf) h['X-Requested-With'] = 'aral';
    const res = await fetch(url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    if (raw) return res;
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  }
  /** Creates a user as the super admin and signs them in under `who`. */
  async function addUser(who, role, extra = {}) {
    const email = `${who}@test.local`;
    const r = await call('sa', 'POST', '/api/app/users', { name: who, email, role, password: 'UserPass12345', ...extra });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    await login(who, email, 'UserPass12345');
    return r.body.user;
  }
  const close = async () => { await new Promise((r) => server.close(r)); };
  return { ctx, clock, url, login, call, addUser, close, jars };
}
