// Invoices (per job, or one monthly invoice for banks and companies), credit notes, the payments ledger,
// aging, reminders, and inspector commissions (default 42% of the fee excluding VAT).
import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { tx } from './db.js';
import { clampStr } from './util.js';
import { dateKey, parseDateKey, round2, money, DAY } from './time.js';
import { layout, rows } from './emails.js';

const token = () => crypto.randomBytes(18).toString('base64url');

export function createFinance(ctx) {
  const { db } = ctx;
  const S = () => ctx.settings();
  const J = () => ctx.jobs;
  const audit = (...a) => ctx.admin.audit(...a);

  const credited = (invId) => round2(db.prepare("SELECT COALESCE(SUM(total),0) s FROM invoices WHERE kind='credit_note' AND credit_for_id=? AND status<>'cancelled'").get(invId).s);
  const balanceOf = (inv) => round2(inv.total - inv.paid - credited(inv.id));
  function refreshStatus(invId) {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invId);
    if (!inv || inv.kind !== 'invoice' || inv.status === 'cancelled') return;
    const paid = round2(db.prepare('SELECT COALESCE(SUM(amount - refunded),0) s FROM payments WHERE invoice_id=?').get(invId).s);
    const bal = round2(inv.total - paid - credited(invId));
    const status = bal <= 0.001 ? 'paid' : paid > 0 || credited(invId) > 0 ? 'part_paid' : 'issued';
    db.prepare('UPDATE invoices SET paid=?, status=? WHERE id=?').run(paid, status, invId);
    if (status === 'paid') {
      for (const l of db.prepare('SELECT DISTINCT job_id FROM invoice_lines WHERE invoice_id=? AND job_id IS NOT NULL').all(invId)) {
        const st = db.prepare('SELECT status FROM jobs WHERE id=?').get(l.job_id)?.status;
        if (st === 'invoiced') J().move(null, l.job_id, 'closed', `Invoice ${inv.number} paid in full`);
      }
    }
  }

  function createInvoice(user, { client_id, lines, discount = 0, supply_date, notes = '', jobIds = [] }) {
    const s = S();
    const client = db.prepare('SELECT * FROM clients WHERE id=?').get(client_id);
    if (!client) throw new HttpError(400, 'Client not found.');
    const subtotal = round2(lines.reduce((a, l) => a + l.amount, 0));
    const disc = round2(Math.min(discount, subtotal));
    const net = round2(subtotal - disc);
    const vatOn = s.vat_registered === '1';
    const rate = vatOn ? Number(s.vat_rate) || 0 : 0;
    const vat = round2((net * rate) / 100);
    const today = dateKey(ctx.now());
    const due = dateKey(ctx.now() + (client.credit_terms_days || 0) * DAY);
    const number = J().nextNumber('invoice');
    const id = Number(db.prepare(`INSERT INTO invoices(number,kind,client_id,issue_date,supply_date,due_date,is_tax_invoice,subtotal,discount,net,vat_rate,vat,total,paid,status,pay_token,notes,created_by,created_at)
      VALUES(?,'invoice',?,?,?,?,?,?,?,?,?,?,?,0,'issued',?,?,?,?)`).run(number, client.id, today, supply_date || today, due, vatOn ? 1 : 0, subtotal, disc, net, rate, vat, round2(net + vat), token(), clampStr(notes, 500), user?.id ?? null, ctx.now()).lastInsertRowid);
    lines.forEach((l, i) => db.prepare('INSERT INTO invoice_lines(invoice_id,job_id,pos,description,qty,unit_price,amount) VALUES(?,?,?,?,?,?,?)').run(id, l.job_id ?? null, i + 1, l.description, l.qty, l.unit_price, l.amount));
    for (const jid of jobIds) {
      // advance payments made against the job's quotation now count towards this invoice
      db.prepare("UPDATE payments SET invoice_id=? WHERE invoice_id IS NULL AND quotation_id IN (SELECT id FROM quotations WHERE job_id=?)").run(id, jid);
      const st = db.prepare('SELECT status FROM jobs WHERE id=?').get(jid).status;
      if (['report_issued', 'reinspection_due'].includes(st)) J().move(user, jid, 'invoiced', `Invoice ${number}`);
      else J().event(user, jid, `Invoice ${number}`);
    }
    refreshStatus(id);
    audit(user, 'invoices', id, 'create', null, { number, total: round2(net + vat) });
    return id;
  }

  /** Invoice for one job, from its accepted quotation. Advance payments are applied automatically. */
  async function invoiceJob(user, jobId) {
    const j = J().getJob(jobId);
    if (db.prepare('SELECT 1 FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE l.job_id=? AND i.kind=\'invoice\' AND i.status<>\'cancelled\'').get(jobId)) throw new HttpError(409, 'This job is already invoiced.');
    const q = db.prepare("SELECT * FROM quotations WHERE job_id=? AND status='accepted' ORDER BY id DESC").get(jobId);
    if (!q) throw new HttpError(409, 'There is no accepted quotation to invoice.');
    const where = [j.building, j.unit_no && `Unit ${j.unit_no}`, j.community].filter(Boolean).join(', ');
    const lines = J().quoteLines(q.id).map((l) => ({ job_id: jobId, description: `${l.description} – ${j.number}${where ? ', ' + where : ''}`, qty: l.qty, unit_price: l.unit_price, amount: l.amount }));
    const id = tx(db, () => createInvoice(user, { client_id: j.client_id, lines, discount: q.discount, supply_date: db.prepare('SELECT inspection_date d FROM reports WHERE job_id=?').get(jobId)?.d, jobIds: [jobId] }));
    await sendInvoice(id).catch((e) => console.error('[invoice email]', e.message));
    return id;
  }

  /** One invoice listing every issued, not-yet-invoiced job of a client in a month (banks / companies). */
  async function monthlyInvoice(user, clientId, month) {
    if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw new HttpError(400, 'Choose the month.');
    const from = parseDateKey(`${month}-01`);
    const [y, m] = month.split('-').map(Number);
    const to = parseDateKey(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`);
    const jobs = db.prepare(`SELECT j.id FROM jobs j WHERE j.client_id=? AND j.report_issued_at>=? AND j.report_issued_at<? AND j.parent_job_id IS NULL AND j.status IN ('report_issued','reinspection_due')
      AND NOT EXISTS (SELECT 1 FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE l.job_id=j.id AND i.kind='invoice' AND i.status<>'cancelled') ORDER BY j.report_issued_at`).all(clientId, from, to).map((r) => r.id);
    if (!jobs.length) throw new HttpError(400, 'There are no issued, un-invoiced jobs for this client in that month.');
    const lines = [];
    let discount = 0;
    for (const jid of jobs) {
      const j = J().getJob(jid);
      const q = db.prepare("SELECT * FROM quotations WHERE job_id=? AND status='accepted' ORDER BY id DESC").get(jid);
      const rpt = db.prepare('SELECT number, inspection_date FROM reports WHERE job_id=?').get(jid);
      const desc = `${j.service_name} – ${j.number}${rpt?.number ? ` / ${rpt.number}` : ''} – ${[j.building, j.unit_no && `Unit ${j.unit_no}`, j.community].filter(Boolean).join(', ')}${j.bank_reference ? ` (ref ${j.bank_reference})` : ''}${rpt?.inspection_date ? `, inspected ${rpt.inspection_date.split('-').reverse().join('/')}` : ''}`;
      const amount = q ? q.subtotal : j.fee_net;
      discount += q ? q.discount : 0;
      lines.push({ job_id: jid, description: desc, qty: 1, unit_price: amount, amount });
    }
    const id = tx(db, () => createInvoice(user, { client_id: clientId, lines, discount, supply_date: dateKey(to - DAY), notes: `Monthly invoice for ${month}`, jobIds: jobs }));
    await sendInvoice(id).catch((e) => console.error('[invoice email]', e.message));
    return id;
  }

  function creditNote(user, invId, { amount, reason }) {
    const inv = db.prepare("SELECT * FROM invoices WHERE id=? AND kind='invoice'").get(invId);
    if (!inv) throw new HttpError(404, 'Invoice not found');
    if (inv.status === 'cancelled') throw new HttpError(409, 'This invoice is cancelled.');
    const total = round2(Number(amount));
    const max = round2(inv.total - credited(invId));
    if (!(total > 0) || total > max + 0.001) throw new HttpError(400, `The credit can be up to AED ${money(max)}.`);
    if (!clampStr(reason, 300)) throw new HttpError(400, 'Give the reason for the credit note.');
    const rate = inv.vat_rate;
    const net = round2(total / (1 + rate / 100));
    const vat = round2(total - net);
    const id = tx(db, () => {
      const number = J().nextNumber('credit');
      const cid = Number(db.prepare(`INSERT INTO invoices(number,kind,credit_for_id,client_id,issue_date,supply_date,due_date,is_tax_invoice,subtotal,discount,net,vat_rate,vat,total,paid,status,pay_token,notes,created_by,created_at)
        VALUES(?,'credit_note',?,?,?,?,?,?,?,0,?,?,?,?,0,'issued',?,?,?,?)`).run(number, invId, inv.client_id, dateKey(ctx.now()), inv.supply_date, dateKey(ctx.now()), inv.is_tax_invoice, net, net, rate, vat, total, token(), clampStr(reason, 300), user.id, ctx.now()).lastInsertRowid);
      db.prepare('INSERT INTO invoice_lines(invoice_id,job_id,pos,description,qty,unit_price,amount) VALUES(?,?,?,?,?,?,?)').run(cid, null, 1, `Credit against invoice ${inv.number}: ${clampStr(reason, 300)}`, 1, net, net);
      refreshStatus(invId);
      return cid;
    });
    audit(user, 'invoices', id, 'credit_note', null, { for: inv.number, total });
    return id;
  }

  function cancelInvoice(user, invId, reason) {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invId);
    if (!inv) throw new HttpError(404, 'Invoice not found');
    if (inv.paid > 0) throw new HttpError(409, 'This invoice has payments. Issue a credit note instead.');
    tx(db, () => {
      db.prepare("UPDATE invoices SET status='cancelled', notes=? WHERE id=?").run(`Cancelled: ${clampStr(reason, 200)}`, invId);
      for (const l of db.prepare('SELECT DISTINCT job_id FROM invoice_lines WHERE invoice_id=? AND job_id IS NOT NULL').all(invId)) {
        db.prepare("UPDATE jobs SET status='report_issued', updated_at=? WHERE id=? AND status='invoiced'").run(ctx.now(), l.job_id);
        J().event(user, l.job_id, `Invoice ${inv.number} cancelled`);
      }
    });
    audit(user, 'invoices', invId, 'cancel', null, { reason });
  }

  async function recordInvoicePayment(user, invId, { method, amount, provider = '', ref = '', paid_on, proof_file_id = null }) {
    const inv = db.prepare("SELECT * FROM invoices WHERE id=? AND kind='invoice'").get(invId);
    if (!inv) throw new HttpError(404, 'Invoice not found');
    if (inv.status === 'cancelled') throw new HttpError(409, 'This invoice is cancelled.');
    const amt = round2(Number(amount));
    if (!(amt > 0)) throw new HttpError(400, 'Enter the amount received.');
    if (amt > balanceOf(inv) + 0.001) throw new HttpError(400, `The balance is AED ${money(balanceOf(inv))}.`);
    if (!['card', 'bank_transfer', 'cheque', 'cash'].includes(method)) throw new HttpError(400, 'Choose how it was paid.');
    if (paid_on && parseDateKey(paid_on) === null) throw new HttpError(400, 'Payment date: use the date picker.');
    if (ref && provider && db.prepare('SELECT 1 FROM payments WHERE provider_ref=? AND provider=?').get(ref, provider)) return null;
    const pid = tx(db, () => {
      const receipt = `RC-${String(db.prepare('SELECT COUNT(*) n FROM payments').get().n + 1).padStart(5, '0')}`;
      const id = Number(db.prepare('INSERT INTO payments(client_id,invoice_id,method,provider,provider_ref,amount,paid_on,proof_file_id,receipt_no,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(inv.client_id, invId, method, provider, ref, amt, paid_on || dateKey(ctx.now()), proof_file_id, receipt, user?.id ?? null, ctx.now()).lastInsertRowid);
      refreshStatus(invId);
      return id;
    });
    audit(user, 'payments', pid, 'create', null, { invoice: inv.number, amount: amt, method });
    const c = db.prepare('SELECT * FROM clients WHERE id=?').get(inv.client_id);
    const s = S();
    if (c.email) {
      const pdf = ctx.docs.receiptPdf(pid);
      await ctx.mailer.send({ to: c.email, template: 'receipt', subject: `Payment received – ${inv.number}`, text: `Dear ${c.name},\n\nWe received AED ${money(amt)} against invoice ${inv.number}. Your receipt is attached.\n\n${s.company_name}`, html: layout(s, 'Payment received', `<p>Dear ${c.name},</p><p>Thank you. Your receipt is attached.</p>${rows([['Invoice', inv.number], ['Amount', `AED ${money(amt)}`]])}`), attachments: [{ filename: `Receipt-${inv.number}.pdf`, contentType: 'application/pdf', content: pdf }] });
    }
    return pid;
  }

  const invoiceUrl = (inv) => `${ctx.config.baseUrl}/pay.html?i=${inv.pay_token}`;
  async function sendInvoice(invId) {
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invId);
    const c = db.prepare('SELECT * FROM clients WHERE id=?').get(inv.client_id);
    if (!c.email) return;
    const s = S();
    const pdf = ctx.docs.invoicePdf(invId);
    const bal = balanceOf(inv);
    const label = inv.kind === 'credit_note' ? 'Credit note' : inv.is_tax_invoice ? 'Tax invoice' : 'Invoice';
    await ctx.mailer.send({
      to: c.email, template: 'invoice', jobId: db.prepare('SELECT job_id FROM invoice_lines WHERE invoice_id=? AND job_id IS NOT NULL LIMIT 1').get(invId)?.job_id,
      subject: `${label} ${inv.number} – ${s.company_name}`,
      text: `Dear ${c.name},\n\nPlease find ${label.toLowerCase()} ${inv.number} attached (AED ${money(inv.total)}).${bal > 0 ? `\nBalance due: AED ${money(bal)} by ${inv.due_date.split('-').reverse().join('/')}. Pay online: ${invoiceUrl(inv)}` : '\nThis invoice is fully paid. Thank you.'}\n\n${s.company_name}`,
      html: layout(s, `${label} ${inv.number}`, `<p>Dear ${c.name},</p><p>Please find the ${label.toLowerCase()} attached.</p>${rows([['Total', `AED ${money(inv.total)}`], ['Balance due', bal > 0 ? `AED ${money(bal)}` : 'Paid in full'], ['Due date', bal > 0 ? inv.due_date.split('-').reverse().join('/') : '']])}`, bal > 0 ? { url: invoiceUrl(inv), label: 'Pay online' } : null),
      attachments: [{ filename: `${inv.number}.pdf`, contentType: 'application/pdf', content: pdf }],
    });
  }

  function listInvoices(q = {}) {
    const where = [], args = [];
    if (q.status === 'open') where.push("i.kind='invoice' AND i.status IN ('issued','part_paid')");
    else if (q.status) { where.push('i.status=?'); args.push(q.status); }
    if (q.client_id) { where.push('i.client_id=?'); args.push(Number(q.client_id)); }
    if (q.from) { where.push('i.issue_date>=?'); args.push(q.from); }
    if (q.to) { where.push('i.issue_date<=?'); args.push(q.to); }
    if (q.q) { where.push('(i.number LIKE ? OR c.name LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
    const today = dateKey(ctx.now());
    return db.prepare(`SELECT i.*, c.name client_name, c.email client_email FROM invoices i JOIN clients c ON c.id=i.client_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.id DESC LIMIT 1000`).all(...args)
      .map((i) => { const bal = i.kind === 'invoice' && i.status !== 'cancelled' ? balanceOf(i) : 0; return { ...i, credited: credited(i.id), balance: bal, overdue_days: bal > 0 && i.due_date < today ? Math.round((parseDateKey(today) - parseDateKey(i.due_date)) / DAY) : 0 }; });
  }
  function invoiceDetail(id) {
    const inv = db.prepare('SELECT i.*, c.name client_name, c.email client_email FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=?').get(id);
    if (!inv) throw new HttpError(404, 'Invoice not found');
    return { invoice: { ...inv, credited: credited(id), balance: inv.kind === 'invoice' && inv.status !== 'cancelled' ? balanceOf(inv) : 0, pay_url: invoiceUrl(inv) }, lines: db.prepare('SELECT l.*, j.number job_number FROM invoice_lines l LEFT JOIN jobs j ON j.id=l.job_id WHERE invoice_id=? ORDER BY pos').all(id), payments: db.prepare('SELECT * FROM payments WHERE invoice_id=? ORDER BY id').all(id), credits: db.prepare("SELECT * FROM invoices WHERE credit_for_id=? ORDER BY id").all(id) };
  }
  function aging() {
    const today = parseDateKey(dateKey(ctx.now()));
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
    const byClient = {};
    for (const i of listInvoices({ status: 'open' })) {
      const days = Math.round((today - parseDateKey(i.due_date)) / DAY);
      const k = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'd90p';
      buckets[k] = round2(buckets[k] + i.balance);
      const c = (byClient[i.client_id] ??= { client_id: i.client_id, client_name: i.client_name, current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 });
      c[k] = round2(c[k] + i.balance); c.total = round2(c.total + i.balance);
    }
    return { buckets, clients: Object.values(byClient).sort((a, b) => b.total - a.total) };
  }
  function payments(q = {}) {
    const where = [], args = [];
    if (q.from) { where.push('p.paid_on>=?'); args.push(q.from); }
    if (q.to) { where.push('p.paid_on<=?'); args.push(q.to); }
    return db.prepare(`SELECT p.*, c.name client_name, i.number invoice_number, q.number quote_number, q.revision quote_revision FROM payments p JOIN clients c ON c.id=p.client_id LEFT JOIN invoices i ON i.id=p.invoice_id LEFT JOIN quotations q ON q.id=p.quotation_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 2000`).all(...args);
  }

  // ---------- public invoice payment page ----------
  function publicInvoice(tok) {
    const inv = db.prepare("SELECT i.*, c.name client_name FROM invoices i JOIN clients c ON c.id=i.client_id WHERE pay_token=? AND kind='invoice'").get(String(tok || ''));
    if (!inv) throw new HttpError(404, 'This link is not valid.');
    return { number: inv.number, client: inv.client_name, issue_date: inv.issue_date, due_date: inv.due_date, total: inv.total, balance: inv.status === 'cancelled' ? 0 : balanceOf(inv), status: inv.status, tax: !!inv.is_tax_invoice, company: S().company_name, lines: db.prepare('SELECT description, amount FROM invoice_lines WHERE invoice_id=? ORDER BY pos').all(inv.id) };
  }

  // ---------- commissions ----------
  /** Called when a report is issued: the inspector earns their % of the fee excluding VAT. */
  function ensureCommission(jobId) {
    const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
    if (!j?.inspector_id || db.prepare('SELECT 1 FROM commissions WHERE job_id=?').get(jobId)) return;
    const ins = db.prepare('SELECT commission_pct FROM inspectors WHERE id=?').get(j.inspector_id);
    const pct = ins?.commission_pct ?? Number(S().default_commission_pct) ?? 42;
    const q = db.prepare("SELECT net FROM quotations WHERE job_id=? AND status='accepted' ORDER BY id DESC").get(jobId);
    const base = round2(q?.net ?? j.fee_net ?? 0);
    const today = dateKey(ctx.now());
    db.prepare("INSERT INTO commissions(inspector_id,job_id,base_amount,pct,amount,status,payable_on,statement_month) VALUES(?,?,?,?,?,'payable',?,?)").run(j.inspector_id, jobId, base, pct, round2((base * pct) / 100), today, today.slice(0, 7));
  }
  function listCommissions(q = {}) {
    const where = [], args = [];
    if (q.month) { where.push('c.statement_month=?'); args.push(q.month); }
    if (q.inspector_id) { where.push('c.inspector_id=?'); args.push(Number(q.inspector_id)); }
    if (q.status) { where.push('c.status=?'); args.push(q.status); }
    return db.prepare(`SELECT c.*, i.name inspector_name, j.number job_number, s.name service_name, p.building, p.unit_no, r.number report_number FROM commissions c JOIN inspectors i ON i.id=c.inspector_id JOIN jobs j ON j.id=c.job_id JOIN services s ON s.id=j.service_id JOIN properties p ON p.id=j.property_id LEFT JOIN reports r ON r.job_id=j.id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.statement_month DESC, i.name, c.id`).all(...args);
  }
  function updateCommission(user, id, { bonus, status }) {
    const c = db.prepare('SELECT * FROM commissions WHERE id=?').get(id);
    if (!c) throw new HttpError(404, 'Not found');
    if (c.status === 'paid' && status !== 'payable') throw new HttpError(409, 'This commission is already paid.');
    if (bonus !== undefined) db.prepare('UPDATE commissions SET bonus=? WHERE id=?').run(round2(Number(bonus) || 0), id);
    if (status && ['pending', 'payable', 'void'].includes(status)) db.prepare('UPDATE commissions SET status=?, paid_on=NULL WHERE id=?').run(status, id);
    audit(user, 'commissions', id, 'update', c, { bonus, status });
  }
  function payCommissions(user, ids, paid_on) {
    if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Tick the commissions to pay.');
    const day = paid_on && parseDateKey(paid_on) !== null ? paid_on : dateKey(ctx.now());
    let n = 0;
    tx(db, () => { for (const id of ids) n += Number(db.prepare("UPDATE commissions SET status='paid', paid_on=? WHERE id=? AND status='payable'").run(day, Number(id)).changes); });
    audit(user, 'commissions', null, 'pay', null, { ids, paid_on: day });
    return n;
  }

  // ---------- hourly jobs: expire quotes, invoice reminders ----------
  async function tick() {
    const today = dateKey(ctx.now());
    let expired = 0, reminded = 0;
    for (const q of db.prepare("SELECT q.id, q.job_id FROM quotations q JOIN jobs j ON j.id=q.job_id WHERE q.status='sent' AND q.valid_until<? AND j.status='quoted'").all(today)) {
      tx(db, () => { db.prepare("UPDATE quotations SET status='expired' WHERE id=?").run(q.id); J().move(null, q.job_id, 'quote_expired', 'Quotation expired'); });
      expired++;
    }
    const steps = String(S().reminder_days || '3,7,14').split(',').map((x) => Number(x.trim())).filter((x) => x > 0);
    for (const inv of listInvoices({ status: 'open' })) {
      const days = Math.round((parseDateKey(today) - parseDateKey(inv.due_date)) / DAY);
      const step = steps.filter((d) => days >= d).pop();
      if (!step || !inv.client_email) continue;
      const tag = `invoice_reminder_${inv.id}_${step}`;
      if (db.prepare('SELECT 1 FROM outbox WHERE template_code=?').get(tag)) continue;
      const s = S();
      await ctx.mailer.send({ to: inv.client_email, template: tag, subject: `Reminder: invoice ${inv.number} is ${days} days overdue`, text: `Dear ${inv.client_name},\n\nOur invoice ${inv.number} for AED ${money(inv.total)} was due on ${inv.due_date.split('-').reverse().join('/')}. The balance is AED ${money(inv.balance)}.\n\nPay online: ${invoiceUrl(inv)}\n\nIf you have already paid, please ignore this message.\n\n${s.company_name}`, html: layout(s, 'Payment reminder', `<p>Dear ${inv.client_name},</p><p>Our invoice ${inv.number} is now overdue.</p>${rows([['Due date', inv.due_date.split('-').reverse().join('/')], ['Balance', `AED ${money(inv.balance)}`]])}<p>If you have already paid, please ignore this message.</p>`, { url: invoiceUrl(inv), label: 'Pay online' }) });
      reminded++;
    }
    return { expired, reminded };
  }

  return { createInvoice, invoiceJob, monthlyInvoice, creditNote, cancelInvoice, recordInvoicePayment, sendInvoice, listInvoices, invoiceDetail, aging, payments, publicInvoice, invoiceUrl, balanceOf, ensureCommission, listCommissions, updateCommission, payCommissions, tick, refreshStatus };
}
