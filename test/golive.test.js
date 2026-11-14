// Go-live reset: clears business data, keeps the setup, restarts numbering, works once on live and repeatedly on a test system.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, SA } from './helpers.js';

async function seedBusiness(t) {
  const { call, ctx } = t;
  await call(null, 'POST', '/api/public/leads', { name: 'Sara Buyer', mobile: '0501234567', email: 's@example.com', service_code: 'OWN-PPI', property_type: 'apartment', bedrooms: 2, community: 'Downtown Dubai', consent: true });
  const lid = ctx.db.prepare('SELECT id FROM leads ORDER BY id DESC').get().id;
  for (const st of ['contacted', 'qualified', 'onboarding', 'converted']) assert.equal((await call('sa', 'PUT', `/api/app/leads/${lid}`, { status: st })).status, 200);
  await call('sa', 'POST', '/api/app/books/expenses', { date: '2026-11-01', account: 'EXP-SUBS', description: 'Test', amount: 100, paid_from: 'bank' }).catch(() => {});
}

test('go-live reset: wrong password and phrase are refused; correct one clears business data once and keeps the setup', async () => {
  const t = await startTestApp(); const { call, ctx } = t;
  try {
    await t.login('sa', SA.email, SA.password);
    await seedBusiness(t);
    const n = (tbl) => ctx.db.prepare(`SELECT COUNT(*) n FROM ${tbl}`).get().n;
    assert.ok(n('jobs') > 0 && n('clients') > 0);
    const users = n('users'), services = n('services');
    ctx.db.prepare("INSERT INTO files(job_id,purpose,name,mime,size,storage,local_path,sha256,created_at) VALUES(NULL,'backup','b.gz','application/gzip',1,'disk','backups/b.gz','x',1)").run();
    ctx.db.prepare("INSERT INTO files(job_id,purpose,name,mime,size,storage,local_path,sha256,created_at) VALUES(NULL,'photo','p.jpg','image/jpeg',1,'disk','p.jpg','y',1)").run();
    assert.equal((await call('sa', 'POST', '/api/app/golive/reset', { password: 'wrong', phrase: 'RESET' })).status, 400);
    assert.equal((await call('sa', 'POST', '/api/app/golive/reset', { password: SA.password, phrase: 'no' })).status, 400);
    assert.equal(n('jobs') > 0, true);
    const ok = await call('sa', 'POST', '/api/app/golive/reset', { password: SA.password, phrase: 'reset' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    for (const tbl of ['jobs', 'clients', 'leads', 'quotations', 'invoices', 'payments', 'expenses', 'reports', 'properties']) assert.equal(n(tbl), 0, tbl);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM files WHERE purpose='backup'").get().n, 1); // backups are never deleted
    assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM files WHERE purpose='photo'").get().n, 0);
    assert.equal(n('users'), users); assert.equal(n('services'), services);
    // numbering starts again at 1
    await call(null, 'POST', '/api/public/leads', { name: 'First Real', mobile: '0507654321', email: 'r@example.com', service_code: 'OWN-PPI', property_type: 'apartment', bedrooms: 1, community: 'Marina', consent: true });
    const lid = ctx.db.prepare('SELECT id FROM leads ORDER BY id DESC').get().id;
    for (const st of ['contacted', 'qualified', 'onboarding', 'converted']) await call('sa', 'PUT', `/api/app/leads/${lid}`, { status: st });
    assert.match(ctx.db.prepare('SELECT number FROM jobs').get().number, /00001$/);
    // live: only once
    assert.equal((await call('sa', 'POST', '/api/app/golive/reset', { password: SA.password, phrase: 'RESET' })).status, 409);
    assert.equal((await call('sa', 'GET', '/api/app/golive')).body.can_reset, false);
    // others cannot
    assert.equal((await call(null, 'POST', '/api/app/golive/reset', { password: 'x', phrase: 'RESET' })).status >= 400, true);
  } finally { await t.close(); }
});

test('test system: banner flag, no real emails, and it can be reset again and again', async () => {
  const t = await startTestApp(); const { call, ctx } = t;
  try {
    ctx.config.appEnv = 'test';
    await t.login('sa', SA.email, SA.password);
    assert.equal((await call(null, 'GET', '/api/config')).body.env, 'test');
    assert.equal((await ctx.mailer.send({ to: 'someone@example.com', subject: 'x', text: 'y' })).status, 'logged');
    for (let i = 0; i < 2; i++) {
      await seedBusiness(t);
      assert.equal((await call('sa', 'POST', '/api/app/golive/reset', { password: SA.password, phrase: 'RESET' })).status, 200);
    }
    assert.equal((await call('sa', 'GET', '/api/app/golive')).body.can_reset, true);
  } finally { await t.close(); }
});

test('resetting only quotations and invoices keeps leads, clients and expenses, restarts numbers, and runs once on live', async () => {
  const t = await startTestApp({ appEnv: 'live' });
  try {
    await t.login('sa', SA.email, SA.password);
    t.ctx.db.prepare("INSERT INTO clients(type,name,created_at) VALUES('individual','Keep Me',1)").run();
    t.ctx.db.prepare("UPDATE settings SET value='9' WHERE key='next_quote_no'").run();
    const db = t.ctx.db;
    const cid = Number(db.prepare("SELECT id FROM clients LIMIT 1").get().id);
    const prop = Number(db.prepare("INSERT INTO properties(property_type,created_at) VALUES('apartment',1)").run().lastInsertRowid);
    const svc = db.prepare('SELECT id FROM services LIMIT 1').get().id;
    const job = Number(db.prepare("INSERT INTO jobs(number,client_id,property_id,service_id,status,created_at,updated_at,client_kind) VALUES('J1',?,?,?,'paid',1,1,'individual')").run(cid, prop, svc).lastInsertRowid);
    db.prepare("INSERT INTO expenses(date,account,net,paid_from,job_id,created_at) VALUES('2026-11-01','5100',10,'bank',?,1)").run(job);
    db.prepare("UPDATE leads SET job_id=?").run(job);
    const bad = await t.call('sa', 'POST', '/api/app/golive/reset-docs', { password: SA.password, phrase: 'nope' });
    assert.equal(bad.status, 400);
    const ok = await t.call('sa', 'POST', '/api/app/golive/reset-docs', { password: SA.password, phrase: 'RESET' });
    assert.equal(ok.status, 200);
    assert.equal(t.ctx.db.prepare('SELECT COUNT(*) n FROM clients').get().n >= 1, true);
    assert.equal(t.ctx.db.prepare("SELECT 1 FROM settings WHERE key='next_quote_no'").get(), undefined);
    assert.equal((await t.call('sa', 'POST', '/api/app/golive/reset-docs', { password: SA.password, phrase: 'RESET' })).status, 409);
  } finally { await t.close(); }
});
