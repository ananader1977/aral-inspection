// Books and financial statements (Super Admin only).
// The system already holds invoices, credit notes, payments and inspector commissions. With expenses, owner / loan /
// VAT movements and equipment added here, it builds a double-entry journal on the fly (nothing to post by hand) and
// from it the income statement, balance sheet, cash flow statement and trial balance. Because every entry balances,
// the balance sheet always balances.
//
// Basis: accrual. Revenue when the invoice is issued; inspector commission when it becomes payable; expenses on the
// bill date; equipment depreciated straight-line each month from the month of purchase. Amounts exclude VAT; VAT goes
// to one VAT account (output VAT on invoices less input VAT on expenses and equipment, less VAT paid to the FTA).
import { HttpError } from './http.js';
import { clampStr } from './util.js';
import { dateKey, parseDateKey, round2 } from './time.js';

/** Chart of accounts: code → [name, type]. type: asset, liability, equity, income, cogs, expense. */
export const ACCOUNTS = {
  1000: ['Bank', 'asset'],
  1010: ['Cash on hand', 'asset'],
  1100: ['Accounts receivable (clients)', 'asset'],
  1500: ['Equipment and vehicles (cost)', 'asset'],
  1590: ['Accumulated depreciation', 'asset'],
  2000: ['Accounts payable (suppliers)', 'liability'],
  2050: ['Inspector commissions payable', 'liability'],
  2100: ['VAT payable (output less input)', 'liability'],
  2200: ['Client advances (paid before invoice)', 'liability'],
  2300: ['Loans', 'liability'],
  3000: ['Owner capital', 'equity'],
  3100: ['Owner drawings', 'equity'],
  4000: ['Inspection revenue', 'income'],
  4900: ['Credit notes', 'income'],
  5000: ['Inspector commissions', 'cogs'],
  5100: ['Subcontractors and specialists', 'cogs'],
  5200: ['Inspection consumables and lab tests', 'cogs'],
  6000: ['Salaries and staff costs', 'expense'],
  6100: ['Rent', 'expense'],
  6150: ['Utilities, internet and phone', 'expense'],
  6200: ['Fuel, parking and transport', 'expense'],
  6250: ['Vehicle costs', 'expense'],
  6300: ['Marketing and advertising', 'expense'],
  6350: ['Software and subscriptions', 'expense'],
  6400: ['Licences and government fees', 'expense'],
  6450: ['Insurance', 'expense'],
  6500: ['Professional fees (legal, audit)', 'expense'],
  6550: ['Bank and card charges', 'expense'],
  6600: ['Equipment repairs and calibration', 'expense'],
  6650: ['Office supplies', 'expense'],
  6700: ['Training', 'expense'],
  6800: ['Other expenses', 'expense'],
  6900: ['Depreciation', 'expense'],
};
/** Accounts a bill can be booked to (depreciation and commissions are automatic). */
export const EXPENSE_ACCOUNTS = Object.keys(ACCOUNTS).filter((k) => ['cogs', 'expense'].includes(ACCOUNTS[k][1]) && !['5000', '6900'].includes(k));
const CASH = { bank: '1000', cash: '1010', owner: '3000' };
const PAY_METHOD_CASH = { cash: '1010', card: '1000', bank_transfer: '1000', cheque: '1000' };
export const MONEY_KINDS = {
  capital: ['Capital paid in by the owner', 'financing'],
  drawing: ['Owner drawing', 'financing'],
  loan_in: ['Loan received', 'financing'],
  loan_repay: ['Loan repayment', 'financing'],
  vat_paid: ['VAT paid to the FTA', 'operating'],
  vat_refund: ['VAT refund from the FTA', 'operating'],
};
// cash flow lines (direct method)
const CF = {
  clients: ['operating', 'Received from clients'],
  suppliers: ['operating', 'Paid to suppliers and for expenses'],
  commissions: ['operating', 'Paid to inspectors (commissions)'],
  vat: ['operating', 'VAT paid to / refunded by the FTA'],
  assets: ['investing', 'Equipment and vehicles bought'],
  capital: ['financing', 'Capital paid in by the owner'],
  drawing: ['financing', 'Owner drawings'],
  loans: ['financing', 'Loans received less repaid'],
};

const dmy = (d) => d.split('-').reverse().join('/');
const isDate = (s) => typeof s === 'string' && parseDateKey(s) !== null;
const monthEnd = (y, m) => new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10); // m: 0-11
const prevDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const num = (v, what) => { const n = round2(Number(v)); if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${what}: enter an amount.`); return n; };

export function createAccounts(ctx) {
  const { db } = ctx;
  const audit = (...a) => ctx.admin.audit(...a);
  const today = () => dateKey(ctx.now());

  // ---------- journal ----------
  /** Every accounting entry up to `asOf` (inclusive): { date, ref, memo, cf, lines: [{ acct, dr, cr }] }. */
  function journal(asOf = today()) {
    const E = [];
    const add = (date, ref, memo, lines, cf = null) => { if (date && date <= asOf) E.push({ date, ref, memo, cf, lines: lines.filter((l) => Math.abs(l.dr || l.cr) > 0.0001) }); };
    const dr = (acct, v) => ({ acct: String(acct), dr: round2(v), cr: 0 });
    const cr = (acct, v) => ({ acct: String(acct), dr: 0, cr: round2(v) });

    const inv = new Map();
    for (const i of db.prepare("SELECT i.*, c.name client FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.status NOT IN ('cancelled','draft')").all()) {
      inv.set(i.id, i);
      if (i.kind === 'invoice') add(i.issue_date, i.number, `Invoice to ${i.client}`, [dr(1100, i.total), cr(4000, i.net), cr(2100, i.vat)]);
      else add(i.issue_date, i.number, `Credit note to ${i.client}`, [dr(4900, i.net), dr(2100, i.vat), cr(1100, i.total)]);
    }
    for (const p of db.prepare('SELECT p.*, c.name client FROM payments p JOIN clients c ON c.id=p.client_id').all()) {
      const amt = round2(p.amount - (p.refunded || 0));
      if (amt <= 0) continue;
      const cash = PAY_METHOD_CASH[p.method] || '1000';
      const i = p.invoice_id && inv.get(p.invoice_id);
      const ref = p.receipt_no || `RC-${p.id}`;
      if (i && i.issue_date <= p.paid_on) add(p.paid_on, ref, `Payment from ${p.client} (${i.number})`, [dr(cash, amt), cr(1100, amt)], 'clients');
      else {
        add(p.paid_on, ref, `Advance payment from ${p.client}`, [dr(cash, amt), cr(2200, amt)], 'clients');
        if (i) add(i.issue_date, i.number, `Advance from ${p.client} applied to ${i.number}`, [dr(2200, amt), cr(1100, amt)]);
      }
    }
    for (const c of db.prepare("SELECT c.*, i.name inspector, j.number job FROM commissions c JOIN inspectors i ON i.id=c.inspector_id JOIN jobs j ON j.id=c.job_id WHERE c.status IN ('payable','paid')").all()) {
      const amt = round2(c.amount + (c.bonus || 0));
      const on = c.payable_on || (c.statement_month ? `${c.statement_month}-01` : null);
      add(on, c.job, `Commission ${c.inspector}`, [dr(5000, amt), cr(2050, amt)]);
      if (c.status === 'paid' && c.paid_on) add(c.paid_on, c.job, `Commission paid to ${c.inspector}`, [dr(2050, amt), cr(1000, amt)], 'commissions');
    }
    for (const x of db.prepare('SELECT * FROM expenses WHERE void=0').all()) {
      const ref = `EXP-${x.id}`, memo = [x.supplier, x.description].filter(Boolean).join(': ') || ACCOUNTS[x.account]?.[0];
      const total = round2(x.net + x.vat);
      const lines = [dr(x.account, x.net), dr(2100, x.vat)];
      if (x.paid_from && x.paid_on && x.paid_on <= x.date) add(x.date, ref, memo, [...lines, cr(CASH[x.paid_from], total)], x.paid_from === 'owner' ? null : 'suppliers');
      else {
        add(x.date, ref, memo, [...lines, cr(2000, total)]);
        if (x.paid_from && x.paid_on) add(x.paid_on, ref, `Paid: ${memo}`, [dr(2000, total), cr(CASH[x.paid_from], total)], x.paid_from === 'owner' ? null : 'suppliers');
      }
    }
    for (const m of db.prepare('SELECT * FROM money_entries WHERE void=0').all()) {
      const cash = CASH[m.account], ref = `MOV-${m.id}`, memo = m.note || MONEY_KINDS[m.kind][0];
      const L = { capital: [dr(cash, m.amount), cr(3000, m.amount)], drawing: [dr(3100, m.amount), cr(cash, m.amount)], loan_in: [dr(cash, m.amount), cr(2300, m.amount)],
        loan_repay: [dr(2300, m.amount), cr(cash, m.amount)], vat_paid: [dr(2100, m.amount), cr(cash, m.amount)], vat_refund: [dr(cash, m.amount), cr(2100, m.amount)] }[m.kind];
      add(m.date, ref, memo, L, { capital: 'capital', drawing: 'drawing', loan_in: 'loans', loan_repay: 'loans', vat_paid: 'vat', vat_refund: 'vat' }[m.kind]);
    }
    for (const a of db.prepare('SELECT * FROM fixed_assets WHERE void=0').all()) {
      const ref = `FA-${a.id}`, src = CASH[a.paid_from], own = a.paid_from === 'owner';
      add(a.purchase_date, ref, `Bought: ${a.name}`, [dr(1500, a.cost), cr(src, a.cost)], own ? null : 'assets');
      if (a.vat > 0) add(a.purchase_date, ref, `VAT on ${a.name}`, [dr(2100, a.vat), cr(src, a.vat)], own ? null : 'suppliers');
      // straight-line depreciation at each month end, from the month of purchase
      const per = round2((a.cost - a.residual) / Math.max(1, a.life_months));
      let y = Number(a.purchase_date.slice(0, 4)), m = Number(a.purchase_date.slice(5, 7)) - 1, done = 0;
      const total = round2(a.cost - a.residual);
      while (done < a.life_months) {
        const end = monthEnd(y, m);
        if (end > asOf) break;
        const v = done === a.life_months - 1 ? round2(total - per * done) : per; // last month takes the rounding
        add(end, ref, `Depreciation: ${a.name}`, [dr(6900, v), cr(1590, v)]);
        done++; m++; if (m === 12) { m = 0; y++; }
      }
    }
    E.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return E;
  }

  /** Balances (debit minus credit) per account; optional date window [from, to]. */
  function balances(entries, from = '0000-00-00', to = '9999-12-31') {
    const b = {};
    for (const e of entries) {
      if (e.date < from || e.date > to) continue;
      for (const l of e.lines) b[l.acct] = round2((b[l.acct] || 0) + l.dr - l.cr);
    }
    return b;
  }
  const fyStart = (d) => {
    const sm = Math.min(12, Math.max(1, Number(ctx.settings().fy_start_month) || 1));
    const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
    return `${m >= sm ? y : y - 1}-${String(sm).padStart(2, '0')}-01`;
  };
  const checkPeriod = (from, to) => {
    if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'Choose the period (from and to dates).');
    if (from > to) throw new HttpError(400, 'The start date is after the end date.');
  };
  const line = (code, amount) => ({ code: String(code), name: ACCOUNTS[code][0], amount: round2(amount) });

  // ---------- income statement ----------
  function profitFor(b) {
    const sum = (type, sign) => Object.entries(b).filter(([k]) => ACCOUNTS[k]?.[1] === type).reduce((a, [, v]) => a + sign * v, 0);
    return round2(sum('income', -1) - sum('cogs', 1) - sum('expense', 1));
  }
  function incomeStatement(from, to, entries = journal(to)) {
    checkPeriod(from, to);
    const b = balances(entries, from, to);
    const pick = (type) => Object.keys(ACCOUNTS).filter((k) => ACCOUNTS[k][1] === type && Math.abs(b[k] || 0) > 0.004).map((k) => line(k, type === 'income' ? -(b[k] || 0) : b[k] || 0));
    const revenue = pick('income');
    const netRevenue = round2(revenue.reduce((a, l) => a + l.amount, 0));
    const cogs = pick('cogs'); const cogsTotal = round2(cogs.reduce((a, l) => a + l.amount, 0));
    const opex = pick('expense'); const opexTotal = round2(opex.reduce((a, l) => a + l.amount, 0));
    const gross = round2(netRevenue - cogsTotal);
    const net = round2(gross - opexTotal);
    return { from, to, revenue, net_revenue: netRevenue, cogs, cogs_total: cogsTotal, gross_profit: gross, gross_margin: netRevenue ? round2((gross / netRevenue) * 100) : null,
      opex, opex_total: opexTotal, net_profit: net, net_margin: netRevenue ? round2((net / netRevenue) * 100) : null };
  }
  /** The same dates one year earlier, for comparison ("same period last year"). */
  function previousPeriod(from, to) {
    const back = (d) => { const y = Number(d.slice(0, 4)) - 1; const md = d.slice(5); return md === '02-29' ? `${y}-02-28` : `${y}-${md}`; };
    return { from: back(from), to: back(to) };
  }

  // ---------- balance sheet ----------
  function balanceSheet(asOf, entries = journal(asOf)) {
    if (!isDate(asOf)) throw new HttpError(400, 'Choose the date.');
    const b = balances(entries, '0000-00-00', asOf);
    const v = (k) => b[k] || 0;
    const fy = fyStart(asOf);
    const retained = profitFor(balances(entries, '0000-00-00', prevDay(fy)));
    const current = profitFor(balances(entries, fy, asOf));
    const vat = v(2100), ar = v(1100);
    const assets = {
      current: [line(1000, v(1000)), line(1010, v(1010)), ...(ar >= 0 ? [line(1100, ar)] : []), ...(vat > 0 ? [{ code: '2100', name: 'VAT refundable', amount: round2(vat) }] : [])],
      non_current: [line(1500, v(1500)), { ...line(1590, v(1590)), name: 'Less: accumulated depreciation' }],
    };
    const liabilities = {
      current: [line(2000, -v(2000)), line(2050, -v(2050)), ...(vat <= 0 ? [line(2100, -vat)] : []), line(2200, -v(2200)), ...(ar < 0 ? [{ code: '1100', name: 'Credits owed to clients', amount: round2(-ar) }] : [])],
      non_current: [line(2300, -v(2300))],
    };
    const equity = [line(3000, -v(3000)), { ...line(3100, -v(3100)), name: 'Less: owner drawings' }, { code: '3900', name: `Retained earnings (before ${dmy(fy)})`, amount: retained }, { code: '3950', name: `Profit this financial year (from ${dmy(fy)})`, amount: current }];
    const nz = (arr) => arr.filter((l) => l.code === '1000' || Math.abs(l.amount) > 0.004);
    assets.current = nz(assets.current); assets.non_current = nz(assets.non_current);
    liabilities.current = nz(liabilities.current); liabilities.non_current = nz(liabilities.non_current);
    const sum = (arr) => round2(arr.reduce((a, l) => a + l.amount, 0));
    const ta = round2(sum(assets.current) + sum(assets.non_current));
    const tl = round2(sum(liabilities.current) + sum(liabilities.non_current));
    const te = sum(equity);
    return { as_of: asOf, fy_start: fy, assets, liabilities, equity, totals: { current_assets: sum(assets.current), non_current_assets: sum(assets.non_current), assets: ta,
      current_liabilities: sum(liabilities.current), non_current_liabilities: sum(liabilities.non_current), liabilities: tl, equity: te, liabilities_and_equity: round2(tl + te), difference: round2(ta - tl - te) } };
  }

  // ---------- cash flow (direct method) ----------
  function cashFlow(from, to, entries = journal(to)) {
    checkPeriod(from, to);
    const cashOf = (b) => round2((b[1000] || 0) + (b[1010] || 0));
    const opening = cashOf(balances(entries, '0000-00-00', prevDay(from)));
    const closing = cashOf(balances(entries, '0000-00-00', to));
    const by = {};
    for (const e of entries) {
      if (e.date < from || e.date > to) continue;
      const c = e.lines.reduce((a, l) => (l.acct === '1000' || l.acct === '1010' ? a + l.dr - l.cr : a), 0);
      if (Math.abs(c) < 0.0001) continue;
      const k = e.cf || 'suppliers';
      by[k] = round2((by[k] || 0) + c);
    }
    const section = (name) => Object.keys(CF).filter((k) => CF[k][0] === name && by[k]).map((k) => ({ key: k, name: CF[k][1], amount: by[k] }));
    const sections = { operating: section('operating'), investing: section('investing'), financing: section('financing') };
    const tot = (s) => round2(s.reduce((a, l) => a + l.amount, 0));
    const net = round2(tot(sections.operating) + tot(sections.investing) + tot(sections.financing));
    return { from, to, opening, ...sections, totals: { operating: tot(sections.operating), investing: tot(sections.investing), financing: tot(sections.financing) }, net_change: net, closing,
      difference: round2(opening + net - closing), net_profit: incomeStatement(from, to, entries).net_profit };
  }

  /** Trial balance as at a date: every account with its debit or credit balance. */
  function trialBalance(asOf, entries = journal(asOf)) {
    const b = balances(entries, '0000-00-00', asOf);
    const rows = Object.keys(ACCOUNTS).filter((k) => Math.abs(b[k] || 0) > 0.004).map((k) => ({ code: k, name: ACCOUNTS[k][0], type: ACCOUNTS[k][1], debit: b[k] > 0 ? b[k] : 0, credit: b[k] < 0 ? -b[k] : 0 }));
    return { as_of: asOf, rows, debit: round2(rows.reduce((a, r) => a + r.debit, 0)), credit: round2(rows.reduce((a, r) => a + r.credit, 0)) };
  }
  /** Journal lines in a period (for the accountant / auditor). */
  function ledger(from, to, entries = journal(to)) {
    checkPeriod(from, to);
    return entries.filter((e) => e.date >= from).flatMap((e) => e.lines.map((l) => ({ date: e.date, ref: e.ref, memo: e.memo, code: l.acct, account: ACCOUNTS[l.acct]?.[0] || l.acct, debit: l.dr, credit: l.cr })));
  }

  // ---------- expenses ----------
  function cleanExpense(b, before = {}) {
    const v = {
      date: b.date ?? before.date, account: String(b.account ?? before.account ?? ''), supplier: clampStr(b.supplier ?? before.supplier, 120), description: clampStr(b.description ?? before.description, 300),
      reference: clampStr(b.reference ?? before.reference, 60), net: num(b.net ?? before.net, 'Amount'), vat: num(b.vat ?? before.vat ?? 0, 'VAT'),
      paid_from: (b.paid_from === undefined ? before.paid_from : b.paid_from) || null, paid_on: (b.paid_on === undefined ? before.paid_on : b.paid_on) || null, job_id: b.job_id === undefined ? before.job_id ?? null : Number(b.job_id) || null,
    };
    if (!isDate(v.date)) throw new HttpError(400, 'Bill date: use the date picker.');
    if (!EXPENSE_ACCOUNTS.includes(v.account)) throw new HttpError(400, 'Choose the type of expense.');
    if (!(v.net > 0)) throw new HttpError(400, 'Amount: enter the amount excluding VAT.');
    if (v.paid_from && !CASH[v.paid_from]) throw new HttpError(400, 'Choose how it was paid.');
    if (v.paid_from && !v.paid_on) v.paid_on = v.date;
    if (!v.paid_from) v.paid_on = null;
    if (v.paid_on && !isDate(v.paid_on)) throw new HttpError(400, 'Paid on: use the date picker.');
    if (v.paid_on && v.paid_on < v.date) v.paid_on = v.date;
    return v;
  }
  function listExpenses(q = {}) {
    const where = ['e.void=0'], args = [];
    if (isDate(q.from)) { where.push('e.date>=?'); args.push(q.from); }
    if (isDate(q.to)) { where.push('e.date<=?'); args.push(q.to); }
    if (q.account) { where.push('e.account=?'); args.push(String(q.account)); }
    if (q.unpaid === '1') where.push('e.paid_on IS NULL');
    if (q.q) { where.push('(e.supplier LIKE ? OR e.description LIKE ? OR e.reference LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
    return db.prepare(`SELECT e.*, j.number job_number FROM expenses e LEFT JOIN jobs j ON j.id=e.job_id WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.id DESC LIMIT 2000`).all(...args)
      .map((e) => ({ ...e, account_name: ACCOUNTS[e.account]?.[0] || e.account, total: round2(e.net + e.vat) }));
  }
  function addExpense(user, b) {
    const v = cleanExpense(b);
    const id = Number(db.prepare('INSERT INTO expenses(date,account,supplier,description,reference,net,vat,paid_from,paid_on,job_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(v.date, v.account, v.supplier, v.description, v.reference, v.net, v.vat, v.paid_from, v.paid_on, v.job_id, user.id, ctx.now()).lastInsertRowid);
    audit(user, 'expenses', id, 'create', null, v);
    return id;
  }
  function updateExpense(user, id, b) {
    const before = db.prepare('SELECT * FROM expenses WHERE id=? AND void=0').get(id);
    if (!before) throw new HttpError(404, 'Expense not found');
    const v = cleanExpense(b, before);
    db.prepare('UPDATE expenses SET date=?,account=?,supplier=?,description=?,reference=?,net=?,vat=?,paid_from=?,paid_on=?,job_id=? WHERE id=?')
      .run(v.date, v.account, v.supplier, v.description, v.reference, v.net, v.vat, v.paid_from, v.paid_on, v.job_id, id);
    audit(user, 'expenses', id, 'update', before, v);
  }
  async function attachBill(user, id, { buf, mime, name }) {
    const e = db.prepare('SELECT * FROM expenses WHERE id=? AND void=0').get(id);
    if (!e) throw new HttpError(404, 'Expense not found');
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(mime || '')) throw new HttpError(400, 'Attach a photo (JPG, PNG) or a PDF of the bill.');
    if (!buf?.length || buf.length > 15 * 1024 * 1024) throw new HttpError(400, 'The file is empty or larger than 15 MB.');
    const fileId = await ctx.storage.save({ name: clampStr(name, 120) || `bill-${id}`, mime, buf, purpose: 'expense', userId: user.id });
    db.prepare('UPDATE expenses SET file_id=? WHERE id=?').run(fileId, id);
    audit(user, 'expenses', id, 'attach', null, { fileId });
    return fileId;
  }

  // ---------- owner / loan / VAT movements ----------
  function listMoney() { return db.prepare('SELECT * FROM money_entries WHERE void=0 ORDER BY date DESC, id DESC').all().map((m) => ({ ...m, kind_label: MONEY_KINDS[m.kind][0] })); }
  function addMoney(user, b) {
    if (!MONEY_KINDS[b.kind]) throw new HttpError(400, 'Choose the type of movement.');
    if (!isDate(b.date)) throw new HttpError(400, 'Date: use the date picker.');
    const amount = num(b.amount, 'Amount');
    if (!(amount > 0)) throw new HttpError(400, 'Amount: enter the amount.');
    const account = b.account === 'cash' ? 'cash' : 'bank';
    const id = Number(db.prepare('INSERT INTO money_entries(date,kind,amount,account,note,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(b.date, b.kind, amount, account, clampStr(b.note, 300), user.id, ctx.now()).lastInsertRowid);
    audit(user, 'money_entries', id, 'create', null, { ...b, amount });
    return id;
  }

  // ---------- equipment ----------
  function listAssets(asOf = today()) {
    const entries = journal(asOf);
    return db.prepare('SELECT * FROM fixed_assets WHERE void=0 ORDER BY purchase_date DESC, id DESC').all().map((a) => {
      const dep = round2(entries.filter((e) => e.ref === `FA-${a.id}`).reduce((s, e) => s + e.lines.filter((l) => l.acct === '1590').reduce((x, l) => x + l.cr, 0), 0));
      return { ...a, depreciated: dep, book_value: round2(a.cost - dep), monthly: round2((a.cost - a.residual) / Math.max(1, a.life_months)) };
    });
  }
  function addAsset(user, b) {
    const name = clampStr(b.name, 120);
    if (!name) throw new HttpError(400, 'Name the equipment.');
    if (!isDate(b.purchase_date)) throw new HttpError(400, 'Purchase date: use the date picker.');
    const cost = num(b.cost, 'Cost'), vat = num(b.vat ?? 0, 'VAT'), residual = num(b.residual ?? 0, 'Value at the end');
    if (!(cost > 0)) throw new HttpError(400, 'Cost: enter the price excluding VAT.');
    if (residual >= cost) throw new HttpError(400, 'The value at the end must be less than the cost.');
    const life = Math.round(Number(b.life_months) || 36);
    if (life < 1 || life > 480) throw new HttpError(400, 'Useful life: between 1 and 480 months.');
    const paid = CASH[b.paid_from] ? b.paid_from : 'bank';
    const id = Number(db.prepare('INSERT INTO fixed_assets(name,purchase_date,cost,vat,life_months,residual,paid_from,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(name, b.purchase_date, cost, vat, life, residual, paid, clampStr(b.note, 300), user.id, ctx.now()).lastInsertRowid);
    audit(user, 'fixed_assets', id, 'create', null, { name, cost, vat, life, residual, paid });
    return id;
  }

  /** Removes an expense, movement or equipment entry from the books (kept in the database and the audit log). */
  function voidEntry(user, table, id, reason) {
    const T = { expenses: 'expenses', money: 'money_entries', assets: 'fixed_assets' }[table];
    if (!T) throw new HttpError(404, 'Not found');
    if (!clampStr(reason, 200)) throw new HttpError(400, 'Give the reason for removing it.');
    const n = db.prepare(`UPDATE ${T} SET void=1 WHERE id=? AND void=0`).run(id).changes;
    if (!n) throw new HttpError(404, 'Not found');
    audit(user, T, id, 'void', null, { reason: clampStr(reason, 200) });
  }

  return { journal, balances, incomeStatement, previousPeriod, balanceSheet, cashFlow, trialBalance, ledger, listExpenses, addExpense, updateExpense, attachBill, listMoney, addMoney, listAssets, addAsset, voidEntry, fyStart };
}
