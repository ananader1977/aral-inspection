// Jobs: list, new job, job file (client, property, quotation, agreement, payment, scheduling, report, invoice, history).
import { h, fill, toast, pill, t, fmtStamp, fmtDay, num2, money, todayIso } from '/js/common.js';
import { S, A, can, run, modal, closeModal, field, go } from '/js/app.js';

export const STATUS_KIND = { new: 'warn', quoted: 'attention', quote_accepted: 'attention', agreement_signed: 'attention', payment_pending: 'warn', paid: 'cu', scheduled: 'cu', report_draft: 'cu', under_review: 'attention', report_issued: 'ok', invoiced: 'ok', closed: 'ok', quote_rejected: 'bad', quote_expired: '', on_hold: '', access_failed: 'bad', reinspection_due: 'warn', cancelled: '', refunded: '' };
export const STATUS_LABEL = { new: 'New request', quoted: 'Quoted', quote_accepted: 'Quote accepted', agreement_signed: 'Agreement signed', payment_pending: 'Awaiting payment', paid: 'Paid', scheduled: 'Scheduled', report_draft: 'Inspection in progress', inspected: 'Inspected', under_review: 'Under review', report_issued: 'Report issued', invoiced: 'Invoiced', closed: 'Closed', quote_rejected: 'Quote rejected', quote_expired: 'Quote expired', on_hold: 'On hold', access_failed: 'Access failed', reinspection_due: 'Re-inspection due', cancelled: 'Cancelled', refunded: 'Refunded' };
export const statusPill = (s, label) => pill(t(label || STATUS_LABEL[s] || s), STATUS_KIND[s]);
const PTYPES = ['studio', 'apartment', 'townhouse', 'villa', 'penthouse', 'office', 'retail', 'warehouse', 'building', 'land'];
const CLIENT_TYPES = ['individual', 'company', 'bank', 'developer', 'owners_association', 'broker'];
const where = (j) => [j.building, j.unit_no && `${t('Unit')} ${j.unit_no}`, j.community].filter(Boolean).join(', ');
const opt = (list, cur, labels) => list.map((v) => h('option', { value: v, selected: String(v) === String(cur ?? '') }, labels ? t(labels[v] || v) : t(v)));
let services = null;
const loadServices = async () => (services ||= (await A('GET', '/services')).rows);

export async function jobsView(el, parts) {
  if (parts[0] === 'new') return newJob(el);
  if (parts[0]) return jobFile(el, Number(parts[0]));
  const st = { q: '', status: '', open: '1' };
  const box = h('div', {});
  let statuses = {};
  const load = async () => {
    const qs = new URLSearchParams(Object.entries(st).filter(([, v]) => v)).toString();
    const d = await A('GET', `/jobs?${qs}`);
    statuses = d.statuses;
    if (!sel.options.length || sel.options.length < 2) fill(sel, h('option', { value: '' }, t('All statuses')), Object.entries(statuses).map(([k, v]) => h('option', { value: k }, t(v))));
    fill(box, d.rows.length ? h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Job', 'Client', 'Service and property', 'Visit', 'Inspector', 'Status'].map((c) => h('th', {}, t(c))))),
      h('tbody', {}, d.rows.map((j) => h('tr', { class: 'click', onclick: () => go(`jobs/${j.id}`) },
        h('td', { class: 'nowrap ltr' }, h('b', {}, j.number), h('div', { class: 'small muted' }, fmtStamp(j.created_at))),
        h('td', {}, j.client_name, h('div', { class: 'small muted ltr' }, j.client_mobile)),
        h('td', {}, j.service_name, h('div', { class: 'small muted' }, [j.property_type, j.bedrooms != null ? `${j.bedrooms} BR` : '', where(j)].filter(Boolean).join(' · '))),
        h('td', { class: 'nowrap' }, j.scheduled_start ? fmtStamp(j.scheduled_start) : '-'),
        h('td', {}, j.inspector_name || '-'),
        h('td', {}, statusPill(j.status, j.status_label))))))) : h('p', { class: 'muted' }, t('No jobs found.')));
  };
  const sel = h('select', { 'aria-label': t('Status'), onchange: (e) => { st.status = e.target.value; st.open = e.target.value ? '' : st.open; load(); } });
  const openBox = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { st.open = e.target.checked ? '1' : ''; load(); } }), t('Open jobs only'));
  let tm;
  fill(el, h('div', { class: 'card' },
    h('div', { class: 'actions' }, h('h1', {}, t('Jobs')), h('span', { class: 'spacer' }),
      h('a', { class: 'btn alt sm', href: '#clients' }, t('Clients and rates')),
      h('a', { class: 'btn alt sm', href: '/api/app/export/jobs.xlsx', download: '' }, t('Export to Excel')),
      can('jobs.manage') ? h('a', { class: 'btn cu', href: '#jobs/new' }, t('+ New job')) : null),
    h('div', { class: 'toolbar' }, h('input', { type: 'search', placeholder: t('Search job, client, mobile, building'), 'aria-label': t('Search'), oninput: (e) => { st.q = e.target.value.trim(); clearTimeout(tm); tm = setTimeout(load, 300); } }), sel, openBox),
    box));
  await load();
}

function clientFields(c = {}) {
  return h('div', { class: 'grid2' },
    field('Client name (English, printed on PDFs)', h('input', { name: 'c_name', required: true, value: c.name || '' })),
    field('Client type', h('select', { name: 'c_type' }, opt(CLIENT_TYPES, c.type || 'individual'))),
    field('Mobile', h('input', { name: 'c_mobile', class: 'ltr', value: c.mobile || '', placeholder: '+971 50 123 4567' })),
    field('Email', h('input', { name: 'c_email', type: 'email', class: 'ltr', value: c.email || '' })),
    field('Contact person', h('input', { name: 'c_contact_person', value: c.contact_person || '' })),
    field('Name in Arabic (screens only)', h('input', { name: 'c_name_ar', value: c.name_ar || '', dir: 'rtl' })),
    field('Client TRN', h('input', { name: 'c_trn', class: 'ltr', value: c.trn || '' })),
    field('Credit terms (days, 0 = pays in advance)', h('input', { name: 'c_credit_terms_days', inputmode: 'numeric', class: 'ltr', value: c.credit_terms_days ?? 0 })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'c_monthly_invoicing', checked: !!c.monthly_invoicing }), t('One invoice per month (banks / companies)')),
    field('Address (for invoices)', h('input', { name: 'c_address', value: c.address || '' })));
}
function propertyFields(p = {}) {
  return h('div', { class: 'grid3' },
    field('Property type', h('select', { name: 'p_property_type' }, opt(PTYPES, p.property_type || 'apartment'))),
    field('Bedrooms', h('input', { name: 'p_bedrooms', inputmode: 'numeric', class: 'ltr', value: p.bedrooms ?? '' })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'p_has_maid_room', checked: !!p.has_maid_room }), t("Maid's room")),
    field('Community', h('input', { name: 'p_community', list: 'dl-community', value: p.community || '' })),
    field('Building / project', h('input', { name: 'p_building', value: p.building || '' })),
    field('Unit no.', h('input', { name: 'p_unit_no', class: 'ltr', value: p.unit_no || '' })),
    field('Developer', h('input', { name: 'p_developer', list: 'dl-developer', value: p.developer || '' })),
    field('Built-up area (sq ft)', h('input', { name: 'p_bua_sqft', inputmode: 'decimal', class: 'ltr', value: p.bua_sqft ?? '' })),
    field('Levels', h('input', { name: 'p_levels', inputmode: 'numeric', class: 'ltr', value: p.levels ?? 1 })),
    field('Title deed no.', h('input', { name: 'p_title_deed_no', class: 'ltr', value: p.title_deed_no || '' })),
    field('Handover date', h('input', { name: 'p_handover_date', type: 'date', value: p.handover_date || '' })),
    field('Map link', h('input', { name: 'p_map_link', class: 'ltr', value: p.map_link || '' })),
    h('datalist', { id: 'dl-community' }, (S.lk?.community || []).map((v) => h('option', { value: v }))),
    h('datalist', { id: 'dl-developer' }, (S.lk?.developer || []).map((v) => h('option', { value: v }))));
}
const pick = (f, prefix) => {
  const o = {};
  for (const el of f.elements) if (el.name?.startsWith(prefix)) o[el.name.slice(prefix.length)] = el.type === 'checkbox' ? el.checked : el.value;
  return o;
};

async function newJob(el) {
  const svc = (await loadServices()).filter((s) => !s.is_addon);
  const f = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const body = { service_code: f.service_code.value, purpose: f.purpose.value, bank_reference: f.bank_reference.value, access_contact: f.access_contact.value, access_notes: f.access_notes.value, preferred_dates: f.preferred_dates.value, occupancy: f.occupancy.value, channel: 'internal', client: pick(f, 'c_'), property: pick(f, 'p_') };
    const r = await run(() => A('POST', '/jobs', body), 'Job created');
    if (r) go(`jobs/${r.id}`);
  } },
  h('h1', {}, t('New job')),
  h('div', { class: 'card' }, h('h2', {}, t('Client')), h('p', { class: 'small muted' }, t('An existing client with the same mobile or email is reused.')), clientFields()),
  h('div', { class: 'card' }, h('h2', {}, t('Property')), propertyFields()),
  h('div', { class: 'card' }, h('h2', {}, t('Service and access')),
    h('div', { class: 'grid2' },
      field('Service', h('select', { name: 'service_code', required: true }, svc.map((s) => h('option', { value: s.code }, `${s.name} (${s.code})`)))),
      field('Purpose', h('select', { name: 'purpose' }, h('option', { value: '' }, '-'), (S.lk?.purpose || []).map((v) => h('option', { value: v }, v)))),
      field('Occupancy', h('select', { name: 'occupancy' }, h('option', { value: '' }, '-'), (S.lk?.occupancy || []).map((v) => h('option', { value: v }, v)))),
      field('Bank / client reference', h('input', { name: 'bank_reference', class: 'ltr' })),
      field('Access contact (name and mobile)', h('input', { name: 'access_contact' })),
      field('Preferred dates', h('input', { name: 'preferred_dates' }))),
    field('Access notes (keys, gate pass, security)', h('textarea', { name: 'access_notes', rows: 2 }))),
  h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Create job')), h('a', { class: 'btn alt', href: '#jobs' }, t('Cancel'))));
  fill(el, f);
}

async function jobFile(el, id) {
  const d = await A('GET', `/jobs/${id}`);
  const j = d.job, c = d.client, p = d.property;
  const reload = () => jobFile(el, id);
  const draft = d.quotes.find((q) => q.status === 'draft');
  const live = d.quotes.find((q) => ['sent', 'accepted', 'change_requested', 'rejected', 'expired'].includes(q.status));
  const accepted = d.quotes.find((q) => q.status === 'accepted');
  const due = accepted ? Math.max(0, Math.round((accepted.total * accepted.deposit_pct) / 100 * 100) / 100 - d.paid) : 0;
  const M = can('jobs.manage');
  const btns = [];
  if (M && ['new', 'quoted', 'quote_rejected', 'quote_expired', 'quote_accepted'].includes(j.status)) btns.push(h('button', { class: 'btn cu', onclick: () => quoteEditor(j, draft, reload) }, t(draft ? 'Edit quotation' : live ? 'Revise quotation' : 'Prepare quotation')));
  if (M && draft) btns.push(h('button', { class: 'btn', onclick: async () => { if (await run(() => A('POST', `/quotes/${draft.id}/send`), 'Quotation emailed to the client')) reload(); } }, t('Send quotation')));
  if (M && live?.status === 'sent') btns.push(h('button', { class: 'btn alt', onclick: () => acceptForClient(live, reload) }, t('Record acceptance (phone / email)')));
  if (accepted && due > 0 && ['payment_pending', 'agreement_signed'].includes(j.status) && (M || can('finance.manage'))) {
    btns.push(h('button', { class: 'btn cu', onclick: () => paymentForm(`/quotes/${accepted.id}/payment`, due, reload) }, t('Record payment')));
    if (S.cfg.payments === 'mock') btns.push(h('button', { class: 'btn alt', onclick: async () => { const r = await run(() => A('POST', `/quotes/${accepted.id}/test-pay`)); if (r) window.open(r.url, '_blank', 'noopener'); } }, t('Test online payment (demo)')));
  }
  const canSchedule = ['paid', 'scheduled', 'access_failed'].includes(j.status) || (j.status === 'agreement_signed' && j.client_kind === 'company');
  if (M && canSchedule) btns.push(h('button', { class: 'btn cu', onclick: () => scheduleForm(j, reload) }, t(j.status === 'scheduled' ? 'Reschedule' : 'Schedule the inspection')));
  if (d.report && can('inspect') && ['scheduled', 'report_draft', 'access_failed'].includes(j.status)) btns.push(h('a', { class: 'btn', href: `#inspect/${j.id}` }, t('Open the inspection')));
  if (d.report && ['under_review'].includes(j.status) && can('reports.review')) btns.push(h('a', { class: 'btn cu', href: `#reviews/${j.id}` }, t('Review the report')));
  if (d.report?.versions?.length) btns.push(h('a', { class: 'btn alt', href: `/api/app/reports/${j.id}/pdf`, target: '_blank' }, t('Report PDF')));
  if (M && ['report_issued', 'invoiced'].includes(j.status) && !d.children.length) btns.push(h('button', { class: 'btn alt', onclick: async () => { const r = await run(() => A('POST', `/jobs/${j.id}/reinspection`), 'Re-inspection job created'); if (r) go(`jobs/${r.id}`); } }, t('Book a re-inspection')));
  if (can('finance.manage') && j.status === 'report_issued' && !d.invoices.length && !c.monthly_invoicing) btns.push(h('button', { class: 'btn cu', onclick: async () => { if (await run(() => A('POST', `/jobs/${j.id}/invoice`), 'Invoice issued')) reload(); } }, t('Issue invoice')));
  if (M && !['closed', 'cancelled', 'refunded', 'invoiced'].includes(j.status)) {
    if (j.status === 'on_hold') btns.push(h('button', { class: 'btn alt', onclick: async () => { if (await run(() => A('POST', `/jobs/${j.id}/status`, { to: 'new', note: 'Back from hold' }))) reload(); } }, t('Take off hold')));
    else if (j.next.includes('on_hold')) btns.push(h('button', { class: 'btn alt', onclick: async () => { if (await run(() => A('POST', `/jobs/${j.id}/status`, { to: 'on_hold' }))) reload(); } }, t('Put on hold')));
    btns.push(h('button', { class: 'btn danger', onclick: () => cancelJob(j, reload) }, t('Cancel job')));
  }

  const card = (title, ...kids) => h('div', { class: 'card' }, h('h2', {}, t(title)), ...kids);
  const kv = (pairs) => h('dl', { class: 'kv' }, pairs.filter(([, v]) => v !== '' && v != null).flatMap(([k, v]) => [h('dt', {}, t(k)), h('dd', {}, v)]));
  fill(el,
    h('div', { class: 'actions' }, h('a', { class: 'btn alt sm', href: '#jobs' }, '‹ ', t('Jobs')), h('h1', { class: 'ltr' }, j.number), statusPill(j.status, j.status_label), d.parent ? h('a', { class: 'pill cu', href: `#jobs/${d.parent.id}` }, `${t('Re-inspection of')} ${d.parent.number}`) : null),
    h('p', { class: 'muted' }, `${j.service_name} · ${where(j) || t('Property details missing')}`),
    btns.length ? h('div', { class: 'card actions' }, btns) : null,
    h('div', { class: 'grid2' },
      card('Client', kv([['Name', c.name], ['Type', t(c.type)], ['Mobile', h('span', { class: 'ltr' }, c.mobile || '-')], ['Email', h('span', { class: 'ltr' }, c.email || '-')], ['Payment', c.credit_terms_days ? t('{n} days credit', { n: c.credit_terms_days }) : t('Pays in advance')], ['Monthly invoice', c.monthly_invoicing ? t('Yes') : '']]),
        M ? h('p', {}, h('button', { class: 'btn alt sm', onclick: () => editClientProperty(j, c, p, reload) }, t('Edit client and property'))) : null),
      card('Property and access', kv([['Property', [t(p.property_type), p.bedrooms != null ? `${p.bedrooms} BR` : '', p.has_maid_room ? t("maid's room") : ''].filter(Boolean).join(' · ')], ['Address', where({ ...p })], ['Developer', p.developer], ['Built-up area', p.bua_sqft ? `${p.bua_sqft} sq ft` : ''], ['Purpose', j.purpose], ['Reference', j.bank_reference], ['Access contact', j.access_contact], ['Access notes', j.access_notes], ['Preferred dates', j.preferred_dates], ['Occupancy', j.occupancy]]))),
    j.scheduled_start ? card('Visit', kv([['When', fmtStamp(j.scheduled_start) + ' – ' + fmtStamp(j.scheduled_end).slice(-5)], ['Inspector', j.inspector_name], ['Equipment', d.equipment.map((e) => e.name).join(', ')], ['On site', j.access_at ? fmtStamp(j.access_at) : ''], ['Report due', j.sla_due_at ? fmtStamp(j.sla_due_at) : '']])) : null,
    d.quotes.length ? card('Quotations', h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Quotation', 'Date', 'Total', 'Status', ''].map((x) => h('th', {}, t(x))))),
      h('tbody', {}, d.quotes.map((q) => h('tr', { class: q.status === 'superseded' ? 'off' : '' }, h('td', { class: 'ltr nowrap' }, q.display_number), h('td', {}, fmtDay(q.issue_date)), h('td', { class: 'num' }, num2(q.total)),
        h('td', {}, pill(t(q.status), q.status === 'accepted' ? 'ok' : q.status === 'rejected' ? 'bad' : q.status === 'sent' ? 'attention' : ''), q.decided_name ? h('div', { class: 'small muted' }, `${q.decided_name} · ${fmtStamp(q.decided_at)}`) : null, q.decision_note ? h('div', { class: 'small' }, q.decision_note) : null),
        h('td', { class: 'nowrap' }, h('a', { class: 'btn alt sm', href: `/api/app/quotes/${q.id}/pdf`, target: '_blank' }, 'PDF')))))))) : null,
    d.agreement ? card('Service agreement', d.agreement.signed_at ? h('p', {}, pill(t('Signed'), 'ok'), ' ', `${d.agreement.signed_name} · ${fmtStamp(d.agreement.signed_at)} `, h('a', { class: 'btn alt sm', href: `/api/app/agreements/${d.agreement.id}/pdf`, target: '_blank' }, 'PDF'))
      : [h('p', {}, pill(t('Waiting for the client to sign'), 'warn'), ' ', d.agreement.sent_at ? h('span', { class: 'small muted' }, `${t('Link sent')} ${fmtStamp(d.agreement.sent_at)}`) : null),
        h('p', { class: 'small muted' }, t('The client signs on the quotation link. Send it again by email or WhatsApp below, or record a signature the client gave on paper.')),
        M && accepted ? h('p', { class: 'actions' },
          h('button', { class: 'btn', onclick: async () => { if (await run(() => A('POST', `/quotes/${accepted.id}/send-link`), 'Signing link emailed to the client')) reload(); } }, t('Email the signing link')),
          h('button', { class: 'btn alt', onclick: () => signForClient(accepted, reload) }, t('Record signature (signed on paper)'))) : null]) : null,
    d.client_link && M && ['quoted', 'quote_accepted', 'agreement_signed', 'payment_pending'].includes(j.status) ? card('Client link', clientLink(d.client_link, c, j)) : null,
    d.payments.length || accepted ? card('Payments', d.payments.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('tbody', {}, d.payments.map((x) => h('tr', {}, h('td', {}, x.receipt_no), h('td', {}, fmtDay(x.paid_on)), h('td', {}, t(x.method), x.provider === 'mock' ? ' (demo)' : ''), h('td', { class: 'num' }, num2(x.amount)), h('td', {}, h('a', { class: 'btn alt sm', href: `/api/app/receipts/${x.id}/pdf`, target: '_blank' }, t('Receipt')))))))) : null,
      accepted ? h('p', { class: 'small' }, t('Paid'), ': ', money(d.paid), due > 0 ? ` · ${t('Due now')}: ${money(due)}` : '') : null) : null,
    d.report ? card('Report', kv([['Status', t(d.report.status)], ['Number', d.report.number], ['Findings', d.report.counts.map((x) => `${t(x.severity)}: ${x.n}`).join(' · ')], ['Photos and videos', d.report.media.map((x) => `${t(x.kind)}: ${x.n}`).join(' · ')], ['Attachments', d.report.attachments ? String(d.report.attachments) : ''], ['Returned with', d.report.review_note]]),
      h('p', { class: 'actions' }, d.drive ? h('a', { class: 'btn alt sm', href: d.drive, target: '_blank', rel: 'noopener' }, t('Google Drive folder')) : null, d.report.verify_token && d.report.issued_at ? h('a', { class: 'btn alt sm', href: `/report.html?t=${d.report.verify_token}`, target: '_blank' }, t('Online report')) : null,
        can('inspect') || can('jobs.view') ? h('a', { class: 'btn alt sm', href: `/api/app/inspect/${j.id}/preview.pdf`, target: '_blank' }, t('Preview PDF')) : null)) : null,
    d.invoices.length ? card('Invoices', h('div', { class: 'tablewrap' }, h('table', {}, h('tbody', {}, d.invoices.map((i) => h('tr', {}, h('td', { class: 'ltr' }, i.number), h('td', {}, fmtDay(i.issue_date)), h('td', { class: 'num' }, num2(i.total)), h('td', {}, pill(t(i.status), i.status === 'paid' ? 'ok' : 'warn')), h('td', {}, h('a', { class: 'btn alt sm', href: `/api/app/invoices/${i.id}/pdf`, target: '_blank' }, 'PDF'), ' ', can('finance.view') ? h('a', { class: 'btn alt sm', href: `#finance/invoice/${i.id}` }, t('Open')) : null))))))) : null,
    d.children.length ? card('Re-inspection', d.children.map((x) => h('p', {}, h('a', { href: `#jobs/${x.id}` }, x.number), ' ', statusPill(x.status)))) : null,
    d.commission ? card('Inspector commission', kv([['Fee excl. VAT', money(d.commission.base_amount)], ['Rate', `${d.commission.pct}%`], ['Commission', money(d.commission.amount + d.commission.bonus)], ['Status', t(d.commission.status)]])) : null,
    card('History', h('ul', { class: 'timeline' }, d.events.slice().reverse().map((e) => h('li', {}, h('b', {}, fmtStamp(e.ts)), ' · ', e.to_status && e.from_status !== e.to_status && e.from_status ? statusPill(e.to_status) : null, ' ', e.note, e.user_name ? h('span', { class: 'muted small' }, ` — ${e.user_name}`) : null)))));
}

function editClientProperty(j, c, p, reload) {
  const f = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const body = { client: { ...pick(f, 'c_') }, property: pick(f, 'p_'), purpose: f.purpose.value, bank_reference: f.bank_reference.value, access_contact: f.access_contact.value, access_notes: f.access_notes.value, preferred_dates: f.preferred_dates.value, occupancy: f.occupancy.value };
    if (await run(() => A('PUT', `/jobs/${j.id}`, body), 'Saved')) { closeModal(); reload(); }
  } }, h('h2', {}, t('Edit client and property')), h('h3', {}, t('Client')), clientFields(c), h('h3', {}, t('Property')), propertyFields(p),
  h('div', { class: 'grid2' },
    field('Purpose', h('input', { name: 'purpose', value: j.purpose })), field('Bank / client reference', h('input', { name: 'bank_reference', value: j.bank_reference })),
    field('Access contact (name and mobile)', h('input', { name: 'access_contact', value: j.access_contact })), field('Preferred dates', h('input', { name: 'preferred_dates', value: j.preferred_dates })),
    field('Occupancy', h('input', { name: 'occupancy', value: j.occupancy, list: 'dl-occ' }))),
  h('datalist', { id: 'dl-occ' }, (S.lk?.occupancy || []).map((v) => h('option', { value: v }))),
  field('Access notes (keys, gate pass, security)', h('textarea', { name: 'access_notes', rows: 2 }, j.access_notes)),
  h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
  modal(f);
}

async function quoteEditor(j, draft, reload) {
  const d = await A('GET', `/jobs/${j.id}/quote-defaults`);
  let lines = (draft?.lines?.length ? draft.lines : d.lines).map((l) => ({ description: l.description, qty: l.qty, unit_price: l.unit_price, service_id: l.service_id }));
  const tbody = h('tbody', {});
  const totalEl = h('p', { class: 'num' });
  const disc = h('input', { inputmode: 'decimal', class: 'ltr', value: draft?.discount || 0, oninput: () => sum() });
  const sum = () => {
    const sub = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
    const net = sub - (Number(disc.value) || 0);
    const vat = d.vat_rate ? (net * d.vat_rate) / 100 : 0;
    fill(totalEl, `${t('Subtotal')} ${num2(sub)} · ${t('Discount')} ${num2(Number(disc.value) || 0)}${d.vat_rate ? ` · ${t('VAT')} ${d.vat_rate}% ${num2(vat)}` : ''} · `, h('b', {}, `${t('Total')} AED ${num2(net + vat)}`));
  };
  const draw = () => {
    fill(tbody, lines.map((l, i) => h('tr', {},
      h('td', {}, h('input', { value: l.description, 'aria-label': t('Description'), oninput: (e) => { l.description = e.target.value; } })),
      h('td', {}, h('input', { value: l.qty, inputmode: 'decimal', class: 'ltr', 'aria-label': t('Qty'), oninput: (e) => { l.qty = e.target.value; sum(); } })),
      h('td', {}, h('input', { value: l.unit_price, inputmode: 'decimal', class: 'ltr', 'aria-label': t('Unit price'), oninput: (e) => { l.unit_price = e.target.value; sum(); } })),
      h('td', {}, h('button', { class: 'btn danger sm', type: 'button', onclick: () => { lines.splice(i, 1); draw(); } }, '×')))));
    sum();
  };
  const comps = ['Interior finishes', 'MEP (electrical and plumbing)', 'Air conditioning', 'Water leak and moisture', 'Thermal imaging', 'Exterior', 'Structure (visual)', 'Pool / spa', 'Life safety'];
  const chosen = new Set(draft?.components || comps.slice(0, 4));
  const pre = ['AC connected', 'DEWA connected', 'Keys and access arranged', 'Unit empty and clean'];
  const chosenPre = new Set(draft?.prerequisites || pre.slice(0, 3));
  const f = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const body = { lines: lines.map((l) => ({ ...l, qty: Number(l.qty), unit_price: Number(l.unit_price) })), discount: Number(disc.value) || 0, deposit_pct: Number(f.deposit_pct.value), valid_days: Number(f.valid_days.value), turnaround_text: f.turnaround_text.value, components: [...chosen], prerequisites: [...chosenPre] };
    if (await run(() => A('POST', `/jobs/${j.id}/quote`, body), 'Quotation saved as draft')) { closeModal(); reload(); }
  } }, h('h2', {}, t('Quotation')),
  d.priced ? null : h('div', { class: 'alert' }, t('This service is priced per proposal: enter the fee lines.')),
  h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Description', 'Qty', 'Unit price (AED)', ''].map((x) => h('th', {}, t(x))))), tbody)),
  h('p', { class: 'actions' }, h('button', { class: 'btn alt sm', type: 'button', onclick: () => { lines.push({ description: '', qty: 1, unit_price: 0 }); draw(); } }, t('+ Line')),
    d.addons.map((a) => h('button', { class: 'btn alt sm', type: 'button', onclick: () => { lines.push({ description: a.name.replace(/^Add-on:\s*/, ''), qty: 1, unit_price: a.price, service_id: a.id }); draw(); } }, `+ ${a.name.replace(/^Add-on:\s*/, '')} (${num2(a.price)})`))),
  h('div', { class: 'grid3' }, field('Discount (AED)', disc), field('Advance payment %', h('input', { name: 'deposit_pct', inputmode: 'numeric', class: 'ltr', value: draft?.deposit_pct ?? d.settings.deposit_pct })), field('Valid for (days)', h('input', { name: 'valid_days', inputmode: 'numeric', class: 'ltr', value: d.settings.valid_days }))),
  totalEl,
  field('Report delivery', h('input', { name: 'turnaround_text', value: draft?.turnaround_text || d.settings.turnaround })),
  h('label', {}, t('Components in scope')), h('div', { class: 'chips' }, comps.map((x) => h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: chosen.has(x), onchange: (e) => (e.target.checked ? chosen.add(x) : chosen.delete(x)) }), t(x)))),
  h('label', {}, t('Please arrange before the visit')), h('div', { class: 'chips' }, pre.map((x) => h('label', { class: 'chip' }, h('input', { type: 'checkbox', checked: chosenPre.has(x), onchange: (e) => (e.target.checked ? chosenPre.add(x) : chosenPre.delete(x)) }), t(x)))),
  h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save draft')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
  modal(f);
  draw();
}

/** The secure link the client uses to accept, sign and pay: copy, open, or send by WhatsApp. */
function clientLink(url, c, j) {
  const wa = String(c.mobile || '').replace(/\D/g, '').replace(/^00/, '').replace(/^0(5\d{8})$/, '971$1');
  const msg = `Dear ${c.contact_person || c.name}, please use this secure link to review your inspection quotation, sign the service agreement and pay online: ${url}`;
  return [h('p', { class: 'small muted' }, t('The client accepts the quotation, signs the agreement and pays on this page.')),
    h('div', { class: 'secret small linkbox' }, url),
    h('p', { class: 'actions' },
      h('button', { class: 'btn alt sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(url); toast(t('Link copied')); } catch { toast(url, 8000); } } }, t('Copy link')),
      h('a', { class: 'btn alt sm', href: url, target: '_blank', rel: 'noopener' }, t('Open as the client')),
      wa ? h('a', { class: 'btn alt sm', href: `https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, target: '_blank', rel: 'noopener' }, 'WhatsApp') : null)];
}

function signForClient(q, reload) {
  const f = h('form', { onsubmit: async (e) => { e.preventDefault(); if (await run(() => A('POST', `/quotes/${q.id}/sign-for-client`, { name: f.who.value, note: f.note.value }), 'Signature recorded')) { closeModal(); reload(); } } },
    h('h2', {}, t('Record signature (signed on paper)')), h('p', { class: 'small muted' }, t('Use this only when the client signed the service agreement on paper or confirmed it in writing. Keep the signed copy.')),
    field('Signed by (name)', h('input', { name: 'who', required: true })), field('Note (e.g. signed on site, email of 21/10)', h('input', { name: 'note' })),
    h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Record signature')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
  modal(f);
}

function acceptForClient(q, reload) {
  const f = h('form', { onsubmit: async (e) => { e.preventDefault(); if (await run(() => A('POST', `/quotes/${q.id}/accept-for-client`, { name: f.who.value }), 'Acceptance recorded. The client still signs the agreement online.')) { closeModal(); reload(); } } },
    h('h2', {}, t('Record acceptance')), h('p', { class: 'small muted' }, t('Use this when the client accepted by phone or email. The client still signs the service agreement through the link.')),
    field('Accepted by (name)', h('input', { name: 'who', required: true })),
    h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Record')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
  modal(f);
}

export function paymentForm(path, due, reload) {
  const f = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    if (await run(() => A('POST', path, { ...v, amount: Number(v.amount) }), 'Payment recorded and receipt emailed')) { closeModal(); reload(); }
  } }, h('h2', {}, t('Record payment')),
  h('div', { class: 'grid2' },
    field('Amount (AED)', h('input', { name: 'amount', inputmode: 'decimal', class: 'ltr', required: true, value: due })),
    field('Method', h('select', { name: 'method' }, opt(['bank_transfer', 'cheque', 'cash', 'card'], 'bank_transfer'))),
    field('Date received', h('input', { name: 'paid_on', type: 'date', value: todayIso() })),
    field('Reference (transfer / cheque no.)', h('input', { name: 'ref', class: 'ltr' }))),
  h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Record payment')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
  modal(f);
}

function scheduleForm(j, reload) {
  const box = h('div', {});
  let chosenIns = j.inspector_id || null;
  const chosenEq = new Set(j.equipment_ids || []);
  const f = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    if (!chosenIns) return toast(t('Choose an inspector.'));
    if (await run(() => A('POST', `/jobs/${j.id}/schedule`, { date: f.date.value, time: f.time.value, hours: Number(f.hours.value), inspector_id: chosenIns, equipment_ids: [...chosenEq] }), 'Booked. The client and the inspector were emailed with a calendar invite.')) { closeModal(); reload(); }
  } }, h('h2', {}, t('Schedule the inspection')),
  h('div', { class: 'grid3' },
    field('Date', h('input', { name: 'date', type: 'date', required: true, value: j.scheduled_start ? new Date(j.scheduled_start + 4 * 3600e3).toISOString().slice(0, 10) : '', onchange: () => check() })),
    field('Start time', h('input', { name: 'time', type: 'time', required: true, step: 900, value: j.scheduled_start ? new Date(j.scheduled_start + 4 * 3600e3).toISOString().slice(11, 16) : '10:00', onchange: () => check() })),
    field('Duration (hours)', h('select', { name: 'hours', onchange: () => check() }, ['1', '1.5', '2', '2.5', '3', '4', '5', '6', '8'].map((x) => h('option', { value: x, selected: x === '3' }, x))))),
  box,
  h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Book and email')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
  async function check() {
    if (!f.date.value || !f.time.value) return fill(box, h('p', { class: 'muted' }, t('Choose the date and time to see who is free.')));
    const r = await run(() => A('GET', `/jobs/${j.id}/availability?date=${f.date.value}&time=${f.time.value}&hours=${f.hours.value}`));
    if (!r) return;
    fill(box, h('h3', {}, t('Inspector')), h('div', { class: 'pickgrid' }, r.inspectors.map((i) => h('label', { class: `pick ${i.ok ? '' : 'off'}` },
      h('input', { type: 'radio', name: 'ins', value: i.id, checked: chosenIns === i.id, disabled: !i.ok && !i.problems.every((p) => p === 'not thermal certified'), onchange: () => { chosenIns = i.id; } }),
      h('span', {}, h('b', {}, i.name), h('div', { class: 'small muted' }, i.ok ? i.areas || t('Available') : i.problems.map((p) => t(p)).join(', ')))))),
    h('h3', {}, t('Equipment')), r.needs_thermal ? h('p', { class: 'small muted' }, t('This service needs a thermal camera. A free one is added automatically if you do not choose one.')) : null,
    h('div', { class: 'pickgrid' }, r.equipment.map((e) => h('label', { class: `pick ${e.ok ? '' : 'off'}` }, h('input', { type: 'checkbox', checked: chosenEq.has(e.id), disabled: !e.ok, onchange: (x) => (x.target.checked ? chosenEq.add(e.id) : chosenEq.delete(e.id)) }),
      h('span', {}, h('b', {}, e.name), h('div', { class: 'small muted' }, e.ok ? `${t(e.kind)}${e.calibration_due ? ` · ${t('calibration to')} ${fmtDay(e.calibration_due)}` : ''}` : e.problems.map((p) => t(p)).join(', ')))))));
  }
  modal(f);
  check();
}

async function cancelJob(j, reload) {
  const f = h('form', { onsubmit: async (e) => { e.preventDefault(); if (await run(() => A('POST', `/jobs/${j.id}/cancel`, { reason: f.reason.value }), 'Job cancelled')) { closeModal(); reload(); } } },
    h('h2', {}, t('Cancel job')), h('p', { class: 'small muted' }, t('Bookings for equipment are released. Refunds are handled under Finance.')),
    field('Reason', h('input', { name: 'reason', required: true })),
    h('p', { class: 'actions' }, h('button', { class: 'btn danger' }, t('Cancel job')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Back'))));
  modal(f);
}

// ---------- clients (banks, companies, individuals) with negotiated rates ----------
export async function clientsView(el) {
  const st = { q: '' };
  const box = h('div', {});
  const load = async () => {
    const d = await A('GET', `/clients?q=${encodeURIComponent(st.q)}`);
    fill(box, h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Client', 'Type', 'Contact', 'Payment', 'Jobs'].map((x) => h('th', {}, t(x))))),
      h('tbody', {}, d.rows.map((c) => h('tr', { class: can('jobs.manage') ? 'click' : '', onclick: () => can('jobs.manage') && editClient(c) },
        h('td', {}, h('b', {}, c.name), c.trn ? h('div', { class: 'small muted ltr' }, `TRN ${c.trn}`) : null), h('td', {}, t(c.type)),
        h('td', {}, h('span', { class: 'ltr' }, c.mobile), h('div', { class: 'small muted ltr' }, c.email)),
        h('td', {}, c.credit_terms_days ? t('{n} days credit', { n: c.credit_terms_days }) : t('Pays in advance'), c.monthly_invoicing ? h('div', { class: 'small muted' }, t('Monthly invoice')) : null),
        h('td', { class: 'num' }, c.jobs)))))));
  };
  const editClient = async (c) => {
    const [svc, rates] = await Promise.all([loadServices(), A('GET', `/clients/${c.id}/rates`)]);
    const rate = Object.fromEntries(rates.rows.map((r) => [r.service_id, r]));
    const f = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const body = pick(f, 'c_');
      const rs = svc.map((s) => ({ service_id: s.id, price: f[`r_${s.id}`].value, sla_hours: f[`h_${s.id}`].value }));
      if (await run(async () => { await A('PUT', `/clients/${c.id}`, body); await A('PUT', `/clients/${c.id}/rates`, { rates: rs }); }, 'Saved')) { closeModal(); load(); }
    } }, h('h2', {}, c.name), clientFields(c),
    h('h3', {}, t('Negotiated rates (leave empty to use the price list)')),
    h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Service', 'Price excl. VAT (AED)', 'Report within (hours)'].map((x) => h('th', {}, t(x))))),
      h('tbody', {}, svc.map((s) => h('tr', {}, h('td', {}, s.name), h('td', {}, h('input', { name: `r_${s.id}`, class: 'ltr', inputmode: 'decimal', value: rate[s.id]?.price ?? '' })), h('td', {}, h('input', { name: `h_${s.id}`, class: 'ltr', inputmode: 'numeric', value: rate[s.id]?.sla_hours ?? '' }))))))),
    h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
    modal(f);
  };
  let tm;
  fill(el, h('div', { class: 'card' }, h('div', { class: 'actions' }, h('a', { class: 'btn alt sm', href: '#jobs' }, '‹ ', t('Jobs')), h('h1', {}, t('Clients')), h('span', { class: 'spacer' }), h('a', { class: 'btn alt sm', href: '/api/app/export/clients.xlsx', download: '' }, t('Export to Excel'))),
    h('div', { class: 'toolbar' }, h('input', { type: 'search', placeholder: t('Search'), oninput: (e) => { st.q = e.target.value.trim(); clearTimeout(tm); tm = setTimeout(load, 300); } })), box));
  await load();
}
