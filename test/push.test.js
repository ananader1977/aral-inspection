// Phone notifications: devices register, Android goes through FCM, iPhone through APNs (fake servers here),
// uninstalled phones are forgotten, and the phone app stays signed in longer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import http2 from 'node:http2';
import crypto from 'node:crypto';
import { startTestApp, SA } from './helpers.js';

const verifyJwt = (jwt, key, ec) => { const [h, p, s] = jwt.split('.'); return crypto.verify('sha256', Buffer.from(`${h}.${p}`), ec ? { key, dsaEncoding: 'ieee-p1363' } : key, Buffer.from(s, 'base64url')); };

async function fakes() {
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const got = { fcm: [], apns: [] };
  const google = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    if (req.url === '/token') {
      const jwt = new URLSearchParams(body).get('assertion');
      if (!verifyJwt(jwt, rsa.publicKey)) { res.writeHead(401).end('{}'); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }));
      return;
    }
    assert.equal(req.headers.authorization, 'Bearer ya29.test');
    const m = JSON.parse(body).message;
    if (m.token.startsWith('dead')) { res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } })); return; }
    got.fcm.push({ path: req.url, ...m });
    res.writeHead(200).end('{}');
  });
  const apple = http2.createServer();
  apple.on('stream', (stream, h) => {
    let body = ''; stream.on('data', (c) => { body += c; });
    stream.on('end', () => {
      const ok = verifyJwt(String(h.authorization).replace(/^bearer /, ''), ec.publicKey, true);
      const token = h[':path'].split('/').pop();
      if (!ok) { stream.respond({ ':status': 403 }); stream.end('{"reason":"InvalidProviderToken"}'); return; }
      if (token.startsWith('dead')) { stream.respond({ ':status': 410 }); stream.end('{"reason":"Unregistered"}'); return; }
      got.apns.push({ token, topic: h['apns-topic'], ...JSON.parse(body) });
      stream.respond({ ':status': 200 }); stream.end();
    });
  });
  await new Promise((r) => google.listen(0, '127.0.0.1', r));
  await new Promise((r) => apple.listen(0, '127.0.0.1', r));
  const g = `http://127.0.0.1:${google.address().port}`;
  const push = {
    fcm: { projectId: 'aral-test', clientEmail: 'fcm@aral-test.iam.gserviceaccount.com', privateKey: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }), tokenUrl: `${g}/token`, apiUrl: g },
    apns: { key: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }), keyId: 'KEY123', teamId: 'TEAM123', bundleId: 'com.aralinspection.app', host: `http://127.0.0.1:${apple.address().port}` },
  };
  return { push, got, close: () => { google.close(); apple.close(); } };
}

test('notifications reach Android and iPhone; uninstalled phones are removed', async () => {
  const f = await fakes();
  const t = await startTestApp({ push: f.push });
  try {
    await t.login('sa', SA.email, SA.password);
    const ins = Number(t.ctx.db.prepare("INSERT INTO inspectors(name,email,licence_expiry,created_at) VALUES('Eng. Push','p@test.local','2027-12-31',?)").run(t.clock.now()).lastInsertRowid);
    await t.addUser('insp', 'inspector', { inspector_id: ins });
    assert.deepEqual((await t.call(null, 'GET', '/api/config')).body.push, { android: true, ios: true });
    assert.equal((await t.call('insp', 'POST', '/api/app/devices', { token: 'fcm-token-aaaaaaaaaaaaaaaaaaaa', platform: 'android', name: 'Pixel', app_version: '1.0.0' })).status, 200);
    assert.equal((await t.call('insp', 'POST', '/api/app/devices', { token: 'a'.repeat(64), platform: 'ios', name: 'iPhone' })).status, 200);
    assert.equal((await t.call('insp', 'POST', '/api/app/devices', { token: 'x', platform: 'ios' })).status, 400);
    assert.equal((await t.call('insp', 'GET', '/api/app/devices')).body.rows.length, 2);
    const r = await t.ctx.push.toInspector(ins, { title: 'New job: JOB-1', body: 'Fri 23 Oct', url: '/app/#inspect/1' });
    assert.deepEqual(r, { sent: 2, gone: 0, failed: 0 });
    assert.equal(f.got.fcm[0].path, '/v1/projects/aral-test/messages:send');
    assert.equal(f.got.fcm[0].notification.title, 'New job: JOB-1');
    assert.equal(f.got.fcm[0].data.url, '/app/#inspect/1');
    assert.equal(f.got.apns[0].topic, 'com.aralinspection.app');
    assert.equal(f.got.apns[0].aps.alert.body, 'Fri 23 Oct');
    // the same phone signing in as someone else moves to that user
    await t.call('sa', 'POST', '/api/app/devices', { token: 'fcm-token-aaaaaaaaaaaaaaaaaaaa', platform: 'android' });
    assert.equal((await t.call('insp', 'GET', '/api/app/devices')).body.rows.length, 1);
    // office alerts go to people who manage jobs, not to inspectors
    await t.ctx.jobs.notifyOffice('Payment received: AED 1,000', 'JOB-1 · Client');
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(f.got.fcm.at(-1).notification.title, 'Payment received: AED 1,000');
    assert.equal(f.got.apns.length, 1);
    // uninstalled apps
    t.ctx.db.prepare("UPDATE devices SET token='dead-android-token-0000000' WHERE platform='android'").run();
    t.ctx.db.prepare("UPDATE devices SET token='dead' || token WHERE platform='ios'").run();
    const r2 = await t.ctx.push.toUsers([1, 2, 3], { title: 'x', body: 'y' });
    assert.equal(r2.gone, 2);
    assert.equal(t.ctx.db.prepare('SELECT COUNT(*) n FROM devices').get().n, 0);
    // signing out of the app forgets the phone
    await t.call('insp', 'POST', '/api/app/devices', { token: 'b'.repeat(64), platform: 'ios' });
    await t.call('insp', 'DELETE', '/api/app/devices', { token: 'b'.repeat(64) });
    assert.equal((await t.call('insp', 'GET', '/api/app/devices')).body.rows.length, 0);
  } finally { await t.close(); f.close(); }
});

test('without push settings nothing is sent and nothing breaks', async () => {
  const t = await startTestApp();
  try {
    await t.login('sa', SA.email, SA.password);
    assert.deepEqual((await t.call(null, 'GET', '/api/config')).body.push, { android: false, ios: false });
    assert.equal((await t.call('sa', 'POST', '/api/app/devices', { token: 'c'.repeat(64), platform: 'ios' })).body.push, false);
    assert.deepEqual(await t.ctx.push.toUsers([1], { title: 'x', body: 'y' }), { sent: 0, gone: 0, failed: 0 });
  } finally { await t.close(); }
});

test('the phone app stays signed in for a week (other browsers 12 hours)', async () => {
  const t = await startTestApp();
  try {
    await t.login('sa', SA.email, SA.password);
    await t.addUser('insp', 'inspector');
    const login = (ua) => fetch(`${t.url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ua }, body: JSON.stringify({ email: 'insp@test.local', password: 'UserPass12345' }) });
    const age = (r) => Number(/Max-Age=(\d+)/i.exec(r.headers.get('set-cookie'))[1]);
    assert.equal(age(await login('Mozilla/5.0 (Linux; Android 15) Chrome/140 ARALApp/1.0.0')), 7 * 24 * 3600);
    assert.equal(age(await login('Mozilla/5.0 Chrome/140')), 12 * 3600);
  } finally { await t.close(); }
});

test('download links for the phone viewer: 5 minutes, one file, never a session', async () => {
  const t = await startTestApp();
  try {
    await t.login('sa', SA.email, SA.password);
    const r = await t.call('sa', 'POST', '/api/app/download-link', { path: '/api/app/export/jobs.xlsx' });
    assert.equal(r.status, 200);
    const u = new URL(r.body.url);
    assert.equal((await fetch(t.url + u.pathname + u.search)).status, 200, 'works without the cookie');
    const other = await fetch(`${t.url}/api/app/export/clients.xlsx${u.search}`);
    assert.equal(other.status, 401, 'only for that file');
    const asCookie = await fetch(`${t.url}/api/me`, { headers: { Cookie: `aral_session=${u.searchParams.get('dl')}` } });
    assert.equal(asCookie.status, 401, 'not a session');
    assert.equal((await t.call('sa', 'POST', '/api/app/download-link', { path: 'https://evil.example/x' })).status, 400);
    t.clock.advance(6 * 60 * 1000);
    assert.equal((await fetch(t.url + u.pathname + u.search)).status, 401, 'expired');
  } finally { await t.close(); }
});
