// Books (Super Admin): financial statements, expenses, owner / loan / VAT movements and equipment.
import { h, fill, t, fmtDay, num2, todayIso, toast } from '/js/common.js';
import { A, run, modal, closeModal, field } from '/js/app.js';

const amt = (v) => (v == null ? '' : v < 0 ? `(${num2(-v)})` : num2(v));
let META = null;
const meta = async () => (META ||= await A('GET', '/books/meta'));
const acctName = (code) => META?.accounts?.[code]?.[0] || code;
const iso = (d) => d.toISOString().slice(0, 10);

/** Period presets in Dubai dates. */
function presets(fyStart) {
  const today = todayIso();
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  const me = (yy, mm) => iso(new Date(Date.UTC(yy, mm + 1, 0)));
  const q0 = Math.floor(m / 3) * 3;
  const fyM = Number((fyStart || `${y}-01-01`).slice(5, 7)) - 1, fyY = Number((fyStart || `${y}-01-01`).slice(0, 4));
  return [
    ['This month', `${today.slice(0, 7)}-01`, today],
    ['Last month', iso(new Date(Date.UTC(y, m - 1, 1))), me(y, m - 1)],
    ['This quarter', iso(new Date(Date.UTC(y, q0, 1))), today],
    ['This financial year', iso(new Date(Date.UTC(fyY, fyM, 1))), today],
    ['Last financial year', iso(new Date(Date.UTC(fyY - 1, fyM, 1))), iso(new Date(Date.UTC(fyY, fyM, 0)))],
  ];
}

// ---------- statements ----------
export async function statementsView(el) {
  const M = await meta();
  const P = presets(M.fy_start);
  const st = { from: P[3][1], to: P[3][2], tab: 'income' };
  const from = h('input', { type: 'date', value: st.from, 'aria-label': t('From'), onchange: (e) => { st.from = e.target.value; load(); } });
  const to = h('input', { type: 'date', value: st.to, 'aria-label': t('To'), onchange: (e) => { st.to = e.target.value; load(); } });
  const pre = h('select', { 'aria-label': t('Period'), onchange: (e) => { const p = P[Number(e.target.value)]; if (!p) return; st.from = from.value = p[1]; st.to = to.value = p[2]; load(); } },
    P.map(([l], i) => h('option', { value: i, selected: i === 3 }, t(l))), h('option', { value: '' }, t('Custom')));
  const tabs = h('div', { class: 'tabs sub' });
  const box = h('div', {});
  const links = h('span', { class: 'actions' });
  let data = null;
  const drawTabs = () => tabs.replaceChildren(...[['income', 'Income statement'], ['balance', 'Balance sheet'], ['cashflow', 'Cash flow'], ['trial', 'Trial balance']]
    .map(([k, l]) => h('a', { href: '#', class: st.tab === k ? 'on' : '', onclick: (e) => { e.preventDefault(); st.tab = k; drawTabs(); draw(); } }, t(l))));
  async function load() {
    if (!st.from || !st.to) return;
    try { data = await A('GET', `/books/statements?from=${st.from}&to=${st.to}&as_of=${st.to}`); } catch (e) { fill(box, h('div', { class: 'alert bad' }, e.message)); return; }
    const q = `from=${st.from}&to=${st.to}&as_of=${st.to}`;
    links.replaceChildren(
      h('a', { class: 'btn alt sm', href: `/api/app/books/statements.pdf?${q}`, target: '_blank' }, t('PDF (all statements)')),
      h('a', { class: 'btn alt sm', href: `/api/app/books/statements.xlsx?${q}`, download: '' }, t('Excel (with journal)')));
    draw();
  }
  const table = (cols, rows) => h('div', { class: 'tablewrap' }, h('table', { class: 'stmt' }, h('thead', {}, h('tr', {}, cols.map((c, i) => h('th', { class: i ? 'num' : '' }, t(c))))), h('tbody', {}, rows)));
  const r = (label, vals, kind = '') => h('tr', { class: kind }, h('td', {}, label), ...[].concat(vals).map((v) => h('td', { class: 'num' }, v === null ? '' : amt(v))));
  function draw() {
    if (!data) return;
    const I = data.income, PV = data.previous;
    if (st.tab === 'income') {
      const block = (k, title, total, ptotal) => {
        const codes = [...new Set([...I[k], ...PV[k]].map((l) => l.code))];
        return [r(t(title), [null, null], 'grp'), ...codes.map((c) => r(`   ${t(acctName(c))}`, [I[k].find((l) => l.code === c)?.amount ?? 0, PV[k].find((l) => l.code === c)?.amount ?? 0])), r(t('Total {x}', { x: t(title).toLowerCase() }), [total, ptotal], 'sub')];
      };
      const pct = (v) => (v == null ? '' : ` (${v}%)`);
      fill(box, h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('b', {}, num2(I.net_revenue)), h('span', {}, t('Revenue (AED, excl. VAT)'))),
        h('div', { class: 'kpi' }, h('b', {}, num2(I.gross_profit)), h('span', {}, t('Gross profit') + pct(I.gross_margin))),
        h('div', { class: `kpi ${I.net_profit < 0 ? 'cu' : ''}` }, h('b', {}, amt(I.net_profit)), h('span', {}, t('Net profit') + pct(I.net_margin)))),
      table(['', `${fmtDay(I.from)} – ${fmtDay(I.to)}`, `${fmtDay(PV.from)} – ${fmtDay(PV.to)}`], [
        ...block('revenue', 'Revenue', I.net_revenue, PV.net_revenue), ...block('cogs', 'Cost of sales', I.cogs_total, PV.cogs_total),
        r(t('Gross profit') + pct(I.gross_margin), [I.gross_profit, PV.gross_profit], 'tot'),
        ...block('opex', 'Operating expenses', I.opex_total, PV.opex_total),
        r(t('Net profit') + pct(I.net_margin), [I.net_profit, PV.net_profit], 'tot')]),
      h('p', { class: 'small muted' }, t('Accrual basis: revenue when invoiced, inspector commissions when payable, expenses on the bill date, equipment depreciated monthly. Amounts exclude VAT. Corporate tax is not included.')));
    } else if (st.tab === 'balance') {
      const B = data.balance, T = B.totals;
      const lines = (arr) => arr.map((l) => r(`   ${t(l.name)}`, l.amount));
      fill(box, Math.abs(T.difference) > 0.009 ? h('div', { class: 'alert bad' }, t('Check: assets differ from liabilities and equity by AED {n}.', { n: num2(T.difference) })) : null,
        table(['', t('At {d}', { d: fmtDay(B.as_of) })], [
          r(t('Current assets'), null, 'grp'), ...lines(B.assets.current), r(t('Total current assets'), T.current_assets, 'sub'),
          r(t('Non-current assets'), null, 'grp'), ...lines(B.assets.non_current), r(t('Total non-current assets'), T.non_current_assets, 'sub'),
          r(t('TOTAL ASSETS'), T.assets, 'tot'),
          r(t('Current liabilities'), null, 'grp'), ...lines(B.liabilities.current), r(t('Total current liabilities'), T.current_liabilities, 'sub'),
          r(t('Non-current liabilities'), null, 'grp'), ...lines(B.liabilities.non_current),
          r(t('TOTAL LIABILITIES'), T.liabilities, 'sub'),
          r(t("Owner's equity"), null, 'grp'), ...lines(B.equity), r(t('TOTAL EQUITY'), T.equity, 'sub'),
          r(t('TOTAL LIABILITIES AND EQUITY'), T.liabilities_and_equity, 'tot')]),
        h('p', { class: 'small muted' }, t('The balance sheet is at the "To" date. The financial year started on {d} (Settings → Company details).', { d: fmtDay(B.fy_start) })));
    } else if (st.tab === 'cashflow') {
      const C = data.cashflow;
      const lines = (arr) => arr.map((l) => r(`   ${t(l.name)}`, l.amount));
      fill(box, table(['', `${fmtDay(C.from)} – ${fmtDay(C.to)}`], [
        r(t('Cash and bank at the start'), C.opening, 'sub'),
        r(t('Operating activities'), null, 'grp'), ...lines(C.operating), r(t('Net cash from operating activities'), C.totals.operating, 'sub'),
        r(t('Investing activities'), null, 'grp'), ...lines(C.investing), r(t('Net cash from investing activities'), C.totals.investing, 'sub'),
        r(t('Financing activities'), null, 'grp'), ...lines(C.financing), r(t('Net cash from financing activities'), C.totals.financing, 'sub'),
        r(t('Net change in cash'), C.net_change, 'sub'), r(t('Cash and bank at the end'), C.closing, 'tot'),
        r(t('For reference: net profit for the period'), C.net_profit)]),
      h('p', { class: 'small muted' }, t('Direct method: actual money in and out of the bank and cash accounts, including VAT.')));
    } else {
      const T = data.trial;
      fill(box, table(['Account', 'Debit', 'Credit'], [
        ...T.rows.map((x) => h('tr', {}, h('td', {}, h('span', { class: 'muted ltr' }, `${x.code} `), t(x.name)), h('td', { class: 'num' }, x.debit ? num2(x.debit) : ''), h('td', { class: 'num' }, x.credit ? num2(x.credit) : ''))),
        h('tr', { class: 'tot' }, h('td', {}, t('Total')), h('td', { class: 'num' }, num2(T.debit)), h('td', { class: 'num' }, num2(T.credit)))]),
      h('p', { class: 'small muted' }, t('At {d}. The journal with every entry is in the Excel file.', { d: fmtDay(T.as_of) })));
    }
  }
  drawTabs();
  fill(el, h('div', { class: 'card' },
    h('div', { class: 'actions' }, h('h1', {}, t('Financial statements')), h('span', { class: 'spacer' }), links),
    h('div', { class: 'toolbar' }, pre, from, to), tabs, box));
  await load();
}

// ---------- expenses ----------
export async function expensesView(el) {
  const M = await meta();
  const st = { from: `${todayIso().slice(0, 4)}-01-01`, to: todayIso(), account: '', unpaid: '' };
  const box = h('div', {});
  const accountSelect = (value, name = 'account') => h('select', { name, required: true }, h('option', { value: '' }, '-'),
    h('optgroup', { label: t('Cost of sales') }, M.expense_accounts.filter((c) => M.accounts[c][1] === 'cogs').map((c) => h('option', { value: c, selected: c === value }, t(M.accounts[c][0])))),
    h('optgroup', { label: t('Operating expenses') }, M.expense_accounts.filter((c) => M.accounts[c][1] === 'expense').map((c) => h('option', { value: c, selected: c === value }, t(M.accounts[c][0])))));
  async function load() {
    const d = await A('GET', `/books/expenses?${new URLSearchParams(Object.entries(st).filter(([, v]) => v))}`);
    const total = d.rows.reduce((a, x) => a + x.net, 0), unpaid = d.rows.filter((x) => !x.paid_on).reduce((a, x) => a + x.total, 0);
    fill(box, h('div', { class: 'kpis' }, h('div', { class: 'kpi' }, h('b', {}, num2(total)), h('span', {}, t('Expenses in the period (excl. VAT)'))), h('div', { class: `kpi ${unpaid ? 'cu' : ''}` }, h('b', {}, num2(unpaid)), h('span', {}, t('Not paid yet (incl. VAT)')))),
      d.rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Date', 'Type', 'Supplier', 'Excl. VAT', 'VAT', 'Paid', ''].map((x, i) => h('th', { class: i === 3 || i === 4 ? 'num' : '' }, t(x))))),
        h('tbody', {}, d.rows.map((x) => h('tr', { class: 'click', onclick: () => form(x) },
          h('td', { class: 'nowrap' }, fmtDay(x.date)), h('td', {}, t(x.account_name)), h('td', {}, x.supplier || '-', x.description ? h('div', { class: 'small muted' }, x.description) : null),
          h('td', { class: 'num' }, num2(x.net)), h('td', { class: 'num' }, x.vat ? num2(x.vat) : ''),
          h('td', {}, x.paid_on ? `${fmtDay(x.paid_on)} · ${t({ bank: 'Bank', cash: 'Cash', owner: 'Owner paid' }[x.paid_from])}` : h('span', { class: 'pill warn' }, t('Not paid'))),
          h('td', {}, x.file_id ? h('a', { class: 'btn alt sm', href: `/api/app/books/expenses/${x.id}/bill`, target: '_blank', onclick: (e) => e.stopPropagation() }, t('Bill')) : null)))))) : h('p', { class: 'muted' }, t('No expenses in this period.')));
  }
  function form(x = {}) {
    const fileIn = h('input', { type: 'file', accept: 'image/jpeg,image/png,application/pdf', name: 'bill' });
    const paidSel = h('select', { name: 'paid_from' }, [['', 'Not paid yet'], ['bank', 'Bank / card'], ['cash', 'Cash'], ['owner', 'Paid by the owner personally']].map(([k, l]) => h('option', { value: k, selected: (x.paid_from || '') === k }, t(l))));
    const f = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      delete v.bill;
      v.net = Number(v.net); v.vat = Number(v.vat || 0);
      const r = await run(() => (x.id ? A('PUT', `/books/expenses/${x.id}`, v) : A('POST', '/books/expenses', v)));
      if (!r) return;
      const eid = x.id || r.id;
      if (fileIn.files[0]) {
        const fl = fileIn.files[0];
        const res = await fetch(`/api/app/books/expenses/${eid}/bill?name=${encodeURIComponent(fl.name)}`, { method: 'POST', headers: { 'X-Requested-With': 'aral', 'Content-Type': fl.type }, body: fl });
        if (!res.ok) toast((await res.json().catch(() => ({}))).error || t('The bill could not be attached.'), 6000);
      }
      toast(t('Saved')); closeModal(); load();
    } }, h('h2', {}, t(x.id ? 'Expense' : 'Add an expense')),
    h('div', { class: 'grid2' },
      field('Bill date', h('input', { name: 'date', type: 'date', required: true, value: x.date || todayIso() })),
      field('Type of expense', accountSelect(x.account)),
      field('Supplier', h('input', { name: 'supplier', value: x.supplier || '' })),
      field('Supplier invoice no.', h('input', { name: 'reference', value: x.reference || '', class: 'ltr' })),
      field('Amount excl. VAT (AED)', h('input', { name: 'net', inputmode: 'decimal', required: true, class: 'ltr', value: x.net ?? '' })),
      field('VAT (AED)', h('input', { name: 'vat', inputmode: 'decimal', class: 'ltr', value: x.vat ?? '' }), M.vat_registered ? 'Recoverable input VAT from the tax invoice.' : 'Not VAT registered: put the full amount above and leave VAT empty.'),
      field('Paid from', paidSel),
      field('Paid on', h('input', { name: 'paid_on', type: 'date', value: x.paid_on || '' }), 'Empty = same as the bill date.')),
    field('Description', h('input', { name: 'description', value: x.description || '' })),
    field('Photo or PDF of the bill', fileIn, x.file_id ? 'A bill is attached; choosing a file replaces it.' : ''),
    h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save')),
      x.id ? h('button', { class: 'btn danger', type: 'button', onclick: () => voidIt('expenses', x.id, load) }, t('Remove')) : null,
      h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
    modal(f);
  }
  fill(el, h('div', { class: 'card' },
    h('div', { class: 'actions' }, h('h1', {}, t('Expenses')), h('span', { class: 'spacer' }), h('button', { class: 'btn cu', onclick: () => form() }, t('+ Add an expense'))),
    h('div', { class: 'toolbar' },
      h('input', { type: 'date', value: st.from, 'aria-label': t('From'), onchange: (e) => { st.from = e.target.value; load(); } }),
      h('input', { type: 'date', value: st.to, 'aria-label': t('To'), onchange: (e) => { st.to = e.target.value; load(); } }),
      (() => { const s = accountSelect('', 'filter'); s.required = false; s.firstChild.textContent = t('All types'); s.onchange = (e) => { st.account = e.target.value; load(); }; return s; })(),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { st.unpaid = e.target.checked ? '1' : ''; load(); } }), ' ', t('Not paid only'))),
    box));
  await load();
}

function voidIt(table, id, after) {
  const f = h('form', { onsubmit: async (e) => { e.preventDefault(); if (await run(() => A('POST', `/books/${table}/${id}/void`, { reason: f.reason.value }), 'Removed from the books')) { closeModal(); after(); } } },
    h('h2', {}, t('Remove from the books')), h('p', { class: 'small muted' }, t('It stays in the audit log.')), field('Reason', h('input', { name: 'reason', required: true })),
    h('p', { class: 'actions' }, h('button', { class: 'btn danger' }, t('Remove')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Back'))));
  modal(f);
}

// ---------- owner, loans and VAT ----------
export async function moneyView(el) {
  const M = await meta();
  const box = h('div', {});
  async function load() {
    const d = await A('GET', '/books/money');
    fill(box, d.rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Date', 'Type', 'Account', 'Amount (AED)', 'Note', ''].map((x) => h('th', {}, t(x))))),
      h('tbody', {}, d.rows.map((m) => h('tr', {}, h('td', { class: 'nowrap' }, fmtDay(m.date)), h('td', {}, t(m.kind_label)), h('td', {}, t(m.account === 'cash' ? 'Cash' : 'Bank')), h('td', { class: 'num' }, num2(m.amount)), h('td', {}, m.note),
        h('td', {}, h('button', { class: 'btn alt sm', onclick: () => voidIt('money', m.id, load) }, t('Remove')))))))) : h('p', { class: 'muted' }, t('Nothing recorded yet. Start with the capital you put into the business.')));
  }
  const add = () => {
    const f = h('form', { onsubmit: async (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); v.amount = Number(v.amount); if (await run(() => A('POST', '/books/money', v), 'Saved')) { closeModal(); load(); } } },
      h('h2', {}, t('Owner, loan or VAT movement')),
      h('div', { class: 'grid2' },
        field('Type', h('select', { name: 'kind' }, Object.entries(M.money_kinds).map(([k, [l]]) => h('option', { value: k }, t(l))))),
        field('Date', h('input', { name: 'date', type: 'date', required: true, value: todayIso() })),
        field('Amount (AED)', h('input', { name: 'amount', inputmode: 'decimal', required: true, class: 'ltr' })),
        field('Account', h('select', { name: 'account' }, h('option', { value: 'bank' }, t('Bank')), h('option', { value: 'cash' }, t('Cash'))))),
      field('Note', h('input', { name: 'note' })),
      h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
    modal(f);
  };
  fill(el, h('div', { class: 'card' }, h('div', { class: 'actions' }, h('h1', {}, t('Owner, loans and VAT')), h('span', { class: 'spacer' }), h('button', { class: 'btn cu', onclick: add }, t('+ Add'))),
    h('p', { class: 'small muted' }, t('Money the owner puts in or takes out, loans, and VAT paid to or refunded by the FTA. Client payments, expenses and commissions come from their own screens.')), box));
  await load();
}

// ---------- equipment ----------
export async function assetsView(el) {
  await meta();
  const box = h('div', {});
  async function load() {
    const d = await A('GET', '/books/assets');
    fill(box, d.rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Equipment', 'Bought', 'Cost', 'Per month', 'Depreciated', 'Book value', ''].map((x, i) => h('th', { class: i > 1 && i < 6 ? 'num' : '' }, t(x))))),
      h('tbody', {}, d.rows.map((a) => h('tr', {}, h('td', {}, a.name, h('div', { class: 'small muted' }, t('{n} months', { n: a.life_months }))), h('td', { class: 'nowrap' }, fmtDay(a.purchase_date)),
        h('td', { class: 'num' }, num2(a.cost)), h('td', { class: 'num' }, num2(a.monthly)), h('td', { class: 'num' }, num2(a.depreciated)), h('td', { class: 'num' }, num2(a.book_value)),
        h('td', {}, h('button', { class: 'btn alt sm', onclick: () => voidIt('assets', a.id, load) }, t('Remove')))))))) : h('p', { class: 'muted' }, t('No equipment yet. Add thermal cameras, moisture meters, laptops and vehicles.')));
  }
  const add = () => {
    const f = h('form', { onsubmit: async (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); for (const k of ['cost', 'vat', 'residual', 'life_months']) v[k] = Number(v[k] || 0); if (await run(() => A('POST', '/books/assets', v), 'Saved')) { closeModal(); load(); } } },
      h('h2', {}, t('Add equipment')),
      h('div', { class: 'grid2' },
        field('Name', h('input', { name: 'name', required: true, placeholder: 'FLIR E8 thermal camera' })),
        field('Purchase date', h('input', { name: 'purchase_date', type: 'date', required: true, value: todayIso() })),
        field('Cost excl. VAT (AED)', h('input', { name: 'cost', inputmode: 'decimal', required: true, class: 'ltr' })),
        field('VAT (AED)', h('input', { name: 'vat', inputmode: 'decimal', class: 'ltr' })),
        field('Useful life (months)', h('input', { name: 'life_months', inputmode: 'numeric', value: 36, class: 'ltr' }), 'Typical: tools 36, laptops 36, vehicles 60.'),
        field('Value at the end (AED)', h('input', { name: 'residual', inputmode: 'decimal', value: 0, class: 'ltr' })),
        field('Paid from', h('select', { name: 'paid_from' }, [['bank', 'Bank / card'], ['cash', 'Cash'], ['owner', 'Paid by the owner personally']].map(([k, l]) => h('option', { value: k }, t(l)))))),
      field('Note', h('input', { name: 'note' })),
      h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
    modal(f);
  };
  fill(el, h('div', { class: 'card' }, h('div', { class: 'actions' }, h('h1', {}, t('Equipment')), h('span', { class: 'spacer' }), h('button', { class: 'btn cu', onclick: add }, t('+ Add equipment'))),
    h('p', { class: 'small muted' }, t('Depreciated in equal amounts every month from the month of purchase.')), box));
  await load();
}
