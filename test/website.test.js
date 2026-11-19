import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, SA } from './helpers.js';

const post = (t, path, body) => fetch(t.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

const price = (t, o) => t.ctx.pricing.estimate({ service: o.service, propertyType: o.property_type, bedrooms: o.bedrooms, sqft: o.sqft, addons: o.addons, urgent: o.urgent });

test('the website is served at / and the public data carries no prices', async () => {
  const t = await startTestApp();
  try {
    const home = await fetch(t.url + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Know exactly what you're buying/);
    const site = await (await fetch(t.url + '/api/public/site')).json();
    assert.deepEqual(site.services.map((s) => s.code), ['OWN-PPI', 'OWN-SNG', 'OWN-MIO', 'ADD-THM']);
    assert.equal(JSON.stringify(site).includes('price'), false);
    assert.equal(site.services.some((s) => 'from' in s), false);
    assert.equal((await post(t, '/api/public/estimate', { service: 'OWN-PPI', property_type: 'apartment', bedrooms: 2 })).status, 404);
  } finally { await t.close(); }
});

test('price calculation: base price, add-ons, urgent surcharge, VAT and commercial quotes', async () => {
  const t = await startTestApp();
  try {
    let r = { body: price(t, { service: 'OWN-PPI', property_type: 'apartment', bedrooms: 2 }) };
    assert.equal(r.body.total, 1800);
    assert.equal(r.body.vat, 0);
    r = { body: price(t, { service: 'OWN-PPI', property_type: 'apartment', bedrooms: 2, addons: ['ADD-THM', 'NOPE'], urgent: true }) };
    assert.deepEqual(r.body.lines.map((l) => l.amount), [1800, 500]); // no surcharges in the price list
    assert.equal(r.body.total, 2300);
    // removed services are not offered
    assert.equal((() => { try { price(t, { service: 'OWN-DLP', property_type: 'apartment', bedrooms: 2 }); return 200; } catch (e) { return e.status; } })(), 400);
    r = { body: price(t, { service: 'OWN-SNG', property_type: 'studio' }) };
    assert.equal(r.body.total, 1200);
    r = { body: price(t, { service: 'OWN-SNG', property_type: 'villa', bedrooms: 6 }) };
    assert.equal(r.body.total, 6000);
    r = { body: price(t, { service: 'OWN-PPI', property_type: 'office', sqft: 2000 }) };
    assert.equal(r.body.quote_needed, true);
    assert.equal((() => { try { price(t, { service: 'BAD' }); return 200; } catch (e) { return e.status; } })(), 400);
    // VAT once registered
    await t.login('sa', SA.email, SA.password);
    await t.call('sa', 'PUT', '/api/app/settings', { vat_registered: '1', trn: '100000000000003' });
    r = { body: price(t, { service: 'OWN-PPI', property_type: 'apartment', bedrooms: 2 }) };
    assert.equal(r.body.vat, 90);
    assert.equal(r.body.total, 1890);
  } finally { await t.close(); }
});

test('booking request becomes a lead, emails the office and the client, and is managed by the admin', async () => {
  const t = await startTestApp();
  try {
    const good = { name: 'Sara Buyer', mobile: '050 123 4567', email: 'sara@example.com', service_code: 'OWN-PPI', property_type: 'apartment', bedrooms: 2, community: 'Dubai Hills Estate', preferred_date: '2026-10-25', estimate_total: 1800, referral_code: 'agent7', consent: true };
    assert.equal((await post(t, '/api/public/leads', { ...good, name: '' })).status, 400);
    assert.equal((await post(t, '/api/public/leads', { ...good, mobile: 'abc' })).status, 400);
    assert.equal((await post(t, '/api/public/leads', { ...good, consent: false })).status, 400);
    assert.equal((await post(t, '/api/public/leads', { ...good, preferred_date: '25/10/2026' })).status, 400);
    // honeypot: accepted silently, nothing stored
    assert.equal((await post(t, '/api/public/leads', { ...good, website: 'http://spam' })).status, 200);
    assert.equal(t.ctx.db.prepare('SELECT COUNT(*) n FROM leads').get().n, 0);
    const r = await post(t, '/api/public/leads', good);
    assert.equal(r.status, 200);
    assert.equal(r.body.ref, 'L-00001');
    // double submit within 10 minutes does not create a second lead
    await post(t, '/api/public/leads', good);
    assert.equal(t.ctx.db.prepare('SELECT COUNT(*) n FROM leads').get().n, 1);
    const lead = t.ctx.db.prepare('SELECT * FROM leads').get();
    assert.equal(lead.source, 'broker');
    assert.equal(lead.referral_code, 'AGENT7');
    assert.equal(lead.mobile, '0501234567');
    const mails = t.ctx.db.prepare('SELECT to_addr, template_code FROM outbox ORDER BY id').all();
    assert.deepEqual(mails.map((m) => m.template_code), ['lead_office', 'lead_ack']);
    assert.equal(mails[1].to_addr, 'sara@example.com');

    await t.login('sa', SA.email, SA.password);
    await t.addUser('adm', 'admin');
    await t.addUser('insp', 'inspector');
    assert.equal((await t.call('insp', 'GET', '/api/app/leads')).status, 403);
    const list = await t.call('adm', 'GET', '/api/app/leads?open=1');
    assert.equal(list.body.rows.length, 1);
    assert.equal(list.body.stats.open, 1);
    assert.equal((await t.call('adm', 'PUT', `/api/app/leads/${lead.id}`, { status: 'lost' })).status, 400);
    const up = await t.call('adm', 'PUT', `/api/app/leads/${lead.id}`, { status: 'contacted', notes: 'Called, booking Saturday' });
    assert.equal(up.body.row.status, 'contacted');
    assert.ok(up.body.row.contacted_at);
    // overdue counter: a new lead older than 2 hours
    await post(t, '/api/public/leads', { ...good, mobile: '+971551112222' });
    t.clock.advance(3 * 3600 * 1000);
    assert.equal(t.ctx.leads.stats().overdue, 1);
    const xl = await t.call('sa', 'GET', '/api/app/export/leads.xlsx', undefined, { raw: true });
    assert.equal(xl.status, 200);
    // manual lead from a phone call
    await t.login('adm', 'adm@test.local', 'UserPass12345');
    const man = await t.call('adm', 'POST', '/api/app/leads', { name: 'Walk-in', mobile: '+971500000009', source: 'phone' });
    assert.equal(man.body.row.source, 'phone');
  } finally { await t.close(); }
});

test('every browser script parses', async () => {
  const { execFileSync } = await import('node:child_process');
  const dir = new URL('../public/js/', import.meta.url).pathname;
  const files = ['app.js', 'common.js', 'i18n.js', 'settings.js', 'leads.js', 'jobs.js', 'calendar.js', 'inspect.js', 'reviews.js', 'finance.js', 'pub/shared.js', 'pub/quote.js', 'pub/pay.js', 'pub/pay-demo.js', 'pub/verify.js', 'pub/report.js', '../sw.js', '../site/site.js'];
  for (const f of files) execFileSync(process.execPath, ['--check', dir + f]);
});

const UNITS = [['studio', 0], ['apartment', 1], ['apartment', 2], ['apartment', 3], ['townhouse', 3], ['villa', 4], ['villa', 5]];

test('a unit type costs the same for every inspection service', async () => {
  const t = await startTestApp();
  try {
    for (const [type, beds] of UNITS) assert.equal(new Set(['OWN-PPI', 'OWN-SNG', 'OWN-MIO'].map((c) => price(t, { service: c, property_type: type, bedrooms: beds }).total)).size, 1, type + beds);
  } finally { await t.close(); }
});

test('prices flattened by the earlier release are restored by unit type', async () => {
  const t = await startTestApp();
  try {
    t.ctx.db.prepare("UPDATE price_rules SET price=6000 WHERE property_type IN ('apartment','villa')").run();
    t.ctx.db.prepare("DELETE FROM settings WHERE key IN ('_prices_unified2','_prices_repaired')").run();
    t.ctx.db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('_prices_unified','1')").run();
    const { unifyPrices } = await import('../src/seed.js');
    unifyPrices(t.ctx.db);
    assert.deepEqual(UNITS.map(([type, beds]) => price(t, { service: 'OWN-PPI', property_type: type, bedrooms: beds }).total), [1200, 1500, 1800, 2400, 3000, 4500, 6000]);
  } finally { await t.close(); }
});

test('the price is returned only after the enquiry is saved, and is worked out by the server', async () => {
  const t = await startTestApp();
  try {
    const r = await post(t, '/api/public/leads', { name: 'Price Seeker', mobile: '050 111 2233', consent: true, service_code: 'OWN-PPI', property_type: 'apartment', bedrooms: 2, estimate_total: 1 });
    assert.equal(r.status, 200);
    assert.equal(r.body.estimate.total, 1800);
    await t.login('sa', SA.email, SA.password);
    const leads = await t.call('sa', 'GET', '/api/app/leads');
    assert.equal(leads.body.rows.find((l) => l.name === 'Price Seeker').estimate_total, 1800); // not the 1 the browser claimed
    const bad = await post(t, '/api/public/leads', { name: 'No Consent', mobile: '050 111 2244', service_code: 'OWN-PPI' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.estimate, undefined);
  } finally { await t.close(); }
});
