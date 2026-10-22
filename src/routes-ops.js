// Routes for the operations phases: jobs, quotations, agreement, payments, scheduling, calendar,
// the inspection (phone) app, technical review, reports, invoices, commissions, exports and public pages.
import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { can } from './roles.js';
import { buildXlsx } from './xlsx.js';
import { buildIcs } from './ics.js';
import { dateKey, parseDateKey, DAY, round2 } from './time.js';
import { safeEqual } from './auth.js';
import { MAX_VIDEO, MAX_ATTACHMENT } from './reports.js';

export function registerOpsRoutes(app, ctx) {
  const { db, auth, config } = ctx;
  const U = auth.requireUser;
  const P = (...perms) => (req) => { if (!perms.some((p) => can(req.user.role, p))) throw new HttpError(403, 'You do not have permission to do this.'); };
  const ip = (req) => (config.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.ip_;
  const limit = (req, key, max, ms) => { if (!config.disableRateLimit) ctx.limit(`${key}:${ip(req)}`, max, ms); };
  const id = (req) => Number(req.params.id);
  const pdf = (res, buf, name, inline = true) => res.send(buf, 'application/pdf', 200, { 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"` });
  const sendXlsx = (res, name, sheets) => res.send(buildXlsx(sheets), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 200, { 'Content-Disposition': `attachment; filename="${name}-${dateKey(ctx.now())}.xlsx"` });
  const J = ctx.jobs, R = ctx.reports, F = ctx.finance;
  /** Sends bytes with HTTP Range support (iPhones only play videos that can be fetched in ranges). */
  const sendMedia = (req, res, m) => {
    const size = m.buf.length;
    const r = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    const base = { 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400' };
    if (!r) return res.send(m.buf, m.mime, 200, base);
    let start = r[1] === '' ? Math.max(0, size - Number(r[2])) : Number(r[1]);
    let end = r[1] !== '' && r[2] !== '' ? Math.min(Number(r[2]), size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.send(m.buf.subarray(start, end + 1), m.mime, 206, { ...base, 'Content-Range': `bytes ${start}-${end}/${size}` });
  };
  /** Staff with jobs.view, or the inspector assigned to the job. */
  const jobAccess = (req, jobId) => {
    if (can(req.user.role, 'jobs.view')) return;
    if (req.user.role === 'inspector') { const j = db.prepare('SELECT inspector_id FROM jobs WHERE id=?').get(jobId); if (j && j.inspector_id === req.user.inspector_id) return; }
    throw new HttpError(403, 'You do not have permission to do this.');
  };

  // ---------- clients ----------
  app.get('/api/app/clients', U, P('jobs.view', 'finance.view'), (req, res) => {
    const q = String(req.query.q || '');
    res.json({ rows: db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM jobs j WHERE j.client_id=c.id) jobs FROM clients c WHERE (?='' OR c.name LIKE ? OR c.mobile LIKE ? OR c.email LIKE ?) ORDER BY c.name LIMIT 500`).all(q, `%${q}%`, `%${q}%`, `%${q}%`) });
  });
  app.post('/api/app/clients', U, P('jobs.manage'), async (req, res) => res.json({ id: J.upsertClient(await req.json()) }));
  app.put('/api/app/clients/:id', U, P('jobs.manage', 'finance.manage'), async (req, res) => {
    if (!db.prepare('SELECT 1 FROM clients WHERE id=?').get(id(req))) throw new HttpError(404, 'Client not found');
    const b = await req.json();
    J.upsertClient({ ...db.prepare('SELECT * FROM clients WHERE id=?').get(id(req)), ...b, id: id(req) });
    ctx.admin.audit(req.user, 'clients', id(req), 'update', null, b, ip(req));
    res.json({ ok: true });
  });
  app.get('/api/app/clients/:id/rates', U, P('jobs.view', 'finance.view'), (req, res) => res.json({ rows: db.prepare('SELECT r.*, s.code, s.name FROM client_rates r JOIN services s ON s.id=r.service_id WHERE r.client_id=? ORDER BY s.sort').all(id(req)) }));
  app.put('/api/app/clients/:id/rates', U, P('jobs.manage', 'finance.manage'), async (req, res) => {
    const { rates = [] } = await req.json();
    db.prepare('DELETE FROM client_rates WHERE client_id=?').run(id(req));
    for (const r of rates.slice(0, 40)) if (Number(r.price) > 0) db.prepare('INSERT INTO client_rates(client_id,service_id,price,sla_hours) VALUES(?,?,?,?)').run(id(req), Number(r.service_id), round2(Number(r.price)), Number(r.sla_hours) || null);
    ctx.admin.audit(req.user, 'client_rates', id(req), 'update', null, rates, ip(req));
    res.json({ ok: true });
  });

  // ---------- jobs ----------
  app.get('/api/app/services', U, (req, res) => res.json({ rows: db.prepare('SELECT id, code, name, is_addon, segment, needs_thermal FROM services WHERE active=1 ORDER BY sort').all() }));
  app.get('/api/app/jobs', U, P('jobs.view'), (req, res) => res.json({ rows: J.listJobs(req.query, req.user), statuses: J.JOB_STATUS_LABEL }));
  app.post('/api/app/jobs', U, P('jobs.manage'), async (req, res) => res.json({ id: J.createJob(req.user, await req.json()) }));
  app.get('/api/app/jobs/:id', U, (req, res) => { jobAccess(req, id(req)); res.json(J.jobDetail(id(req), req.user)); });
  app.put('/api/app/jobs/:id', U, P('jobs.manage'), async (req, res) => { J.updateJob(req.user, id(req), await req.json()); res.json(J.jobDetail(id(req), req.user)); });
  app.post('/api/app/jobs/:id/status', U, P('jobs.manage'), async (req, res) => {
    const { to, note } = await req.json();
    if (!['on_hold', 'new', 'quoted', 'paid', 'scheduled', 'closed', 'refunded'].includes(to)) throw new HttpError(400, 'Use the buttons on the job for this change.');
    if (to === 'refunded' && req.user.role !== 'super_admin') throw new HttpError(403, 'Only the Super Admin can mark a refund.');
    J.move(req.user, id(req), to, note || '');
    res.json(J.jobDetail(id(req), req.user));
  });
  app.post('/api/app/jobs/:id/cancel', U, P('jobs.manage'), async (req, res) => { const { reason } = await req.json(); J.cancelJob(req.user, id(req), reason); res.json(J.jobDetail(id(req), req.user)); });
  app.post('/api/app/leads/:id/convert', U, P('leads.manage'), (req, res) => res.json({ id: J.convertLead(req.user, id(req)) }));
  app.get('/api/app/jobs/:id/quote-defaults', U, P('jobs.manage'), (req, res) => {
    const remembered = JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(`_job_addons_${id(req)}`)?.value || '[]');
    const d = J.defaultLines(id(req), remembered);
    res.json({ ...d, ...J.totals(d.lines, 0), addons: db.prepare("SELECT s.id, s.code, s.name, MIN(r.price) price FROM services s JOIN price_rules r ON r.service_id=s.id WHERE s.is_addon=1 AND s.active=1 GROUP BY s.id").all(), chosen: remembered, settings: { deposit_pct: Number(ctx.settings().deposit_pct), valid_days: Number(ctx.settings().quote_validity_days), turnaround: ctx.settings().default_turnaround } });
  });
  app.post('/api/app/jobs/:id/quote', U, P('jobs.manage'), async (req, res) => res.json({ id: J.saveQuote(req.user, id(req), await req.json()) }));
  app.post('/api/app/quotes/:id/send', U, P('jobs.manage'), async (req, res) => res.json({ url: await J.sendQuote(req.user, id(req)) }));
  app.get('/api/app/quotes/:id/pdf', U, P('jobs.view'), (req, res) => { const q = J.quoteById(id(req)); pdf(res, ctx.docs.quotePdf(q.id), `Quotation-${J.quoteNo(q)}.pdf`); });
  app.post('/api/app/quotes/:id/payment', U, P('jobs.manage', 'finance.manage'), async (req, res) => res.json({ id: await J.recordQuotePayment(req.user, id(req), await req.json()) }));
  app.post('/api/app/quotes/:id/accept-for-client', U, P('jobs.manage'), async (req, res) => {
    // office records an acceptance received by phone / email (keeps the same audit trail)
    const q = J.quoteById(id(req));
    const { name } = await req.json();
    await J.decideQuote(q.public_token, { action: 'accept', name: `${name || 'Client'} (recorded by ${req.user.name})` }, ip(req));
    res.json({ ok: true });
  });
  app.post('/api/app/quotes/:id/send-link', U, P('jobs.manage'), async (req, res) => { await J.sendSigningLink(req.user, id(req)); res.json({ ok: true }); });
  app.post('/api/app/quotes/:id/sign-for-client', U, P('jobs.manage'), async (req, res) => { await J.signForClient(req.user, id(req), await req.json()); res.json({ ok: true }); });
  app.get('/api/app/agreements/:id/pdf', U, P('jobs.view'), async (req, res) => pdf(res, await ctx.docs.agreementPdf(id(req)), `Agreement-${id(req)}.pdf`));
  app.get('/api/app/receipts/:id/pdf', U, P('jobs.view', 'finance.view'), (req, res) => pdf(res, ctx.docs.receiptPdf(id(req)), `Receipt-${id(req)}.pdf`));
  app.get('/api/app/jobs/:id/availability', U, P('jobs.manage'), (req, res) => {
    const j = J.getJob(id(req));
    const day = parseDateKey(req.query.date);
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(req.query.time || ''));
    if (day === null || !m) throw new HttpError(400, 'Choose a date and time.');
    const start = day + (Number(m[1]) * 60 + Number(m[2])) * 60000;
    const end = start + (Number(req.query.hours) || 3) * 3600000;
    res.json({ inspectors: J.availableInspectors(start, end, { thermal: !!j.needs_thermal, exceptJob: j.id }), equipment: J.freeEquipment(start, end, j.id), needs_thermal: !!j.needs_thermal });
  });
  app.post('/api/app/jobs/:id/schedule', U, P('jobs.manage'), async (req, res) => { await J.schedule(req.user, id(req), await req.json()); res.json(J.jobDetail(id(req), req.user)); });
  app.post('/api/app/jobs/:id/reinspection', U, P('jobs.manage'), (req, res) => res.json({ id: R.createReinspection(req.user, id(req)) }));
  app.post('/api/app/jobs/:id/invoice', U, P('finance.manage'), async (req, res) => res.json({ id: await F.invoiceJob(req.user, id(req)) }));
  app.get('/api/app/files/:id', U, async (req, res) => {
    const f = ctx.storage.get(id(req));
    if (!f) throw new HttpError(404, 'File not found');
    if (f.job_id) jobAccess(req, f.job_id); else if (!can(req.user.role, 'jobs.view')) throw new HttpError(403, 'Not allowed');
    res.send(await ctx.storage.read(f.id), f.mime, 200, { 'Content-Disposition': `inline; filename="${f.name.replace(/"/g, '')}"` });
  });

  // ---------- calendar (week view as in the Consultancy app) and ICS feed ----------
  app.get('/api/app/calendar', U, P('calendar.view'), (req, res) => {
    const from = Number(req.query.from) || ctx.now() - 7 * DAY, to = Number(req.query.to) || from + 7 * DAY;
    if (to - from > 62 * DAY) throw new HttpError(400, 'Choose a shorter period.');
    res.json({ rows: J.calendar(from, to, { inspector_id: req.query.inspector_id, user: req.user }),
      upcoming: J.calendar(ctx.now() - 2 * 3600e3, ctx.now() + 60 * DAY, { inspector_id: req.query.inspector_id, user: req.user }).filter((a) => !['report_issued', 'invoiced', 'closed'].includes(a.status)).slice(0, 30), inspectors: req.user.role === 'inspector' ? [] : db.prepare('SELECT id, name FROM inspectors WHERE active=1 ORDER BY name').all(), work: { start: 8, end: 20 } });
  });
  const feedKey = () => {
    let k = db.prepare("SELECT value FROM settings WHERE key='_feed_key'").get()?.value;
    if (!k) { k = crypto.randomBytes(16).toString('hex'); db.prepare("INSERT INTO settings(key,value) VALUES('_feed_key',?)").run(k); }
    return k;
  };
  const feedSig = (insId) => crypto.createHmac('sha256', feedKey()).update(`inspector:${insId}`).digest('hex').slice(0, 24);
  app.get('/api/app/calendar/feed', U, P('jobs.manage'), (req, res) => res.json({ url: `${config.baseUrl}/calendar.ics?key=${feedKey()}`, inspectors: db.prepare('SELECT id, name FROM inspectors WHERE active=1 ORDER BY name').all().map((i) => ({ ...i, url: `${config.baseUrl}/calendar.ics?inspector=${i.id}&sig=${feedSig(i.id)}` })) }));
  app.post('/api/app/calendar/feed/reset', U, P('settings.edit'), (req, res) => { db.prepare("DELETE FROM settings WHERE key='_feed_key'").run(); res.json({ url: `${config.baseUrl}/calendar.ics?key=${feedKey()}` }); });
  app.get('/calendar.ics', (req, res) => {
    limit(req, 'ics', 120, 60 * 60 * 1000);
    const k = feedKey();
    const insp = req.query.inspector ? Number(req.query.inspector) : null;
    const ok = insp ? safeEqual(String(req.query.sig || ''), feedSig(insp)) : safeEqual(String(req.query.key || ''), k);
    if (!ok) throw new HttpError(404, 'Not found');
    const s = ctx.settings();
    res.send(buildIcs(J.feedEvents(insp), { name: `${s.company_short} inspections`, alarmMinutes: 60, now: ctx.now() }), 'text/calendar; charset=utf-8');
  });

  // ---------- inspection app (phone) ----------
  app.get('/api/app/inspect', U, P('inspect'), (req, res) => {
    const where = req.user.role === 'inspector' ? 'j.inspector_id=?' : '1=1';
    const args = req.user.role === 'inspector' ? [req.user.inspector_id || -1] : [];
    res.json({ rows: db.prepare(`SELECT j.id, j.number, j.status, j.scheduled_start, j.scheduled_end, j.sla_due_at, c.name client_name, c.mobile client_mobile, s.name service_name, p.building, p.unit_no, p.community, p.property_type, p.bedrooms, r.status report_status, r.review_note, i.name inspector_name
      FROM jobs j JOIN clients c ON c.id=j.client_id JOIN services s ON s.id=j.service_id JOIN properties p ON p.id=j.property_id LEFT JOIN reports r ON r.job_id=j.id LEFT JOIN inspectors i ON i.id=j.inspector_id
      WHERE ${where} AND (j.status IN ('scheduled','report_draft','access_failed','under_review') OR (? AND (j.status='paid' OR (j.status='agreement_signed' AND j.client_kind='company'))))
      ORDER BY j.scheduled_start IS NULL, j.scheduled_start LIMIT 200`).all(...args, req.user.role === 'inspector' ? 0 : 1), inspectors: db.prepare('SELECT COUNT(*) n FROM inspectors WHERE active=1').get().n, linked: req.user.role !== 'inspector' || !!req.user.inspector_id });
  });
  app.get('/api/app/inspect/:id', U, P('inspect'), (req, res) => res.json(R.tree(id(req), req.user)));
  app.post('/api/app/inspect/:id/checkin', U, P('inspect'), (req, res) => { R.checkIn(req.user, id(req)); res.json(R.tree(id(req), req.user)); });
  app.post('/api/app/inspect/:id/access-failed', U, P('inspect'), async (req, res) => { await R.accessFailed(req.user, id(req), (await req.json()).note); res.json({ ok: true }); });
  app.put('/api/app/inspect/:id/general', U, P('inspect'), async (req, res) => { R.updateGeneral(req.user, id(req), await req.json()); res.json({ ok: true }); });
  app.post('/api/app/inspect/:id/sections', U, P('inspect'), async (req, res) => res.json({ id: R.addSection(req.user, id(req), await req.json()) }));
  app.put('/api/app/sections/:id', U, P('inspect'), async (req, res) => { R.updateSection(req.user, id(req), await req.json()); res.json({ ok: true }); });
  app.delete('/api/app/sections/:id', U, P('inspect'), (req, res) => { R.deleteSection(req.user, id(req)); res.json({ ok: true }); });
  app.post('/api/app/sections/:id/items', U, P('inspect'), async (req, res) => res.json({ id: R.addItem(req.user, id(req), await req.json()) }));
  app.put('/api/app/items/:id', U, P('inspect'), async (req, res) => { R.updateItem(req.user, id(req), await req.json()); res.json({ ok: true }); });
  app.delete('/api/app/items/:id', U, P('inspect'), (req, res) => { R.deleteItem(req.user, id(req)); res.json({ ok: true }); });
  app.post('/api/app/items/:id/observations', U, P('inspect'), async (req, res) => res.json({ id: R.addObservation(req.user, id(req), await req.json()) }));
  app.put('/api/app/observations/:id', U, P('inspect'), async (req, res) => { R.updateObservation(req.user, id(req), await req.json()); res.json({ ok: true }); });
  app.delete('/api/app/observations/:id', U, P('inspect'), (req, res) => { R.deleteObservation(req.user, id(req)); res.json({ ok: true }); });
  app.get('/api/app/suggestions', U, P('inspect'), (req, res) => res.json({ rows: R.suggestions(String(req.query.item || '')), glossary: db.prepare('SELECT id, term FROM glossary ORDER BY term').all(), trades: db.prepare("SELECT value FROM lookups WHERE list='trade' AND active=1 ORDER BY sort").all().map((r) => r.value) }));
  app.post('/api/app/inspect/:id/media', U, P('inspect'), async (req, res) => {
    const q = req.query;
    const buf = await req.rawBody(MAX_VIDEO + 1024);
    res.json({ id: await R.addMedia(req.user, id(req), { buf, mime: req.headers['content-type'], kind: q.kind, client_uuid: q.uuid, observation_id: q.observation_id, section_id: q.section_id, item_id: q.item_id, caption: q.caption, temp_min_c: q.temp_min, temp_max_c: q.temp_max, pair_media_id: q.pair, taken_at: q.taken_at }) });
  });
  app.post('/api/app/media/:id/thumb', U, P('inspect'), async (req, res) => { await R.addThumb(req.user, id(req), await req.rawBody(3 * 1024 * 1024), req.headers['content-type']); res.json({ ok: true }); });
  app.put('/api/app/media/:id', U, P('inspect'), async (req, res) => { R.updateMedia(req.user, id(req), await req.json()); res.json({ ok: true }); });
  app.delete('/api/app/media/:id', U, P('inspect'), async (req, res) => { await R.deleteMedia(req.user, id(req)); res.json({ ok: true }); });
  app.get('/api/app/media/:id', U, async (req, res) => {
    const m = await R.mediaBytes(id(req), { thumb: req.query.thumb === '1', user: can(req.user.role, 'jobs.view') ? null : req.user });
    sendMedia(req, res, m);
  });
  // documents attached to the report (lab results, floor plans, DEWA bills, developer snag lists…)
  app.post('/api/app/inspect/:id/attachments', U, P('inspect'), async (req, res) => {
    const q = req.query;
    const buf = await req.rawBody(MAX_ATTACHMENT + 1024);
    res.json({ id: await R.addAttachment(req.user, id(req), { buf, mime: req.headers['content-type'], name: q.name, title: q.title, description: q.description }) });
  });
  app.put('/api/app/attachments/:id', U, P('inspect'), async (req, res) => { R.updateAttachment(req.user, id(req), await req.json()); res.json({ ok: true }); });
  app.delete('/api/app/attachments/:id', U, P('inspect'), async (req, res) => { await R.deleteAttachment(req.user, id(req)); res.json({ ok: true }); });
  app.get('/api/app/attachments/:id', U, async (req, res) => {
    const a = await R.attachmentBytes(id(req), { user: can(req.user.role, 'jobs.view') ? null : req.user });
    res.send(a.buf, a.mime, 200, { 'Content-Disposition': `inline; filename="${a.name.replace(/"/g, '')}"`, 'Cache-Control': 'private, max-age=3600' });
  });
  app.post('/api/app/inspect/:id/submit', U, P('inspect'), async (req, res) => { await R.submit(req.user, id(req)); res.json({ ok: true }); });
  app.get('/api/app/inspect/:id/problems', U, P('inspect'), (req, res) => res.json({ problems: R.problems(R.reportOfJob(id(req))) }));
  app.get('/api/app/inspect/:id/preview.pdf', U, P('inspect', 'jobs.view'), async (req, res) => {
    jobAccess(req, id(req));
    const r = R.reportOfJob(id(req));
    const out = await ctx.docs.reportPdf(r.id);
    pdf(res, out.buf, `${r.number || 'DRAFT'}-preview.pdf`);
  });

  // ---------- technical review ----------
  app.get('/api/app/reviews', U, P('reports.review', 'jobs.view'), (req, res) => res.json({ rows: R.queue() }));
  app.post('/api/app/reviews/:id/approve', U, P('reports.review'), (req, res) => { R.approve(req.user, id(req)); res.json({ ok: true }); });
  app.post('/api/app/reviews/:id/return', U, P('reports.review'), async (req, res) => { R.returnReport(req.user, id(req), (await req.json()).note); res.json({ ok: true }); });
  app.post('/api/app/reviews/:id/issue', U, P('reports.review'), async (req, res) => res.json(await R.issue(req.user, id(req))));
  app.get('/api/app/reports/:id/pdf', U, async (req, res) => {
    jobAccess(req, id(req));
    const r = R.reportOfJob(id(req));
    const v = db.prepare('SELECT pdf_file_id FROM report_versions WHERE report_id=? ORDER BY version DESC LIMIT 1').get(r.id);
    if (!v) throw new HttpError(404, 'The report has not been issued yet.');
    pdf(res, await ctx.storage.read(v.pdf_file_id), `${r.number}.pdf`);
  });

  // ---------- invoices, payments, aging ----------
  app.get('/api/app/invoices', U, P('finance.view'), (req, res) => res.json({ rows: F.listInvoices(req.query), clients: db.prepare('SELECT id, name, monthly_invoicing, credit_terms_days FROM clients WHERE active=1 AND (monthly_invoicing=1 OR credit_terms_days>0) ORDER BY name').all() }));
  app.get('/api/app/invoices/:id', U, P('finance.view'), (req, res) => res.json(F.invoiceDetail(id(req))));
  app.get('/api/app/invoices/:id/pdf', U, P('finance.view', 'jobs.view'), (req, res) => { const i = F.invoiceDetail(id(req)).invoice; pdf(res, ctx.docs.invoicePdf(i.id), `${i.number}.pdf`); });
  app.post('/api/app/invoices/monthly', U, P('finance.manage'), async (req, res) => { const b = await req.json(); res.json({ id: await F.monthlyInvoice(req.user, Number(b.client_id), b.month) }); });
  app.post('/api/app/invoices/:id/credit', U, P('finance.manage'), async (req, res) => { const cid = F.creditNote(req.user, id(req), await req.json()); await F.sendInvoice(cid).catch(() => {}); res.json({ id: cid }); });
  app.post('/api/app/invoices/:id/cancel', U, P('finance.manage'), async (req, res) => { F.cancelInvoice(req.user, id(req), (await req.json()).reason); res.json({ ok: true }); });
  app.post('/api/app/invoices/:id/payment', U, P('finance.manage'), async (req, res) => res.json({ id: await F.recordInvoicePayment(req.user, id(req), await req.json()) }));
  app.post('/api/app/invoices/:id/send', U, P('finance.manage'), async (req, res) => { await F.sendInvoice(id(req)); res.json({ ok: true }); });
  app.get('/api/app/payments', U, P('finance.view'), (req, res) => res.json({ rows: F.payments(req.query) }));
  app.get('/api/app/aging', U, P('finance.view'), (req, res) => res.json(F.aging()));

  // ---------- commissions ----------
  app.get('/api/app/commissions', U, P('finance.view', 'commissions.manage'), (req, res) => res.json({ rows: F.listCommissions(req.query), inspectors: db.prepare('SELECT id, name FROM inspectors ORDER BY name').all() }));
  app.put('/api/app/commissions/:id', U, P('commissions.manage'), async (req, res) => { F.updateCommission(req.user, id(req), await req.json()); res.json({ ok: true }); });
  app.post('/api/app/commissions/pay', U, P('commissions.manage'), async (req, res) => { const b = await req.json(); res.json({ paid: F.payCommissions(req.user, b.ids, b.paid_on) }); });
  app.get('/api/app/commissions/statement.pdf', U, P('finance.view', 'commissions.manage'), (req, res) => {
    if (!/^\d{4}-\d{2}$/.test(String(req.query.month || '')) || !req.query.inspector_id) throw new HttpError(400, 'Choose the inspector and month.');
    pdf(res, ctx.docs.commissionPdf(Number(req.query.inspector_id), req.query.month), `Commission-${req.query.month}.pdf`);
  });

  // ---------- test online payment (demo) from the office ----------
  /** staff = the office is taking the card for the client: the payer returns to the job / invoice screen. */
  async function checkoutFor(kind, rowId, staff) {
    if (kind === 'quote') {
      const q = J.quoteById(rowId);
      const pq = J.publicQuote(q.public_token);
      if (!['accepted'].includes(q.status)) throw new HttpError(409, 'The quotation must be accepted first.');
      if (!pq.agreement?.signed) throw new HttpError(409, staff ? 'The service agreement is not signed yet. Ask the client to sign, or use "Record signature (signed on paper)" first.' : 'Please sign the service agreement first.');
      if (!(pq.due_now > 0)) throw new HttpError(409, 'Nothing is due on this quotation.');
      const j = J.getJob(q.job_id);
      return ctx.payments.createCheckout({ kind, id: q.id, number: J.quoteNo(q), amount: pq.due_now, email: j.client_email, back: J.quoteUrl(q), returnUrl: staff ? `${config.baseUrl}/app/#jobs/${j.id}` : null, userId: staff?.id });
    }
    const inv = F.invoiceDetail(rowId).invoice;
    if (!(inv.balance > 0)) throw new HttpError(409, 'This invoice is already paid.');
    return ctx.payments.createCheckout({ kind, id: inv.id, number: inv.number, amount: inv.balance, email: inv.client_email, back: F.invoiceUrl(inv), returnUrl: staff ? `${config.baseUrl}/app/#finance/invoice/${inv.id}` : null, userId: staff?.id });
  }
  // the office takes a card payment for the client (by phone or at the office); "test-pay" kept for older screens
  for (const path of ['card-pay', 'test-pay']) {
    app.post(`/api/app/quotes/:id/${path}`, U, P('jobs.manage', 'finance.manage'), async (req, res) => res.json(await checkoutFor('quote', id(req), req.user)));
    app.post(`/api/app/invoices/:id/${path}`, U, P('finance.manage'), async (req, res) => res.json(await checkoutFor('invoice', id(req), req.user)));
  }
  /** Records a paid checkout session (demo, Stripe redirect or Stripe webhook). Safe to call twice. */
  async function settle(session, ref) {
    const by = session.initiated_by ? db.prepare('SELECT id, name, email, role FROM users WHERE id=?').get(session.initiated_by) : null;
    if (session.quotation_id) await J.recordQuotePayment(by, session.quotation_id, { method: 'card', amount: session.amount, provider: session.provider, ref });
    else if (session.invoice_id) await F.recordInvoicePayment(by, session.invoice_id, { method: 'card', amount: session.amount, provider: session.provider, ref });
    db.prepare("UPDATE payment_sessions SET status='paid', payment_ref=? WHERE id=?").run(ref, session.id);
  }
  const backUrl = (s) => s.return_url || (s.quotation_id ? J.quoteUrl(J.quoteById(s.quotation_id)) : F.invoiceUrl(db.prepare('SELECT * FROM invoices WHERE id=?').get(s.invoice_id)));

  // ---------- public: quotation, agreement, payment ----------
  app.get('/api/public/quote/:t', (req, res) => { limit(req, 'pq', 120, 10 * 60 * 1000); res.json(J.publicQuote(req.params.t)); });
  app.get('/api/public/quote/:t/pdf', (req, res) => { limit(req, 'pq', 120, 10 * 60 * 1000); const q = db.prepare("SELECT * FROM quotations WHERE public_token=? AND status<>'draft'").get(req.params.t); if (!q) throw new HttpError(404, 'Not found'); pdf(res, ctx.docs.quotePdf(q.id), `Quotation-${J.quoteNo(q)}.pdf`); });
  app.post('/api/public/quote/:t/decide', async (req, res) => { limit(req, 'pqd', 20, 60 * 60 * 1000); res.json(await J.decideQuote(req.params.t, await req.json(), ip(req))); });
  app.post('/api/public/quote/:t/sign', async (req, res) => { limit(req, 'pqs', 20, 60 * 60 * 1000); res.json(await J.signAgreement(req.params.t, await req.json(), ip(req))); });
  app.get('/api/public/quote/:t/agreement.pdf', async (req, res) => {
    const q = db.prepare('SELECT * FROM quotations WHERE public_token=?').get(req.params.t);
    const ag = q && db.prepare('SELECT * FROM agreements WHERE quotation_id=? AND signed_at IS NOT NULL').get(q.id);
    if (!ag) throw new HttpError(404, 'Not found');
    pdf(res, await ctx.docs.agreementPdf(ag.id), `Agreement-${q.number}.pdf`);
  });
  app.post('/api/public/quote/:t/pay', async (req, res) => {
    limit(req, 'pqp', 30, 60 * 60 * 1000);
    const q = db.prepare('SELECT id FROM quotations WHERE public_token=?').get(req.params.t);
    if (!q) throw new HttpError(404, 'Not found');
    res.json(await checkoutFor('quote', q.id));
  });
  app.get('/api/public/invoice/:t', (req, res) => { limit(req, 'pi', 120, 10 * 60 * 1000); res.json(F.publicInvoice(req.params.t)); });
  app.get('/api/public/invoice/:t/pdf', (req, res) => { const i = db.prepare("SELECT * FROM invoices WHERE pay_token=? AND kind='invoice'").get(req.params.t); if (!i) throw new HttpError(404, 'Not found'); pdf(res, ctx.docs.invoicePdf(i.id), `${i.number}.pdf`); });
  app.post('/api/public/invoice/:t/pay', async (req, res) => {
    limit(req, 'pip', 30, 60 * 60 * 1000);
    const i = db.prepare("SELECT id FROM invoices WHERE pay_token=? AND kind='invoice'").get(req.params.t);
    if (!i) throw new HttpError(404, 'Not found');
    res.json(await checkoutFor('invoice', i.id));
  });
  // demo checkout
  app.get('/api/public/pay-demo/:s', (req, res) => {
    if (ctx.payments.name !== 'mock') throw new HttpError(404, 'Not found');
    const s = ctx.payments.session(req.params.s);
    if (!s) throw new HttpError(404, 'This payment link is not valid.');
    const what = s.quotation_id ? `Quotation ${J.quoteNo(J.quoteById(s.quotation_id))}` : `Invoice ${db.prepare('SELECT number FROM invoices WHERE id=?').get(s.invoice_id).number}`;
    res.json({ amount: s.amount, status: s.status, what, company: ctx.settings().company_name, back: backUrl(s) });
  });
  app.post('/api/public/pay-demo/:s', async (req, res) => {
    limit(req, 'pd', 30, 60 * 60 * 1000);
    if (ctx.payments.name !== 'mock') throw new HttpError(404, 'Not found');
    const { card, expiry, cvc } = await req.json();
    if (!/^\d{2}\s*\/\s*\d{2}$/.test(String(expiry || ''))) throw new HttpError(400, 'Enter the expiry as MM/YY.');
    const [mm, yy] = String(expiry).split('/').map((x) => Number(x.trim()));
    const nowD = new Date(ctx.now());
    if (mm < 1 || mm > 12 || 2000 + yy < nowD.getUTCFullYear() || (2000 + yy === nowD.getUTCFullYear() && mm < nowD.getUTCMonth() + 1)) throw new HttpError(400, 'The card has expired.');
    if (!/^\d{3,4}$/.test(String(cvc || ''))) throw new HttpError(400, 'Enter the 3-digit CVC.');
    const s = ctx.payments.completeMock(req.params.s, card);
    if (!s.already) await settle(s, s.payment_ref);
    res.json({ ok: true, back: backUrl(s) });
  });
  // Stripe: confirm on return, and the webhook
  app.post('/api/public/checkout/:s/confirm', async (req, res) => {
    limit(req, 'pc', 30, 60 * 60 * 1000);
    const s = ctx.payments.session(req.params.s);
    if (!s) throw new HttpError(404, 'Not found');
    if (s.status !== 'paid') { const r = await ctx.payments.retrieve(s.id); if (r.paid) await settle(s, r.paymentRef); }
    res.json({ paid: ctx.payments.session(req.params.s).status === 'paid' });
  });
  app.post('/api/public/stripe/webhook', async (req, res) => {
    if (ctx.payments.name !== 'stripe') throw new HttpError(404, 'Not found');
    const evt = ctx.payments.verifyWebhook(await req.rawBody(), req.headers['stripe-signature']);
    if (evt.type === 'checkout.session.completed' && evt.data?.object?.payment_status === 'paid') {
      const s = ctx.payments.session(evt.data.object.id);
      if (s && s.status !== 'paid') await settle(s, evt.data.object.payment_intent || evt.data.object.id);
    }
    res.json({ received: true });
  });

  // ---------- public: online report, QR verification, feedback ----------
  app.get('/api/public/verify/:t', (req, res) => { limit(req, 'pv', 120, 10 * 60 * 1000); res.json(R.verify(req.params.t)); });
  app.get('/api/public/report/:t', (req, res) => { limit(req, 'pr', 240, 10 * 60 * 1000); res.json(R.online(req.params.t)); });
  app.get('/api/public/report/:t/pdf', async (req, res) => { const f = await R.latestPdf(req.params.t); pdf(res, f.buf, f.name); });
  app.get('/api/public/report/:t/media/:id', async (req, res) => {
    const m = await R.mediaBytes(id(req), { thumb: req.query.thumb === '1', token: req.params.t });
    sendMedia(req, res, m);
  });
  app.get('/api/public/report/:t/attachment/:id', async (req, res) => {
    limit(req, 'pa', 240, 10 * 60 * 1000);
    const a = await R.attachmentBytes(id(req), { token: req.params.t });
    res.send(a.buf, a.mime, 200, { 'Content-Disposition': `${req.query.download ? 'attachment' : 'inline'}; filename="${a.name.replace(/"/g, '')}"`, 'Cache-Control': 'private, max-age=3600' });
  });
  app.post('/api/public/report/:t/feedback', async (req, res) => {
    limit(req, 'fb', 10, 60 * 60 * 1000);
    const r = db.prepare("SELECT job_id FROM reports WHERE verify_token=? AND status='issued'").get(req.params.t);
    if (!r) throw new HttpError(404, 'Not found');
    const { score, comment } = await req.json();
    const n = Number(score);
    if (!(n >= 1 && n <= 5)) throw new HttpError(400, 'Choose 1 to 5 stars.');
    db.prepare('INSERT INTO feedback(job_id,score,comment,created_at) VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET score=excluded.score, comment=excluded.comment').run(r.job_id, Math.round(n), String(comment || '').slice(0, 1000), ctx.now());
    res.json({ ok: true });
  });

  // ---------- dashboard KPIs ----------
  app.get('/api/app/kpis', U, (req, res) => {
    const n = (sql, ...a) => db.prepare(sql).get(...a)?.n ?? 0;
    const s = ctx.settings();
    const today = dateKey(ctx.now());
    const monthStart = parseDateKey(`${today.slice(0, 7)}-01`);
    const out = { today };
    if (req.user.role === 'inspector') {
      out.mine = db.prepare("SELECT COUNT(*) n FROM jobs WHERE inspector_id=? AND status IN ('scheduled','report_draft')").get(req.user.inspector_id || -1).n;
      out.returned = db.prepare("SELECT COUNT(*) n FROM jobs j JOIN reports r ON r.job_id=j.id WHERE j.inspector_id=? AND r.status='returned'").get(req.user.inspector_id || -1).n;
      return res.json(out);
    }
    out.jobs_month = n('SELECT COUNT(*) n FROM jobs WHERE created_at>=? AND parent_job_id IS NULL', monthStart);
    out.target = Number(s.monthly_job_target) || 0;
    out.reports_month = n("SELECT COUNT(*) n FROM reports WHERE issued_at>=?", monthStart);
    out.open = Object.fromEntries(db.prepare("SELECT status, COUNT(*) n FROM jobs WHERE status NOT IN ('closed','cancelled','refunded') GROUP BY status").all().map((r) => [r.status, r.n]));
    out.today_visits = db.prepare(`SELECT j.id, j.number, j.scheduled_start, j.status, c.name client_name, i.name inspector_name, p.building, p.unit_no FROM jobs j JOIN clients c ON c.id=j.client_id JOIN properties p ON p.id=j.property_id LEFT JOIN inspectors i ON i.id=j.inspector_id WHERE j.scheduled_start>=? AND j.scheduled_start<? AND j.status NOT IN ('cancelled') ORDER BY j.scheduled_start`).all(parseDateKey(today), parseDateKey(today) + DAY);
    out.sla_late = db.prepare("SELECT j.id, j.number, j.sla_due_at, c.name client_name FROM jobs j JOIN clients c ON c.id=j.client_id WHERE j.sla_due_at<? AND j.report_issued_at IS NULL AND j.status IN ('report_draft','under_review') ORDER BY j.sla_due_at").all(ctx.now());
    const issued = db.prepare('SELECT COUNT(*) n, SUM(CASE WHEN report_issued_at<=sla_due_at THEN 1 ELSE 0 END) ok FROM jobs WHERE report_issued_at>=? AND sla_due_at IS NOT NULL').get(monthStart);
    out.sla_pct = issued.n ? Math.round((issued.ok / issued.n) * 100) : null;
    out.review_score = db.prepare('SELECT ROUND(AVG(score),2) a, COUNT(*) n FROM feedback').get();
    out.review_target = Number(s.review_score_target) || 4.8;
    if (can(req.user.role, 'finance.view')) {
      out.revenue_month = round2(db.prepare("SELECT COALESCE(SUM(net),0) n FROM invoices WHERE kind='invoice' AND status<>'cancelled' AND issue_date>=?").get(`${today.slice(0, 7)}-01`).n - db.prepare("SELECT COALESCE(SUM(net),0) n FROM invoices WHERE kind='credit_note' AND status<>'cancelled' AND issue_date>=?").get(`${today.slice(0, 7)}-01`).n);
      out.collected_month = round2(db.prepare('SELECT COALESCE(SUM(amount-refunded),0) n FROM payments WHERE paid_on>=?').get(`${today.slice(0, 7)}-01`).n);
      out.outstanding = round2(F.listInvoices({ status: 'open' }).reduce((a, i) => a + i.balance, 0));
      out.commission_payable = round2(db.prepare("SELECT COALESCE(SUM(amount+bonus),0) n FROM commissions WHERE status='payable'").get().n);
      // rolling 12 months taxable turnover for the AED 375,000 VAT registration threshold
      out.turnover_12m = round2(db.prepare("SELECT COALESCE(SUM(CASE WHEN kind='invoice' THEN net ELSE -net END),0) n FROM invoices WHERE status<>'cancelled' AND issue_date>=?").get(dateKey(ctx.now() - 365 * DAY)).n);
      out.vat_registered = s.vat_registered === '1';
    }
    out.reviews_waiting = n("SELECT COUNT(*) n FROM reports WHERE status IN ('submitted','approved')");
    res.json(out);
  });

  // ---------- Excel exports ----------
  const X = (perm, file, build) => app.get(`/api/app/export/${file}.xlsx`, U, P(perm), (req, res) => sendXlsx(res, file, build(req)));
  X('jobs.view', 'jobs', (req) => [{ name: 'Jobs', columns: [
    { header: 'Job', key: 'number', width: 16 }, { header: 'Created', key: 'created_at', type: 'date', width: 16 }, { header: 'Status', key: 'status_label', width: 18 },
    { header: 'Client', key: 'client_name', width: 26 }, { header: 'Mobile', key: 'client_mobile', width: 16 }, { header: 'Service', key: 'service_name', width: 32 },
    { header: 'Property type', key: 'property_type', width: 12 }, { header: 'Bedrooms', key: 'bedrooms', type: 'number', width: 9 }, { header: 'Building', key: 'building', width: 20 },
    { header: 'Unit', key: 'unit_no', width: 8 }, { header: 'Community', key: 'community', width: 20 }, { header: 'Inspector', key: 'inspector_name', width: 22 },
    { header: 'Visit', key: 'scheduled_start', type: 'date', width: 16 }, { header: 'Report due', key: 'sla_due_at', type: 'date', width: 16 }, { header: 'Report issued', key: 'report_issued_at', type: 'date', width: 16 },
    { header: 'Fee excl. VAT (AED)', key: 'fee_net', type: 'money', width: 14 }, { header: 'Bank ref', key: 'bank_reference', width: 14 }], rows: J.listJobs(req.query, req.user) }]);
  X('jobs.view', 'sla', () => [{ name: 'SLA by client', columns: [
    { header: 'Client', key: 'client', width: 30 }, { header: 'Reports issued', key: 'n', type: 'number', width: 14 }, { header: 'On time', key: 'ok', type: 'number', width: 10 },
    { header: 'On time %', key: 'pct', type: 'number', width: 10 }, { header: 'Average hours', key: 'avg_h', type: 'number', width: 14 }],
    rows: db.prepare('SELECT c.name client, COUNT(*) n, SUM(CASE WHEN j.report_issued_at<=j.sla_due_at THEN 1 ELSE 0 END) ok, ROUND(100.0*SUM(CASE WHEN j.report_issued_at<=j.sla_due_at THEN 1 ELSE 0 END)/COUNT(*),1) pct, ROUND(AVG((j.report_issued_at-j.access_at)/3600000.0),1) avg_h FROM jobs j JOIN clients c ON c.id=j.client_id WHERE j.report_issued_at IS NOT NULL AND j.sla_due_at IS NOT NULL GROUP BY c.id ORDER BY n DESC').all() }]);
  X('jobs.view', 'quotations', () => [{ name: 'Quotations', columns: [
    { header: 'Quotation', value: (q) => (q.revision ? `${q.number}-R${q.revision}` : q.number), width: 18 }, { header: 'Job', key: 'job', width: 16 }, { header: 'Client', key: 'client', width: 26 },
    { header: 'Issued', key: 'issue_date', width: 12 }, { header: 'Valid until', key: 'valid_until', width: 12 }, { header: 'Status', key: 'status', width: 14 },
    { header: 'Net (AED)', key: 'net', type: 'money', width: 12 }, { header: 'VAT', key: 'vat', type: 'money', width: 10 }, { header: 'Total', key: 'total', type: 'money', width: 12 }, { header: 'Decided by', key: 'decided_name', width: 24 }],
    rows: db.prepare('SELECT q.*, j.number job, c.name client FROM quotations q JOIN jobs j ON j.id=q.job_id JOIN clients c ON c.id=j.client_id ORDER BY q.id DESC').all() }]);
  X('finance.view', 'invoices', (req) => {
    const rows = F.listInvoices(req.query);
    const byMonth = {};
    for (const i of rows.filter((x) => x.status !== 'cancelled')) { const m = (byMonth[i.issue_date.slice(0, 7)] ??= { month: i.issue_date.slice(0, 7), net: 0, vat: 0, total: 0 }); const sg = i.kind === 'credit_note' ? -1 : 1; m.net = round2(m.net + sg * i.net); m.vat = round2(m.vat + sg * i.vat); m.total = round2(m.total + sg * i.total); }
    return [{ name: 'Invoices', columns: [
      { header: 'Number', key: 'number', width: 16 }, { header: 'Type', value: (i) => (i.kind === 'credit_note' ? 'Credit note' : i.is_tax_invoice ? 'Tax invoice' : 'Invoice'), width: 12 }, { header: 'Client', key: 'client_name', width: 28 },
      { header: 'Issued', key: 'issue_date', width: 12 }, { header: 'Due', key: 'due_date', width: 12 }, { header: 'Net (AED)', key: 'net', type: 'money', width: 12 }, { header: 'VAT', key: 'vat', type: 'money', width: 10 },
      { header: 'Total', key: 'total', type: 'money', width: 12 }, { header: 'Paid', key: 'paid', type: 'money', width: 12 }, { header: 'Balance', key: 'balance', type: 'money', width: 12 }, { header: 'Status', key: 'status', width: 10 }, { header: 'Days overdue', key: 'overdue_days', type: 'number', width: 12 }], rows },
    { name: 'VAT summary', columns: [{ header: 'Month', key: 'month', width: 10 }, { header: 'Net (AED)', key: 'net', type: 'money', width: 14 }, { header: 'VAT (AED)', key: 'vat', type: 'money', width: 14 }, { header: 'Total (AED)', key: 'total', type: 'money', width: 14 }], rows: Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)) }];
  });
  X('finance.view', 'payments', (req) => [{ name: 'Payments', columns: [
    { header: 'Receipt', key: 'receipt_no', width: 10 }, { header: 'Date', key: 'paid_on', width: 12 }, { header: 'Client', key: 'client_name', width: 28 }, { header: 'Method', key: 'method', width: 14 },
    { header: 'Provider', key: 'provider', width: 10 }, { header: 'Reference', key: 'provider_ref', width: 24 }, { header: 'Invoice', key: 'invoice_number', width: 16 },
    { header: 'Quotation', value: (p) => (p.quote_number ? `${p.quote_number}${p.quote_revision ? '-R' + p.quote_revision : ''}` : ''), width: 16 }, { header: 'Amount (AED)', key: 'amount', type: 'money', width: 14 }, { header: 'Refunded', key: 'refunded', type: 'money', width: 10 }], rows: F.payments(req.query) }]);
  X('finance.view', 'aging', () => { const a = F.aging(); return [{ name: 'Aging', columns: [{ header: 'Client', key: 'client_name', width: 30 }, { header: 'Not due', key: 'current', type: 'money', width: 12 }, { header: '1–30 days', key: 'd30', type: 'money', width: 12 }, { header: '31–60', key: 'd60', type: 'money', width: 12 }, { header: '61–90', key: 'd90', type: 'money', width: 12 }, { header: '90+', key: 'd90p', type: 'money', width: 12 }, { header: 'Total', key: 'total', type: 'money', width: 14 }], rows: a.clients }]; });
  X('finance.view', 'commissions', (req) => [{ name: 'Commissions', columns: [
    { header: 'Month', key: 'statement_month', width: 10 }, { header: 'Inspector', key: 'inspector_name', width: 24 }, { header: 'Job', key: 'job_number', width: 16 }, { header: 'Report', key: 'report_number', width: 16 },
    { header: 'Service', key: 'service_name', width: 30 }, { header: 'Fee excl. VAT', key: 'base_amount', type: 'money', width: 12 }, { header: '%', key: 'pct', type: 'number', width: 6 },
    { header: 'Commission', key: 'amount', type: 'money', width: 12 }, { header: 'Bonus', key: 'bonus', type: 'money', width: 10 }, { header: 'Status', key: 'status', width: 10 }, { header: 'Paid on', key: 'paid_on', width: 12 }], rows: F.listCommissions(req.query) }]);
  X('jobs.view', 'calibration', () => [{ name: 'Equipment', columns: [{ header: 'Equipment', key: 'name', width: 26 }, { header: 'Kind', key: 'kind', width: 12 }, { header: 'Serial', key: 'serial_no', width: 16 }, { header: 'Calibration due', key: 'calibration_due', width: 14 }, { header: 'Bookings (90 days)', key: 'n', type: 'number', width: 16 }],
    rows: db.prepare('SELECT e.*, (SELECT COUNT(*) FROM equipment_bookings b WHERE b.equipment_id=e.id AND b.start_at>?) n FROM equipment e ORDER BY calibration_due').all(ctx.now() - 90 * DAY) }]);
  X('jobs.view', 'clients', () => [{ name: 'Clients', columns: [{ header: 'Client', key: 'name', width: 28 }, { header: 'Type', key: 'type', width: 14 }, { header: 'Contact', key: 'contact_person', width: 22 }, { header: 'Email', key: 'email', width: 28 }, { header: 'Mobile', key: 'mobile', width: 16 }, { header: 'TRN', key: 'trn', width: 16 }, { header: 'Credit days', key: 'credit_terms_days', type: 'number', width: 10 }, { header: 'Monthly invoice', value: (c) => (c.monthly_invoicing ? 'Yes' : 'No'), width: 12 }, { header: 'Jobs', key: 'jobs', type: 'number', width: 8 }],
    rows: db.prepare('SELECT c.*, (SELECT COUNT(*) FROM jobs j WHERE j.client_id=c.id) jobs FROM clients c ORDER BY c.name').all() }]);
}
