// Phase 2 business logic: audit log, admin lists, users, company settings and versioned wording.
import { HttpError } from './http.js';
import { RESOURCES } from './resources.js';
import { SETTING_DEFAULTS, tx } from './db.js';
import { ROLES, ROLE_LABEL, can } from './roles.js';
import { hashPassword, validatePasswordStrength, randomPassword } from './auth.js';
import { isEmail, clampStr } from './util.js';
import { parseDateKey, dateKey } from './time.js';

export function createAdmin(ctx) {
  const { db } = ctx;

  function audit(user, entity, entityId, action, before, after, ip = '') {
    db.prepare('INSERT INTO audit_log(ts,user_id,ip,entity,entity_id,action,before_json,after_json) VALUES(?,?,?,?,?,?,?,?)')
      .run(ctx.now(), user?.id ?? null, ip, entity, entityId ?? null, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null);
  }
  const need = (user, perm) => { if (!can(user.role, perm)) throw new HttpError(403, 'You do not have permission to do this.'); };

  // ---------- generic admin lists ----------
  const spec = (name) => {
    const r = RESOURCES[name];
    if (!r) throw new HttpError(404, 'Unknown list');
    return r;
  };

  function clean(r, body, existing) {
    const out = {};
    for (const f of r.fields) {
      let v = body[f.k];
      if (v === undefined) { if (existing) continue; v = f.def ?? null; }
      if (f.t === 'bool') v = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
      else if (f.t === 'int' || f.t === 'ref') { v = v === '' || v === null ? null : Number(v); if (v !== null && !Number.isInteger(v)) throw new HttpError(400, `${f.label}: enter a whole number.`); }
      else if (f.t === 'num') { v = v === '' || v === null ? null : Number(v); if (v !== null && !Number.isFinite(v)) throw new HttpError(400, `${f.label}: enter a number.`); }
      else if (f.t === 'date') { v = v ? String(v) : null; if (v && parseDateKey(v) === null) throw new HttpError(400, `${f.label}: use the date picker (YYYY-MM-DD).`); }
      else { v = v === null ? null : clampStr(v, f.t === 'textarea' ? 4000 : (f.max || 200)); }
      if (f.t === 'enum' && v !== null && v !== '' && !f.options.includes(v)) throw new HttpError(400, `${f.label}: choose one of the options.`);
      if (f.email && v && !isEmail(v)) throw new HttpError(400, `${f.label}: enter a valid email address.`);
      if (f.req && (v === null || v === '')) throw new HttpError(400, `${f.label} is required.`);
      if (f.t === 'ref' && v !== null && !db.prepare(`SELECT 1 FROM ${RESOURCES[f.ref].table} WHERE id=?`).get(v)) throw new HttpError(400, `${f.label}: not found.`);
      if ((f.t === 'text' || f.t === 'textarea' || f.t === 'enum' || f.t === 'lookup') && v === null && !f.req) v = '';
      out[f.k] = v;
    }
    return out;
  }

  function listResource(name, query = {}) {
    const r = spec(name);
    const where = [], args = [];
    for (const f of r.fields) if (f.filter && query[f.k] !== undefined && query[f.k] !== '') { where.push(`${f.k}=?`); args.push(f.t === 'ref' ? Number(query[f.k]) : query[f.k]); }
    if (query.q) {
      const txt = r.fields.filter((f) => ['text', 'textarea'].includes(f.t));
      if (txt.length) { where.push(`(${txt.map((f) => `${f.k} LIKE ?`).join(' OR ')})`); txt.forEach(() => args.push(`%${query.q}%`)); }
    }
    return db.prepare(`SELECT * FROM ${r.table}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${r.order} LIMIT 2000`).all(...args);
  }

  function saveResource(user, name, body, id, ip) {
    const r = spec(name);
    need(user, r.perm);
    const before = id ? db.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(id) : null;
    if (id && !before) throw new HttpError(404, 'Not found');
    const v = clean(r, body, before);
    if (r.table === 'branches' && v.is_default) db.prepare('UPDATE branches SET is_default=0').run();
    try {
      if (id) {
        const keys = Object.keys(v);
        if (keys.length) db.prepare(`UPDATE ${r.table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map((k) => v[k]), id);
      } else {
        if (r.stamp) v.created_at = ctx.now();
        const keys = Object.keys(v);
        id = Number(db.prepare(`INSERT INTO ${r.table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...keys.map((k) => v[k])).lastInsertRowid);
      }
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'This entry already exists.');
      throw e;
    }
    const after = db.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(id);
    audit(user, r.table, id, before ? 'update' : 'create', before, after, ip);
    return after;
  }

  function deleteResource(user, name, id, ip) {
    const r = spec(name);
    need(user, r.perm);
    const before = db.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(id);
    if (!before) throw new HttpError(404, 'Not found');
    try {
      db.prepare(`DELETE FROM ${r.table} WHERE id=?`).run(id);
    } catch (e) {
      if (/FOREIGN KEY/.test(e.message)) throw new HttpError(409, 'This entry is in use. Untick "Active" instead of deleting it.');
      throw e;
    }
    audit(user, r.table, id, 'delete', before, null, ip);
  }

  /** id/label pairs for drop-downs that point at another list. */
  function options(name) {
    const r = spec(name);
    if (name === 'section_templates') return db.prepare("SELECT s.id, c.name || ' · ' || s.name AS label FROM section_templates s JOIN checklists c ON c.id=s.checklist_id ORDER BY c.name, s.sort").all();
    if (name === 'services') return db.prepare("SELECT id, code || ' · ' || name AS label FROM services ORDER BY sort, code").all();
    if (name === 'glossary') return db.prepare('SELECT id, term AS label FROM glossary ORDER BY term').all();
    return db.prepare(`SELECT id, ${r.label} AS label FROM ${r.table} ORDER BY ${r.label}`).all();
  }

  // ---------- users ----------
  const userRow = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, role_label: ROLE_LABEL[u.role], phone: u.phone, credentials: u.credentials, inspector_id: u.inspector_id, active: u.active, has2fa: !!u.totp_secret, last_login_at: u.last_login_at, created_at: u.created_at });
  const listUsers = () => db.prepare('SELECT * FROM users ORDER BY active DESC, role, name').all().map(userRow);

  function saveUser(actor, body, id, ip) {
    need(actor, 'users.manage');
    const before = id ? db.prepare('SELECT * FROM users WHERE id=?').get(id) : null;
    if (id && !before) throw new HttpError(404, 'User not found');
    const email = clampStr(body.email ?? before?.email, 254).toLowerCase();
    const name = clampStr(body.name ?? before?.name, 120);
    const role = body.role ?? before?.role;
    if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (!name) throw new HttpError(400, 'Name is required.');
    if (!ROLES.includes(role)) throw new HttpError(400, 'Choose a role.');
    const active = body.active === undefined ? (before ? before.active : 1) : body.active ? 1 : 0;
    if (before && before.id === actor.id && (role !== 'super_admin' || !active)) throw new HttpError(400, 'You cannot remove your own Super Admin access.');
    if (before?.role === 'super_admin' && (role !== 'super_admin' || !active) && db.prepare("SELECT COUNT(*) n FROM users WHERE role='super_admin' AND active=1").get().n <= 1) throw new HttpError(400, 'There must be at least one active Super Admin.');
    const inspectorId = role === 'inspector' && body.inspector_id ? Number(body.inspector_id) : role === 'inspector' ? before?.inspector_id ?? null : null;
    if (inspectorId && !db.prepare('SELECT 1 FROM inspectors WHERE id=?').get(inspectorId)) throw new HttpError(400, 'Inspector not found.');
    const fields = { email, name, role, active, phone: clampStr(body.phone ?? before?.phone ?? '', 40), credentials: clampStr(body.credentials ?? before?.credentials ?? '', 200), inspector_id: inspectorId };
    let password = null;
    try {
      if (before) {
        db.prepare('UPDATE users SET email=?,name=?,role=?,active=?,phone=?,credentials=?,inspector_id=? WHERE id=?').run(...Object.values(fields), id);
      } else {
        password = body.password || randomPassword();
        validatePasswordStrength(password);
        id = Number(db.prepare('INSERT INTO users(email,name,role,active,phone,credentials,inspector_id,password_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(...Object.values(fields), hashPassword(password), ctx.now()).lastInsertRowid);
      }
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'A user with this email already exists.');
      throw e;
    }
    const after = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    audit(actor, 'users', id, before ? 'update' : 'create', before && userRow(before), userRow(after), ip);
    return { user: userRow(after), password: before ? null : password };
  }

  function resetPassword(actor, id, ip) {
    need(actor, 'users.manage');
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!u) throw new HttpError(404, 'User not found');
    const password = randomPassword();
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), id);
    audit(actor, 'users', id, 'reset_password', null, null, ip);
    return password;
  }

  function reset2fa(actor, id, ip) {
    need(actor, 'users.manage');
    if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(id)) throw new HttpError(404, 'User not found');
    db.prepare('UPDATE users SET totp_secret=NULL, totp_pending=NULL WHERE id=?').run(id);
    audit(actor, 'users', id, 'reset_2fa', null, null, ip);
  }

  // ---------- company settings ----------
  function saveSettings(actor, body, ip) {
    need(actor, 'settings.edit');
    const before = ctx.settings();
    const changed = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (!(k in SETTING_DEFAULTS)) continue;
      let val = clampStr(v, 500);
      if (/^next_.*_no$|^number_digits$|_days$|_pct$|^vat_rate$|^monthly_job_target$/.test(k) && val !== '' && !(Number(val) >= 0)) throw new HttpError(400, `${k}: enter a number.`);
      if (k === 'fy_start_month' && !(Number(val) >= 1 && Number(val) <= 12)) throw new HttpError(400, 'Financial year start: a month number from 1 to 12.');
      if (k === 'vat_registered') val = val === '1' || val === 'true' ? '1' : '0';
      if (k.startsWith('brand_') && k !== 'ui_default_lang' && !/^#[0-9a-f]{6}$/i.test(val)) throw new HttpError(400, 'Colours must look like #0A1F4A.');
      if (k === 'ui_default_lang' && !['en', 'ar'].includes(val)) throw new HttpError(400, 'Language must be en or ar.');
      if (k === 'vat_effective_date' && val && parseDateKey(val) === null) throw new HttpError(400, 'VAT effective date: use the date picker.');
      if (before[k] !== val) changed[k] = val;
    }
    if ((changed.vat_registered ?? before.vat_registered) === '1' && !(changed.trn ?? before.trn)) throw new HttpError(400, 'Enter the TRN before switching VAT on.');
    const up = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    tx(db, () => { for (const [k, v] of Object.entries(changed)) up.run(k, v); });
    if (Object.keys(changed).length) audit(actor, 'settings', null, 'update', Object.fromEntries(Object.keys(changed).map((k) => [k, before[k]])), changed, ip);
    return ctx.settings();
  }

  // ---------- versioned wording (terms & conditions, report text, email templates) ----------
  function listBlocks() {
    return db.prepare(`SELECT b.*, u.name AS created_by_name FROM content_blocks b LEFT JOIN users u ON u.id=b.created_by
      WHERE b.version = (SELECT MAX(version) FROM content_blocks x WHERE x.code=b.code) ORDER BY b.code`).all();
  }
  const blockHistory = (code) => db.prepare('SELECT b.*, u.name AS created_by_name FROM content_blocks b LEFT JOIN users u ON u.id=b.created_by WHERE code=? ORDER BY version DESC').all(code);
  /** The version in force on a date (latest version whose effective date has started). */
  const currentBlock = (code, onDate = dateKey(ctx.now())) => db.prepare('SELECT * FROM content_blocks WHERE code=? AND effective_from<=? ORDER BY version DESC LIMIT 1').get(code, onDate);

  function saveBlock(actor, code, body, ip) {
    need(actor, code.startsWith('sec_intro_') ? 'technical.edit' : 'content.edit');
    if (!/^[a-z0-9_]{2,60}$/.test(code)) throw new HttpError(400, 'Code may use lower-case letters, numbers and _ only.');
    const text = clampStr(body.body, 20000);
    if (!text) throw new HttpError(400, 'The text cannot be empty.');
    const eff = body.effective_from || dateKey(ctx.now());
    if (parseDateKey(eff) === null) throw new HttpError(400, 'Effective date: use the date picker.');
    const prev = db.prepare('SELECT * FROM content_blocks WHERE code=? ORDER BY version DESC LIMIT 1').get(code);
    if (prev && prev.body === text && prev.title === clampStr(body.title ?? prev.title, 200) && prev.effective_from === eff) return prev;
    const version = (prev?.version || 0) + 1;
    const id = Number(db.prepare('INSERT INTO content_blocks(code,version,title,body,effective_from,created_by,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(code, version, clampStr(body.title ?? prev?.title ?? code, 200), text, eff, actor.id, ctx.now()).lastInsertRowid);
    audit(actor, 'content_blocks', id, 'new_version', prev ? { version: prev.version } : null, { code, version, effective_from: eff }, ip);
    return db.prepare('SELECT * FROM content_blocks WHERE id=?').get(id);
  }

  // ---------- audit log and messages ----------
  function listAudit(q = {}) {
    const where = [], args = [];
    if (q.entity) { where.push('a.entity=?'); args.push(q.entity); }
    if (q.user_id) { where.push('a.user_id=?'); args.push(Number(q.user_id)); }
    if (q.from && parseDateKey(q.from) !== null) { where.push('a.ts>=?'); args.push(parseDateKey(q.from)); }
    if (q.to && parseDateKey(q.to) !== null) { where.push('a.ts<?'); args.push(parseDateKey(q.to) + 86400000); }
    return db.prepare(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT 1000`).all(...args);
  }
  const listMessages = () => db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 500').all();

  /** Things still to fill in before going live (shown on the dashboard). */
  function setupChecklist() {
    const s = ctx.settings();
    const cnt = (sql) => db.prepare(sql).get().n;
    return [
      { key: 'licence', label: 'DET licence and RERA registration numbers', done: !!(s.det_licence_no && s.rera_reg_no), href: 'settings/company' },
      { key: 'contact', label: 'Company phone, email and website', done: !!(s.phone && s.email && s.website), href: 'settings/company' },
      { key: 'bank', label: 'Bank details for quotations and invoices', done: !!(s.bank_name && s.bank_iban), href: 'settings/company' },
      { key: 'address', label: 'Branch address printed on documents', done: cnt("SELECT COUNT(*) n FROM branches WHERE is_default=1 AND active=1 AND address NOT LIKE 'Dubai, United Arab Emirates'") > 0, href: 'settings/list/branches' },
      { key: 'terms', label: 'Terms & conditions approved by your lawyer (replace the DRAFT text)', done: cnt("SELECT COUNT(*) n FROM content_blocks b WHERE code LIKE 'tc_%' AND body LIKE 'DRAFT%' AND version=(SELECT MAX(version) FROM content_blocks x WHERE x.code=b.code)") === 0, href: 'settings/wording' },
      { key: 'backup', label: 'Database backed up in the last 2 days (Settings → Backups)', done: (() => { try { return Date.now() - (JSON.parse(db.prepare("SELECT value FROM settings WHERE key='_last_backup'").get()?.value || '{}').at || 0) < 2 * 86400000; } catch { return false; } })(), href: 'settings/backups' },
      { key: 'inspectors', label: 'At least one inspector with a valid licence', done: cnt("SELECT COUNT(*) n FROM inspectors WHERE active=1 AND (licence_expiry IS NULL OR licence_expiry>=date('now'))") > 0, href: 'settings/list/inspectors' },
      { key: 'reviewer', label: 'A Technical Manager user to approve reports', done: cnt("SELECT COUNT(*) n FROM users WHERE role='reviewer' AND active=1") > 0, href: 'settings/users' },
      { key: 'email', label: 'Gmail connected (SMTP app password on the server)', done: !!ctx.config.smtp.host, href: 'settings/messages' },
    ];
  }

  return { audit, listResource, saveResource, deleteResource, options, listUsers, saveUser, resetPassword, reset2fa, saveSettings, listBlocks, blockHistory, currentBlock, saveBlock, listAudit, listMessages, setupChecklist, need };
}
