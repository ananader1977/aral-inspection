// End-to-end: lead → job → quotation → accept → e-sign → demo card payment → schedule (calendar, ICS)
// → phone inspection (findings, photos, video) → submit → review → issue PDF → invoice → commission → re-inspection,
// plus a bank client with credit terms, a monthly invoice, part payment, credit note and aging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startTestApp, SA } from './helpers.js';

const HOUR = 3600e3, DAY = 24 * HOUR;
const JPEG = fs.readFileSync(new URL('../public/logo.jpg', import.meta.url));
const pdfOk = (buf) => {
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const f = path.join(os.tmpdir(), `aral-check-${process.pid}.pdf`);
  fs.writeFileSync(f, buf);
  try { execFileSync('qpdf', ['--check', f], { stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { if (e.code !== 'ENOENT' && e.status !== 3) throw new Error(`qpdf: ${e.stdout}${e.stderr}`); } finally { fs.rmSync(f, { force: true }); }
};
const tokenFrom = (url) => new URL(url).searchParams.get('t');

async function setup() {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aral-up-'));
  const t = await startTestApp({ uploadDir });
  await t.login('sa', SA.email, SA.password);
  const { ctx } = t;
  ctx.db.prepare("INSERT INTO settings(key,value) VALUES('email','office@test.local') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  const ins = Number(ctx.db.prepare("INSERT INTO inspectors(name,email,licence_expiry,insurance_expiry,agreement_expiry,thermal_certified,credentials,created_at) VALUES('Eng. Test Inspector','insp@test.local','2027-12-31','2027-12-31','2027-12-31',1,'B.Sc. Civil Eng.',?)").run(t.clock.now()).lastInsertRowid);
  const ins2 = Number(ctx.db.prepare("INSERT INTO inspectors(name,email,licence_expiry,created_at) VALUES('Expired Inspector','x@test.local','2026-01-01',?)").run(t.clock.now()).lastInsertRowid);
  const cam = Number(ctx.db.prepare("INSERT INTO equipment(name,kind,calibration_due) VALUES('Thermal camera #1','thermal','2027-06-30')").run().lastInsertRowid);
  ctx.db.prepare("INSERT INTO equipment(name,kind,calibration_due) VALUES('Thermal camera #2 (overdue)','thermal','2026-01-01')").run();
  await t.addUser('insp', 'inspector', { inspector_id: ins });
  await t.addUser('tm', 'reviewer', { credentials: 'B.Sc. Mechanical Engineering' });
  await t.addUser('acc', 'accountant');
  // sessions last 12 hours: sign everyone in again after moving the clock
  const relogin = async () => { await t.login('sa', SA.email, SA.password); for (const w of ['insp', 'tm', 'acc', 'adm']) if (t.jars[w]) await t.login(w, `${w}@test.local`, 'UserPass12345'); };
  return { ...t, ins, ins2, cam, uploadDir, relogin };
}

test('individual client: website lead to issued report, invoice and commission', async () => {
  const t = await setup();
  const { call, ctx } = t;
  try {
    // website enquiry → job
    const lead = await call(null, 'POST', '/api/public/leads', { name: 'Sara Buyer', mobile: '0501234567', email: 'sara@example.com', service: 'OWN-PPI', property_type: 'apartment', bedrooms: 2, community: 'Downtown Dubai', building: 'IL Primo', addons: ['ADD-THM'], consent: true }, { csrf: false });
    assert.equal(lead.status, 200, JSON.stringify(lead.body));
    const leadId = ctx.db.prepare('SELECT id FROM leads ORDER BY id DESC').get().id;
    const conv = await call('sa', 'POST', `/api/app/leads/${leadId}/convert`);
    assert.equal(conv.status, 200, JSON.stringify(conv.body));
    const jobId = conv.body.id;
    await call('sa', 'PUT', `/api/app/jobs/${jobId}`, { property: { property_type: 'apartment', bedrooms: 2, community: 'Downtown Dubai', building: 'IL Primo', unit_no: '1205', has_maid_room: 1 } });

    // quotation from the price list (2BR resale 1,700 + thermal 500)
    const dflt = await call('sa', 'GET', `/api/app/jobs/${jobId}/quote-defaults`);
    assert.equal(dflt.body.total, 2200);
    const q = await call('sa', 'POST', `/api/app/jobs/${jobId}/quote`, {});
    assert.equal(q.status, 200, JSON.stringify(q.body));
    // inspector cannot see the job list
    assert.equal((await call('insp', 'GET', '/api/app/jobs')).status, 403);
    const sent = await call('sa', 'POST', `/api/app/quotes/${q.body.id}/send`);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const tok = tokenFrom(sent.body.url);
    const mail = ctx.db.prepare("SELECT * FROM outbox WHERE template_code='quotation'").get();
    assert.equal(mail.to_addr, 'sara@example.com');
    assert.match(mail.attachments, /Quotation-QT-2026-00001\.pdf/);
    pdfOk((await call('sa', 'GET', `/api/app/quotes/${q.body.id}/pdf`, undefined, { raw: true }).then((r) => r.arrayBuffer()).then(Buffer.from)));

    // client: cannot pay before accepting and signing
    assert.equal((await call(null, 'POST', `/api/public/quote/${tok}/pay`, {}, { csrf: false })).status, 409);
    let pub = await call(null, 'POST', `/api/public/quote/${tok}/decide`, { action: 'accept', name: 'Sara Buyer' }, { csrf: false });
    assert.equal(pub.body.status, 'accepted');
    assert.equal((await call(null, 'POST', `/api/public/quote/${tok}/sign`, { name: 'Sara Buyer' }, { csrf: false })).status, 400, 'must tick agree');
    pub = await call(null, 'POST', `/api/public/quote/${tok}/sign`, { name: 'Sara Buyer', agree: true }, { csrf: false });
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    assert.equal(pub.body.agreement.signed, true);
    assert.equal(pub.body.due_now, 2200);
    assert.equal(ctx.db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId).status, 'payment_pending');
    assert.ok(ctx.db.prepare("SELECT 1 FROM outbox WHERE template_code='agreement'").get());

    // demo card checkout
    const co = await call(null, 'POST', `/api/public/quote/${tok}/pay`, {}, { csrf: false });
    assert.equal(co.status, 200, JSON.stringify(co.body));
    const sid = new URL(co.body.url).searchParams.get('s');
    assert.equal((await call(null, 'GET', `/api/public/pay-demo/${sid}`)).body.amount, 2200);
    assert.equal((await call(null, 'POST', `/api/public/pay-demo/${sid}`, { card: '4000 0000 0000 0002', expiry: '12/30', cvc: '123' }, { csrf: false })).status, 402);
    const paid = await call(null, 'POST', `/api/public/pay-demo/${sid}`, { card: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' }, { csrf: false });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    await call(null, 'POST', `/api/public/pay-demo/${sid}`, { card: '4242424242424242', expiry: '12/30', cvc: '123' }, { csrf: false }); // double click
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM payments').get().n, 1);
    assert.equal(ctx.db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId).status, 'paid');
    assert.ok(ctx.db.prepare("SELECT 1 FROM outbox WHERE template_code='receipt'").get());

    // scheduling: expired inspector refused, overdue camera skipped, thermal camera auto-booked
    const avail = await call('sa', 'GET', `/api/app/jobs/${jobId}/availability?date=2026-10-23&time=10:00&hours=3`);
    assert.equal(avail.body.inspectors.find((i) => i.id === t.ins2).ok, false);
    assert.equal((await call('sa', 'POST', `/api/app/jobs/${jobId}/schedule`, { date: '2026-10-23', time: '10:00', hours: 3, inspector_id: t.ins2 })).status, 409);
    const sch = await call('sa', 'POST', `/api/app/jobs/${jobId}/schedule`, { date: '2026-10-23', time: '10:00', hours: 3, inspector_id: t.ins });
    assert.equal(sch.status, 200, JSON.stringify(sch.body));
    assert.deepEqual(sch.body.job.equipment_ids, [t.cam]);
    const conf = ctx.db.prepare("SELECT * FROM outbox WHERE template_code='inspection_confirmation'").get();
    assert.match(conf.attachments, /\.ics/);
    assert.ok(ctx.db.prepare("SELECT 1 FROM outbox WHERE template_code='inspector_assignment' AND to_addr='insp@test.local'").get());

    // calendar week view (staff and the inspector's own) and the ICS feed
    const from = Date.UTC(2026, 9, 18, 20), to = from + 7 * DAY;
    const cal = await call('sa', 'GET', `/api/app/calendar?from=${from}&to=${to}`);
    assert.equal(cal.body.rows.length, 1);
    assert.equal(cal.body.rows[0].inspector, 'Eng. Test Inspector');
    assert.equal((await call('insp', 'GET', `/api/app/calendar?from=${from}&to=${to}`)).body.rows.length, 1);
    const feed = await call('sa', 'GET', '/api/app/calendar/feed');
    const ics = await call(null, 'GET', new URL(feed.body.url).pathname + new URL(feed.body.url).search);
    assert.match(ics.body, /BEGIN:VEVENT[\s\S]*JOB-2026-00001/);
    const insFeed = feed.body.inspectors.find((i) => i.id === t.ins).url;
    assert.match((await call(null, 'GET', new URL(insFeed).pathname + new URL(insFeed).search)).body, /JOB-2026-00001/);
    assert.equal((await call(null, 'GET', '/calendar.ics?key=wrong')).status, 404);
    // double booking is refused for the same inspector
    const job2 = await call('sa', 'POST', '/api/app/jobs', { service_code: 'OWN-MIO', client: { name: 'Other', mobile: '0507654321', type: 'company' }, property: { property_type: 'apartment', bedrooms: 1 } });
    ctx.db.prepare("UPDATE jobs SET status='paid' WHERE id=?").run(job2.body.id);
    assert.equal((await call('sa', 'POST', `/api/app/jobs/${job2.body.id}/schedule`, { date: '2026-10-23', time: '11:00', hours: 2, inspector_id: t.ins })).status, 409);

    // phone app: report built from the checklist (2BR + maid's room)
    t.clock.advance(2 * DAY);
    await t.relogin();
    const list = await call('insp', 'GET', '/api/app/inspect');
    assert.equal(list.body.rows.length, 1);
    let tree = (await call('insp', 'POST', `/api/app/inspect/${jobId}/checkin`)).body;
    assert.equal(tree.job.status, 'report_draft');
    const names = tree.sections.map((s) => s.name);
    for (const n of ['Air Conditioning', 'Kitchen', "Maid's Room", 'Master Bedroom', 'Bedroom 2', 'Bathroom 2']) assert.ok(names.includes(n), n);
    assert.ok(!names.includes('Bedroom 3'));
    assert.ok(tree.job.sla_due_at - tree.job.access_at === 24 * HOUR);
    // not allowed on someone else's job
    assert.equal((await call('insp', 'GET', `/api/app/inspect/${job2.body.id}`)).status, 403);

    const bath = tree.sections.find((s) => s.name === 'Master Bathroom');
    const shower = bath.items.find((i) => i.name === 'Shower Faucet Condition');
    const sugg = await call('insp', 'GET', `/api/app/suggestions?item=${encodeURIComponent(shower.name)}`);
    const leakTpl = sugg.body.rows.find((r) => r.severity === undefined ? r.default_severity === 'critical' : false) || sugg.body.rows.find((r) => r.default_severity === 'critical');
    const o1 = await call('insp', 'POST', `/api/app/items/${shower.id}/observations`, { library_id: leakTpl.id });
    assert.equal(o1.status, 200, JSON.stringify(o1.body));
    const floor = tree.sections.find((s) => s.name === 'Kitchen').items.find((i) => i.name === 'Floor Condition');
    await call('insp', 'PUT', `/api/app/items/${floor.id}`, { attr_value: 'Porcelain' });
    const o2 = await call('insp', 'POST', `/api/app/items/${floor.id}/observations`, { text: 'Hollow sound in two tiles near the sink.', severity: 'attention', trade: 'qualified contractor', glossary_id: ctx.db.prepare("SELECT id FROM glossary WHERE term='Hollow sound'").get().id });
    const panel = tree.sections.find((s) => s.name === 'Electrical').items[1];
    await call('insp', 'POST', `/api/app/items/${panel.id}/observations`, { text: 'RCD tripped correctly when tested.', severity: 'info' });

    // submit is blocked: the critical finding has no photo
    let sub = await call('insp', 'POST', `/api/app/inspect/${jobId}/submit`);
    assert.equal(sub.status, 400);
    assert.match(sub.body.error, /critical finding/);

    // photo upload (raw body, idempotent by uuid), a video with a preview, cover photo
    const up = (q, buf, type) => fetch(`${t.url}/api/app/inspect/${jobId}/media?${q}`, { method: 'POST', headers: { Cookie: t.jars.insp, 'X-Requested-With': 'aral', 'Content-Type': type }, body: buf }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const p1 = await up(`kind=photo&uuid=u-1&observation_id=${o1.body.id}&caption=Leak%20at%20the%20joint`, JPEG, 'image/jpeg');
    assert.equal(p1.status, 200, JSON.stringify(p1.body));
    assert.equal((await up(`kind=photo&uuid=u-1&observation_id=${o1.body.id}`, JPEG, 'image/jpeg')).body.id, p1.body.id);
    await up(`kind=thermal&uuid=u-2&observation_id=${o2.body.id}&temp_min=22.4&temp_max=31.0`, JPEG, 'image/jpeg');
    const v = await up(`kind=video&uuid=u-3&observation_id=${o2.body.id}`, Buffer.from('fake-mp4-bytes'), 'video/mp4');
    assert.equal(v.status, 200);
    await fetch(`${t.url}/api/app/media/${v.body.id}/thumb`, { method: 'POST', headers: { Cookie: t.jars.insp, 'X-Requested-With': 'aral', 'Content-Type': 'image/jpeg' }, body: JPEG });
    assert.equal((await up('kind=photo&uuid=u-4', Buffer.from('x'), 'image/gif')).status, 415);
    await call('insp', 'PUT', `/api/app/inspect/${jobId}/general`, { persons_present: ['Buyer', 'Agent'], weather: 'Sunny', temperature_c: 33, ac_connected: true, dewa_connected: true, cover_media_id: p1.body.id });
    assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM files WHERE purpose IN ('photo','thermal','video','thumb')").get().n, 4);

    // attachments: a PDF (lab result) and an image (floor plan); fake PDFs and other types are refused
    const att = (q, buf, type) => fetch(`${t.url}/api/app/inspect/${jobId}/attachments?${new URLSearchParams(q)}`, { method: 'POST', headers: { Cookie: t.jars.insp, 'X-Requested-With': 'aral', 'Content-Type': type }, body: buf }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const labPdf = ctx.docs.quotePdf(q.body.id);
    const a1 = await att({ name: 'lab-result.pdf', title: 'Mould lab result', description: 'Swab test from the kitchen cabinet' }, labPdf, 'application/pdf');
    assert.equal(a1.status, 200, JSON.stringify(a1.body));
    const a2 = await att({ name: 'floor_plan.jpg', title: 'Floor plan' }, JPEG, 'image/jpeg');
    assert.equal(a2.status, 200, JSON.stringify(a2.body));
    assert.equal((await att({ name: 'x.pdf', title: 'Fake' }, Buffer.from('not a pdf'), 'application/pdf')).status, 415);
    assert.equal((await att({ name: 'x.docx', title: 'Word' }, Buffer.from('PK'), 'application/msword')).status, 415);
    assert.equal((await call('insp', 'PUT', `/api/app/attachments/${a2.body.id}`, { move: 'up' })).status, 200);
    assert.deepEqual((await call('insp', 'GET', `/api/app/inspect/${jobId}`)).body.attachments.map((a) => a.title), ['Floor plan', 'Mould lab result']);
    assert.equal((await call('insp', 'GET', `/api/app/attachments/${a1.body.id}`, undefined, { raw: true })).status, 200);

    sub = await call('insp', 'POST', `/api/app/inspect/${jobId}/submit`);
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    assert.equal((await call('insp', 'POST', `/api/app/items/${floor.id}/observations`, { text: 'x' })).status, 409, 'locked while in review');

    // review: return, fix, approve, issue (inspector cannot review)
    assert.equal((await call('insp', 'POST', `/api/app/reviews/${jobId}/approve`)).status, 403);
    assert.equal((await call('tm', 'GET', '/api/app/reviews')).body.rows.length, 1);
    await call('tm', 'POST', `/api/app/reviews/${jobId}/return`, { note: 'Add the tile location.' });
    assert.equal((await call('insp', 'GET', '/api/app/inspect')).body.rows[0].report_status, 'returned');
    await call('insp', 'PUT', `/api/app/observations/${o2.body.id}`, { text: 'Hollow sound in two floor tiles in front of the sink.' });
    await call('insp', 'POST', `/api/app/inspect/${jobId}/submit`);
    assert.equal((await call('tm', 'POST', `/api/app/reviews/${jobId}/issue`)).status, 409, 'approve first');
    assert.equal((await call('tm', 'POST', `/api/app/reviews/${jobId}/approve`)).status, 200);
    const iss = await call('tm', 'POST', `/api/app/reviews/${jobId}/issue`);
    assert.equal(iss.status, 200, JSON.stringify(iss.body));
    assert.equal(iss.body.number, 'RPT-2026-00001');

    const rpt = Buffer.from(await (await call('sa', 'GET', `/api/app/reports/${jobId}/pdf`, undefined, { raw: true })).arrayBuffer());
    pdfOk(rpt);
    if (process.env.SAVE_PDF) fs.writeFileSync(process.env.SAVE_PDF, rpt);
    const v1 = ctx.db.prepare('SELECT page_count FROM report_versions').get();
    assert.ok(v1.page_count >= 8, `pages ${v1.page_count}`);
    try {
      const txt = execFileSync('pdftotext', ['-layout', '-', '-'], { input: rpt }).toString();
      for (const s of ['Attachments', 'A1. Floor plan', 'A2. Mould lab result', 'Swab test from the kitchen cabinet', 'RESALE', 'Contents', 'General information', 'Report summary', 'Glossary', 'Hollow sound', 'Thermal imaging addendum', 'Sign-off', 'Page 2 of', 'No defects observed', 'ARAL | IL Primo, Unit 1205, Downtown Dubai']) assert.ok(txt.includes(s), `PDF should contain "${s}"`);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const mailR = ctx.db.prepare("SELECT * FROM outbox WHERE template_code='report_issued'").get();
    assert.match(mailR.body, /report\.html\?t=/);
    assert.deepEqual(JSON.parse(mailR.attachments), ['RPT-2026-00001.pdf', 'Floor plan.jpg', 'Mould lab result.pdf']);

    // invoice (already paid in advance) → job closed, commission 42% of 2,200
    const inv = ctx.db.prepare('SELECT * FROM invoices').get();
    assert.equal(inv.status, 'paid');
    assert.equal(inv.total, 2200);
    assert.equal(inv.is_tax_invoice, 0);
    assert.equal(ctx.db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId).status, 'closed');
    const com = ctx.db.prepare('SELECT * FROM commissions WHERE job_id=?').get(jobId);
    assert.equal(com.amount, 924);
    assert.equal(com.status, 'payable');

    // public online report, QR verification, media through the report token only
    const vt = ctx.db.prepare('SELECT verify_token FROM reports WHERE job_id=?').get(jobId).verify_token;
    const ver = await call(null, 'GET', `/api/public/verify/${vt}`);
    assert.equal(ver.body.number, 'RPT-2026-00001');
    const onl = await call(null, 'GET', `/api/public/report/${vt}`);
    assert.equal(onl.body.counts.critical, 1);
    assert.ok(onl.body.media.some((m) => m.kind === 'video'));
    assert.equal((await call(null, 'GET', `/api/public/report/${vt}/media/${v.body.id}`, undefined, { raw: true })).status, 200);
    assert.equal((await call(null, 'GET', `/api/public/report/wrong/media/${v.body.id}`)).status, 404);
    assert.equal(onl.body.attachments.length, 2);
    const dl = await call(null, 'GET', `/api/public/report/${vt}/attachment/${a1.body.id}?download=1`, undefined, { raw: true });
    assert.equal(dl.status, 200);
    assert.match(dl.headers.get('content-disposition'), /attachment/);
    assert.equal((await call(null, 'GET', `/api/public/report/wrong/attachment/${a1.body.id}`)).status, 404);
    assert.equal((await call('insp', 'DELETE', `/api/app/attachments/${a1.body.id}`)).status, 409, 'locked after issue');
    assert.equal((await call(null, 'POST', `/api/public/report/${vt}/feedback`, { score: 5, comment: 'Very thorough' }, { csrf: false })).status, 200);

    // re-inspection copies the open findings
    ctx.db.prepare("UPDATE jobs SET status='report_issued' WHERE id=?").run(jobId);
    const re = await call('sa', 'POST', `/api/app/jobs/${jobId}/reinspection`);
    assert.equal(re.status, 200, JSON.stringify(re.body));
    await call('sa', 'POST', `/api/app/jobs/${re.body.id}/schedule`, { date: '2026-10-30', time: '09:00', hours: 2, inspector_id: t.ins });
    const rtree = (await call('insp', 'GET', `/api/app/inspect/${re.body.id}`)).body;
    const obs = rtree.sections.flatMap((s) => s.items.flatMap((i) => i.observations));
    assert.equal(obs.length, 2);
    assert.ok(obs.every((o) => o.severity !== 'info'));

    // commission statement and payout
    const st = await call('acc', 'GET', `/api/app/commissions/statement.pdf?inspector_id=${t.ins}&month=2026-10`, undefined, { raw: true });
    pdfOk(Buffer.from(await st.arrayBuffer()));
    assert.equal((await call('acc', 'POST', '/api/app/commissions/pay', { ids: [com.id] })).body.paid, 1);

    // dashboard and exports
    const k = await call('sa', 'GET', '/api/app/kpis');
    assert.equal(k.body.reports_month, 1);
    assert.equal(k.body.collected_month, 2200);
    for (const f of ['jobs', 'invoices', 'payments', 'aging', 'commissions', 'quotations', 'sla', 'calibration', 'clients']) {
      const r = await call('sa', 'GET', `/api/app/export/${f}.xlsx`, undefined, { raw: true });
      assert.equal(r.status, 200, f);
      assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    }
  } finally { await t.close(); fs.rmSync(t.uploadDir, { recursive: true, force: true }); }
});

test('bank client on credit terms: monthly invoice, part payment, credit note, aging and reminders', async () => {
  const t = await setup();
  const { call, ctx } = t;
  try {
    const c = await call('sa', 'POST', '/api/app/clients', { name: 'Test Bank PJSC', type: 'bank', email: 'ops@bank.example', credit_terms_days: 30, monthly_invoicing: true, trn: '100000000000003' });
    const job = await call('sa', 'POST', '/api/app/jobs', { service_code: 'BNK-REP', client_id: c.body.id, bank_reference: 'ENBD-7781', property: { property_type: 'villa', bedrooms: 4, community: 'Arabian Ranches', building: 'Villa 12' } });
    const jobId = job.body.id;
    const q = await call('sa', 'POST', `/api/app/jobs/${jobId}/quote`, {});
    const qd = ctx.db.prepare('SELECT * FROM quotations WHERE id=?').get(q.body.id);
    assert.equal(qd.total, 1300);
    assert.match(qd.payment_terms, /30 days/);
    await call('sa', 'POST', `/api/app/quotes/${q.body.id}/send`);
    await call('sa', 'POST', `/api/app/quotes/${q.body.id}/accept-for-client`, { name: 'Bank officer' });
    const tok = qd.public_token;
    const signed = await call(null, 'POST', `/api/public/quote/${tok}/sign`, { name: 'Bank officer', agree: true }, { csrf: false });
    assert.equal(signed.body.due_now, 0);
    assert.equal(ctx.db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId).status, 'agreement_signed');
    // credit client can be scheduled without paying first
    const sch = await call('sa', 'POST', `/api/app/jobs/${jobId}/schedule`, { date: '2026-10-22', time: '14:00', hours: 2, inspector_id: t.ins });
    assert.equal(sch.status, 200, JSON.stringify(sch.body));
    // the admin (not the inspector) can fill the report too, then review and issue
    await call('sa', 'POST', `/api/app/inspect/${jobId}/checkin`);
    const tree = (await call('sa', 'GET', `/api/app/inspect/${jobId}`)).body;
    assert.ok(tree.sections.some((s) => s.name === 'Exterior, Garden & Roof'));
    const it = tree.sections[0].items[0];
    await call('sa', 'POST', `/api/app/items/${it.id}/observations`, { text: 'AC outlet in the majlis is not cooling.', severity: 'attention' });
    assert.equal((await call('sa', 'POST', `/api/app/inspect/${jobId}/submit`)).status, 200);
    await call('tm', 'POST', `/api/app/reviews/${jobId}/approve`);
    const iss = await call('tm', 'POST', `/api/app/reviews/${jobId}/issue`);
    assert.equal(iss.status, 200, JSON.stringify(iss.body));
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM invoices').get().n, 0, 'monthly clients are not invoiced per job');

    // monthly invoice with the bank reference
    const mi = await call('acc', 'POST', '/api/app/invoices/monthly', { client_id: c.body.id, month: '2026-10' });
    assert.equal(mi.status, 200, JSON.stringify(mi.body));
    const det = (await call('acc', 'GET', `/api/app/invoices/${mi.body.id}`)).body;
    assert.match(det.lines[0].description, /ENBD-7781/);
    assert.equal(det.invoice.due_date, '2026-11-20');
    assert.equal(ctx.db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId).status, 'invoiced');
    assert.equal((await call('acc', 'POST', '/api/app/invoices/monthly', { client_id: c.body.id, month: '2026-10' })).status, 400, 'no double invoicing');
    pdfOk(Buffer.from(await (await call('acc', 'GET', `/api/app/invoices/${mi.body.id}/pdf`, undefined, { raw: true })).arrayBuffer()));

    // part payment, credit note, balance
    assert.equal((await call('acc', 'POST', `/api/app/invoices/${mi.body.id}/payment`, { method: 'bank_transfer', amount: 2000 })).status, 400, 'more than the balance');
    await call('acc', 'POST', `/api/app/invoices/${mi.body.id}/payment`, { method: 'bank_transfer', amount: 1000, paid_on: '2026-10-25' });
    let inv = (await call('acc', 'GET', `/api/app/invoices/${mi.body.id}`)).body.invoice;
    assert.equal(inv.status, 'part_paid');
    assert.equal(inv.balance, 300);
    const cn = await call('acc', 'POST', `/api/app/invoices/${mi.body.id}/credit`, { amount: 100, reason: 'Goodwill discount' });
    assert.equal(cn.status, 200, JSON.stringify(cn.body));
    inv = (await call('acc', 'GET', `/api/app/invoices/${mi.body.id}`)).body.invoice;
    assert.equal(inv.balance, 200);
    pdfOk(Buffer.from(await (await call('acc', 'GET', `/api/app/invoices/${cn.body.id}/pdf`, undefined, { raw: true })).arrayBuffer()));

    // pay the rest online through the invoice link (demo)
    const pt = ctx.db.prepare('SELECT pay_token FROM invoices WHERE id=?').get(mi.body.id).pay_token;
    assert.equal((await call(null, 'GET', `/api/public/invoice/${pt}`)).body.balance, 200);
    t.clock.advance(40 * DAY);
    await t.relogin();
    // overdue: reminder sent once
    await ctx.finance.tick(); await ctx.finance.tick();
    assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM outbox WHERE template_code LIKE 'invoice_reminder_%'").get().n, 1);
    const aging = (await call('acc', 'GET', '/api/app/aging')).body;
    assert.equal(aging.buckets.d30, 200);
    const co = await call(null, 'POST', `/api/public/invoice/${pt}/pay`, {}, { csrf: false });
    const sid = new URL(co.body.url).searchParams.get('s');
    assert.equal((await call(null, 'POST', `/api/public/pay-demo/${sid}`, { card: '4242424242424242', expiry: '12/30', cvc: '123' }, { csrf: false })).status, 200);
    inv = (await call('acc', 'GET', `/api/app/invoices/${mi.body.id}`)).body.invoice;
    assert.equal(inv.status, 'paid');
    assert.equal(ctx.db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId).status, 'closed');
    // admins cannot record invoice payments (accountant / super admin only)
    await t.addUser('adm', 'admin');
    assert.equal((await call('adm', 'POST', `/api/app/invoices/${mi.body.id}/payment`, { method: 'cash', amount: 1 })).status, 403);
  } finally { await t.close(); fs.rmSync(t.uploadDir, { recursive: true, force: true }); }
});

test('quotation revisions, rejection, expiry and VAT', async () => {
  const t = await setup();
  const { call, ctx } = t;
  try {
    ctx.db.prepare("INSERT INTO settings(key,value) VALUES('vat_registered','1'),('trn','100123456700003') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    const job = await call('sa', 'POST', '/api/app/jobs', { service_code: 'OWN-SNG', client: { name: 'Ali', email: 'ali@example.com', mobile: '0551112222' }, property: { property_type: 'studio' } });
    const q1 = await call('sa', 'POST', `/api/app/jobs/${job.body.id}/quote`, {});
    let q = ctx.db.prepare('SELECT * FROM quotations WHERE id=?').get(q1.body.id);
    assert.equal(q.net, 1200); assert.equal(q.vat, 60); assert.equal(q.total, 1260);
    await call('sa', 'POST', `/api/app/quotes/${q1.body.id}/send`);
    const r = await call(null, 'POST', `/api/public/quote/${q.public_token}/decide`, { action: 'reject', note: 'Too expensive' }, { csrf: false });
    assert.equal(r.body.status, 'rejected');
    // revision R1 with a discount (over 10% needs the super admin: we are super admin)
    const q2 = await call('sa', 'POST', `/api/app/jobs/${job.body.id}/quote`, { lines: [{ description: 'Snagging – studio', qty: 1, unit_price: 1200 }], discount: 100 });
    q = ctx.db.prepare('SELECT * FROM quotations WHERE id=?').get(q2.body.id);
    assert.equal(q.revision, 1); assert.equal(q.number, 'QT-2026-00001'); assert.equal(q.total, 1155);
    await call('sa', 'POST', `/api/app/quotes/${q2.body.id}/send`);
    assert.equal(ctx.db.prepare('SELECT status FROM quotations WHERE id=?').get(q1.body.id).status, 'superseded');
    t.clock.advance(20 * DAY);
    await ctx.finance.tick();
    assert.equal(ctx.db.prepare('SELECT status FROM jobs WHERE id=?').get(job.body.id).status, 'quote_expired');
    assert.equal((await call(null, 'POST', `/api/public/quote/${q.public_token}/decide`, { action: 'accept', name: 'Ali' }, { csrf: false })).status, 409);
    pdfOk(ctx.docs.quotePdf(q2.body.id));
  } finally { await t.close(); fs.rmSync(t.uploadDir, { recursive: true, force: true }); }
});
