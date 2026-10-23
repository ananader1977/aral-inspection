// Nightly database backup (encrypted, rotated) and the HTTPS-only header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startTestApp, SA } from './helpers.js';

test('backup now: consistent, encrypted copy that restores; old copies rotated; audit logged', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aral-bk-test-'));
  const t = await startTestApp({ dbPath: path.join(dir, 'app.db'), uploadDir: path.join(dir, 'up'), backup: { key: 'test-passphrase', keep: 3 } });
  try {
    await t.login('sa', SA.email, SA.password);
    const r = await t.call('sa', 'POST', '/api/app/backups');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.encrypted, true);
    assert.match(r.body.name, /^aral-db-\d{8}-\d{4}\.enc\.gz$/);
    const list = (await t.call('sa', 'GET', '/api/app/backups')).body;
    assert.equal(list.rows.length, 1);
    assert.ok(list.last.at);
    // download and restore: the copy opens as a database with our data
    const dl = await t.call('sa', 'GET', `/api/app/backups/${list.rows[0].id}/download`, undefined, { raw: true });
    assert.equal(dl.status, 200);
    const buf = Buffer.from(await dl.arrayBuffer());
    assert.equal(buf.subarray(0, 7).toString(), 'ARALBK1', 'encrypted file');
    assert.throws(() => t.ctx.backup.decode(buf, 'wrong key'));
    const raw = t.ctx.backup.decode(buf, 'test-passphrase');
    const restored = path.join(dir, 'restored.db');
    fs.writeFileSync(restored, raw);
    const rdb = new DatabaseSync(restored);
    assert.equal(rdb.prepare('SELECT email FROM users WHERE role=?').get('super_admin').email, SA.email);
    assert.ok(rdb.prepare('SELECT COUNT(*) n FROM services').get().n >= 8);
    rdb.close();
    // only the newest 3 are kept
    for (let i = 0; i < 4; i++) { t.clock.advance(60000); await t.call('sa', 'POST', '/api/app/backups'); }
    assert.equal((await t.call('sa', 'GET', '/api/app/backups')).body.rows.length, 3);
    // nightly: nothing more today (already backed up)
    assert.equal(await t.ctx.backup.tick(), null);
    assert.ok(t.ctx.db.prepare("SELECT 1 FROM audit_log WHERE entity='backup' AND action='download'").get());
    // other roles cannot see or download backups
    await t.addUser('adm', 'admin');
    assert.equal((await t.call('adm', 'GET', '/api/app/backups')).status, 403);
  } finally { await t.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the next day the nightly tick makes a new backup after 02:00 Dubai time', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aral-bk-test-'));
  const t = await startTestApp({ dbPath: path.join(dir, 'app.db'), uploadDir: path.join(dir, 'up'), backup: { key: '', keep: 5 } });
  try {
    const first = await t.ctx.backup.tick(); // 10:00 Dubai, no backup yet today
    assert.ok(first && !first.encrypted);
    assert.equal(await t.ctx.backup.tick(), null);
    t.clock.advance(16 * 3600e3); // 02:00 next day
    t.clock.advance(30 * 60e3);
    assert.ok(await t.ctx.backup.tick());
    assert.equal(t.ctx.backup.list().length, 2);
  } finally { await t.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('HTTPS sites tell browsers to always use HTTPS', async () => {
  const t = await startTestApp({ secureCookies: true });
  try {
    const r = await t.call(null, 'GET', '/api/health');
    assert.match(r.headers.get('strict-transport-security') || '', /max-age=31536000/);
  } finally { await t.close(); }
  const t2 = await startTestApp();
  try { assert.equal((await t2.call(null, 'GET', '/api/health')).headers.get('strict-transport-security'), null); } finally { await t2.close(); }
});
