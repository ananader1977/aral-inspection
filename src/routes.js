import { HttpError } from './http.js';
import { verifyPassword, hashPassword, validatePasswordStrength, newTotpSecret, verifyTotp, otpauthUri } from './auth.js';
import { RESOURCES, resourceMeta } from './resources.js';
import { SETTING_DEFAULTS, SETTING_GROUPS } from './db.js';
import { ROLES, ROLE_LABEL, ROLES_2FA, can, permissionsOf } from './roles.js';
import { buildXlsx } from './xlsx.js';
import { isEmail } from './util.js';
import { dateKey } from './time.js';
import { LEAD_STATUSES } from './leads.js';
import { RESIDENTIAL_TYPES, COMMERCIAL_TYPES } from './pricing.js';
import { registerOpsRoutes } from './routes-ops.js';

export function registerRoutes(app, ctx) {
  const { db, auth, admin, config } = ctx;
  const U = auth.requireUser;
  const P = (perm) => (req) => { if (!can(req.user.role, perm)) throw new HttpError(403, 'You do not have permission to do this.'); };
  const ip = (req) => (config.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.ip_;
  const limit = (req, key, max, ms) => { if (!config.disableRateLimit) ctx.limit(`${key}:${ip(req)}`, max, ms); };
  const id = (req) => Number(req.params.id);
  const me = (u) => ({ ...u, role_label: ROLE_LABEL[u.role], permissions: permissionsOf(u.role), needs2fa: auth.needs2fa(u) });

  // ---------- public ----------
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/config', (req, res) => {
    const s = ctx.settings();
    res.json({ company: s.company_name, short: s.company_short, tagline: s.tagline, lang: s.ui_default_lang, payments: config.paymentProvider, email: !!config.smtp.host, storage: config.drive.refreshToken ? 'drive' : 'disk', ai: !!config.ai?.apiKey, ai_provider: config.ai?.apiKey ? ctx.ai.label() : '' });
  });

  app.post('/api/login', async (req, res) => {
    limit(req, 'login', 10, 10 * 60 * 1000);
    const { email, password, lang } = await req.json();
    const u = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(String(email || '').trim().toLowerCase());
    if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(401, 'Wrong email or password.');
    // the language chosen on the sign-in page becomes the user's screen language
    if (['en', 'ar'].includes(lang) && lang !== u.ui_lang) { db.prepare('UPDATE users SET ui_lang=? WHERE id=?').run(lang, u.id); u.ui_lang = lang; }
    if (u.totp_secret) return res.json({ need_code: true, token: auth.pendingToken(u) });
    auth.startSession(res, u);
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(ctx.now(), u.id);
    admin.audit(u, 'users', u.id, 'login', null, null, ip(req));
    res.json({ user: me({ id: u.id, email: u.email, name: u.name, role: u.role, ui_lang: u.ui_lang, has2fa: false, must_setup_2fa: auth.needs2fa(u) }) });
  });
  app.post('/api/login/code', async (req, res) => {
    limit(req, 'login-code', 10, 10 * 60 * 1000);
    const { token, code } = await req.json();
    const uid = auth.readPending(token);
    if (!uid) throw new HttpError(401, 'Your sign-in expired. Please enter your password again.');
    const u = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(uid);
    if (!u || !verifyTotp(u.totp_secret, code, ctx.now())) throw new HttpError(401, 'That code is not right. Check the time on your phone and try the newest code.');
    auth.startSession(res, u);
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(ctx.now(), u.id);
    admin.audit(u, 'users', u.id, 'login', null, null, ip(req));
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => { auth.endSession(res); res.json({ ok: true }); });

  // ---------- public website: catalogue, instant estimate, enquiry form ----------
  app.get('/api/public/site', (req, res) => {
    const s = ctx.settings();
    const svc = db.prepare("SELECT code, name, name_ar, segment, is_addon, includes_reinspection, default_sla_hours FROM services WHERE active=1 AND (segment='owner' OR is_addon=1) ORDER BY sort").all();
    const from = (code) => db.prepare("SELECT MIN(r.price) p FROM price_rules r JOIN services s ON s.id=r.service_id WHERE s.code=?").get(code)?.p ?? null;
    const branch = db.prepare('SELECT address, phone FROM branches WHERE is_default=1 AND active=1').get();
    const lk = (list) => db.prepare('SELECT value FROM lookups WHERE list=? AND active=1 ORDER BY sort, value').all(list).map((r) => r.value);
    res.json({
      company: s.company_name, tagline: s.tagline, phone: s.phone || branch?.phone || '', mobile: s.mobile, email: s.email, website: s.website,
      address: branch?.address || '', rera: s.rera_reg_no, licence: s.det_licence_no, vat_registered: s.vat_registered === '1', vat_rate: Number(s.vat_rate),
      services: svc.map((x) => ({ ...x, from: from(x.code) })), communities: lk('community'),
      residential_types: RESIDENTIAL_TYPES, commercial_types: COMMERCIAL_TYPES,
      price_table: [['studio', 'studio', 0], ['apt1', 'apartment', 1], ['apt2', 'apartment', 2], ['apt3', 'apartment', 3], ['townhouse', 'townhouse', 3], ['villa4', 'villa', 4], ['villa5', 'villa', 5]].map(([key, type, beds]) => ({
        key, prices: Object.fromEntries(['OWN-PPI', 'OWN-SNG', 'OWN-MIO'].map((code) => {
          const sv = db.prepare('SELECT id FROM services WHERE code=? AND active=1').get(code);
          return [code, sv ? ctx.pricing.basePrice(sv.id, type, beds, null)?.price ?? null : null];
        })),
      })),
      addon_prices: Object.fromEntries(db.prepare("SELECT s.code, MIN(r.price) p FROM services s JOIN price_rules r ON r.service_id=s.id WHERE s.is_addon=1 AND s.active=1 GROUP BY s.code").all().map((r) => [r.code, r.p])),
    });
  });
  app.post('/api/public/estimate', async (req, res) => {
    limit(req, 'estimate', 120, 10 * 60 * 1000);
    const b = await req.json();
    res.json(ctx.pricing.estimate({ service: b.service, propertyType: b.property_type, bedrooms: b.bedrooms, sqft: b.sqft, addons: b.addons, urgent: !!b.urgent }));
  });
  app.post('/api/public/leads', async (req, res) => {
    limit(req, 'lead', 8, 60 * 60 * 1000);
    const r = await ctx.leads.createPublic(await req.json(), ip(req));
    res.json({ ok: true, ref: r.id ? `L-${String(r.id).padStart(5, '0')}` : '' });
  });

  // ---------- leads (staff) ----------
  app.get('/api/app/leads', U, P('leads.manage'), (req, res) => res.json({ rows: ctx.leads.list(req.query), statuses: LEAD_STATUSES, stats: ctx.leads.stats() }));
  app.post('/api/app/leads', U, P('leads.manage'), async (req, res) => res.json({ row: ctx.leads.createManual(req.user, await req.json(), ip(req)) }));
  app.put('/api/app/leads/:id', U, P('leads.manage'), async (req, res) => res.json({ row: ctx.leads.update(req.user, id(req), await req.json(), ip(req)) }));
  app.get('/api/app/export/leads.xlsx', U, P('leads.manage'), (req, res) => sendXlsx(res, 'Leads', [{ name: 'Leads', columns: [
    { header: 'Ref', value: (l) => `L-${String(l.id).padStart(5, '0')}`, width: 10 }, { header: 'Received', key: 'created_at', type: 'date', width: 18 },
    { header: 'Status', key: 'status', width: 12 }, { header: 'Source', key: 'source', width: 10 }, { header: 'Name', key: 'name', width: 24 },
    { header: 'Mobile', key: 'mobile', width: 16 }, { header: 'Email', key: 'email', width: 26 }, { header: 'Service', key: 'service_name', width: 30 },
    { header: 'Property', key: 'property_type', width: 12 }, { header: 'Bedrooms', key: 'bedrooms', type: 'number', width: 9 }, { header: 'Community', key: 'community', width: 20 },
    { header: 'Estimate (AED)', key: 'estimate_total', type: 'money', width: 14 }, { header: 'Referral code', key: 'referral_code', width: 14 },
    { header: 'Lost reason', key: 'lost_reason', width: 22 }, { header: 'Assigned to', key: 'assigned_name', width: 20 }, { header: 'Notes', key: 'notes', width: 40 }], rows: ctx.leads.list(req.query) }]));

  // ---------- me ----------
  app.get('/api/me', U, (req, res) => res.json({ user: me(req.user) }));
  app.post('/api/me/password', U, async (req, res) => {
    const { current, password } = await req.json();
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!verifyPassword(String(current || ''), u.password_hash)) throw new HttpError(400, 'Your current password is wrong.');
    validatePasswordStrength(password);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), u.id);
    auth.startSession(res, db.prepare('SELECT * FROM users WHERE id=?').get(u.id));
    admin.audit(req.user, 'users', u.id, 'change_password', null, null, ip(req));
    res.json({ ok: true });
  });
  app.post('/api/me/lang', U, async (req, res) => {
    const { lang } = await req.json();
    if (!['en', 'ar'].includes(lang)) throw new HttpError(400, 'Language must be en or ar.');
    db.prepare('UPDATE users SET ui_lang=? WHERE id=?').run(lang, req.user.id);
    res.json({ ok: true });
  });
  app.post('/api/me/2fa/start', U, (req, res) => {
    const secret = newTotpSecret();
    db.prepare('UPDATE users SET totp_pending=? WHERE id=?').run(secret, req.user.id);
    res.json({ secret, uri: otpauthUri(secret, req.user.email, `${ctx.settings().company_short} Inspection`) });
  });
  app.post('/api/me/2fa/confirm', U, async (req, res) => {
    const { code } = await req.json();
    const u = db.prepare('SELECT totp_pending FROM users WHERE id=?').get(req.user.id);
    if (!u.totp_pending) throw new HttpError(400, 'Start the set-up again.');
    if (!verifyTotp(u.totp_pending, code, ctx.now())) throw new HttpError(400, 'That code is not right. Enter the 6-digit code shown in the app now.');
    db.prepare('UPDATE users SET totp_secret=totp_pending, totp_pending=NULL WHERE id=?').run(req.user.id);
    admin.audit(req.user, 'users', req.user.id, 'enable_2fa', null, null, ip(req));
    res.json({ ok: true });
  });
  app.post('/api/me/2fa/disable', U, async (req, res) => {
    if (auth.needs2fa(req.user)) throw new HttpError(400, 'Two-step sign-in is required for your role.');
    const { code } = await req.json();
    const u = db.prepare('SELECT totp_secret FROM users WHERE id=?').get(req.user.id);
    if (!verifyTotp(u.totp_secret, code, ctx.now())) throw new HttpError(400, 'That code is not right.');
    db.prepare('UPDATE users SET totp_secret=NULL WHERE id=?').run(req.user.id);
    admin.audit(req.user, 'users', req.user.id, 'disable_2fa', null, null, ip(req));
    res.json({ ok: true });
  });

  // ---------- dashboard (Phase 2: set-up checklist and counts) ----------
  app.get('/api/app/dashboard', U, (req, res) => {
    const n = (sql) => db.prepare(sql).get().n;
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || (config.baseUrl.startsWith('https') ? 'https' : 'http');
    const using = host ? `${proto}://${host}` : '';
    res.json({
      links: can(req.user.role, 'settings.edit') ? { base_url: config.baseUrl, using, mismatch: !!using && new URL(using).host !== new URL(config.baseUrl).host } : null,
      setup: can(req.user.role, 'settings.edit') ? admin.setupChecklist() : [],
      leads: can(req.user.role, 'leads.manage') ? ctx.leads.stats() : null,
      counts: { users: n('SELECT COUNT(*) n FROM users WHERE active=1'), inspectors: n('SELECT COUNT(*) n FROM inspectors WHERE active=1'), services: n('SELECT COUNT(*) n FROM services WHERE active=1'), comments: n('SELECT COUNT(*) n FROM comment_library WHERE active=1') },
      expiring: db.prepare("SELECT 'inspector' kind, name, MIN(COALESCE(licence_expiry,'9999'), COALESCE(insurance_expiry,'9999'), COALESCE(agreement_expiry,'9999')) due FROM inspectors WHERE active=1 GROUP BY id HAVING due < date('now','+45 days') UNION ALL SELECT 'equipment', name, calibration_due FROM equipment WHERE active=1 AND calibration_due < date('now','+45 days') ORDER BY due").all(),
    });
  });

  // ---------- settings: lists ----------
  app.get('/api/app/meta', U, P('settings.view'), (req, res) => res.json({ resources: resourceMeta(), roles: ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r], twofa: ROLES_2FA.includes(r) })), settingGroups: SETTING_GROUPS }));
  app.get('/api/app/lookups', U, (req, res) => {
    const rows = db.prepare('SELECT list, value FROM lookups WHERE active=1 ORDER BY list, sort, value').all();
    const out = {};
    for (const r of rows) (out[r.list] ||= []).push(r.value);
    res.json(out);
  });
  app.get('/api/app/list/:name', U, P('settings.view'), (req, res) => res.json({ rows: admin.listResource(req.params.name, req.query) }));
  app.get('/api/app/list/:name/options', U, (req, res) => res.json({ rows: admin.options(req.params.name) }));
  app.post('/api/app/list/:name', U, async (req, res) => res.json({ row: admin.saveResource(req.user, req.params.name, await req.json(), null, ip(req)) }));
  app.put('/api/app/list/:name/:id', U, async (req, res) => res.json({ row: admin.saveResource(req.user, req.params.name, await req.json(), id(req), ip(req)) }));
  app.delete('/api/app/list/:name/:id', U, (req, res) => { admin.deleteResource(req.user, req.params.name, id(req), ip(req)); res.json({ ok: true }); });

  // ---------- settings: company ----------
  app.get('/api/app/settings', U, P('settings.view'), (req, res) => res.json({ settings: ctx.settings(), groups: SETTING_GROUPS }));
  app.put('/api/app/settings', U, async (req, res) => res.json({ settings: admin.saveSettings(req.user, await req.json(), ip(req)) }));

  // ---------- settings: users ----------
  app.get('/api/app/users', U, P('users.manage'), (req, res) => res.json({ rows: admin.listUsers() }));
  app.post('/api/app/users', U, async (req, res) => res.json(admin.saveUser(req.user, await req.json(), null, ip(req))));
  app.put('/api/app/users/:id', U, async (req, res) => res.json(admin.saveUser(req.user, await req.json(), id(req), ip(req))));
  app.post('/api/app/users/:id/reset-password', U, (req, res) => res.json({ password: admin.resetPassword(req.user, id(req), ip(req)) }));
  app.post('/api/app/users/:id/reset-2fa', U, (req, res) => { admin.reset2fa(req.user, id(req), ip(req)); res.json({ ok: true }); });

  // ---------- settings: wording ----------
  app.get('/api/app/wording', U, P('settings.view'), (req, res) => res.json({ rows: admin.listBlocks() }));
  app.get('/api/app/wording/:code', U, P('settings.view'), (req, res) => res.json({ rows: admin.blockHistory(req.params.code), current: admin.currentBlock(req.params.code) || null }));
  app.post('/api/app/wording/:code', U, async (req, res) => res.json({ row: admin.saveBlock(req.user, req.params.code, await req.json(), ip(req)) }));

  // ---------- audit and messages ----------
  app.get('/api/app/audit', U, P('audit.view'), (req, res) => res.json({ rows: admin.listAudit(req.query) }));
  app.get('/api/app/messages', U, P('messages.view'), (req, res) => res.json({ rows: admin.listMessages(), enabled: !!config.smtp.host }));
  app.post('/api/app/messages/test', U, P('settings.edit'), async (req, res) => {
    const body = await req.json();
    const to = String(body.to || req.user.email).trim();
    if (!isEmail(to)) throw new HttpError(400, 'Enter a valid email address.');
    const s = ctx.settings();
    const r = await ctx.mailer.send({ to, subject: `${s.company_short}: test email`, text: `This is a test email from the ${s.company_name} app.\n\nIf you can read this, Gmail sending works.`, template: 'test' });
    res.json(r);
  });

  // ---------- Excel exports ----------
  const sendXlsx = (res, name, sheets) => res.send(buildXlsx(sheets), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 200, { 'Content-Disposition': `attachment; filename="${name}-${dateKey(ctx.now())}.xlsx"` });
  app.get('/api/app/export/list/:name.xlsx', U, P('export'), (req, res) => {
    const r = RESOURCES[req.params.name];
    if (!r) throw new HttpError(404, 'Unknown list');
    const refLabels = {};
    for (const f of r.fields) if (f.t === 'ref') refLabels[f.k] = Object.fromEntries(admin.options(f.ref).map((o) => [o.id, o.label]));
    const columns = [{ header: 'ID', key: 'id', type: 'number', width: 6 }, ...r.fields.map((f) => ({
      header: f.label, width: f.t === 'textarea' ? 60 : 22, type: f.t === 'num' ? (f.money ? 'money' : 'number') : f.t === 'int' ? 'number' : 'text',
      value: (row) => (f.t === 'ref' ? refLabels[f.k][row[f.k]] ?? '' : f.t === 'bool' ? (row[f.k] ? 'Yes' : 'No') : row[f.k]),
    }))];
    sendXlsx(res, r.title.replace(/\W+/g, '-'), [{ name: r.title.slice(0, 31), columns, rows: admin.listResource(req.params.name, req.query) }]);
  });
  app.get('/api/app/export/users.xlsx', U, P('users.manage'), (req, res) => sendXlsx(res, 'Users', [{ name: 'Users', columns: [
    { header: 'Name', key: 'name', width: 28 }, { header: 'Email', key: 'email', width: 32 }, { header: 'Role', key: 'role_label', width: 20 },
    { header: '2FA', value: (u) => (u.has2fa ? 'On' : 'Off'), width: 8 }, { header: 'Active', value: (u) => (u.active ? 'Yes' : 'No'), width: 8 },
    { header: 'Last sign-in', key: 'last_login_at', type: 'date', width: 18 }], rows: admin.listUsers() }]));
  app.get('/api/app/export/audit.xlsx', U, P('audit.view'), (req, res) => sendXlsx(res, 'Audit-log', [{ name: 'Audit log', columns: [
    { header: 'Time', key: 'ts', type: 'date', width: 18 }, { header: 'User', key: 'user_name', width: 24 }, { header: 'Action', key: 'action', width: 16 },
    { header: 'Record', key: 'entity', width: 18 }, { header: 'ID', key: 'entity_id', type: 'number', width: 8 }, { header: 'IP', key: 'ip', width: 16 },
    { header: 'Before', key: 'before_json', width: 50 }, { header: 'After', key: 'after_json', width: 50 }], rows: admin.listAudit(req.query) }]));
  app.get('/api/app/export/messages.xlsx', U, P('messages.view'), (req, res) => sendXlsx(res, 'Messages', [{ name: 'Messages', columns: [
    { header: 'Time', key: 'ts', type: 'date', width: 18 }, { header: 'To', key: 'to_addr', width: 32 }, { header: 'Subject', key: 'subject', width: 44 },
    { header: 'Status', key: 'status', width: 10 }, { header: 'Error', key: 'error', width: 40 }], rows: admin.listMessages() }]));
  app.get('/api/app/export/settings.xlsx', U, P('settings.edit'), (req, res) => {
    const s = ctx.settings();
    sendXlsx(res, 'Settings', [{ name: 'Settings', columns: [{ header: 'Setting', key: 'k', width: 28 }, { header: 'Value', key: 'v', width: 50 }], rows: Object.keys(SETTING_DEFAULTS).map((k) => ({ k, v: s[k] })) }]);
  });

  registerOpsRoutes(app, ctx);
}
