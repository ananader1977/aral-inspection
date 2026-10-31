// Leads: forward-only status, converting creates the job order with the lead's details, lost reasons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, SA } from './helpers.js';
import { upgradeLookups } from '../src/seed.js';

async function newLead(t, extra = {}) {
  const r = await t.call(null, 'POST', '/api/public/leads', { name: 'Omar Client', mobile: '0507654321', email: 'omar@example.com', service: 'OWN-PPI', property_type: 'villa', bedrooms: 4, community: 'Arabian Ranches', building: 'Villa 12', preferred_date: '2026-11-05', message: 'Gate code 4455', consent: true, ...extra }, { csrf: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return t.ctx.db.prepare('SELECT id FROM leads ORDER BY id DESC').get().id;
}

test('a lead only moves forward; converted and lost are final', async () => {
  const t = await startTestApp();
  try {
    await t.login('sa', SA.email, SA.password);
    const id = await newLead(t);
    const put = (b) => t.call('sa', 'PUT', `/api/app/leads/${id}`, b);
    assert.equal((await put({ status: 'contacted' })).status, 200);
    assert.equal((await put({ status: 'qualified' })).status, 200);
    let r = await put({ status: 'contacted' });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /cannot go back/);
    assert.equal((await put({ status: 'new' })).status, 409);
    assert.equal((await put({ status: 'qualified', notes: 'called twice' })).status, 200, 'same status, notes only');
    assert.equal((await put({ status: 'lost' })).status, 400, 'reason needed');
    r = await put({ status: 'lost', lost_reason: 'Customer Not Interested' });
    assert.equal(r.body.row.lost_reason, 'Customer Not Interested');
    assert.equal((await put({ status: 'onboarding' })).status, 409);
    assert.equal((await put({ status: 'converted' })).status, 409);
    assert.equal((await t.call('sa', 'POST', `/api/app/leads/${id}/convert`)).status, 409);
    // the new lost reasons are in the list
    const lk = (await t.call('sa', 'GET', '/api/app/lookups')).body.lost_reason;
    assert.ok(lk.includes('High Price') && lk.includes('Customer Not Interested'), JSON.stringify(lk));
  } finally { await t.close(); }
});

test('setting a lead to converted creates the job order and copies the details', async () => {
  const t = await startTestApp();
  try {
    await t.login('sa', SA.email, SA.password);
    const id = await newLead(t);
    await t.call('sa', 'PUT', `/api/app/leads/${id}`, { status: 'contacted', notes: 'Prefers morning' });
    const r = await t.call('sa', 'PUT', `/api/app/leads/${id}`, { status: 'converted', notes: 'Prefers morning' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.row.status, 'converted');
    const jobId = r.body.row.job_id;
    assert.ok(jobId);
    const j = (await t.call('sa', 'GET', `/api/app/jobs/${jobId}`)).body;
    const job = j.job || j;
    assert.equal(job.client_name, 'Omar Client');
    assert.equal(job.client_email, 'omar@example.com');
    assert.equal(job.community, 'Arabian Ranches');
    assert.equal(job.preferred_dates, '2026-11-05');
    assert.equal(job.access_notes, 'Gate code 4455');
    assert.equal(job.lead_id, id);
    const ev = t.ctx.db.prepare('SELECT note FROM job_events WHERE job_id=? ORDER BY id').all(jobId).map((e) => e.note).join(' | ');
    assert.match(ev, /From lead L-\d{5}: .*Prefers morning/);
    // converting again does not make a second job, and the status cannot go back
    assert.equal((await t.call('sa', 'POST', `/api/app/leads/${id}/convert`)).body.id, jobId);
    assert.equal((await t.call('sa', 'PUT', `/api/app/leads/${id}`, { status: 'qualified' })).status, 409);
    assert.equal(t.ctx.db.prepare('SELECT COUNT(*) n FROM jobs WHERE lead_id=?').get(id).n, 1);
  } finally { await t.close(); }
});

test('existing systems: "Price" becomes "High Price" and "Customer Not Interested" is added', async () => {
  const t = await startTestApp();
  try {
    const db = t.ctx.db;
    db.prepare("DELETE FROM lookups WHERE list='lost_reason' AND value IN ('High Price','Customer Not Interested')").run();
    db.prepare("INSERT INTO lookups(list,value,sort) VALUES('lost_reason','Price',0)").run();
    db.prepare("DELETE FROM settings WHERE key='_lookups_version'").run();
    assert.equal(upgradeLookups(db), true);
    const vals = db.prepare("SELECT value FROM lookups WHERE list='lost_reason'").all().map((r) => r.value);
    assert.ok(vals.includes('High Price') && vals.includes('Customer Not Interested') && !vals.includes('Price'), JSON.stringify(vals));
    assert.equal(upgradeLookups(db), false, 'runs once');
  } finally { await t.close(); }
});

test('the lead email reaches the job even when the client already exists with another email', async () => {
  const t = await startTestApp();
  try {
    await t.login('sa', SA.email, SA.password);
    t.ctx.db.prepare("INSERT INTO clients(type,name,mobile,email,created_at) VALUES('individual','Omar Client','+971507654321','old@example.com',1)").run();
    const id = await newLead(t, { email: 'omar.new@example.com' });
    const r = await t.call('sa', 'PUT', `/api/app/leads/${id}`, { status: 'converted' });
    const j = (await t.call('sa', 'GET', `/api/app/jobs/${r.body.row.job_id}`)).body;
    assert.equal((j.job || j).client_email, 'omar.new@example.com');
    assert.equal(t.ctx.db.prepare('SELECT COUNT(*) n FROM clients').get().n, 1, 'same client, updated');
  } finally { await t.close(); }
});

test('Super Admin can switch emailed links to the address the app is open at', async () => {
  const t = await startTestApp();
  try {
    await t.login('sa', SA.email, SA.password);
    const here = t.url;
    t.ctx.config.baseUrl = 'https://aral-inspection.onrender.com';
    assert.equal((await t.call('sa', 'GET', '/api/app/dashboard')).body.links.mismatch, true);
    assert.equal((await t.call('sa', 'POST', '/api/app/settings/public-url', { url: 'https://evil.example' })).status, 400);
    const r = await t.call('sa', 'POST', '/api/app/settings/public-url', { url: here });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(t.ctx.config.baseUrl, here);
    assert.equal((await t.call('sa', 'GET', '/api/app/dashboard')).body.links.mismatch, false);
    assert.equal(t.ctx.db.prepare("SELECT value FROM settings WHERE key='_public_url'").get().value, here);
    await t.addUser('adm', 'admin');
    assert.equal((await t.call('adm', 'POST', '/api/app/settings/public-url', { url: here })).status, 403);
  } finally { await t.close(); }
});
