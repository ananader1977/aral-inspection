import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startTestApp, SA } from './helpers.js';
import { totpCode, base32Decode, base32Encode } from '../src/auth.js';

test('first start loads the catalogue, checklists, wording and the super admin', async () => {
  const t = await startTestApp();
  try {
    const n = (sql) => t.ctx.db.prepare(sql).get().n;
    assert.equal(n('SELECT COUNT(*) n FROM services'), 15);
    assert.ok(n('SELECT COUNT(*) n FROM price_rules') > 20);
    assert.ok(n('SELECT COUNT(*) n FROM comment_library') >= 20);
    assert.ok(n('SELECT COUNT(*) n FROM section_templates') >= 15);
    assert.ok(n("SELECT COUNT(*) n FROM content_blocks WHERE code='tc_report' AND body LIKE 'DRAFT%'") === 1);
    assert.equal(t.ctx.db.prepare("SELECT role FROM users WHERE email=?").get(SA.email).role, 'super_admin');
    // seeding is not repeated on a second start of the same database
    assert.equal((await import('../src/seed.js')).seedReference(t.ctx.db, t.clock.now), false);
  } finally { await t.close(); }
});

test('TOTP matches the RFC 6238 test vector', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  assert.equal(totpCode(secret, 59 * 1000), '287082');
  assert.equal(totpCode(secret, 1111111109 * 1000), '081804');
});

test('2FA is required for the super admin before anything else, then asked at every sign-in', async () => {
  const t = await startTestApp({ require2fa: true });
  try {
    const r = await t.login('sa', SA.email, SA.password);
    assert.equal(r.status, 200);
    assert.equal(r.body.user.must_setup_2fa, true);
    const blocked = await t.call('sa', 'GET', '/api/app/dashboard');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.setup_2fa, true);
    const start = await t.call('sa', 'POST', '/api/me/2fa/start', {});
    assert.match(start.body.uri, /^otpauth:\/\/totp\//);
    assert.equal((await t.call('sa', 'POST', '/api/me/2fa/confirm', { code: '000000' })).status, 400);
    assert.equal((await t.call('sa', 'POST', '/api/me/2fa/confirm', { code: totpCode(start.body.secret, t.clock.now()) })).status, 200);
    assert.equal((await t.call('sa', 'GET', '/api/app/dashboard')).status, 200);
    // next sign-in needs the code
    const res = await fetch(`${t.url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(SA) });
    const b = await res.json();
    assert.equal(b.need_code, true);
    assert.equal(res.headers.get('set-cookie'), null);
    const wrong = await fetch(`${t.url}/api/login/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: b.token, code: '123456' }) });
    assert.equal(wrong.status, 401);
    // the pending token expires after 5 minutes
    t.clock.advance(6 * 60 * 1000);
    const late = await fetch(`${t.url}/api/login/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: b.token, code: totpCode(start.body.secret, t.clock.now()) }) });
    assert.equal(late.status, 401);
    assert.equal((await t.login('sa2', SA.email, SA.password)).status, 200);
    // inspectors are not forced to use 2FA
    await t.addUser('insp', 'inspector');
    assert.equal((await t.call('insp', 'GET', '/api/me')).body.user.must_setup_2fa, false);
  } finally { await t.close(); }
});

test('roles: who can see and change what', async () => {
  const t = await startTestApp();
  try {
    await t.login('sa', SA.email, SA.password);
    await t.addUser('insp', 'inspector');
    await t.addUser('acc', 'accountant');
    await t.addUser('tm', 'reviewer');
    await t.addUser('adm', 'admin');
    assert.equal((await t.call(null, 'GET', '/api/app/dashboard')).status, 401);
    assert.equal((await t.call('insp', 'GET', '/api/app/settings')).status, 403);
    assert.equal((await t.call('insp', 'GET', '/api/app/list/services')).status, 403);
    assert.equal((await t.call('acc', 'GET', '/api/app/settings')).status, 200);
    assert.equal((await t.call('acc', 'PUT', '/api/app/settings', { phone: '+97140000000' })).status, 403);
    assert.equal((await t.call('acc', 'GET', '/api/app/users')).status, 403);
    // technical manager edits the comment library but not prices
    assert.equal((await t.call('tm', 'POST', '/api/app/list/comment_library', { item_name: 'Floor Condition', text: 'Test finding', default_severity: 'info' })).status, 200);
    const svc = t.ctx.db.prepare("SELECT id FROM services WHERE code='OWN-PPI'").get().id;
    assert.equal((await t.call('tm', 'POST', '/api/app/list/price_rules', { service_id: svc, property_type: '*', price: 1 })).status, 403);
    // admin coordinator manages inspectors, not services
    assert.equal((await t.call('adm', 'POST', '/api/app/list/inspectors', { name: 'New Inspector' })).status, 200);
    assert.equal((await t.call('adm', 'PUT', `/api/app/list/services/${svc}`, { name: 'X' })).status, 403);
    // CSRF header is required for changes
    assert.equal((await t.call('sa', 'PUT', '/api/app/settings', { phone: '1' }, { csrf: false })).status, 403);
    // clients cannot use the staff app
    await t.call('sa', 'POST', '/api/app/users', { name: 'Client', email: 'client@test.local', role: 'client', password: 'UserPass12345' });
    await t.login('cl', 'client@test.local', 'UserPass12345');
    assert.equal((await t.call('cl', 'GET', '/api/me')).status, 403);
  } finally { await t.close(); }
});

test('users: add, edit, deactivate, reset password; the last super admin is protected', async () => {
  const t = await startTestApp();
  try {
    await t.login('sa', SA.email, SA.password);
    const add = await t.call('sa', 'POST', '/api/app/users', { name: 'Coordinator', email: 'coord@test.local', role: 'admin' });
    assert.equal(add.status, 200);
    assert.ok(add.body.password.length >= 10);
    assert.equal((await t.call('sa', 'POST', '/api/app/users', { name: 'Dup', email: 'COORD@test.local', role: 'admin' })).status, 409);
    const me = t.ctx.db.prepare('SELECT id FROM users WHERE email=?').get(SA.email).id;
    assert.equal((await t.call('sa', 'PUT', `/api/app/users/${me}`, { role: 'admin' })).status, 400);
    assert.equal((await t.call('sa', 'PUT', `/api/app/users/${me}`, { active: false })).status, 400);
    const id = add.body.user.id;
    assert.equal((await t.call('sa', 'PUT', `/api/app/users/${id}`, { active: false })).status, 200);
    assert.equal((await t.login('coord', 'coord@test.local', add.body.password)).status, 401);
    await t.call('sa', 'PUT', `/api/app/users/${id}`, { active: true });
    const reset = await t.call('sa', 'POST', `/api/app/users/${id}/reset-password`, {});
    assert.equal((await t.login('coord', 'coord@test.local', reset.body.password)).status, 200);
    // changing your own password signs out other sessions
    const before = t.jars.coord;
    await t.login('coord2', 'coord@test.local', reset.body.password);
    assert.equal((await t.call('coord2', 'POST', '/api/me/password', { current: reset.body.password, password: 'BrandNew12345' })).status, 200);
    t.jars.old = before;
    assert.equal((await t.call('old', 'GET', '/api/me')).status, 401);
    assert.ok(t.ctx.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity='users' AND action='reset_password'").get().n === 1);
  } finally { await t.close(); }
});

test('company settings: validation, VAT needs a TRN, every change is audited', async () => {
  const t = await startTestApp();
  try {
    await t.login('sa', SA.email, SA.password);
    assert.equal((await t.call('sa', 'PUT', '/api/app/settings', { vat_registered: '1' })).status, 400);
    assert.equal((await t.call('sa', 'PUT', '/api/app/settings', { brand_navy: 'blue' })).status, 400);
    const ok = await t.call('sa', 'PUT', '/api/app/settings', { vat_registered: '1', trn: '100000000000003', rera_reg_no: 'RERA-123', unknown_key: 'x' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.settings.vat_registered, '1');
    assert.equal(ok.body.settings.unknown_key, undefined);
    const a = t.ctx.db.prepare("SELECT * FROM audit_log WHERE entity='settings' ORDER BY id DESC").get();
    assert.deepEqual(JSON.parse(a.after_json), { vat_registered: '1', trn: '100000000000003', rera_reg_no: 'RERA-123' });
  } finally { await t.close(); }
});

test('admin lists: create, validate, edit, filter, delete; entries in use cannot be deleted', async () => {
  const t = await startTestApp();
  try {
    await t.login('sa', SA.email, SA.password);
    assert.equal((await t.call('sa', 'POST', '/api/app/list/inspectors', { name: '' })).status, 400);
    assert.equal((await t.call('sa', 'POST', '/api/app/list/inspectors', { name: 'A', email: 'not-an-email' })).status, 400);
    assert.equal((await t.call('sa', 'POST', '/api/app/list/inspectors', { name: 'A', licence_expiry: '31/12/2027' })).status, 400);
    const ins = await t.call('sa', 'POST', '/api/app/list/inspectors', { name: 'Eng. Test', licence_expiry: '2027-12-31', thermal_certified: true });
    assert.equal(ins.status, 200);
    assert.equal(ins.body.row.thermal_certified, 1);
    assert.equal(ins.body.row.active, 1);
    const upd = await t.call('sa', 'PUT', `/api/app/list/inspectors/${ins.body.row.id}`, { commission_pct: 40 });
    assert.equal(upd.body.row.commission_pct, 40);
    assert.equal(upd.body.row.name, 'Eng. Test');
    // filter and search
    const ppi = t.ctx.db.prepare("SELECT id FROM services WHERE code='OWN-PPI'").get().id;
    const prices = await t.call('sa', 'GET', `/api/app/list/price_rules?service_id=${ppi}`);
    assert.ok(prices.body.rows.length >= 5 && prices.body.rows.every((r) => r.service_id === ppi));
    const found = await t.call('sa', 'GET', '/api/app/list/comment_library?q=hollow');
    assert.ok(found.body.rows.length >= 1);
    // unique picklist value
    assert.equal((await t.call('sa', 'POST', '/api/app/list/lookups', { list: 'community', value: 'Downtown Dubai' })).status, 409);
    // a checklist used by services cannot be deleted; deleting a service removes its prices
    const cl = t.ctx.db.prepare('SELECT id FROM checklists').get().id;
    assert.equal((await t.call('sa', 'DELETE', `/api/app/list/checklists/${cl}`)).status, 409);
    assert.equal((await t.call('sa', 'DELETE', `/api/app/list/services/${ppi}`)).status, 200);
    assert.equal(t.ctx.db.prepare('SELECT COUNT(*) n FROM price_rules WHERE service_id=?').get(ppi).n, 0);
    assert.equal((await t.call('sa', 'DELETE', `/api/app/list/inspectors/${ins.body.row.id}`)).status, 200);
    // only one default branch
    const b2 = await t.call('sa', 'POST', '/api/app/list/branches', { name: 'Abu Dhabi', address: 'Abu Dhabi', is_default: true });
    assert.equal(b2.status, 200);
    assert.equal(t.ctx.db.prepare('SELECT COUNT(*) n FROM branches WHERE is_default=1').get().n, 1);
    // options for drop-downs
    const opts = await t.call('sa', 'GET', '/api/app/list/section_templates/options');
    assert.match(opts.body.rows[0].label, /Residential .* · Air Conditioning/);
  } finally { await t.close(); }
});

test('wording is versioned; the version in force depends on its effective date', async () => {
  const t = await startTestApp();
  try {
    await t.login('sa', SA.email, SA.password);
    const r = await t.call('sa', 'POST', '/api/app/wording/tc_report', { title: 'Terms', body: 'Approved terms v2', effective_from: '2026-11-01' });
    assert.equal(r.status, 200);
    assert.equal(r.body.row.version, 2);
    let d = await t.call('sa', 'GET', '/api/app/wording/tc_report');
    assert.equal(d.body.rows.length, 2);
    assert.equal(d.body.current.version, 1); // 21 Oct: v2 not yet in force
    t.clock.advance(12 * 24 * 3600 * 1000);
    assert.equal((await t.call('sa', 'GET', '/api/me')).status, 401); // sessions last 12 hours
    await t.login('sa', SA.email, SA.password);
    d = await t.call('sa', 'GET', '/api/app/wording/tc_report');
    assert.equal(d.body.current.version, 2);
    // saving the same text again does not create a version
    await t.call('sa', 'POST', '/api/app/wording/tc_report', { title: 'Terms', body: 'Approved terms v2', effective_from: '2026-11-01' });
    assert.equal((await t.call('sa', 'GET', '/api/app/wording/tc_report')).body.rows.length, 2);
    assert.equal((await t.call('sa', 'POST', '/api/app/wording/Bad Code', { body: 'x' })).status, 400);
    // the dashboard checklist ticks the terms item only when no DRAFT terms remain
    const dash = await t.call('sa', 'GET', '/api/app/dashboard');
    assert.equal(dash.body.setup.find((s) => s.key === 'terms').done, false);
  } finally { await t.close(); }
});

test('Excel exports and the test email (logged when Gmail is not configured)', async () => {
  const t = await startTestApp();
  try {
    await t.login('sa', SA.email, SA.password);
    for (const p of ['/api/app/export/list/services.xlsx', '/api/app/export/list/price_rules.xlsx', '/api/app/export/users.xlsx', '/api/app/export/audit.xlsx', '/api/app/export/settings.xlsx']) {
      const res = await t.call('sa', 'GET', p, undefined, { raw: true });
      assert.equal(res.status, 200, p);
      const buf = Buffer.from(await res.arrayBuffer());
      assert.equal(buf.subarray(0, 2).toString(), 'PK', p);
    }
    const m = await t.call('sa', 'POST', '/api/app/messages/test', { to: 'me@test.local' });
    assert.equal(m.body.status, 'logged');
    assert.equal((await t.call('sa', 'GET', '/api/app/messages')).body.rows[0].to_addr, 'me@test.local');
  } finally { await t.close(); }
});

test('demo data: users for each role, inspectors and equipment', async () => {
  const t = await startTestApp({ seedDemo: true, demoPassword: 'DemoPass12345' });
  try {
    const roles = t.ctx.db.prepare('SELECT role FROM users ORDER BY role').all().map((r) => r.role);
    assert.deepEqual(roles, ['accountant', 'admin', 'inspector', 'reviewer', 'super_admin']);
    assert.equal(t.ctx.db.prepare('SELECT COUNT(*) n FROM equipment').get().n, 4);
    assert.equal((await t.login('tm', 'tm.demo@aral.example', 'DemoPass12345')).status, 200);
  } finally { await t.close(); }
});

test('every fixed screen text has an Arabic translation', () => {
  const ar = JSON.parse(fs.readFileSync(new URL('../public/i18n/ar.json', import.meta.url), 'utf8'));
  const missing = [];
  for (const f of ['app.js', 'settings.js', 'common.js']) {
    const src = fs.readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
      const k = m[1].replace(/\\'/g, "'");
      if (/[A-Za-z]{3}/.test(k) && !ar[k]) missing.push(k);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});
