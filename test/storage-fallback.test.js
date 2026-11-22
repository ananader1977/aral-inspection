import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers.js';
import { createStorage } from '../src/storage.js';

test('a photo is kept on the server disk when Google Drive sign-in has expired; backups still report the error', async () => {
  const t = await startTestApp();
  const real = globalThis.fetch;
  try {
    const storage = createStorage({ ...t.ctx, config: { ...t.ctx.config, drive: { clientId: 'x', clientSecret: 'y', refreshToken: 'expired', forFiles: true } }, now: t.ctx.now });
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    const id = await storage.save({ name: 'p.jpg', mime: 'image/jpeg', buf: Buffer.from('jpeg-bytes'), purpose: 'general' });
    assert.equal(storage.get(id).storage, 'disk');
    assert.equal((await storage.read(id)).toString(), 'jpeg-bytes');
    await assert.rejects(storage.save({ name: 'b.gz', mime: 'application/gzip', buf: Buffer.from('x'), purpose: 'backup' }), /sign-in failed/);
  } finally { globalThis.fetch = real; await t.close(); }
});

test('by default photos and files stay on the server disk and only backups go to Drive', async () => {
  const t = await startTestApp();
  const real = globalThis.fetch; let calls = 0;
  try {
    const storage = createStorage({ ...t.ctx, config: { ...t.ctx.config, drive: { clientId: 'x', clientSecret: 'y', refreshToken: 'ok' } }, now: t.ctx.now });
    globalThis.fetch = async () => { calls++; return new Response('{}', { status: 400 }); };
    const id = await storage.save({ name: 'p.jpg', mime: 'image/jpeg', buf: Buffer.from('a'), purpose: 'photo' });
    assert.equal(storage.get(id).storage, 'disk');
    assert.equal(calls, 0);
    await assert.rejects(storage.save({ name: 'b.gz', mime: 'application/gzip', buf: Buffer.from('x'), purpose: 'backup' }));
    assert.ok(calls > 0);
  } finally { globalThis.fetch = real; await t.close(); }
});
