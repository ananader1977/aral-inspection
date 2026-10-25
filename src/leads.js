// Leads: website enquiries and enquiries typed in by the Admin (Workflow 1).
import { HttpError } from './http.js';
import { cleanMobile, isEmail, clampStr } from './util.js';
import { parseDateKey, fmtStamp } from './time.js';
import { RESIDENTIAL_TYPES, COMMERCIAL_TYPES } from './pricing.js';

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'onboarding', 'converted', 'lost'];
const SOURCES = ['website', 'whatsapp', 'phone', 'email', 'broker', 'bank', 'repeat', 'other'];

export function createLeads(ctx) {
  const { db } = ctx;

  function clean(body, { publicForm }) {
    const name = clampStr(body.name, 120);
    if (!name) throw new HttpError(400, 'Please enter your name.');
    const mobile = cleanMobile(String(body.mobile || ''));
    if (!mobile) throw new HttpError(400, 'Please enter a valid mobile number, e.g. +971 50 123 4567.');
    const email = clampStr(body.email, 254);
    if (email && !isEmail(email)) throw new HttpError(400, 'Please enter a valid email address or leave it empty.');
    const type = clampStr(body.property_type, 30);
    if (type && ![...RESIDENTIAL_TYPES, ...COMMERCIAL_TYPES].includes(type)) throw new HttpError(400, 'Choose a property type.');
    const service = clampStr(body.service_code, 20);
    if (service && !db.prepare('SELECT 1 FROM services WHERE code=? AND active=1').get(service)) throw new HttpError(400, 'Choose a service.');
    const date = clampStr(body.preferred_date, 10);
    if (date && parseDateKey(date) === null) throw new HttpError(400, 'Choose a date from the calendar.');
    if (publicForm && !body.consent) throw new HttpError(400, 'Please agree to be contacted about your enquiry.');
    const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    return {
      name, mobile, email,
      client_type: ['individual', 'company', 'bank', 'developer', 'owners_association', 'broker'].includes(body.client_type) ? body.client_type : 'individual',
      pref_lang: body.pref_lang === 'ar' ? 'ar' : 'en',
      service_code: service, property_type: type,
      bedrooms: num(body.bedrooms), sqft: num(body.sqft),
      community: clampStr(body.community, 120), building: clampStr(body.building, 120),
      preferred_date: date || null,
      addons: JSON.stringify([].concat(body.addons || []).map(String).slice(0, 6)),
      urgent: body.urgent ? 1 : 0,
      estimate_total: num(body.estimate_total),
      referral_code: clampStr(body.referral_code, 40).toUpperCase(),
      message: clampStr(body.message, 2000),
      source: publicForm ? (body.referral_code ? 'broker' : 'website') : SOURCES.includes(body.source) ? body.source : 'phone',
      consent: body.consent ? 1 : 0,
    };
  }

  /** Website form. Also emails the office and (if an email was given) the client. */
  async function createPublic(body, ip) {
    if (body.website) return { id: 0 }; // honeypot field filled in: a bot
    const v = clean(body, { publicForm: true });
    const dup = db.prepare('SELECT id FROM leads WHERE mobile=? AND created_at>? ORDER BY id DESC').get(v.mobile, ctx.now() - 10 * 60 * 1000);
    if (dup) return { id: dup.id, duplicate: true }; // double submit
    const keys = Object.keys(v);
    const id = Number(db.prepare(`INSERT INTO leads(${keys.join(',')},created_at,ip) VALUES(${keys.map(() => '?').join(',')},?,?)`).run(...keys.map((k) => v[k]), ctx.now(), ip).lastInsertRowid);
    ctx.admin.audit(null, 'leads', id, 'create', null, { source: v.source, service: v.service_code }, ip);
    const s = ctx.settings();
    const svc = v.service_code ? db.prepare('SELECT name FROM services WHERE code=?').get(v.service_code)?.name : '';
    const lines = [
      `Name: ${v.name}`, `Mobile: ${v.mobile}`, v.email && `Email: ${v.email}`, svc && `Service: ${svc}`,
      v.property_type && `Property: ${v.property_type}${v.bedrooms != null ? `, ${v.bedrooms} bedroom(s)` : ''}${v.sqft ? `, ${v.sqft} sq ft` : ''}`,
      (v.community || v.building) && `Location: ${[v.building, v.community].filter(Boolean).join(', ')}`,
      v.preferred_date && `Preferred date: ${v.preferred_date.split('-').reverse().join('/')}`,
      v.estimate_total != null && `Estimate shown: AED ${v.estimate_total.toLocaleString('en-US')}`,
      v.referral_code && `Referral code: ${v.referral_code}`, v.message && `Message: ${v.message}`,
    ].filter(Boolean);
    const office = s.email;
    ctx.push.later(() => ctx.push.toPermission('leads.manage', { title: `New enquiry: ${v.name}`, body: svc || 'From the website', url: '/app/#leads', tag: 'lead' }));
    if (office && isEmail(office)) {
      await ctx.mailer.send({ to: office, subject: `New enquiry: ${v.name}${svc ? ' · ' + svc : ''}`, text: `A new enquiry came in from the website (${fmtStamp(ctx.now())}).\n\n${lines.join('\n')}\n\nCall or WhatsApp within 2 hours. Open the app: ${ctx.config.baseUrl}/app/#leads`, template: 'lead_office' });
    }
    if (v.email) {
      const ar = v.pref_lang === 'ar';
      await ctx.mailer.send({
        to: v.email,
        subject: ar ? `استلمنا طلبك - ${s.company_name}` : `We received your enquiry - ${s.company_name}`,
        text: ar
          ? `مرحبًا ${v.name}،\n\nشكرًا لتواصلك مع ${s.company_name}. سيتصل بك أحد أعضاء فريقنا قريبًا لتأكيد التفاصيل والموعد.\n\n${s.tagline}`
          : `Dear ${v.name},\n\nThank you for contacting ${s.company_name}. A member of our team will call you shortly to confirm the details and book your inspection.\n\nKind regards,\n${s.company_name}\n${s.tagline}`,
        template: 'lead_ack',
      });
    }
    return { id };
  }

  function createManual(user, body, ip) {
    const v = clean(body, { publicForm: false });
    const keys = Object.keys(v);
    const id = Number(db.prepare(`INSERT INTO leads(${keys.join(',')},created_at,ip,assigned_to) VALUES(${keys.map(() => '?').join(',')},?,?,?)`).run(...keys.map((k) => v[k]), ctx.now(), ip, user.id).lastInsertRowid);
    ctx.admin.audit(user, 'leads', id, 'create', null, { source: v.source }, ip);
    return get(id);
  }

  const get = (id) => db.prepare('SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id=l.assigned_to WHERE l.id=?').get(id);

  function list(q = {}) {
    const where = [], args = [];
    if (q.status && LEAD_STATUSES.includes(q.status)) { where.push('l.status=?'); args.push(q.status); }
    if (q.open === '1') where.push("l.status NOT IN ('converted','lost')");
    if (q.q) { where.push('(l.name LIKE ? OR l.mobile LIKE ? OR l.community LIKE ? OR l.building LIKE ? OR l.referral_code LIKE ?)'); for (let i = 0; i < 5; i++) args.push(`%${q.q}%`); }
    return db.prepare(`SELECT l.*, u.name AS assigned_name, s.name AS service_name FROM leads l LEFT JOIN users u ON u.id=l.assigned_to LEFT JOIN services s ON s.code=l.service_code ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.id DESC LIMIT 1000`).all(...args);
  }

  function update(user, id, body, ip) {
    const before = get(id);
    if (!before) throw new HttpError(404, 'Lead not found');
    const status = body.status ?? before.status;
    if (!LEAD_STATUSES.includes(status)) throw new HttpError(400, 'Choose a status.');
    const lost = clampStr(body.lost_reason ?? before.lost_reason, 120);
    if (status === 'lost' && !lost) throw new HttpError(400, 'Choose a reason why the lead was lost.');
    const assigned = body.assigned_to === undefined ? before.assigned_to : body.assigned_to ? Number(body.assigned_to) : null;
    const contactedAt = before.contacted_at || (status !== 'new' ? ctx.now() : null);
    db.prepare('UPDATE leads SET status=?, lost_reason=?, assigned_to=?, notes=?, contacted_at=? WHERE id=?')
      .run(status, status === 'lost' ? lost : '', assigned, clampStr(body.notes ?? before.notes, 4000), contactedAt, id);
    const after = get(id);
    ctx.admin.audit(user, 'leads', id, 'update', { status: before.status }, { status: after.status, lost_reason: after.lost_reason }, ip);
    return after;
  }

  /** Counts for the dashboard: open leads, overdue (new for more than 2 hours), this month. */
  function stats() {
    const n = (sql, ...a) => db.prepare(sql).get(...a).n;
    return {
      open: n("SELECT COUNT(*) n FROM leads WHERE status NOT IN ('converted','lost')"),
      overdue: n("SELECT COUNT(*) n FROM leads WHERE status='new' AND created_at < ?", ctx.now() - 2 * 3600 * 1000),
      total: n('SELECT COUNT(*) n FROM leads'),
    };
  }

  return { createPublic, createManual, list, get, update, stats };
}
