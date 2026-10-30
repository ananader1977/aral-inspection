// Financial statements: income statement, balance sheet, cash flow and trial balance (Super Admin only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, SA } from './helpers.js';

test('statements from invoices, payments, commissions, expenses, owner money and equipment', async () => {
  const t = await startTestApp();
  const { ctx, call } = t;
  try {
    await t.login('sa', SA.email, SA.password);
    const db = ctx.db;
    db.prepare("INSERT INTO settings(key,value) VALUES('vat_registered','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
    db.prepare("INSERT INTO settings(key,value) VALUES('vat_rate','5') ON CONFLICT(key) DO UPDATE SET value='5'").run();
    const sa = { id: 1 };
    // owner puts in 50,000 on 1 Oct; laptop + camera bought for 12,000 + VAT, 24 months
    assert.equal((await call('sa', 'POST', '/api/app/books/money', { date: '2026-10-01', kind: 'capital', amount: 50000, note: 'Opening capital' })).status, 200);
    const fa = await call('sa', 'POST', '/api/app/books/assets', { name: 'Thermal camera FLIR', purchase_date: '2026-09-15', cost: 12000, vat: 600, life_months: 24, paid_from: 'bank' });
    assert.equal(fa.status, 200, JSON.stringify(fa.body));
    // client invoice 2,000 + VAT on 5 Oct, paid 2,100 on 10 Oct; second invoice 1,000 + VAT unpaid; credit note 105
    const cid = Number(db.prepare("INSERT INTO clients(type,name,mobile,created_at) VALUES('individual','Sara','+971501234567',?)").run(t.clock.now()).lastInsertRowid);
    t.clock.advance(-16 * 86400e3); // 5 Oct
    const inv1 = ctx.finance.createInvoice(sa, { client_id: cid, lines: [{ description: 'Inspection', qty: 1, unit_price: 2000, amount: 2000 }] });
    const inv2 = ctx.finance.createInvoice(sa, { client_id: cid, lines: [{ description: 'Inspection 2', qty: 1, unit_price: 1000, amount: 1000 }] });
    t.clock.advance(16 * 86400e3);
    await ctx.finance.recordInvoicePayment(sa, inv1, { method: 'bank_transfer', amount: 2100, paid_on: '2026-10-10' });
    ctx.finance.creditNote({ id: 1 }, inv2, { amount: 105, reason: 'Goodwill' });
    // advance payment for a quotation not invoiced yet: 500 cash
    db.prepare("INSERT INTO payments(client_id,method,amount,paid_on,created_at) VALUES(?,?,?,?,?)").run(cid, 'cash', 500, '2026-10-12', t.clock.now());
    // inspector commission 840 payable, 400 of another paid
    const ins = Number(db.prepare("INSERT INTO inspectors(name,created_at) VALUES('Eng. A',?)").run(t.clock.now()).lastInsertRowid);
    const prop = Number(db.prepare("INSERT INTO properties(property_type,created_at) VALUES('apartment',?)").run(t.clock.now()).lastInsertRowid);
    const svc = db.prepare('SELECT id FROM services LIMIT 1').get().id;
    const job = (n) => Number(db.prepare("INSERT INTO jobs(number,client_id,property_id,service_id,status,created_at,updated_at,client_kind) VALUES(?,?,?,?,'closed',?,?,'individual')").run(n, cid, prop, svc, 1, 1).lastInsertRowid);
    db.prepare("INSERT INTO commissions(inspector_id,job_id,base_amount,pct,amount,status,payable_on) VALUES(?,?,2000,42,840,'payable','2026-10-06')").run(ins, job('J1'));
    db.prepare("INSERT INTO commissions(inspector_id,job_id,base_amount,pct,amount,status,payable_on,paid_on) VALUES(?,?,1000,40,400,'paid','2026-10-06','2026-10-15')").run(ins, job('J2'));
    // expenses: rent 3,000 paid from bank; fuel 200 + 10 VAT unpaid; licence 1,500 paid by the owner personally
    for (const e of [{ date: '2026-10-02', account: '6100', supplier: 'Landlord', net: 3000, paid_from: 'bank' }, { date: '2026-10-08', account: '6200', supplier: 'ENOC', net: 200, vat: 10 }, { date: '2026-10-03', account: '6400', supplier: 'DET', net: 1500, paid_from: 'owner' }]) {
      const r = await call('sa', 'POST', '/api/app/books/expenses', e); assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    assert.equal((await call('sa', 'POST', '/api/app/books/expenses', { date: '2026-10-02', account: '6900', net: 5 })).status, 400, 'depreciation is automatic');

    const s = (await call('sa', 'GET', '/api/app/books/statements?from=2026-10-01&to=2026-10-31&as_of=2026-10-31')).body;
    const I = s.income;
    assert.equal(I.net_revenue, 2900);          // 2000 + 1000 - 100 credit (excl. VAT)
    assert.equal(I.cogs_total, 1240);           // commissions
    assert.equal(I.gross_profit, 1660);
    assert.equal(I.opex.find((l) => l.code === '6900').amount, 500); // 12,000 / 24 for October
    assert.equal(I.opex_total, 5200);           // 3000 + 200 + 1500 + 500
    assert.equal(I.net_profit, -3540);
    const B = s.balance;
    assert.equal(B.totals.difference, 0, JSON.stringify(B.totals));
    const val = (arr, code) => arr.find((l) => l.code === code)?.amount;
    // bank: +50,000 -12,600 (Sept, before the capital: goes negative then up) +2,100 -400 -3,000
    assert.equal(val(B.assets.current, '1000'), 36100);
    assert.equal(val(B.assets.current, '1010'), 500);
    assert.equal(val(B.assets.current, '1100'), 945);            // 1,050 - 105
    assert.equal(val(B.assets.non_current, '1590'), -1000);      // Sept + Oct depreciation
    assert.equal(val(B.liabilities.current, '2000'), 210);
    assert.equal(val(B.liabilities.current, '2050'), 840);
    assert.equal(val(B.liabilities.current, '2200'), 500);
    assert.equal(val(B.equity, '3000'), 51500);                  // 50,000 + licence paid by the owner
    assert.equal(s.trial.debit, s.trial.credit);
    const CFS = s.cashflow;
    assert.equal(CFS.opening, -12600);
    assert.equal(CFS.closing, 36600);
    assert.equal(CFS.difference, 0);
    assert.equal(CFS.financing.find((l) => l.key === 'capital').amount, 50000);
    assert.equal(CFS.operating.find((l) => l.key === 'clients').amount, 2600);
    // void an expense: it leaves the statements
    const rent = db.prepare("SELECT id FROM expenses WHERE account='6100'").get().id;
    assert.equal((await call('sa', 'POST', `/api/app/books/expenses/${rent}/void`, {})).status, 400, 'reason needed');
    await call('sa', 'POST', `/api/app/books/expenses/${rent}/void`, { reason: 'Entered twice' });
    const s2 = (await call('sa', 'GET', '/api/app/books/statements?from=2026-10-01&to=2026-10-31')).body;
    assert.equal(s2.income.net_profit, -540);
    assert.equal(s2.balance.totals.difference, 0);
    // documents
    const pdf = await call('sa', 'GET', '/api/app/books/statements.pdf?from=2026-10-01&to=2026-10-31', undefined, { raw: true });
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    const x = await call('sa', 'GET', '/api/app/books/statements.xlsx?from=2026-10-01&to=2026-10-31', undefined, { raw: true });
    assert.equal(Buffer.from(await x.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    // only the Super Admin
    for (const role of ['admin', 'accountant', 'reviewer']) {
      await t.addUser(role, role);
      assert.equal((await call(role, 'GET', '/api/app/books/statements')).status, 403, role);
      assert.equal((await call(role, 'GET', '/api/app/books/expenses')).status, 403, role);
    }
  } finally { await t.close(); }
});
