import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, SA } from './helpers.js';

const post = (url, body) => fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('admin sign-in is refused from an address that is not on the allow-list', async () => {
  const app = await startTestApp({ adminAllowedIps: ['203.0.113.7'] });
  try {
    const r = await post(app.url, { email: SA.email, password: SA.password });
    assert.equal(r.status, 403);
  } finally { await app.close?.(); }
});

test('admin sign-in works from an allowed address', async () => {
  const app = await startTestApp({ adminAllowedIps: ['127.0.0.1', '::1', '::ffff:127.0.0.1'] });
  try {
    assert.equal((await post(app.url, { email: SA.email, password: SA.password })).status, 200);
  } finally { await app.close?.(); }
});

test('repeated wrong passwords for one account are stopped', async () => {
  const app = await startTestApp({ disableRateLimit: false });
  try {
    let last;
    for (let i = 0; i < 11; i++) last = await post(app.url, { email: SA.email, password: 'wrong-' + i });
    assert.equal(last.status, 429);
  } finally { await app.close?.(); }
});
