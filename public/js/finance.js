// Finance: invoices (per job and monthly), credit notes, payments ledger, aging and inspector commissions.
import { h, fill, pill, t, fmtDay, num2, money, todayIso } from '/js/common.js';
import { S, A, can, run, modal, closeModal, field, confirmBox, go } from '/js/app.js';
import { paymentForm } from '/js/jobs.js';

const IKIND = { paid: 'ok', part_paid: 'warn', issued: 'attention', cancelled: '', draft: '' };
const SUB = [['invoices', 'Invoices'], ['payments', 'Payments'], ['aging', 'Aging'], ['commissions', 'Commissions']];

export async function financeView(el, parts) {
  const sub = parts[0] || 'invoices';
  const side = h('div', { class: 'tabs sub' }, SUB.filter(([k]) => k !== 'commissions' || can('commissions.manage') || can('finance.view')).map(([k, l]) => h('a', { class: sub === k || (sub === 'invoice' && k === 'invoices') ? 'on' : '', href: `#finance/${k}` }, t(l))));
  const body = h('div', {});
  fill(el, side, body);
  if (sub === 'invoice') return invoiceDetail(body, Number(parts[1]));
  if (sub === 'payments') return payments(body);
  if (sub === 'aging') return aging(body);
  if (sub === 'commissions') return commissions(body);
  return invoices(body);
}

async function invoices(el) {
  const st = { status: 'open', q: '' };
  const box = h('div', {});
  let clients = [];
  const load = async () => {
    const d = await A('GET', `/invoices?${new URLSearchParams(Object.entries(st).filter(([, v]) => v))}`);
    clients = d.clients;
    fill(box, d.rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Number', 'Client', 'Issued', 'Due', 'Total', 'Balance', 'Status'].map((x) => h('th', {}, t(x))))),
      h('tbody', {}, d.rows.map((i) => h('tr', { class: 'click', onclick: () => go(`finance/invoice/${i.id}`) },
        h('td', { class: 'ltr nowrap' }, i.number, i.kind === 'credit_note' ? h('div', { class: 'small muted' }, t('Credit note')) : i.is_tax_invoice ? h('div', { class: 'small muted' }, t('Tax invoice')) : null),
        h('td', {}, i.client_name), h('td', { class: 'nowrap' }, fmtDay(i.issue_date)), h('td', { class: 'nowrap' }, fmtDay(i.due_date)),
        h('td', { class: 'num' }, num2(i.total)), h('td', { class: 'num' }, i.balance ? num2(i.balance) : '-'),
        h('td', {}, pill(t(i.status), IKIND[i.status]), i.overdue_days ? h('div', {}, pill(t('{n} days overdue', { n: i.overdue_days }), 'bad')) : null)))))) : h('p', { class: 'muted' }, t('No invoices.')));
  };
  const monthly = () => {
    const f = h('form', { onsubmit: async (e) => { e.preventDefault(); const r = await run(() => A('POST', '/invoices/monthly', { client_id: Number(f.client.value), month: f.month.value }), 'Monthly invoice issued and emailed'); if (r) { closeModal(); go(`finance/invoice/${r.id}`); } } },
      h('h2', {}, t('Monthly invoice')), h('p', { class: 'small muted' }, t('Lists every report issued in the month that is not invoiced yet, with the bank reference.')),
      field('Client', h('select', { name: 'client', required: true }, clients.filter((c) => c.monthly_invoicing || c.credit_terms_days).map((c) => h('option', { value: c.id }, c.name)))),
      field('Month', h('input', { name: 'month', type: 'month', required: true, value: todayIso().slice(0, 7) })),
      h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Issue invoice')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
    modal(f);
  };
  let tm;
  fill(el, h('div', { class: 'card' },
    h('div', { class: 'actions' }, h('h1', {}, t('Invoices')), h('span', { class: 'spacer' }),
      h('a', { class: 'btn alt sm', href: '/api/app/export/invoices.xlsx', download: '' }, t('Export to Excel (with VAT summary)')),
      can('finance.manage') ? h('button', { class: 'btn cu', onclick: monthly }, t('+ Monthly invoice')) : null),
    h('div', { class: 'toolbar' },
      h('select', { 'aria-label': t('Status'), onchange: (e) => { st.status = e.target.value; load(); } }, [['open', 'Unpaid'], ['', 'All'], ['paid', 'Paid'], ['cancelled', 'Cancelled']].map(([k, l]) => h('option', { value: k }, t(l)))),
      h('input', { type: 'search', placeholder: t('Search number or client'), oninput: (e) => { st.q = e.target.value.trim(); clearTimeout(tm); tm = setTimeout(load, 300); } })),
    box));
  await load();
}

async function invoiceDetail(el, id) {
  const d = await A('GET', `/invoices/${id}`);
  const i = d.invoice;
  const reload = () => invoiceDetail(el, id);
  const M = can('finance.manage') && i.kind === 'invoice' && i.status !== 'cancelled';
  fill(el,
    h('div', { class: 'actions' }, h('a', { class: 'btn alt sm', href: '#finance/invoices' }, '‹ ', t('Invoices')), h('h1', { class: 'ltr' }, i.number), pill(t(i.status), IKIND[i.status])),
    h('div', { class: 'card actions' },
      h('a', { class: 'btn alt', href: `/api/app/invoices/${id}/pdf`, target: '_blank' }, 'PDF'),
      M && i.balance > 0 ? h('button', { class: 'btn cu', onclick: () => paymentForm(`/invoices/${id}/payment`, i.balance, reload) }, t('Record payment')) : null,
      M && i.balance > 0 ? h('button', { class: 'btn', onclick: async () => { const r = await run(() => A('POST', `/invoices/${id}/card-pay`)); if (r) location.href = r.url; } }, S.cfg.payments === 'mock' ? t('Pay by card (demo)') : t('Pay by card for the client')) : null,
      M ? h('button', { class: 'btn alt', onclick: async () => { await run(() => A('POST', `/invoices/${id}/send`), 'Emailed to the client'); } }, t('Email again')) : null,
      M ? h('button', { class: 'btn alt', onclick: credit }, t('Credit note')) : null,
      M && !i.paid ? h('button', { class: 'btn danger', onclick: cancel }, t('Cancel invoice')) : null),
    h('div', { class: 'card' }, h('dl', { class: 'kv' },
      [['Client', i.client_name], ['Type', i.kind === 'credit_note' ? t('Credit note') : i.is_tax_invoice ? t('Tax invoice') : t('Invoice')], ['Issued', fmtDay(i.issue_date)], ['Due', fmtDay(i.due_date)], ['Total', money(i.total)], ['Paid', money(i.paid)], ['Credit notes', i.credited ? money(i.credited) : ''], ['Balance', money(i.balance)], ['Pay online link', i.balance > 0 ? h('a', { href: i.pay_url, target: '_blank', class: 'ltr small' }, i.pay_url) : ''], ['Notes', i.notes]]
        .filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, t(k)), h('dd', {}, v)]))),
    h('div', { class: 'card' }, h('h2', {}, t('Lines')), h('div', { class: 'tablewrap' }, h('table', {}, h('tbody', {}, d.lines.map((l) => h('tr', {}, h('td', {}, l.job_id ? h('a', { href: `#jobs/${l.job_id}`, class: 'ltr' }, l.job_number) : ''), h('td', {}, l.description), h('td', { class: 'num' }, num2(l.amount)))))))),
    d.payments.length ? h('div', { class: 'card' }, h('h2', {}, t('Payments')), h('div', { class: 'tablewrap' }, h('table', {}, h('tbody', {}, d.payments.map((p) => h('tr', {}, h('td', {}, p.receipt_no), h('td', {}, fmtDay(p.paid_on)), h('td', {}, t(p.method), p.provider === 'mock' ? ' (demo)' : ''), h('td', { class: 'ltr small' }, p.provider_ref), h('td', { class: 'num' }, num2(p.amount)), h('td', {}, h('a', { class: 'btn alt sm', href: `/api/app/receipts/${p.id}/pdf`, target: '_blank' }, t('Receipt'))))))))) : null,
    d.credits.length ? h('div', { class: 'card' }, h('h2', {}, t('Credit notes')), d.credits.map((c) => h('p', {}, h('a', { href: `#finance/invoice/${c.id}`, class: 'ltr' }, c.number), ` · ${fmtDay(c.issue_date)} · ${money(c.total)} · ${c.notes}`))) : null);

  function credit() {
    const f = h('form', { onsubmit: async (e) => { e.preventDefault(); if (await run(() => A('POST', `/invoices/${id}/credit`, { amount: Number(f.amount.value), reason: f.reason.value }), 'Credit note issued')) { closeModal(); reload(); } } },
      h('h2', {}, t('Credit note')), field('Amount incl. VAT (AED)', h('input', { name: 'amount', inputmode: 'decimal', class: 'ltr', required: true })), field('Reason', h('input', { name: 'reason', required: true })),
      h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Issue credit note')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
    modal(f);
  }
  async function cancel() {
    const f = h('form', { onsubmit: async (e) => { e.preventDefault(); if (await run(() => A('POST', `/invoices/${id}/cancel`, { reason: f.reason.value }), 'Invoice cancelled')) { closeModal(); reload(); } } },
      h('h2', {}, t('Cancel invoice')), field('Reason', h('input', { name: 'reason', required: true })),
      h('p', { class: 'actions' }, h('button', { class: 'btn danger' }, t('Cancel invoice')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Back'))));
    modal(f);
  }
}

async function payments(el) {
  const st = { from: `${todayIso().slice(0, 7)}-01`, to: todayIso() };
  const box = h('div', {});
  const load = async () => {
    const d = await A('GET', `/payments?${new URLSearchParams(st)}`);
    const total = d.rows.reduce((a, p) => a + p.amount - p.refunded, 0);
    fill(box, h('p', {}, t('Total received'), ': ', h('b', {}, money(total))), d.rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Receipt', 'Date', 'Client', 'Method', 'For', 'Amount'].map((x) => h('th', {}, t(x))))),
      h('tbody', {}, d.rows.map((p) => h('tr', {}, h('td', {}, h('a', { href: `/api/app/receipts/${p.id}/pdf`, target: '_blank' }, p.receipt_no)), h('td', { class: 'nowrap' }, fmtDay(p.paid_on)), h('td', {}, p.client_name),
        h('td', {}, t(p.method), p.provider === 'mock' ? ' (demo)' : ''), h('td', { class: 'ltr' }, p.invoice_number || (p.quote_number ? `${p.quote_number}${p.quote_revision ? '-R' + p.quote_revision : ''}` : '')), h('td', { class: 'num' }, num2(p.amount))))))) : h('p', { class: 'muted' }, t('No payments in this period.')));
  };
  const q = `?from=${st.from}&to=${st.to}`;
  fill(el, h('div', { class: 'card' }, h('div', { class: 'actions' }, h('h1', {}, t('Payments')), h('span', { class: 'spacer' }), h('a', { class: 'btn alt sm', href: `/api/app/export/payments.xlsx${q}`, download: '' }, t('Export to Excel'))),
    h('div', { class: 'toolbar' }, h('input', { type: 'date', value: st.from, 'aria-label': t('From'), onchange: (e) => { st.from = e.target.value; load(); } }), h('input', { type: 'date', value: st.to, 'aria-label': t('To'), onchange: (e) => { st.to = e.target.value; load(); } })), box));
  await load();
}

async function aging(el) {
  const d = await A('GET', '/aging');
  const B = [['current', 'Not due'], ['d30', '1–30 days'], ['d60', '31–60'], ['d90', '61–90'], ['d90p', '90+']];
  fill(el, h('div', { class: 'card' }, h('div', { class: 'actions' }, h('h1', {}, t('Aging')), h('span', { class: 'spacer' }), h('a', { class: 'btn alt sm', href: '/api/app/export/aging.xlsx', download: '' }, t('Export to Excel'))),
    h('div', { class: 'kpis' }, B.map(([k, l]) => h('div', { class: `kpi ${k === 'd90p' || k === 'd90' ? 'cu' : ''}` }, h('b', {}, num2(d.buckets[k])), h('span', {}, t(l))))),
    d.clients.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, t('Client')), B.map(([, l]) => h('th', { class: 'num' }, t(l))), h('th', { class: 'num' }, t('Total')))),
      h('tbody', {}, d.clients.map((c) => h('tr', {}, h('td', {}, c.client_name), B.map(([k]) => h('td', { class: 'num' }, c[k] ? num2(c[k]) : '-')), h('td', { class: 'num' }, h('b', {}, num2(c.total)))))))) : h('p', { class: 'muted' }, t('Nothing outstanding.'))));
}

async function commissions(el) {
  const st = { month: todayIso().slice(0, 7), inspector_id: '', status: '' };
  const box = h('div', {});
  const ticked = new Set();
  let insps = [];
  const load = async () => {
    const d = await A('GET', `/commissions?${new URLSearchParams(Object.entries(st).filter(([, v]) => v))}`);
    insps = d.inspectors;
    if (insSel.options.length <= 1) insps.forEach((i) => insSel.append(h('option', { value: i.id }, i.name)));
    ticked.clear();
    const M = can('commissions.manage');
    const total = d.rows.filter((r) => r.status !== 'void').reduce((a, r) => a + r.amount + r.bonus, 0);
    fill(box, h('p', {}, t('Total'), ': ', h('b', {}, money(total))),
      d.rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, M ? h('th', {}) : null, ['Inspector', 'Job', 'Report', 'Fee excl. VAT', '%', 'Bonus', 'Commission', 'Status'].map((x) => h('th', {}, t(x))))),
        h('tbody', {}, d.rows.map((r) => h('tr', { class: r.status === 'void' ? 'off' : '' },
          M ? h('td', {}, r.status === 'payable' ? h('input', { type: 'checkbox', 'aria-label': t('Select'), onchange: (e) => (e.target.checked ? ticked.add(r.id) : ticked.delete(r.id)) }) : null) : null,
          h('td', {}, r.inspector_name), h('td', { class: 'ltr' }, h('a', { href: `#jobs/${r.job_id}` }, r.job_number)), h('td', { class: 'ltr' }, r.report_number || '-'),
          h('td', { class: 'num' }, num2(r.base_amount)), h('td', { class: 'num' }, r.pct),
          h('td', { class: 'num' }, M && r.status !== 'paid' ? h('input', { class: 'ltr mini', value: r.bonus, inputmode: 'decimal', onchange: async (e) => { await run(() => A('PUT', `/commissions/${r.id}`, { bonus: Number(e.target.value) }), 'Saved'); load(); } }) : num2(r.bonus)),
          h('td', { class: 'num' }, h('b', {}, num2(r.amount + r.bonus))),
          h('td', {}, pill(t(r.status), r.status === 'paid' ? 'ok' : r.status === 'payable' ? 'warn' : ''), r.paid_on ? h('div', { class: 'small muted' }, fmtDay(r.paid_on)) : null)))))) : h('p', { class: 'muted' }, t('No commissions for this selection.')),
      M ? h('p', { class: 'actions' }, h('button', { class: 'btn cu', onclick: pay }, t('Mark ticked as paid'))) : null);
  };
  const pay = async () => {
    if (!ticked.size) return run(async () => { throw new Error(t('Tick the commissions to pay.')); });
    if (!(await confirmBox('Mark as paid?', t('{n} commission(s) will be marked paid today.', { n: ticked.size }), 'Mark paid', false))) return;
    if (await run(() => A('POST', '/commissions/pay', { ids: [...ticked], paid_on: todayIso() }), 'Marked as paid')) load();
  };
  const insSel = h('select', { 'aria-label': t('Inspector'), onchange: (e) => { st.inspector_id = e.target.value; load(); } }, h('option', { value: '' }, t('All inspectors')));
  fill(el, h('div', { class: 'card' },
    h('div', { class: 'actions' }, h('h1', {}, t('Inspector commissions')), h('span', { class: 'spacer' }),
      h('a', { class: 'btn alt sm', href: '/api/app/export/commissions.xlsx', download: '' }, t('Export to Excel')),
      h('button', { class: 'btn alt sm', onclick: () => { if (!st.inspector_id) return run(async () => { throw new Error(t('Choose an inspector first.')); }); window.open(`/api/app/commissions/statement.pdf?inspector_id=${st.inspector_id}&month=${st.month}`, '_blank'); } }, t('Statement PDF'))),
    h('p', { class: 'small muted' }, t('Earned when the report is issued: the inspector share of the fee excluding VAT (default 42%).')),
    h('div', { class: 'toolbar' }, h('input', { type: 'month', value: st.month, 'aria-label': t('Month'), onchange: (e) => { st.month = e.target.value; load(); } }), insSel,
      h('select', { 'aria-label': t('Status'), onchange: (e) => { st.status = e.target.value; load(); } }, [['', 'All'], ['payable', 'payable'], ['paid', 'paid'], ['void', 'void']].map(([k, l]) => h('option', { value: k }, t(l))))),
    box));
  await load();
}
