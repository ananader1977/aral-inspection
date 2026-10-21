// Jobs (the spine), quotations, the service agreement, payments and scheduling.
import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { tx, formatNumber } from './db.js';
import { cleanMobile, isEmail, clampStr } from './util.js';
import { parseDateKey, dateKey, round2, money, fmtRange, HOUR, DAY, yearOf } from './time.js';
import { layout, rows, plainRows } from './emails.js';
import { buildIcs } from './ics.js';

export const JOB_STATUS_LABEL = {
  new: 'New request', quoted: 'Quoted', quote_accepted: 'Quote accepted', agreement_signed: 'Agreement signed', payment_pending: 'Awaiting payment',
  paid: 'Paid', scheduled: 'Scheduled', report_draft: 'Inspection in progress', inspected: 'Inspected', under_review: 'Under review',
  report_issued: 'Report issued', invoiced: 'Invoiced', closed: 'Closed', quote_rejected: 'Quote rejected', quote_expired: 'Quote expired',
  on_hold: 'On hold', access_failed: 'Access failed', reinspection_due: 'Re-inspection due', cancelled: 'Cancelled', refunded: 'Refunded',
};
const NEXT = {
  new: ['quoted', 'cancelled', 'on_hold'],
  quoted: ['quoted', 'quote_accepted', 'quote_rejected', 'quote_expired', 'cancelled', 'on_hold'],
  quote_rejected: ['quoted', 'cancelled'], quote_expired: ['quoted', 'cancelled'],
  quote_accepted: ['quoted', 'agreement_signed', 'cancelled'],
  agreement_signed: ['payment_pending', 'paid', 'scheduled', 'cancelled'],
  payment_pending: ['paid', 'cancelled'],
  paid: ['scheduled', 'cancelled', 'refunded', 'on_hold'],
  scheduled: ['scheduled', 'report_draft', 'access_failed', 'cancelled', 'on_hold'],
  access_failed: ['scheduled', 'cancelled'],
  report_draft: ['under_review', 'access_failed'],
  under_review: ['report_draft', 'report_issued'],
  report_issued: ['invoiced', 'closed', 'reinspection_due'],
  reinspection_due: ['invoiced', 'closed'],
  invoiced: ['closed', 'refunded'],
  on_hold: ['new', 'quoted', 'paid', 'scheduled', 'cancelled'],
  closed: ['refunded'], cancelled: [], refunded: [],
};
const token = () => crypto.randomBytes(18).toString('base64url');

export function createJobs(ctx) {
  const { db } = ctx;
  const S = () => ctx.settings();
  const audit = (...a) => ctx.admin.audit(...a);

  /** Next document number for a kind (job, quote, report, invoice, credit), inside the caller's transaction. */
  function nextNumber(kind) {
    const s = S();
    const n = Number(s[`next_${kind}_no`]) || 1;
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`next_${kind}_no`, String(n + 1));
    return formatNumber(s, kind, n, yearOf(ctx.now()));
  }

  function move(user, jobId, to, note = '') {
    const j = db.prepare('SELECT id,status FROM jobs WHERE id=?').get(jobId);
    if (!j) throw new HttpError(404, 'Job not found');
    if (j.status === to && to !== 'scheduled' && to !== 'quoted') return;
    if (!(NEXT[j.status] || []).includes(to)) throw new HttpError(409, `This job is "${JOB_STATUS_LABEL[j.status]}" and cannot move to "${JOB_STATUS_LABEL[to]}".`);
    db.prepare('UPDATE jobs SET status=?, updated_at=? WHERE id=?').run(to, ctx.now(), jobId);
    db.prepare('INSERT INTO job_events(job_id,ts,user_id,from_status,to_status,note) VALUES(?,?,?,?,?,?)').run(jobId, ctx.now(), user?.id ?? null, j.status, to, clampStr(note, 500));
  }
  const event = (user, jobId, note) => db.prepare('INSERT INTO job_events(job_id,ts,user_id,from_status,to_status,note) VALUES(?,?,?,?,?,?)').run(jobId, ctx.now(), user?.id ?? null, null, db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId).status, clampStr(note, 500));

  // ---------- clients & properties ----------
  function upsertClient(c) {
    const name = clampStr(c.name, 160);
    if (!name) throw new HttpError(400, 'Client name is required.');
    const mobile = c.mobile ? cleanMobile(String(c.mobile)) : '';
    if (c.mobile && !mobile) throw new HttpError(400, 'Client mobile number is not valid.');
    const email = clampStr(c.email, 254);
    if (email && !isEmail(email)) throw new HttpError(400, 'Client email is not valid.');
    const type = ['individual', 'company', 'bank', 'developer', 'owners_association', 'broker'].includes(c.type) ? c.type : 'individual';
    if (c.id) {
      db.prepare('UPDATE clients SET type=?,name=?,name_ar=?,contact_person=?,email=?,mobile=?,address=?,trn=?,credit_terms_days=?,monthly_invoicing=?,referral_source=? WHERE id=?')
        .run(type, name, clampStr(c.name_ar, 160), clampStr(c.contact_person, 120), email, mobile, clampStr(c.address, 300), clampStr(c.trn, 30), Number(c.credit_terms_days) || 0, c.monthly_invoicing ? 1 : 0, clampStr(c.referral_source, 60), c.id);
      return Number(c.id);
    }
    const existing = (mobile && db.prepare('SELECT id FROM clients WHERE mobile=?').get(mobile)) || (email && db.prepare('SELECT id FROM clients WHERE email=? COLLATE NOCASE').get(email));
    if (existing) return existing.id;
    return Number(db.prepare('INSERT INTO clients(type,name,name_ar,contact_person,email,mobile,address,trn,credit_terms_days,monthly_invoicing,referral_source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(type, name, clampStr(c.name_ar, 160), clampStr(c.contact_person, 120), email, mobile, clampStr(c.address, 300), clampStr(c.trn, 30), Number(c.credit_terms_days) || 0, c.monthly_invoicing ? 1 : 0, clampStr(c.referral_source, 60), ctx.now()).lastInsertRowid);
  }
  function saveProperty(p, id) {
    const v = {
      property_type: clampStr(p.property_type || 'apartment', 30), emirate: clampStr(p.emirate || 'Dubai', 40), community: clampStr(p.community, 120), building: clampStr(p.building, 120),
      unit_no: clampStr(p.unit_no, 40), plot_no: clampStr(p.plot_no, 40), title_deed_no: clampStr(p.title_deed_no, 60), developer: clampStr(p.developer, 80),
      bedrooms: p.property_type === 'studio' ? 0 : p.bedrooms === '' || p.bedrooms == null ? null : Number(p.bedrooms), has_maid_room: p.has_maid_room ? 1 : 0,
      levels: Number(p.levels) || 1, bua_sqft: p.bua_sqft ? Number(p.bua_sqft) : null, handover_date: p.handover_date || null, map_link: clampStr(p.map_link, 300),
    };
    if (v.handover_date && parseDateKey(v.handover_date) === null) throw new HttpError(400, 'Handover date: use the date picker.');
    const keys = Object.keys(v);
    if (id) { db.prepare(`UPDATE properties SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map((k) => v[k]), id); return id; }
    return Number(db.prepare(`INSERT INTO properties(${keys.join(',')},created_at) VALUES(${keys.map(() => '?').join(',')},?)`).run(...keys.map((k) => v[k]), ctx.now()).lastInsertRowid);
  }

  // ---------- jobs ----------
  function createJob(user, body) {
    const svc = db.prepare('SELECT * FROM services WHERE code=? AND active=1 AND is_addon=0').get(String(body.service_code || ''));
    if (!svc) throw new HttpError(400, 'Choose a service.');
    return tx(db, () => {
      const clientId = body.client_id ? Number(body.client_id) : upsertClient(body.client || {});
      const client = db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
      if (!client) throw new HttpError(400, 'Client not found.');
      const propertyId = saveProperty(body.property || {});
      const number = nextNumber('job');
      const kind = client.credit_terms_days > 0 ? 'company' : 'individual';
      const id = Number(db.prepare(`INSERT INTO jobs(number,client_id,property_id,service_id,purpose,channel,bank_reference,status,access_contact,access_notes,preferred_dates,occupancy,client_kind,lead_id,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'new',?,?,?,?,?,?,?,?,?)`).run(number, clientId, propertyId, svc.id, clampStr(body.purpose, 80), ['web', 'portal', 'bulk', 'internal', 'whatsapp'].includes(body.channel) ? body.channel : 'internal',
        clampStr(body.bank_reference, 60), clampStr(body.access_contact, 200), clampStr(body.access_notes, 1000), clampStr(body.preferred_dates, 200), clampStr(body.occupancy, 40), kind, body.lead_id || null, user?.id ?? null, ctx.now(), ctx.now()).lastInsertRowid);
      db.prepare('INSERT INTO job_events(job_id,ts,user_id,from_status,to_status,note) VALUES(?,?,?,?,?,?)').run(id, ctx.now(), user?.id ?? null, null, 'new', body.lead_id ? `Converted from lead L-${String(body.lead_id).padStart(5, '0')}` : 'Job created');
      audit(user, 'jobs', id, 'create', null, { number });
      return id;
    });
  }

  function convertLead(user, leadId) {
    const l = db.prepare('SELECT * FROM leads WHERE id=?').get(leadId);
    if (!l) throw new HttpError(404, 'Lead not found');
    if (l.job_id) return l.job_id;
    const svc = l.service_code || db.prepare("SELECT code FROM services WHERE active=1 AND is_addon=0 ORDER BY sort LIMIT 1").get().code;
    const id = createJob(user, {
      service_code: svc, channel: l.source === 'website' || l.source === 'broker' ? 'web' : l.source === 'whatsapp' ? 'whatsapp' : 'internal', lead_id: l.id,
      client: { name: l.name, mobile: l.mobile, email: l.email, type: l.client_type, referral_source: l.referral_code ? `Agent ${l.referral_code}` : l.source },
      property: { property_type: l.property_type || 'apartment', bedrooms: l.bedrooms, community: l.community, building: l.building },
      preferred_dates: l.preferred_date || '', access_notes: l.message,
    });
    db.prepare("UPDATE leads SET status='converted', job_id=?, contacted_at=COALESCE(contacted_at, ?) WHERE id=?").run(id, ctx.now(), leadId);
    // remember the add-ons the client chose on the website for the first quotation
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)").run(`_job_addons_${id}`, l.addons || '[]');
    return id;
  }

  function updateJob(user, id, body) {
    const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    if (!j) throw new HttpError(404, 'Job not found');
    tx(db, () => {
      if (body.client) upsertClient({ ...body.client, id: j.client_id });
      if (body.property) saveProperty(body.property, j.property_id);
      const f = {};
      for (const k of ['purpose', 'bank_reference', 'access_contact', 'access_notes', 'preferred_dates', 'occupancy']) if (body[k] !== undefined) f[k] = clampStr(body[k], 1000);
      if (body.ac_connected !== undefined) f.ac_connected = body.ac_connected ? 1 : 0;
      if (body.dewa_connected !== undefined) f.dewa_connected = body.dewa_connected ? 1 : 0;
      if (body.service_code) {
        const svc = db.prepare('SELECT id FROM services WHERE code=? AND is_addon=0').get(body.service_code);
        if (!svc) throw new HttpError(400, 'Choose a service.');
        if (!['new', 'quoted', 'quote_rejected', 'quote_expired'].includes(j.status)) throw new HttpError(409, 'The service can only change before the quotation is accepted.');
        f.service_id = svc.id;
      }
      if (body.client_kind && ['individual', 'company'].includes(body.client_kind)) f.client_kind = body.client_kind;
      const keys = Object.keys(f);
      if (keys.length) db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`).run(...keys.map((k) => f[k]), ctx.now(), id);
    });
    audit(user, 'jobs', id, 'update', null, body);
  }

  const JOB_SELECT = `SELECT j.*, c.name AS client_name, c.mobile AS client_mobile, c.email AS client_email, c.type AS client_type, c.credit_terms_days,
    p.property_type, p.community, p.building, p.unit_no, p.bedrooms, p.has_maid_room, p.emirate,
    s.code AS service_code, s.name AS service_name, s.segment, s.default_sla_hours, s.needs_thermal, s.includes_reinspection,
    i.name AS inspector_name FROM jobs j JOIN clients c ON c.id=j.client_id JOIN properties p ON p.id=j.property_id JOIN services s ON s.id=j.service_id LEFT JOIN inspectors i ON i.id=j.inspector_id`;

  function listJobs(q = {}, user) {
    const where = [], args = [];
    if (q.status) { where.push('j.status=?'); args.push(q.status); }
    if (q.open === '1') where.push("j.status NOT IN ('closed','cancelled','refunded')");
    if (q.inspector_id) { where.push('j.inspector_id=?'); args.push(Number(q.inspector_id)); }
    if (user?.role === 'inspector') { where.push('j.inspector_id=?'); args.push(user.inspector_id || -1); }
    if (q.from && parseDateKey(q.from) !== null) { where.push('j.created_at>=?'); args.push(parseDateKey(q.from)); }
    if (q.to && parseDateKey(q.to) !== null) { where.push('j.created_at<?'); args.push(parseDateKey(q.to) + DAY); }
    if (q.q) { where.push('(j.number LIKE ? OR c.name LIKE ? OR c.mobile LIKE ? OR p.building LIKE ? OR p.community LIKE ? OR p.unit_no LIKE ?)'); for (let i = 0; i < 6; i++) args.push(`%${q.q}%`); }
    return db.prepare(`${JOB_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY j.id DESC LIMIT 1000`).all(...args).map((j) => ({ ...j, status_label: JOB_STATUS_LABEL[j.status] }));
  }
  const getJob = (id) => { const j = db.prepare(`${JOB_SELECT} WHERE j.id=?`).get(id); if (!j) throw new HttpError(404, 'Job not found'); return j; };

  function jobDetail(id, user) {
    const j = getJob(id);
    if (user?.role === 'inspector' && j.inspector_id !== user.inspector_id) throw new HttpError(403, 'This job is not assigned to you.');
    const quotes = db.prepare('SELECT * FROM quotations WHERE job_id=? ORDER BY id DESC').all(id).map((q) => ({ ...q, lines: db.prepare('SELECT * FROM quote_lines WHERE quotation_id=? ORDER BY pos').all(q.id), components: JSON.parse(q.components), prerequisites: JSON.parse(q.prerequisites), display_number: quoteNo(q) }));
    const report = db.prepare('SELECT id, number, status, submitted_at, approved_at, issued_at, review_note, verify_token FROM reports WHERE job_id=?').get(id) || null;
    if (report) {
      report.counts = db.prepare(`SELECT o.severity, COUNT(*) n FROM observations o JOIN report_items it ON it.id=o.item_id JOIN report_sections sc ON sc.id=it.section_id WHERE sc.report_id=? GROUP BY o.severity`).all(report.id);
      report.media = db.prepare('SELECT kind, COUNT(*) n FROM media WHERE job_id=? GROUP BY kind').all(id);
      report.attachments = db.prepare('SELECT COUNT(*) n FROM report_attachments WHERE report_id=?').get(report.id).n;
      report.versions = db.prepare('SELECT version, issued_at, pdf_file_id, page_count FROM report_versions WHERE report_id=? ORDER BY version DESC').all(report.id);
    }
    return {
      job: { ...j, status_label: JOB_STATUS_LABEL[j.status], next: NEXT[j.status] || [], equipment_ids: JSON.parse(j.equipment_ids || '[]') },
      client: db.prepare('SELECT * FROM clients WHERE id=?').get(j.client_id),
      property: db.prepare('SELECT * FROM properties WHERE id=?').get(j.property_id),
      quotes, agreement: db.prepare('SELECT id, signed_at, signed_name, sent_at, pdf_file_id FROM agreements WHERE job_id=? ORDER BY id DESC').get(id) || null,
      payments: db.prepare('SELECT * FROM payments WHERE quotation_id IN (SELECT id FROM quotations WHERE job_id=?) OR invoice_id IN (SELECT invoice_id FROM invoice_lines WHERE job_id=?) ORDER BY id').all(id, id),
      report, invoices: db.prepare('SELECT DISTINCT i.* FROM invoices i JOIN invoice_lines l ON l.invoice_id=i.id WHERE l.job_id=? ORDER BY i.id').all(id),
      commission: db.prepare('SELECT * FROM commissions WHERE job_id=?').get(id) || null,
      events: db.prepare('SELECT e.*, u.name AS user_name FROM job_events e LEFT JOIN users u ON u.id=e.user_id WHERE job_id=? ORDER BY e.id').all(id),
      equipment: db.prepare('SELECT e.* FROM equipment_bookings b JOIN equipment e ON e.id=b.equipment_id WHERE b.job_id=?').all(id),
      parent: j.parent_job_id ? db.prepare('SELECT id, number FROM jobs WHERE id=?').get(j.parent_job_id) : null,
      children: db.prepare('SELECT id, number, status FROM jobs WHERE parent_job_id=?').all(id),
      lead: j.lead_id ? db.prepare('SELECT id, referral_code, source FROM leads WHERE id=?').get(j.lead_id) : null,
      drive: ctx.storage.jobFolderLink(id),
      client_link: (() => { const q = quotes.find((x) => !['draft', 'superseded'].includes(x.status)); return q ? quoteUrl(q) : null; })(),
      paid: paidForJob(id),
    };
  }

  function cancelJob(user, id, reason) {
    move(user, id, 'cancelled', reason || 'Cancelled');
    db.prepare('DELETE FROM equipment_bookings WHERE job_id=?').run(id);
    db.prepare("UPDATE commissions SET status='void' WHERE job_id=? AND status IN ('pending','payable')").run(id);
    audit(user, 'jobs', id, 'cancel', null, { reason });
  }

  // ---------- quotations ----------
  const quoteNo = (q) => (q.revision ? `${q.number}-R${q.revision}` : q.number);
  const priceVat = () => { const s = S(); return s.vat_registered === '1' ? Number(s.vat_rate) || 0 : 0; };
  function totals(lines, discount) {
    const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
    const disc = round2(Math.min(Math.max(Number(discount) || 0, 0), subtotal));
    const net = round2(subtotal - disc);
    const vatRate = priceVat();
    const vat = round2((net * vatRate) / 100);
    return { subtotal, discount: disc, net, vat_rate: vatRate, vat, total: round2(net + vat) };
  }
  /** Default lines from the price list: the service and any chosen add-ons. */
  function defaultLines(jobId, addons = []) {
    const j = getJob(jobId);
    const lines = [];
    const rate = db.prepare('SELECT price FROM client_rates WHERE client_id=? AND service_id=?').get(j.client_id, j.service_id);
    const base = rate?.price ?? ctx.pricing.basePrice(j.service_id, j.property_type, j.bedrooms, null)?.price ?? null;
    const prop = [j.bedrooms ? `${j.bedrooms} bedroom` : j.property_type === 'studio' ? 'Studio' : '', j.property_type !== 'studio' ? j.property_type : 'apartment', j.community].filter(Boolean).join(' ').replace(/^(\w)/, (m) => m.toUpperCase());
    lines.push({ service_id: j.service_id, description: `${j.service_name}${j.includes_reinspection ? ' (includes one re-inspection)' : ''} – ${prop}`, qty: 1, unit_price: base ?? 0, amount: base ?? 0 });
    for (const code of addons) {
      const a = db.prepare('SELECT * FROM services WHERE code=? AND is_addon=1 AND active=1').get(code);
      const r = a && ctx.pricing.basePrice(a.id, j.property_type, j.bedrooms, null);
      if (r) lines.push({ service_id: a.id, description: a.name.replace(/^Add-on:\s*/, ''), qty: 1, unit_price: r.price, amount: r.price });
    }
    return { lines, priced: base != null };
  }

  function saveQuote(user, jobId, body = {}) {
    const j = getJob(jobId);
    if (!['new', 'quoted', 'quote_rejected', 'quote_expired', 'quote_accepted'].includes(j.status)) throw new HttpError(409, 'A quotation can only be prepared before the agreement is signed.');
    const s = S();
    let lines;
    if (Array.isArray(body.lines) && body.lines.length) {
      lines = body.lines.slice(0, 30).map((l) => {
        const qty = Number(l.qty) || 1, unit = Number(l.unit_price);
        if (!clampStr(l.description, 400)) throw new HttpError(400, 'Each line needs a description.');
        if (!Number.isFinite(unit) || unit < 0) throw new HttpError(400, 'Each line needs a price.');
        return { service_id: l.service_id || null, description: clampStr(l.description, 400), qty, unit_price: round2(unit), amount: round2(qty * unit) };
      });
    } else {
      const remembered = JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(`_job_addons_${jobId}`)?.value || '[]');
      lines = defaultLines(jobId, body.addons || remembered).lines;
    }
    const t = totals(lines, body.discount);
    if (t.discount > 0 && user?.role !== 'super_admin' && t.discount > t.subtotal * 0.1) throw new HttpError(403, 'Discounts above 10% need the Super Admin.');
    const deposit = Math.min(100, Math.max(0, Number(body.deposit_pct ?? s.deposit_pct) || 100));
    const validDays = Number(body.valid_days ?? s.quote_validity_days) || 14;
    const comps = JSON.stringify(Array.isArray(body.components) ? body.components.slice(0, 12).map((x) => clampStr(x, 60)) : ['Interior finishes', 'MEP (electrical and plumbing)', 'Air conditioning', 'Water leak and moisture']);
    const prereq = JSON.stringify(Array.isArray(body.prerequisites) ? body.prerequisites.slice(0, 8).map((x) => clampStr(x, 80)) : ['AC connected', 'DEWA connected', 'Keys and access arranged']);
    const tc = ctx.admin.currentBlock('tc_quote');
    return tx(db, () => {
      const draft = db.prepare("SELECT * FROM quotations WHERE job_id=? AND status='draft' ORDER BY id DESC").get(jobId);
      let qid;
      if (draft) {
        db.prepare('UPDATE quotations SET issue_date=?,valid_until=?,components=?,prerequisites=?,turnaround_text=?,subtotal=?,discount=?,net=?,vat_rate=?,vat=?,total=?,deposit_pct=?,payment_terms=?,tc_block_id=? WHERE id=?')
          .run(dateKey(ctx.now()), dateKey(ctx.now() + validDays * DAY), comps, prereq, clampStr(body.turnaround_text || s.default_turnaround, 200), t.subtotal, t.discount, t.net, t.vat_rate, t.vat, t.total, deposit, j.client_kind === 'company' ? `Payment within ${j.credit_terms_days || s.payment_terms_days} days of invoice` : deposit >= 100 ? '100% in advance' : `${deposit}% in advance, balance before the report is issued`, tc?.id ?? null, draft.id);
        db.prepare('DELETE FROM quote_lines WHERE quotation_id=?').run(draft.id);
        qid = draft.id;
      } else {
        const prev = db.prepare('SELECT * FROM quotations WHERE job_id=? ORDER BY id DESC').get(jobId);
        const number = prev ? prev.number : nextNumber('quote');
        const revision = prev ? prev.revision + 1 : 0;
        if (prev) db.prepare("UPDATE quotations SET status='superseded' WHERE job_id=? AND status IN ('sent','change_requested','rejected','expired','accepted')").run(jobId);
        qid = Number(db.prepare(`INSERT INTO quotations(number,revision,job_id,issue_date,valid_until,status,components,prerequisites,turnaround_text,subtotal,discount,net,vat_rate,vat,total,deposit_pct,payment_terms,tc_block_id,public_token,created_by,created_at)
          VALUES(?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(number, revision, jobId, dateKey(ctx.now()), dateKey(ctx.now() + validDays * DAY), comps, prereq, clampStr(body.turnaround_text || s.default_turnaround, 200),
          t.subtotal, t.discount, t.net, t.vat_rate, t.vat, t.total, deposit, j.client_kind === 'company' ? `Payment within ${j.credit_terms_days || s.payment_terms_days} days of invoice` : deposit >= 100 ? '100% in advance' : `${deposit}% in advance, balance before the report is issued`, tc?.id ?? null, token(), user?.id ?? null, ctx.now()).lastInsertRowid);
      }
      lines.forEach((l, i) => db.prepare('INSERT INTO quote_lines(quotation_id,pos,service_id,description,qty,unit_price,amount) VALUES(?,?,?,?,?,?,?)').run(qid, i + 1, l.service_id, l.description, l.qty, l.unit_price, l.amount));
      return qid;
    });
  }

  const quoteById = (id) => { const q = db.prepare('SELECT * FROM quotations WHERE id=?').get(id); if (!q) throw new HttpError(404, 'Quotation not found'); return q; };
  const quoteLines = (id) => db.prepare('SELECT * FROM quote_lines WHERE quotation_id=? ORDER BY pos').all(id);
  const quoteUrl = (q) => `${ctx.config.baseUrl}/quote.html?t=${q.public_token}`;

  async function sendQuote(user, qid) {
    const q = quoteById(qid);
    if (!['draft', 'sent'].includes(q.status)) throw new HttpError(409, 'Only a draft quotation can be sent.');
    if (q.total <= 0) throw new HttpError(400, 'Add a price before sending the quotation.');
    const j = getJob(q.job_id);
    if (!j.client_email) throw new HttpError(400, 'Add the client email before sending.');
    tx(db, () => {
      db.prepare("UPDATE quotations SET status='sent', sent_at=? WHERE id=?").run(ctx.now(), qid);
      move(user, q.job_id, 'quoted', `Quotation ${quoteNo(q)} sent`);
    });
    const pdf = ctx.docs.quotePdf(qid);
    const s = S();
    const url = quoteUrl(q);
    await ctx.mailer.send({
      to: j.client_email, jobId: j.id, template: 'quotation',
      subject: `Your inspection quotation ${quoteNo(q)} – ${s.company_name}`,
      text: `Dear ${j.client_name},\n\nThank you for your enquiry. Please find our quotation ${quoteNo(q)} attached (AED ${money(q.total)}).\n\nReview and accept it here: ${url}\n\nOnce you accept, you will sign the service agreement online and we will book your inspection.\n\n${s.company_name}`,
      html: layout(s, `Quotation ${quoteNo(q)}`, `<p>Dear ${j.client_name},</p><p>Thank you for your enquiry. Please find our quotation attached.</p>${rows([['Service', j.service_name], ['Property', [j.building, j.unit_no && `Unit ${j.unit_no}`, j.community].filter(Boolean).join(', ')], ['Total', `AED ${money(q.total)}`], ['Valid until', q.valid_until.split('-').reverse().join('/')]])}<p>Once you accept, you sign the service agreement online and we book your inspection.</p>`, { url, label: 'Review and accept' }),
      attachments: [{ filename: `Quotation-${quoteNo(q)}.pdf`, contentType: 'application/pdf', content: pdf }],
    });
    return url;
  }

  /** Public view of a quotation by its secure link. */
  function publicQuote(tok) {
    const q = db.prepare('SELECT * FROM quotations WHERE public_token=?').get(String(tok || ''));
    if (!q || q.status === 'draft') throw new HttpError(404, 'This link is not valid. Please ask us for a new quotation.');
    const j = getJob(q.job_id);
    const ag = db.prepare('SELECT * FROM agreements WHERE quotation_id=?').get(q.id);
    const s = S();
    const paid = paidForJob(j.id);
    const due = round2((q.total * q.deposit_pct) / 100);
    return {
      number: quoteNo(q), status: q.status, issue_date: q.issue_date, valid_until: q.valid_until, expired: q.status === 'sent' && q.valid_until < dateKey(ctx.now()),
      client: j.client_name, service: j.service_name, property: [j.building, j.unit_no && `Unit ${j.unit_no}`, j.community, j.emirate].filter(Boolean).join(', '),
      lines: quoteLines(q.id).map((l) => ({ description: l.description, qty: l.qty, amount: l.amount })), subtotal: q.subtotal, discount: q.discount, vat_rate: q.vat_rate, vat: q.vat, total: q.total,
      components: JSON.parse(q.components), prerequisites: JSON.parse(q.prerequisites), turnaround: q.turnaround_text, payment_terms: q.payment_terms,
      company: s.company_name, terms: ctx.admin.currentBlock('tc_booking')?.body || '', quote_terms: (q.tc_block_id && db.prepare('SELECT body FROM content_blocks WHERE id=?').get(q.tc_block_id)?.body) || '',
      agreement: ag ? { signed: !!ag.signed_at, signed_name: ag.signed_name, signed_at: ag.signed_at } : null,
      credit: j.client_kind === 'company', due_now: j.client_kind === 'company' ? 0 : round2(Math.max(0, due - paid)), paid, job_status: j.status,
      payments: ctx.config.paymentProvider, superseded: q.status === 'superseded',
    };
  }

  async function decideQuote(tok, { action, name, note }, ip) {
    const q = db.prepare('SELECT * FROM quotations WHERE public_token=?').get(String(tok || ''));
    if (!q) throw new HttpError(404, 'This link is not valid.');
    if (q.status !== 'sent') throw new HttpError(409, q.status === 'accepted' ? 'This quotation is already accepted.' : 'This quotation can no longer be changed. Please contact us.');
    if (q.valid_until < dateKey(ctx.now())) throw new HttpError(409, 'This quotation has expired. Please ask us for an updated one.');
    const who = clampStr(name, 120);
    const s = S();
    const j = getJob(q.job_id);
    if (action === 'accept') {
      if (!who) throw new HttpError(400, 'Please type your full name to accept.');
      tx(db, () => {
        db.prepare("UPDATE quotations SET status='accepted', decided_at=?, decided_name=?, decided_ip=? WHERE id=?").run(ctx.now(), who, ip, q.id);
        db.prepare('UPDATE jobs SET fee_net=? WHERE id=?').run(q.net, q.job_id);
        move(null, q.job_id, 'quote_accepted', `Accepted online by ${who}`);
        const tc = ctx.admin.currentBlock('tc_booking');
        if (!db.prepare('SELECT 1 FROM agreements WHERE quotation_id=?').get(q.id)) db.prepare('INSERT INTO agreements(job_id,quotation_id,tc_block_id,public_token,sent_at) VALUES(?,?,?,?,?)').run(q.job_id, q.id, tc?.id ?? null, q.public_token, ctx.now());
      });
      await notifyOffice(`Quotation ${quoteNo(q)} accepted by ${who}`, `${j.number} · ${j.client_name}`);
      await sendSigningLink(null, q.id).catch((e) => console.error('[signing link]', e.message));
    } else if (action === 'reject' || action === 'change') {
      tx(db, () => {
        db.prepare('UPDATE quotations SET status=?, decided_at=?, decided_name=?, decided_ip=?, decision_note=? WHERE id=?').run(action === 'reject' ? 'rejected' : 'change_requested', ctx.now(), who, ip, clampStr(note, 1000), q.id);
        if (action === 'reject') move(null, q.job_id, 'quote_rejected', `Declined online${note ? ': ' + clampStr(note, 300) : ''}`);
        else event(null, q.job_id, `Change requested: ${clampStr(note, 300)}`);
      });
      await notifyOffice(`Quotation ${quoteNo(q)} ${action === 'reject' ? 'declined' : 'change requested'}`, `${j.number} · ${j.client_name}\n${note || ''}`);
    } else throw new HttpError(400, 'Unknown action');
    return publicQuote(tok);
  }

  /** Client signs the service agreement (typed name; optional drawn signature as PNG data URL). */
  async function signAgreement(tok, { name, signature, agree }, ip) {
    const q = db.prepare('SELECT * FROM quotations WHERE public_token=?').get(String(tok || ''));
    const ag = q && db.prepare('SELECT * FROM agreements WHERE quotation_id=?').get(q.id);
    if (!ag) throw new HttpError(404, 'Accept the quotation first.');
    if (ag.signed_at) return publicQuote(tok);
    const who = clampStr(name, 120);
    if (!who) throw new HttpError(400, 'Please type your full name to sign.');
    if (!agree) throw new HttpError(400, 'Please tick that you agree to the terms.');
    let sigId = null;
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(signature || ''));
    if (m && m[1].length < 400000) sigId = await ctx.storage.save({ name: `signature-${q.number}.png`, mime: 'image/png', buf: Buffer.from(m[1], 'base64'), jobId: q.job_id, purpose: 'signature' });
    const j = getJob(q.job_id);
    tx(db, () => {
      db.prepare('UPDATE agreements SET signed_at=?, signed_name=?, signed_ip=?, signature_file_id=? WHERE id=?').run(ctx.now(), who, ip, sigId, ag.id);
      move(null, q.job_id, 'agreement_signed', `Agreement signed by ${who}`);
      if (j.client_kind !== 'company' && q.total > 0) move(null, q.job_id, 'payment_pending', 'Waiting for payment');
      else ctx.reports.ensureReport(q.job_id); // credit clients: ready to schedule now
    });
    try {
      const pdf = await ctx.docs.agreementPdf(ag.id);
      const fid = await ctx.storage.save({ name: `Agreement-${q.number}.pdf`, mime: 'application/pdf', buf: pdf, jobId: q.job_id, purpose: 'pdf_agreement' });
      db.prepare('UPDATE agreements SET pdf_file_id=? WHERE id=?').run(fid, ag.id);
      const s = S();
      if (j.client_email) await ctx.mailer.send({ to: j.client_email, jobId: j.id, template: 'agreement', subject: `Signed service agreement – ${quoteNo(q)}`, text: `Dear ${j.client_name},\n\nThank you. Your signed service agreement is attached.${j.client_kind === 'company' ? ' We will contact you to book the inspection.' : ` You can pay online here: ${quoteUrl(q)}`}\n\n${s.company_name}`, html: layout(s, 'Agreement signed', `<p>Dear ${j.client_name},</p><p>Thank you. Your signed service agreement is attached.</p>`, j.client_kind === 'company' ? null : { url: quoteUrl(q), label: 'Pay online' }), attachments: [{ filename: `Agreement-${q.number}.pdf`, contentType: 'application/pdf', content: pdf }] });
    } catch (e) { console.error('[agreement pdf]', e.message); }
    return publicQuote(tok);
  }

  /** Emails the client the secure link to sign the service agreement (and pay, when payment is due). */
  async function sendSigningLink(user, qid) {
    const q = quoteById(qid);
    const ag = db.prepare('SELECT * FROM agreements WHERE quotation_id=?').get(q.id);
    if (!ag) throw new HttpError(409, 'The quotation must be accepted first.');
    const j = getJob(q.job_id);
    if (!j.client_email) throw new HttpError(400, 'Add the client email first, or send the link by WhatsApp.');
    const s = S();
    const url = quoteUrl(q);
    const signed = !!ag.signed_at;
    await ctx.mailer.send({
      to: j.client_email, jobId: j.id, template: signed ? 'payment_link' : 'agreement_link',
      subject: signed ? `Pay for your inspection – ${quoteNo(q)}` : `Please sign your service agreement – ${quoteNo(q)}`,
      text: `Dear ${j.client_name},\n\n${signed ? 'Thank you for signing. You can pay online here' : 'Thank you for accepting our quotation. Please sign the service agreement online here'}: ${url}\n\n${j.client_kind === 'company' || signed ? '' : 'After signing you can pay by card on the same page. '}We will then book your inspection.\n\n${s.company_name}`,
      html: layout(s, signed ? 'Pay for your inspection' : 'Sign your service agreement', `<p>Dear ${j.client_name},</p><p>${signed ? 'Thank you for signing. You can pay online using the button below.' : 'Thank you for accepting our quotation. The next step is to sign the service agreement online. It takes a minute.'}</p>${rows([['Quotation', quoteNo(q)], ['Total', `AED ${money(q.total)}`]])}`, { url, label: signed ? 'Pay online' : 'Sign the agreement' }),
    });
    db.prepare('UPDATE agreements SET sent_at=? WHERE id=?').run(ctx.now(), ag.id);
    if (user) event(user, j.id, signed ? 'Payment link emailed to the client' : 'Signing link emailed to the client');
  }

  /** The office records an agreement the client signed on paper (or confirmed in writing). */
  async function signForClient(user, qid, { name, note }) {
    const q = quoteById(qid);
    if (!clampStr(name, 120)) throw new HttpError(400, 'Type the name of the person who signed.');
    const out = await signAgreement(q.public_token, { name: `${clampStr(name, 120)} (recorded by ${user.name}${note ? `: ${clampStr(note, 100)}` : ''})`, agree: true }, `office: ${user.email}`);
    audit(user, 'agreements', q.id, 'record_signature', null, { name, note });
    return out;
  }

  // ---------- payments ----------
  function paidForJob(jobId) {
    return round2(db.prepare(`SELECT COALESCE(SUM(amount - refunded),0) s FROM payments WHERE quotation_id IN (SELECT id FROM quotations WHERE job_id=?)
      OR (invoice_id IN (SELECT invoice_id FROM invoice_lines WHERE job_id=?) AND quotation_id IS NULL)`).get(jobId, jobId).s);
  }
  /** Records money received against a quotation (advance) — card or manual. */
  async function recordQuotePayment(user, qid, { method, amount, provider = '', ref = '', paid_on, proof_file_id = null }) {
    const q = quoteById(qid);
    const j = getJob(q.job_id);
    const amt = round2(Number(amount));
    if (!(amt > 0)) throw new HttpError(400, 'Enter the amount received.');
    if (!['card', 'bank_transfer', 'cheque', 'cash'].includes(method)) throw new HttpError(400, 'Choose how it was paid.');
    if (ref && db.prepare('SELECT 1 FROM payments WHERE provider_ref=? AND provider=?').get(ref, provider)) return null; // already recorded (webhook retry)
    const pid = tx(db, () => {
      const receipt = `RC-${String(db.prepare('SELECT COUNT(*) n FROM payments').get().n + 1).padStart(5, '0')}`;
      const id = Number(db.prepare('INSERT INTO payments(client_id,quotation_id,method,provider,provider_ref,amount,paid_on,proof_file_id,receipt_no,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(j.client_id, qid, method, provider, ref, amt, paid_on || dateKey(ctx.now()), proof_file_id, receipt, user?.id ?? null, ctx.now()).lastInsertRowid);
      const due = round2((q.total * q.deposit_pct) / 100);
      const cur = db.prepare('SELECT status FROM jobs WHERE id=?').get(j.id).status;
      if (paidForJob(j.id) + 0.001 >= due && ['payment_pending', 'agreement_signed'].includes(cur)) {
        move(user, j.id, 'paid', `Paid AED ${money(amt)} (${method.replace('_', ' ')})`);
        ctx.reports.ensureReport(j.id); // the inspection record (rooms and items) is ready as soon as the job is paid
      }
      else event(user, j.id, `Payment received: AED ${money(amt)} (${method.replace('_', ' ')})`);
      return id;
    });
    audit(user, 'payments', pid, 'create', null, { quotation: quoteNo(q), amount: amt, method });
    const s = S();
    if (j.client_email) {
      const pdf = ctx.docs.receiptPdf(pid);
      await ctx.mailer.send({ to: j.client_email, jobId: j.id, template: 'receipt', subject: `Payment received – ${quoteNo(q)}`, text: `Dear ${j.client_name},\n\nWe received AED ${money(amt)}. Your receipt is attached. We will contact you to confirm the inspection date.\n\n${s.company_name}`, html: layout(s, 'Payment received', `<p>Dear ${j.client_name},</p><p>We received your payment. Your receipt is attached, and we will contact you to confirm the inspection date.</p>${rows([['Amount', `AED ${money(amt)}`], ['Quotation', quoteNo(q)]])}`), attachments: [{ filename: `Receipt-${quoteNo(q)}.pdf`, contentType: 'application/pdf', content: pdf }] });
    }
    await notifyOffice(`Payment received: AED ${money(amt)}`, `${j.number} · ${j.client_name} · ${method}`);
    return pid;
  }

  async function notifyOffice(subject, text) {
    const s = S();
    if (s.email && isEmail(s.email)) await ctx.mailer.send({ to: s.email, subject: `[ARAL] ${subject}`, text, template: 'office' });
  }

  // ---------- scheduling ----------
  const expiredOn = (ins, day) => ['licence_expiry', 'insurance_expiry', 'agreement_expiry'].filter((k) => ins[k] && ins[k] < day);
  function availableInspectors(start, end, { thermal = false, exceptJob } = {}) {
    const day = dateKey(start);
    return db.prepare('SELECT * FROM inspectors WHERE active=1 ORDER BY name').all().map((i) => {
      const clash = db.prepare("SELECT number FROM jobs WHERE inspector_id=? AND id<>? AND scheduled_start<? AND scheduled_end>? AND status NOT IN ('cancelled','refunded')").get(i.id, exceptJob || 0, end, start);
      const expired = expiredOn(i, day);
      const problems = [...expired.map((k) => `${k.replace('_expiry', '')} expired`), ...(clash ? [`busy with ${clash.number}`] : []), ...(thermal && !i.thermal_certified ? ['not thermal certified'] : [])];
      return { id: i.id, name: i.name, areas: i.areas, ok: !problems.length, problems };
    });
  }
  function freeEquipment(start, end, exceptJob) {
    const day = dateKey(start);
    return db.prepare('SELECT * FROM equipment WHERE active=1 ORDER BY kind, name').all().map((e) => {
      const busy = db.prepare('SELECT j.number FROM equipment_bookings b JOIN jobs j ON j.id=b.job_id WHERE b.equipment_id=? AND b.job_id<>? AND b.start_at<? AND b.end_at>?').get(e.id, exceptJob || 0, end, start);
      const cal = e.calibration_due && e.calibration_due < day;
      return { ...e, ok: !busy && !cal, problems: [...(busy ? [`booked for ${busy.number}`] : []), ...(cal ? ['calibration overdue'] : [])] };
    });
  }

  async function schedule(user, jobId, { date, time, hours, inspector_id, equipment_ids = [], notify = true }) {
    const j = getJob(jobId);
    const okStatus = ['paid', 'scheduled', 'access_failed'].includes(j.status) || (j.status === 'agreement_signed' && j.client_kind === 'company');
    if (!okStatus) throw new HttpError(409, j.client_kind === 'company' ? 'The agreement must be signed before scheduling.' : 'The job must be paid before it can be scheduled.');
    const dayStart = parseDateKey(date);
    const mm = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
    if (dayStart === null || !mm) throw new HttpError(400, 'Choose a date and a start time.');
    const start = dayStart + (Number(mm[1]) * 60 + Number(mm[2])) * 60000;
    const end = start + Math.min(Math.max(Number(hours) || 3, 0.5), 12) * HOUR;
    const ins = availableInspectors(start, end, { thermal: !!j.needs_thermal, exceptJob: jobId }).find((i) => i.id === Number(inspector_id));
    if (!ins) throw new HttpError(400, 'Choose an inspector.');
    if (!ins.ok && !ins.problems.every((p) => p === 'not thermal certified')) throw new HttpError(409, `${ins.name} cannot take this job: ${ins.problems.join(', ')}.`);
    const eq = freeEquipment(start, end, jobId);
    let ids = [...new Set([].concat(equipment_ids).map(Number).filter(Boolean))];
    for (const id of ids) { const e = eq.find((x) => x.id === id); if (!e) throw new HttpError(400, 'Equipment not found.'); if (!e.ok) throw new HttpError(409, `${e.name}: ${e.problems.join(', ')}.`); }
    if (j.needs_thermal && !ids.some((id) => eq.find((x) => x.id === id)?.kind === 'thermal')) {
      const free = eq.find((x) => x.kind === 'thermal' && x.ok);
      if (!free) throw new HttpError(409, 'This service needs a thermal camera and none is free (or within calibration) at that time.');
      ids.push(free.id);
    }
    const resched = j.status === 'scheduled';
    tx(db, () => {
      db.prepare('UPDATE jobs SET inspector_id=?, scheduled_start=?, scheduled_end=?, equipment_ids=?, updated_at=? WHERE id=?').run(ins.id, start, end, JSON.stringify(ids), ctx.now(), jobId);
      db.prepare('DELETE FROM equipment_bookings WHERE job_id=?').run(jobId);
      for (const id of ids) db.prepare('INSERT INTO equipment_bookings(equipment_id,job_id,start_at,end_at) VALUES(?,?,?,?)').run(id, jobId, start, end);
      move(user, jobId, 'scheduled', `${resched ? 'Rescheduled' : 'Scheduled'}: ${fmtRange(start, end)} with ${ins.name}`);
      ctx.reports.ensureReport(jobId);
    });
    audit(user, 'jobs', jobId, resched ? 'reschedule' : 'schedule', null, { start, inspector: ins.name });
    if (notify) await sendSchedule(jobId, resched);
    return getJob(jobId);
  }

  function icsFor(j, s) {
    return buildIcs([{ uid: `${j.number}@aral-inspection`, start: j.scheduled_start, end: j.scheduled_end, summary: `${s.company_short} inspection – ${j.service_name}`, description: plainRows([['Job', j.number], ['Client', j.client_name], ['Mobile', j.client_mobile], ['Inspector', j.inspector_name], ['Access', j.access_notes]]), location: [j.building, j.unit_no && `Unit ${j.unit_no}`, j.community, j.emirate].filter(Boolean).join(', ') }], { name: s.company_name, alarmMinutes: 120, now: ctx.now(), method: 'PUBLISH' });
  }
  async function sendSchedule(jobId, resched) {
    const j = getJob(jobId);
    const s = S();
    const when = fmtRange(j.scheduled_start, j.scheduled_end);
    const where = [j.building, j.unit_no && `Unit ${j.unit_no}`, j.community].filter(Boolean).join(', ');
    const ics = { filename: `${j.number}.ics`, contentType: 'text/calendar; charset=utf-8; method=PUBLISH', content: Buffer.from(icsFor(j, s)) };
    if (j.client_email) await ctx.mailer.send({ to: j.client_email, jobId, template: 'inspection_confirmation', subject: `${resched ? 'New date for' : 'Confirmed:'} your inspection – ${when}`,
      text: `Dear ${j.client_name},\n\nYour inspection is ${resched ? 'now' : ''} booked for ${when} at ${where}. Inspector: ${j.inspector_name}.\n\nPlease make sure the AC and DEWA are connected and we can get access to the property.\n\n${s.company_name}`,
      html: layout(s, resched ? 'Your inspection has a new date' : 'Your inspection is booked', `<p>Dear ${j.client_name},</p>${rows([['When', when], ['Where', where], ['Inspector', j.inspector_name], ['Job', j.number]])}<p><b>Before we come:</b> please make sure the air conditioning and DEWA are connected and we can get access to the property.</p>`), attachments: [ics] });
    const ins = db.prepare('SELECT email FROM inspectors WHERE id=?').get(j.inspector_id);
    if (ins?.email) await ctx.mailer.send({ to: ins.email, jobId, template: 'inspector_assignment', subject: `${resched ? 'Rescheduled' : 'New job'}: ${j.number} – ${when}`, text: plainRows([['Job', j.number], ['Service', j.service_name], ['When', when], ['Where', where], ['Client', j.client_name], ['Mobile', j.client_mobile], ['Access', j.access_notes]]) + `\n\nOpen the inspection app: ${ctx.config.baseUrl}/app/#inspect/${j.id}`, attachments: [ics] });
  }

  /** Appointments for the calendar view between two timestamps. */
  function calendar(from, to, { inspector_id, user } = {}) {
    const where = ["j.scheduled_start IS NOT NULL", 'j.scheduled_start<?', 'j.scheduled_end>?', "j.status NOT IN ('cancelled','refunded')"];
    const args = [to, from];
    if (inspector_id) { where.push('j.inspector_id=?'); args.push(Number(inspector_id)); }
    if (user?.role === 'inspector') { where.push('j.inspector_id=?'); args.push(user.inspector_id || -1); }
    return db.prepare(`${JOB_SELECT} WHERE ${where.join(' AND ')} ORDER BY j.scheduled_start`).all(...args).map((j) => ({
      id: j.id, number: j.number, start: j.scheduled_start, end: j.scheduled_end, status: j.status, status_label: JOB_STATUS_LABEL[j.status],
      client: j.client_name, service: j.service_name, inspector: j.inspector_name, inspector_id: j.inspector_id,
      where: [j.building, j.unit_no && `Unit ${j.unit_no}`, j.community].filter(Boolean).join(', '),
    }));
  }
  function feedEvents(inspectorId) {
    const s = S();
    return calendar(ctx.now() - 60 * DAY, ctx.now() + 180 * DAY, { inspector_id: inspectorId }).map((e) => ({
      uid: `${e.number}@aral-inspection`, start: e.start, end: e.end, summary: `${e.number} · ${e.service} · ${e.inspector || ''}`,
      description: plainRows([['Client', e.client], ['Status', e.status_label], ['Open', `${ctx.config.baseUrl}/app/#job/${e.id}`]]), location: e.where, status: 'CONFIRMED',
      color: ['report_issued', 'invoiced', 'closed'].includes(e.status) ? 'green' : 'blue', _s: s,
    }));
  }

  return { nextNumber, move, event, upsertClient, createJob, convertLead, updateJob, listJobs, getJob, jobDetail, cancelJob, defaultLines, saveQuote, quoteById, quoteLines, quoteNo, quoteUrl, sendQuote, publicQuote, decideQuote, signAgreement, sendSigningLink, signForClient, paidForJob, recordQuotePayment, notifyOffice, availableInspectors, freeEquipment, schedule, calendar, feedEvents, icsFor, totals, JOB_STATUS_LABEL };
}
