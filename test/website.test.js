import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, SA } from './helpers.js';

const post = (t, path, body) => fetch(t.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('the website is served at / and gets live prices from the price list', async () => {
  const t = await startTestApp();
  try {
    const home = await fetch(t.url + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Know exactly what you're buying/);
    const site = await (await fetch(t.url + '/api/public/site')).json();
    const row = (k) => site.price_table.find((r) => r.key === k).prices;
    assert.equal(row('studio')['OWN-PPI'], 1200);
    assert.equal(row('apt3')['OWN-SNG'], 2400);
    assert.equal(row('villa5')['OWN-SNG'], 6000);
    assert.equal(row('apt2')['OWN-MIO'], 1300);
    assert.equal(site.addon_prices['ADD-THM'], 500);
    assert.deepEqual(site.services.map((s) => s.code), ['OWN-PPI', 'OWN-SNG', 'OWN-MIO', 'ADD-THM']);
    // a price change in Settings shows on the website straight away
    await t.login('sa', SA.email, SA.password);
    const ppi = t.ctx.db.prepare("SELECT r.id FROM price_rules r JOIN services s ON s.id=r.service_id WHERE s.code='OWN-PPI' AND r.bedrooms_min=0 AND r.property_type='apartment'").get().id;
    await t.call('sa', 'PUT', `/api/app/list/price_rules/${ppi}`, { price: 1250 });
    const site2 = await (await fetch(t.url + '/api/public/site')).json();
    assert.equal(site2.price_table.find((r) => r.key === 'studio').prices['OWN-PPI'], 1250);
  } finally { await t.close(); }
});

test('instant estimate: base price, add-ons, urgent surcharge, VAT and commercial quotes', async () => {
  const t = await startTestApp();
  try {
    let r = await post(t, '/api/public/estimate', { service: 'OWN-PPI', property_type: 'apartment', bedrooms: 2 });
    assert.equal(r.body.total, 1700);
    assert.equal(r.body.vat, 0);
    r = await post(t, '/api/public/estimate', { service: 'OWN-PPI', property_type: 'apartment', bedrooms: 2, addons: ['ADD-THM', 'NOPE'], urgent: true });
    assert.deepEqual(r.body.lines.map((l) => l.amount), [1700, 500]); // no surcharges in the price list
    assert.equal(r.body.total, 2200);
    // removed services are not offered
    assert.equal((await post(t, '/api/public/estimate', { service: 'OWN-DLP', property_type: 'apartment', bedrooms: 2 })).status, 400);
    r = await post(t, '/api/public/estimate', { service: 'OWN-SNG', property_type: 'studio' });
    assert.equal(r.body.total, 1200);
    r = await post(t, '/api/public/estimate', { service: 'OWN-SNG', property_type: 'villa', bedrooms: 6 });
    assert.equal(r.body.total, 6000);
    r = await post(t, '/api/public/estimate', { service: 'OWN-PPI', property_type: 'office', sqft: 2000 });
    assert.equal(r.body.quote_needed, true);
    assert.equal((await post(t, '/api/public/estimate', { service: 'BAD' })).status, 400);
    // VAT once registered
    await t.login('sa', SA.email, SA.password);
    await t.call('sa', 'PUT', '/api/app/settings', { vat_registered: '1', trn: '100000000000003' });
    r = await post(t, '/api/public/estimate', { service: 'OWN-PPI', property_type: 'apartment', bedrooms: 2 });
    assert.equal(r.body.vat, 85);
    assert.equal(r.body.total, 1785);
  } finally { await t.close(); }
});

test('booking request becomes a lead, emails the office and the client, and is managed by the admin', async () => {
  const t = await startTestApp();
  try {
    const good = { name: 'Sara Buyer', mobile: '050 123 4567', email: 'sara@example.com', service_code: 'OWN-PPI', property_type: 'apartment', bedrooms: 2, community: 'Dubai Hills Estate', preferred_date: '2026-10-25', estimate_total: 1700, referral_code: 'agent7', consent: true };
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
