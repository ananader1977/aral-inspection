import { h, fill, toast, pill, t, fmtStamp, fmtDay, num2, todayIso, yes } from '/js/common.js';
import { S, A, can, run, go, modal, closeModal, field, confirmBox } from '/js/app.js';

let META = null;
const meta = async () => (META ||= await A('GET', '/meta'));

const SETTING_LABELS = {
  company_name: 'Company name', company_short: 'Short name (page footers)', tagline: 'Tagline', det_licence_no: 'DET licence no.', rera_reg_no: 'DLD / RERA registration no.',
  phone: 'Office phone', mobile: 'Mobile', email: 'Email', website: 'Website',
  vat_registered: 'VAT registered', trn: 'TRN', vat_rate: 'VAT rate (%)', vat_effective_date: 'VAT effective date',
  bank_name: 'Bank name', bank_account_name: 'Account name', bank_account_number: 'Account number', bank_iban: 'IBAN', bank_swift: 'SWIFT code',
  job_prefix: 'Job prefix', next_job_no: 'Next job no.', quote_prefix: 'Quotation prefix', next_quote_no: 'Next quotation no.', report_prefix: 'Report prefix', next_report_no: 'Next report no.',
  invoice_prefix: 'Invoice prefix', next_invoice_no: 'Next invoice no.', credit_prefix: 'Credit note prefix', next_credit_no: 'Next credit note no.', number_digits: 'Digits in numbers',
  quote_validity_days: 'Quotation valid for (days)', deposit_pct: 'Advance payment (%)', payment_terms_days: 'Credit terms for companies (days)', reminder_days: 'Reminder before expiry (days)', default_turnaround: 'Report delivery (printed on quotations)',
  default_commission_pct: 'Inspector commission (%)', monthly_job_target: 'Monthly job target', review_score_target: 'Review score target',
  brand_navy: 'Navy', brand_blue: 'Blue', brand_copper: 'Copper', ui_default_lang: 'Default screen language',
};
const SETTING_HINTS = {
  job_prefix: '{YYYY} is replaced by the year.', vat_registered: 'Switch on once registered with the FTA. New invoices then become Tax Invoices with VAT.',
  rera_reg_no: 'Printed on every report and quotation.', default_commission_pct: 'Used when an inspector has no own rate.',
};

const NAV = () => [
  ['Company', [['company', 'Company details'], ['list/branches', 'Branch addresses'], ...(can('users.manage') ? [['users', 'Users']] : []), ['wording', 'Report & terms wording']]],
  ['Catalogue & pricing', [['list/services', 'Services'], ['list/price_rules', 'Prices'], ['list/surcharges', 'Surcharges'], ['list/lookups', 'Picklists'], ['list/valuation_partners', 'Valuation partners']]],
  ['Field team', [['list/inspectors', 'Inspectors'], ['list/equipment', 'Equipment']]],
  ['Report content', [['list/checklists', 'Checklists'], ['list/section_templates', 'Checklist sections'], ['list/item_templates', 'Checklist items'], ['list/comment_library', 'Comment library'], ['list/glossary', 'Glossary']]],
  ['System', [...(can('messages.view') ? [['messages', 'Messages']] : []), ...(can('audit.view') ? [['audit', 'Audit log']] : []), ...(can('settings.edit') ? [['backups', 'Backups']] : [])]],
];

export async function settingsView(el, parts) {
  const sub = parts.join('/') || 'company';
  const side = h('nav', { class: 'side', 'aria-label': t('Settings') }, NAV().map(([g, items]) => items.length ? [h('h4', {}, t(g)), items.map(([k, l]) => h('a', { href: `#settings/${k}`, class: sub === k ? 'on' : '' }, t(l)))] : null));
  const body = h('div', {}, h('p', { class: 'muted' }, t('Loading…')));
  fill(el, h('div', { class: 'subnav' }, side, body));
  if (sub === 'company') return company(body);
  if (sub === 'users') return users(body);
  if (sub.startsWith('wording')) return wording(body, parts[1]);
  if (sub === 'messages') return messages(body);
  if (sub === 'audit') return audit(body);
  if (sub === 'backups' && can('settings.edit')) return backups(body);
  if (parts[0] === 'list') return listView(body, parts[1]);
  fill(body, h('p', {}, t('Not found')));
}

const exportBtn = (path) => h('a', { class: 'btn alt sm', href: `/api/app/export/${path}`, download: '' }, t('Export to Excel'));

// ---------- company ----------
async function company(el) {
  const { settings: s, groups } = await A('GET', '/settings');
  const edit = can('settings.edit');
  const input = (k) => {
    if (k === 'vat_registered') return h('label', { class: 'check' }, h('input', { type: 'checkbox', name: k, checked: s[k] === '1', disabled: !edit }), t(SETTING_LABELS[k]));
    if (k === 'ui_default_lang') return field(SETTING_LABELS[k], h('select', { name: k, disabled: !edit }, h('option', { value: 'en', selected: s[k] === 'en' }, 'English'), h('option', { value: 'ar', selected: s[k] === 'ar' }, 'العربية')));
    if (k.startsWith('brand_')) return field(SETTING_LABELS[k], h('input', { type: 'color', name: k, value: s[k], disabled: !edit }));
    if (k === 'vat_effective_date') return field(SETTING_LABELS[k], h('input', { type: 'date', name: k, value: s[k], disabled: !edit }));
    const numeric = /^next_|_days$|_pct$|digits|rate|target/.test(k);
    return field(SETTING_LABELS[k] || k, h('input', { name: k, value: s[k], disabled: !edit, inputmode: numeric ? 'decimal' : null, class: /prefix|email|website|iban|swift|trn|_no$/.test(k) ? 'ltr' : null }), SETTING_HINTS[k]);
  };
  const f = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    v.vat_registered = f.vat_registered.checked ? '1' : '0';
    if (await run(() => A('PUT', '/settings', v), 'Settings saved')) company(el);
  } }, groups.map(([g, keys]) => h('div', { class: 'card' }, h('h2', {}, t(g)), h('div', { class: 'grid2' }, keys.map(input)))),
  edit ? h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save settings')), exportBtn('settings.xlsx')) : h('p', { class: 'alert info' }, t('Only the Super Admin can change these settings.')));
  fill(el, h('h1', {}, t('Company details')), f);
}

// ---------- users ----------
async function users(el) {
  const [{ rows }, m, insp] = await Promise.all([A('GET', '/users'), meta(), A('GET', '/list/inspectors/options')]);
  const showPassword = (title, email, pw) => modal(h('h2', {}, t(title)), h('p', {}, t('Give this password to {email}. It is shown only once; they can change it under My account.', { email })), h('div', { class: 'secret' }, pw),
    h('p', { class: 'actions' }, h('button', { class: 'btn alt', onclick: () => navigator.clipboard?.writeText(pw).then(() => toast(t('Copied')), () => {}) }, t('Copy')), h('button', { class: 'btn', onclick: closeModal }, t('Done'))));
  const edit = (u) => {
    const f = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      v.active = f.active.checked;
      const r = await run(() => (u ? A('PUT', `/users/${u.id}`, v) : A('POST', '/users', v)), u ? 'User saved' : null);
      if (!r) return;
      closeModal();
      if (r.password) showPassword('User added', r.user.email, r.password);
      users(el);
    } }, h('h2', {}, t(u ? 'Edit user' : 'Add user')),
    h('div', { class: 'grid2' },
      field('Name', h('input', { name: 'name', value: u?.name || '', required: true })),
      field('Email', h('input', { name: 'email', type: 'email', value: u?.email || '', required: true, class: 'ltr' })),
      field('Role', h('select', { name: 'role', required: true }, m.roles.map((r) => h('option', { value: r.value, selected: (u?.role || 'inspector') === r.value }, t(r.label) + (r.twofa ? ` (${t('2FA')})` : ''))))),
      field('Inspector record', h('select', { name: 'inspector_id' }, h('option', { value: '' }, '-'), insp.rows.map((o) => h('option', { value: o.id, selected: u?.inspector_id === o.id }, o.label))), 'Only for inspector logins: links them to their jobs and commission.'),
      field('Phone', h('input', { name: 'phone', value: u?.phone || '', class: 'ltr' })),
      field('Credentials (printed on reports)', h('input', { name: 'credentials', value: u?.credentials || '' }))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: u ? !!u.active : true }), t('Active (can sign in)')),
    u ? null : h('p', { class: 'small muted' }, t('A password is created for the new user and shown once.')),
    h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel')), h('span', { class: 'spacer' }),
      u ? h('button', { class: 'btn alt', type: 'button', onclick: async () => { if (!(await confirmBox('Reset password?', u.email, 'Reset password'))) return; const r = await run(() => A('POST', `/users/${u.id}/reset-password`, {})); if (r) showPassword('New password', u.email, r.password); } }, t('Reset password')) : null,
      u?.has2fa ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (!(await confirmBox('Reset two-step sign-in?', t('They will set it up again at their next sign-in.'), 'Reset'))) return; if (await run(() => A('POST', `/users/${u.id}/reset-2fa`, {}), 'Two-step sign-in reset')) users(el); } }, t('Reset 2FA')) : null));
    modal(f);
  };
  fill(el, h('div', { class: 'card' }, h('div', { class: 'actions' }, h('h1', {}, t('Users')), h('span', { class: 'spacer' }), exportBtn('users.xlsx'), h('button', { class: 'btn cu', onclick: () => edit(null) }, t('+ Add user'))),
    h('p', { class: 'small muted' }, t('Super Admin, Admin, Technical Manager and Accountant must use two-step sign-in. Users are never deleted: untick Active to stop someone signing in.')),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Email', 'Role', '2FA', 'Last sign-in', 'Active'].map((c) => h('th', {}, t(c))))),
      h('tbody', {}, rows.map((u) => h('tr', { class: `click ${u.active ? '' : 'off'}`, onclick: () => edit(u) },
        h('td', {}, h('b', {}, u.name)), h('td', { class: 'ltr' }, u.email), h('td', {}, t(u.role_label)), h('td', {}, pill(u.has2fa ? t('On') : t('Off'), u.has2fa ? 'ok' : '')),
        h('td', { class: 'nowrap' }, fmtStamp(u.last_login_at)), h('td', {}, yes(u.active)))))))));
}

// ---------- wording (versioned) ----------
async function wording(el, code) {
  const { rows } = await A('GET', '/wording');
  const editable = (c) => can(c.startsWith('sec_intro_') ? 'technical.edit' : 'content.edit');
  const groupOf = (c) => (c.startsWith('tc_') ? 'Terms & conditions' : c.startsWith('rpt_') ? 'Report pages' : c.startsWith('sec_intro_') ? 'Section introductions' : c.startsWith('qt_') ? 'Quotation' : 'Email templates');
  const groups = {};
  for (const r of rows) (groups[groupOf(r.code)] ||= []).push(r);
  const list = h('div', { class: 'card' }, h('h1', {}, t('Report & terms wording')),
    h('p', { class: 'small muted' }, t('Every change creates a new version. Documents already issued keep the version they were issued with.')),
    Object.entries(groups).map(([g, items]) => [h('h3', {}, t(g)), h('div', { class: 'tablewrap' }, h('table', {}, h('tbody', {}, items.map((r) => h('tr', { class: 'click', onclick: () => go(`settings/wording/${r.code}`) },
      h('td', {}, h('b', {}, r.title), h('div', { class: 'small muted ltr' }, r.code)), h('td', {}, r.body.startsWith('DRAFT') ? pill(t('Draft'), 'warn') : pill(`v${r.version}`, 'ok')), h('td', { class: 'nowrap small' }, t('from'), ' ', fmtDay(r.effective_from)))))))]));
  if (!code) return fill(el, list);
  const d = await A('GET', `/wording/${code}`);
  const latest = d.rows[0];
  const f = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    if (await run(() => A('POST', `/wording/${code}`, v), 'New version saved')) wording(el, code);
  } },
  field('Title', h('input', { name: 'title', value: latest?.title || '', disabled: !editable(code) })),
  field('Text', h('textarea', { name: 'body', rows: 14, disabled: !editable(code) }, latest?.body || ''), code.startsWith('qt_') || code.startsWith('email_') ? 'You can use {{client_name}}, {{job_no}}, {{quote_no}}, {{pay_link}}, {{report_link}}.' : null),
  field('Effective from', h('input', { name: 'effective_from', type: 'date', value: todayIso(), disabled: !editable(code) }), 'New documents use this version from this date.'),
  editable(code) ? h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save as new version')), h('a', { class: 'btn alt', href: '#settings/wording' }, t('Back'))) : h('p', {}, h('a', { class: 'btn alt', href: '#settings/wording' }, t('Back'))));
  fill(el, h('div', { class: 'card' }, h('div', { class: 'actions' }, h('h1', {}, latest?.title || code), latest?.body.startsWith('DRAFT') ? pill(t('Draft'), 'warn') : null), f),
    h('div', { class: 'card' }, h('h2', {}, t('Version history')), d.rows.map((v) => h('div', { class: `version ${d.current?.id === v.id ? 'cur' : ''}` },
      h('div', { class: 'actions' }, h('b', {}, `v${v.version}`), h('span', { class: 'small muted' }, `${t('from')} ${fmtDay(v.effective_from)} · ${v.created_by_name || t('System')} · ${fmtStamp(v.created_at)}`), d.current?.id === v.id ? pill(t('In force'), 'ok') : null),
      h('details', {}, h('summary', { class: 'small' }, t('Show text')), h('div', { class: 'pre' }, v.body))))));
}

// ---------- generic lists ----------
async function listView(el, name) {
  const m = await meta();
  const r = m.resources[name];
  if (!r) return fill(el, h('p', {}, t('Not found')));
  const editable = can(r.perm);
  const refOpts = {};
  await Promise.all(r.fields.filter((f) => f.t === 'ref').map(async (f) => { refOpts[f.k] = (await A('GET', `/list/${f.ref}/options`)).rows; }));
  const refLabel = (f, v) => refOpts[f.k]?.find((o) => o.id === v)?.label ?? '';
  const st = { q: '' };
  for (const f of r.fields) if (f.filter) st[f.k] = '';
  const box = h('div', {});
  const today = todayIso();
  const cell = (f, row) => {
    const v = row[f.k];
    if (f.t === 'bool') return v ? '✓' : '';
    if (f.t === 'ref') return refLabel(f, v);
    if (f.t === 'date') return v ? (f.expiry && v < today ? pill(fmtDay(v), 'bad') : f.expiry && v < addDays(today, 45) ? pill(fmtDay(v), 'warn') : fmtDay(v)) : '';
    if (f.money) return num2(v);
    if (f.k === 'default_severity') return pill(t(v), v);
    if (f.t === 'enum') return t(v);
    return v ?? '';
  };
  const qs = () => new URLSearchParams(Object.entries(st).filter(([, v]) => v !== '')).toString();
  const load = async () => {
    const { rows } = await A('GET', `/list/${name}?${qs()}`);
    const cols = r.fields.filter((f) => f.list);
    box.replaceChildren(rows.length ? h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, cols.map((f) => h('th', { class: f.t === 'num' || f.t === 'int' ? 'num' : '' }, t(f.label))))),
      h('tbody', {}, rows.map((row) => h('tr', { class: `click ${row.active === 0 ? 'off' : ''}`, onclick: () => form(row) },
        cols.map((f) => h('td', { class: f.t === 'textarea' ? 'clip' : f.t === 'num' || f.t === 'int' ? 'num' : '' }, f.t === 'textarea' ? h('div', {}, cell(f, row)) : cell(f, row)))))))) : h('p', { class: 'muted' }, t('Nothing here yet.')),
      h('p', { class: 'small muted' }, t('{n} rows', { n: rows.length })));
  };
  const input = (f, row) => {
    const v = row ? row[f.k] : f.def ?? '';
    const dis = !editable;
    if (f.t === 'bool') return h('label', { class: 'check' }, h('input', { type: 'checkbox', name: f.k, checked: !!v, disabled: dis }), t(f.label));
    let el;
    if (f.t === 'textarea') el = h('textarea', { name: f.k, required: f.req, disabled: dis, dir: f.dir || null }, v ?? '');
    else if (f.t === 'enum') el = h('select', { name: f.k, required: f.req, disabled: dis }, f.options.map((o) => h('option', { value: o, selected: v === o }, o === '' ? '-' : t(o))));
    else if (f.t === 'ref') el = h('select', { name: f.k, required: f.req, disabled: dis }, f.req ? null : h('option', { value: '' }, '-'), refOpts[f.k].map((o) => h('option', { value: o.id, selected: v === o.id || (!row && st[f.k] && Number(st[f.k]) === o.id) }, o.label)));
    else if (f.t === 'lookup') {
      const opts = [...(f.any ? ['*'] : []), ...(S.lk?.[f.list_name] || [])];
      if (v && !opts.includes(v)) opts.unshift(v);
      el = h('select', { name: f.k, required: f.req, disabled: dis }, f.req ? null : h('option', { value: '' }, '-'), opts.map((o) => h('option', { value: o, selected: v === o }, o === '*' ? t('Any') : o)));
    } else el = h('input', { name: f.k, value: v ?? '', required: f.req, disabled: dis, type: f.t === 'date' ? 'date' : f.email ? 'email' : 'text', inputmode: f.t === 'int' || f.t === 'num' ? 'decimal' : null, dir: f.dir || (f.email || /mobile|phone|_no$/.test(f.k) || ['date', 'int', 'num'].includes(f.t) ? 'ltr' : null) });
    return field(f.label, el);
  };
  const form = (row) => {
    const f = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const v = {};
      for (const fl of r.fields) v[fl.k] = fl.t === 'bool' ? f[fl.k].checked : f[fl.k].value;
      if (await run(() => (row ? A('PUT', `/list/${name}/${row.id}`, v) : A('POST', `/list/${name}`, v)), 'Saved')) { closeModal(); load(); }
    } }, h('h2', {}, `${t(r.title)}: ${row ? t('edit') : t('add')}`),
    h('div', { class: 'grid2' }, r.fields.filter((x) => x.t !== 'textarea').map((x) => input(x, row))), r.fields.filter((x) => x.t === 'textarea').map((x) => input(x, row)),
    h('p', { class: 'actions' }, editable ? h('button', { class: 'btn cu' }, t('Save')) : null, h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t(editable ? 'Cancel' : 'Close')), h('span', { class: 'spacer' }),
      editable && row ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (!(await confirmBox('Delete this entry?', t('This cannot be undone.'), 'Delete'))) return; if (await run(() => A('DELETE', `/list/${name}/${row.id}`), 'Deleted')) load(); else form(row); } }, t('Delete')) : null));
    modal(f);
  };
  const filters = r.fields.filter((f) => f.filter).map((f) => h('select', { 'aria-label': t(f.label), onchange: (e) => { st[f.k] = e.target.value; load(); } },
    h('option', { value: '' }, `${t(f.label)}: ${t('all')}`), (f.t === 'ref' ? refOpts[f.k].map((o) => [o.id, o.label]) : f.options ? f.options.filter(Boolean).map((o) => [o, t(o)]) : []).map(([v, l]) => h('option', { value: v }, l))));
  const search = h('input', { type: 'search', placeholder: t('Search'), 'aria-label': t('Search'), oninput: debounce((e) => { st.q = e.target.value.trim(); load(); }, 300) });
  fill(el, h('div', { class: 'card' }, h('div', { class: 'actions' }, h('h1', {}, t(r.title)), h('span', { class: 'spacer' }), h('a', { class: 'btn alt sm', href: `/api/app/export/list/${name}.xlsx`, download: '' }, t('Export to Excel')), editable ? h('button', { class: 'btn cu', onclick: () => form(null) }, t('+ Add')) : null),
    r.hint ? h('p', { class: 'small muted' }, t(r.hint)) : null,
    editable ? null : h('p', { class: 'alert info small' }, t('You can view this list. Only {who} can change it.', { who: t(r.perm.startsWith('technical') ? 'the Super Admin or Technical Manager' : r.perm.startsWith('field') ? 'the Super Admin or Admin' : 'the Super Admin') })),
    h('div', { class: 'toolbar' }, filters, search), box));
  await load();
}

// ---------- messages ----------
async function messages(el) {
  const d = await A('GET', '/messages');
  const testForm = can('settings.edit') ? h('form', { class: 'toolbar', onsubmit: async (e) => { e.preventDefault(); const r = await run(() => A('POST', '/messages/test', { to: e.target.to.value })); if (r) { toast(t(r.status === 'sent' ? 'Test email sent' : r.status === 'logged' ? 'Email is not configured yet: the message was only logged' : 'Sending failed')); messages(el); } } },
    h('input', { name: 'to', type: 'email', value: S.me.email, class: 'ltr', 'aria-label': t('Send a test email to') }), h('button', { class: 'btn' }, t('Send me a test email'))) : null;
  fill(el, h('div', { class: 'card' }, h('div', { class: 'actions' }, h('h1', {}, t('Messages')), h('span', { class: 'spacer' }), exportBtn('messages.xlsx')),
    d.enabled ? h('p', { class: 'alert good' }, t('Gmail is connected. Emails are sent and listed here.')) : h('p', { class: 'alert' }, t('Gmail is not connected yet. Emails are only listed here. Add SMTP_PASS (Gmail app password) on the server to send them.')),
    testForm,
    d.rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Time', 'To', 'Subject', 'Status'].map((c) => h('th', {}, t(c))))),
      h('tbody', {}, d.rows.map((m) => h('tr', {}, h('td', { class: 'nowrap' }, fmtStamp(m.ts)), h('td', { class: 'ltr' }, m.to_addr), h('td', {}, m.subject, m.error ? h('div', { class: 'small muted' }, m.error) : null),
        h('td', {}, pill(t(m.status), m.status === 'sent' ? 'ok' : m.status === 'failed' ? 'bad' : '')))))))
      : h('p', { class: 'muted' }, t('No messages yet.'))));
}

// ---------- audit ----------
async function audit(el) {
  const st = { from: '', to: '', entity: '' };
  const box = h('div', {});
  const qs = () => new URLSearchParams(Object.entries(st).filter(([, v]) => v)).toString();
  const load = async () => {
    const { rows } = await A('GET', `/audit?${qs()}`);
    box.replaceChildren(h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Time', 'User', 'Action', 'Record', 'Details'].map((c) => h('th', {}, t(c))))),
      h('tbody', {}, rows.map((a) => h('tr', {}, h('td', { class: 'nowrap' }, fmtStamp(a.ts)), h('td', {}, a.user_name || '-'), h('td', {}, t(a.action)), h('td', { class: 'ltr' }, `${a.entity}${a.entity_id ? ' #' + a.entity_id : ''}`),
        h('td', { class: 'clip' }, a.before_json || a.after_json ? h('details', {}, h('summary', { class: 'small' }, t('Show')), a.before_json ? h('div', { class: 'pre ltr' }, `${t('Before')}: ${a.before_json}`) : null, a.after_json ? h('div', { class: 'pre ltr' }, `${t('After')}: ${a.after_json}`) : null) : '')))))));
  };
  const inp = (k, type, label) => h('input', { type, 'aria-label': t(label), onchange: (e) => { st[k] = e.target.value; load(); } });
  fill(el, h('div', { class: 'card' }, h('div', { class: 'actions' }, h('h1', {}, t('Audit log')), h('span', { class: 'spacer' }), h('a', { class: 'btn alt sm', href: '#', onclick: (e) => { e.preventDefault(); location.href = `/api/app/export/audit.xlsx?${qs()}`; } }, t('Export to Excel'))),
    h('p', { class: 'small muted' }, t('Every sign-in and every change, with who made it and what changed. The newest 1,000 entries are shown.')),
    h('div', { class: 'toolbar' }, inp('from', 'date', 'From'), inp('to', 'date', 'To'),
      h('select', { 'aria-label': t('Record'), onchange: (e) => { st.entity = e.target.value; load(); } }, h('option', { value: '' }, t('All records')), ['users', 'settings', 'content_blocks', 'services', 'price_rules', 'inspectors', 'equipment', 'branches', 'comment_library', 'lookups'].map((x) => h('option', { value: x }, x)))), box));
  await load();
}

function debounce(fn, ms) { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; }
function addDays(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// ---------- database backups ----------
async function backups(el) {
  const d = await A('GET', '/backups');
  const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const last = d.last;
  fill(el, h('div', { class: 'card' },
    h('div', { class: 'actions' }, h('h1', {}, t('Backups')), h('span', { class: 'spacer' }),
      h('button', { class: 'btn cu', onclick: async (e) => { e.target.disabled = true; if (await run(() => A('POST', '/backups'), 'Backup saved')) backups(el); else e.target.disabled = false; } }, t('Back up now'))),
    h('p', { class: 'small muted' }, t('The whole database (jobs, clients, reports, invoices, users and settings) is copied every night after 02:00 Dubai time. Photos and PDFs are files in Google Drive or on the server and are not part of this copy.')),
    h('div', { class: 'kpis' },
      h('div', { class: `kpi ${last ? '' : 'cu'}` }, h('b', {}, last ? fmtStamp(last.at) : t('Never')), h('span', {}, t('Last backup'))),
      h('div', { class: 'kpi' }, h('b', {}, d.storage === 'drive' ? 'Google Drive' : t('Server disk')), h('span', {}, d.storage === 'drive' ? t('Folder "ARAL Backups"') : t('Add the Google Drive keys to keep copies off the server'))),
      h('div', { class: `kpi ${d.encrypted ? '' : 'cu'}` }, h('b', {}, d.encrypted ? t('Encrypted') : t('Not encrypted')), h('span', {}, d.encrypted ? t('Keep BACKUP_KEY safe: it is needed to restore') : t('Set BACKUP_KEY on Render to encrypt the copies'))),
      h('div', { class: 'kpi' }, h('b', {}, String(d.keep)), h('span', {}, t('Copies kept')))),
    d.rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['File', 'Made', 'Size', ''].map((x) => h('th', {}, t(x))))),
      h('tbody', {}, d.rows.map((r) => h('tr', {}, h('td', { class: 'ltr small' }, r.name), h('td', { class: 'nowrap' }, fmtStamp(r.created_at)), h('td', { class: 'num' }, kb(r.size)),
        h('td', {}, h('a', { class: 'btn alt sm', href: `/api/app/backups/${r.id}/download` }, t('Download')))))))) : h('p', { class: 'muted' }, t('No backups yet.')),
    h('details', { class: 'small' }, h('summary', {}, t('How to restore')),
      h('ol', {}, h('li', {}, t('Download the backup file.')), h('li', {}, t('Ask your developer to unpack it (and decrypt it with BACKUP_KEY if encrypted) and replace app.db on the Render disk while the service is stopped.')), h('li', {}, t('Start the service again. Test a restore once before going live.'))))));
}
