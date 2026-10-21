// All PDFs (English only): quotation, service agreement, receipt, invoice / tax invoice / credit note,
// inspector commission statement and the inspection report (structure of the approved sample report).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlowDoc, loadImage, fit, PAGE_W, PAGE_H } from './pdf.js';
import { qrMatrix } from './qr.js';
import { money, round2, fmtStamp, fmtDate } from './time.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const readImg = (rel) => { try { return loadImage(fs.readFileSync(path.join(here, '..', 'public', rel))); } catch { return null; } };
const LOGO = readImg('logo.jpg');
const C = { navy: '#0A1F4A', blue: '#0B4F8C', sky: '#2283C8', copper: '#8C5A36', tint: '#F4ECE4', red: '#C62828', text: '#16213A', muted: '#5B6782', line: '#DDE3EC', zebra: '#F5F7FA' };
const SEV = { critical: { label: 'Critical', color: C.red }, attention: { label: 'Needs attention', color: C.blue }, info: { label: 'For information', color: C.text } };
const REINSPECT = { fixed: 'Fixed', not_fixed: 'Not fixed', partly_fixed: 'Partly fixed' };
const dmy = (d) => (d ? String(d).split('-').reverse().join('/') : '');
const addr = (j) => [j.building, j.unit_no && `Unit ${j.unit_no}`, j.community, j.emirate].filter(Boolean).join(', ');

/** "One thousand five hundred dirhams and 50 fils only" */
export function amountInWords(n) {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const under1000 = (x) => {
    const h = Math.floor(x / 100), r = x % 100;
    const rest = r < 20 ? ones[r] : tens[Math.floor(r / 10)] + (r % 10 ? '-' + ones[r % 10] : '');
    return [h ? `${ones[h]} hundred` : '', rest].filter(Boolean).join(' and ');
  };
  const words = (x) => {
    if (x === 0) return 'zero';
    const parts = [];
    for (const [v, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [1, '']]) {
      const k = Math.floor(x / v); x %= v;
      if (k) parts.push(`${under1000(k)}${name ? ' ' + name : ''}`);
    }
    return parts.join(' ');
  };
  const v = round2(Math.abs(n));
  const d = Math.floor(v), f = Math.round((v - d) * 100);
  const s = `${words(d)} dirham${d === 1 ? '' : 's'}${f ? ` and ${f} fils` : ''} only`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function createDocs(ctx) {
  const { db } = ctx;
  const S = () => ctx.settings();

  // ---------- shared page furniture ----------
  function companyLines(s) {
    const branch = db.prepare('SELECT address FROM branches WHERE is_default=1').get();
    return {
      address: branch?.address || 'Dubai, United Arab Emirates',
      contact: [s.phone && `Tel ${s.phone}`, s.mobile && `Mobile ${s.mobile}`, s.email, s.website].filter(Boolean).join('  ·  '),
      regs: [s.det_licence_no && `DET licence ${s.det_licence_no}`, s.rera_reg_no && `RERA ${s.rera_reg_no}`, s.vat_registered === '1' && s.trn && `TRN ${s.trn}`].filter(Boolean).join('  ·  '),
    };
  }
  /** Business document (quote, invoice…): logo + title block on every page, company footer, Page X of Y. */
  function businessDoc(title, meta) {
    const s = S();
    const cl = companyLines(s);
    return new FlowDoc({
      title, author: s.company_name, margin: { top: 118, bottom: 64, left: 46, right: 46 },
      header: (d) => {
        const p = d.pdf;
        if (LOGO) p.image(LOGO, 46, 30, 104, 60);
        p.text(title.toUpperCase(), PAGE_W - 46, 48, { size: 16, bold: true, fill: C.navy, align: 'right' });
        meta.forEach(([k, v], i) => { p.text(`${k}: ${v}`, PAGE_W - 46, 64 + i * 12, { size: 8.5, fill: C.muted, align: 'right' }); });
        p.rect(46, 100, PAGE_W - 92, 2, { fill: C.copper });
      },
      footer: (d, n, total, page) => {
        const p = d.pdf;
        p.line(46, PAGE_H - 50, PAGE_W - 46, PAGE_H - 50, { stroke: C.line, lineWidth: 0.6, page });
        p.text(`${s.company_name}  ·  ${cl.address}`, 46, PAGE_H - 38, { size: 7.5, fill: C.muted, page });
        p.text([cl.contact, cl.regs].filter(Boolean).join('  ·  '), 46, PAGE_H - 28, { size: 7, fill: C.muted, page });
        p.text(`Page ${n} of ${total}`, PAGE_W - 46, PAGE_H - 38, { size: 7.5, fill: C.muted, align: 'right', page });
      },
    });
  }
  function heading(d, text, { size = 12.5, color = C.navy, before = 8 } = {}) {
    d.need(size * 2 + 30);
    d.space(before);
    d.pdf.text(text, d.x, d.y + size, { size, bold: true, fill: color });
    d.y += size + 4;
    d.pdf.rect(d.x, d.y, 36, 2, { fill: C.copper });
    d.y += 9;
  }
  /** Two-column label/value grid. */
  function kv(d, pairs, { cols = 2, size = 9 } = {}) {
    const items = pairs.filter(([, v]) => v !== undefined && v !== null && v !== '');
    const colW = d.width / cols;
    for (let i = 0; i < items.length; i += cols) {
      const row = items.slice(i, i + cols);
      const h = Math.max(...row.map(([, v]) => d.pdf.wrap(String(v), colW - 104, size).length)) * size * 1.35 + 4;
      d.need(h);
      row.forEach(([k, v], c) => {
        const x = d.x + c * colW;
        d.pdf.text(k, x, d.y + size, { size: size - 0.5, fill: C.muted });
        d.pdf.wrap(String(v), colW - 104, size).forEach((ln, li) => d.pdf.text(ln, x + 98, d.y + size + li * size * 1.35, { size, bold: true, fill: C.text }));
      });
      d.y += h;
    }
    d.y += 4;
  }
  function totalsBlock(d, rows) {
    const w = 230, x = d.x + d.width - w;
    d.need(rows.length * 16 + 8);
    rows.forEach(([k, v, strong]) => {
      if (strong) d.pdf.rect(x, d.y - 2, w, 18, { fill: C.tint });
      d.pdf.text(k, x + 8, d.y + 11, { size: 9.5, bold: !!strong, fill: C.text });
      d.pdf.text(v, x + w - 8, d.y + 11, { size: 9.5, bold: !!strong, fill: strong ? C.navy : C.text, align: 'right' });
      d.y += 17;
    });
    d.y += 6;
  }
  function qrBox(d, url, label) {
    d.need(96);
    const m = qrMatrix(url);
    d.pdf.rect(d.x, d.y, d.width, 86, { fill: C.zebra });
    d.pdf.qr(m, d.x + 8, d.y + 8, 70);
    d.pdf.link(url, d.x + 8, d.y + 8, 70, 70);
    d.pdf.text(label, d.x + 90, d.y + 28, { size: 10.5, bold: true, fill: C.navy });
    d.pdf.wrap(url, d.width - 100, 8).forEach((ln, i) => d.pdf.text(ln, d.x + 90, d.y + 44 + i * 10, { size: 8, fill: C.sky }));
    d.pdf.link(url, d.x + 90, d.y + 34, d.width - 100, 24);
    d.y += 96;
  }
  function bankBlock(d, s) {
    const pairs = [['Bank', s.bank_name], ['Account name', s.bank_account_name], ['IBAN', s.bank_iban], ['Account no.', s.bank_account_number], ['SWIFT', s.bank_swift]].filter(([, v]) => v);
    if (!pairs.length) return;
    heading(d, 'Bank transfer details', { size: 10.5 });
    kv(d, pairs, { cols: 2, size: 8.5 });
  }
  const block = (code, onDate) => ctx.admin.currentBlock(code, onDate)?.body || '';
  const bodyText = (d, text, opts = {}) => { for (const para of String(text || '').split(/\n\s*\n/)) if (para.trim()) d.para(para.trim(), { size: 9.5, after: 7, ...opts }); };

  // ---------- quotation ----------
  function quotePdf(qid) {
    const s = S();
    const q = db.prepare('SELECT * FROM quotations WHERE id=?').get(qid);
    const j = ctx.jobs.getJob(q.job_id);
    const c = db.prepare('SELECT * FROM clients WHERE id=?').get(j.client_id);
    const lines = ctx.jobs.quoteLines(qid);
    const no = ctx.jobs.quoteNo(q);
    const d = businessDoc('Quotation', [['No.', no], ['Date', dmy(q.issue_date)], ['Valid until', dmy(q.valid_until)]]);
    bodyText(d, block('qt_cover_letter').replace(/\{\{client_name\}\}/g, c.contact_person || c.name));
    heading(d, 'Client and property');
    const ptitle = [j.bedrooms ? `${j.bedrooms} Bedroom` : j.property_type === 'studio' ? 'Studio' : '', j.property_type === 'studio' ? '' : j.property_type.charAt(0).toUpperCase() + j.property_type.slice(1), j.community && `– ${j.community}`].filter(Boolean).join(' ');
    kv(d, [['Client', c.name], ['Attention', c.contact_person], ['Email', c.email], ['Mobile', c.mobile], ['Property', ptitle], ['Address', addr(j)], ['Service', j.service_name], ['Re-inspection', j.includes_reinspection ? 'One re-inspection included' : 'Not included']]);
    heading(d, 'Scope of the inspection');
    const comps = JSON.parse(q.components || '[]'), pre = JSON.parse(q.prerequisites || '[]');
    if (comps.length) d.para(`Components in scope: ${comps.join(', ')}.`, { size: 9.5 });
    if (pre.length) d.para(`Please arrange before the visit: ${pre.join(', ')}.`, { size: 9.5 });
    d.para(`Report delivery: ${q.turnaround_text}. The report includes photos, videos and findings graded Critical, Needs attention and For information.`, { size: 9.5 });
    heading(d, 'Fees');
    d.table([{ label: '#', w: 0.4 }, { label: 'Description', w: 6 }, { label: 'Qty', w: 0.7, align: 'right' }, { label: 'Unit price (AED)', w: 1.7, align: 'right' }, { label: 'Amount (AED)', w: 1.7, align: 'right' }],
      lines.map((l, i) => [String(i + 1), l.description, String(l.qty), money(l.unit_price), money(l.amount)]));
    totalsBlock(d, [['Subtotal', money(q.subtotal)], ...(q.discount ? [['Discount', `- ${money(q.discount)}`]] : []), ...(q.vat_rate ? [[`VAT ${q.vat_rate}%`, money(q.vat)]] : []), ['Total (AED)', money(q.total), true]]);
    d.para(`Amount in words: ${amountInWords(q.total)}.`, { size: 8.5, fill: C.muted });
    if (!q.vat_rate) d.para('VAT is not charged: the company is not yet registered for VAT.', { size: 8, fill: C.muted });
    kv(d, [['Payment terms', q.payment_terms], ['Payment methods', 'Card (online link), bank transfer, cheque']], { cols: 1 });
    bankBlock(d, s);
    qrBox(d, ctx.jobs.quoteUrl(q), 'Accept, sign and pay online');
    const tc = (q.tc_block_id && db.prepare('SELECT body FROM content_blocks WHERE id=?').get(q.tc_block_id)?.body) || block('tc_quote');
    heading(d, 'Terms and conditions');
    bodyText(d, tc, { size: 8.5 });
    return d.finish();
  }

  // ---------- service agreement ----------
  function agreementPdf(agId) {
    const s = S();
    const ag = db.prepare('SELECT * FROM agreements WHERE id=?').get(agId);
    const q = db.prepare('SELECT * FROM quotations WHERE id=?').get(ag.quotation_id);
    const j = ctx.jobs.getJob(ag.job_id);
    const c = db.prepare('SELECT * FROM clients WHERE id=?').get(j.client_id);
    const d = businessDoc('Service agreement', [['Quotation', ctx.jobs.quoteNo(q)], ['Job', j.number], ['Signed', ag.signed_at ? fmtDate(ag.signed_at) : 'Not signed']]);
    heading(d, 'Parties');
    kv(d, [['Service provider', s.company_name], ['Client', c.name], ['Client email', c.email], ['Client mobile', c.mobile]]);
    heading(d, 'Service');
    kv(d, [['Service', j.service_name], ['Property', addr(j)], ['Fee (AED)', `${money(q.total)}${q.vat_rate ? ` incl. VAT ${q.vat_rate}%` : ''}`], ['Payment terms', q.payment_terms], ['Report delivery', q.turnaround_text]]);
    heading(d, 'Terms of the agreement');
    const tc = db.prepare('SELECT body, version FROM content_blocks WHERE id=?').get(ag.tc_block_id);
    bodyText(d, tc?.body || block('tc_booking'), { size: 9 });
    if (tc) d.para(`Agreement wording version ${tc.version}.`, { size: 8, fill: C.muted });
    heading(d, 'Electronic signature');
    if (ag.signed_at) {
      kv(d, [['Signed by', ag.signed_name], ['Date and time', fmtStamp(ag.signed_at) + ' (Dubai)'], ['IP address', ag.signed_ip || '—'], ['Method', 'Typed name and tick box on the secure quotation link']], { cols: 1 });
      if (ag.signature_file_id) {
        const f = db.prepare('SELECT local_path, storage FROM files WHERE id=?').get(ag.signature_file_id);
        const img = f && sigCache.get(ag.signature_file_id);
        if (img) { const { w, h } = fit(img, 200, 70); d.need(h + 10); d.pdf.image(img, d.x + 98, d.y, w, h); d.y += h + 10; }
      }
    } else d.para('Not signed yet.', { size: 9.5 });
    return d.finish();
  }
  const sigCache = new Map();
  /** Agreement PDFs embed the drawn signature: load it into memory first (storage reads are async). */
  async function agreementPdfAsync(agId) {
    const ag = db.prepare('SELECT signature_file_id FROM agreements WHERE id=?').get(agId);
    if (ag?.signature_file_id && !sigCache.has(ag.signature_file_id)) { try { sigCache.set(ag.signature_file_id, loadImage(await ctx.storage.read(ag.signature_file_id))); } catch { /* print without the drawing */ } }
    return agreementPdf(agId);
  }

  // ---------- receipt ----------
  function receiptPdf(pid) {
    const s = S();
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(pid);
    const c = db.prepare('SELECT * FROM clients WHERE id=?').get(p.client_id);
    const q = p.quotation_id && db.prepare('SELECT * FROM quotations WHERE id=?').get(p.quotation_id);
    const inv = p.invoice_id && db.prepare('SELECT * FROM invoices WHERE id=?').get(p.invoice_id);
    const d = businessDoc('Payment receipt', [['Receipt', p.receipt_no || `RC-${p.id}`], ['Date', dmy(p.paid_on)]]);
    heading(d, 'Received with thanks');
    const against = inv ? `Invoice ${inv.number}` : q ? `Quotation ${ctx.jobs.quoteNo(q)}${q.job_id ? ` (job ${ctx.jobs.getJob(q.job_id).number})` : ''}` : '';
    kv(d, [['Received from', c.name], ['Amount (AED)', money(p.amount)], ['In words', amountInWords(p.amount)], ['Method', { card: 'Card (online)', bank_transfer: 'Bank transfer', cheque: 'Cheque', cash: 'Cash' }[p.method]], ['Reference', p.provider_ref || ''], ['Against', against]], { cols: 1 });
    if (p.provider === 'mock') d.para('DEMO PAYMENT: recorded from the demo checkout. No real money was taken.', { size: 9, bold: true, fill: C.red });
    if (inv) { const bal = ctx.finance.balanceOf(inv); d.para(bal > 0 ? `Balance still due on ${inv.number}: AED ${money(bal)}.` : `Invoice ${inv.number} is now paid in full.`, { size: 9.5 }); }
    d.space(10);
    d.para(`This receipt was produced by ${s.company_name}'s system and is valid without a signature.`, { size: 8, fill: C.muted });
    return d.finish();
  }

  // ---------- invoice / tax invoice / credit note ----------
  function invoicePdf(invId) {
    const s = S();
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(invId);
    const c = db.prepare('SELECT * FROM clients WHERE id=?').get(inv.client_id);
    const credit = inv.kind === 'credit_note';
    const orig = credit && db.prepare('SELECT number, issue_date FROM invoices WHERE id=?').get(inv.credit_for_id);
    const title = credit ? (inv.is_tax_invoice ? 'Tax credit note' : 'Credit note') : inv.is_tax_invoice ? 'Tax invoice' : 'Invoice';
    const d = businessDoc(title, [['No.', inv.number], ['Date', dmy(inv.issue_date)], ...(credit ? [['For invoice', orig?.number || '']] : [['Due', dmy(inv.due_date)]])]);
    heading(d, 'Bill to');
    kv(d, [['Client', c.name], ['Attention', c.contact_person], ['Address', c.address], ['Email', c.email], ['Client TRN', c.trn], ['Date of supply', dmy(inv.supply_date)], ...(inv.is_tax_invoice ? [['Supplier TRN', s.trn]] : [])]);
    const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY pos').all(invId);
    d.table([{ label: '#', w: 0.4 }, { label: 'Description', w: 6.4 }, { label: 'Qty', w: 0.6, align: 'right' }, { label: 'Unit (AED)', w: 1.5, align: 'right' }, { label: 'Amount (AED)', w: 1.6, align: 'right' }],
      lines.map((l, i) => [String(i + 1), l.description, String(l.qty), money(l.unit_price), money(l.amount)]));
    const bal = credit || inv.status === 'cancelled' ? 0 : ctx.finance.balanceOf(inv);
    const credits = credit ? 0 : round2(db.prepare("SELECT COALESCE(SUM(total),0) s FROM invoices WHERE kind='credit_note' AND credit_for_id=? AND status<>'cancelled'").get(invId).s);
    totalsBlock(d, [['Subtotal', money(inv.subtotal)], ...(inv.discount ? [['Discount', `- ${money(inv.discount)}`]] : []), ...(inv.is_tax_invoice ? [[`VAT ${inv.vat_rate}%`, money(inv.vat)]] : []), [credit ? 'Credit total (AED)' : 'Total (AED)', money(inv.total), true],
      ...(credit ? [] : [['Paid', money(inv.paid)], ...(credits ? [['Credit notes', `- ${money(credits)}`]] : []), ['Balance due (AED)', money(bal), true]])]);
    d.para(`Amount in words: ${amountInWords(inv.total)}.`, { size: 8.5, fill: C.muted });
    if (inv.status === 'cancelled') d.para('CANCELLED', { size: 14, bold: true, fill: C.red });
    if (inv.notes) d.para(inv.notes, { size: 9 });
    if (!credit && bal > 0) { bankBlock(d, s); qrBox(d, ctx.finance.invoiceUrl(inv), 'Pay this invoice online by card'); }
    bodyText(d, block('tc_invoice'), { size: 8.5, fill: C.muted });
    return d.finish();
  }

  // ---------- inspector commission statement ----------
  function commissionPdf(inspectorId, month) {
    const ins = db.prepare('SELECT * FROM inspectors WHERE id=?').get(inspectorId);
    const rows = ctx.finance.listCommissions({ inspector_id: inspectorId, month }).filter((r) => r.status !== 'void');
    const d = businessDoc('Commission statement', [['Inspector', ins?.name || ''], ['Month', month]]);
    kv(d, [['Inspector', ins?.name], ['Engagement', ins?.engagement?.replace('_', ' ')], ['Supplier', ins?.supplier_name], ['Email', ins?.email]]);
    d.table([{ label: 'Job', w: 1.6 }, { label: 'Report', w: 1.6 }, { label: 'Service / property', w: 4 }, { label: 'Fee excl. VAT', w: 1.4, align: 'right' }, { label: '%', w: 0.6, align: 'right' }, { label: 'Bonus', w: 1, align: 'right' }, { label: 'Amount', w: 1.3, align: 'right' }, { label: 'Status', w: 1.1 }],
      rows.map((r) => [r.job_number, r.report_number || '', `${r.service_name} – ${[r.building, r.unit_no].filter(Boolean).join(' ')}`, money(r.base_amount), String(r.pct), money(r.bonus), money(r.amount + r.bonus), r.status === 'paid' ? `Paid ${dmy(r.paid_on)}` : r.status]));
    const total = round2(rows.reduce((a, r) => a + r.amount + r.bonus, 0));
    const paid = round2(rows.filter((r) => r.status === 'paid').reduce((a, r) => a + r.amount + r.bonus, 0));
    totalsBlock(d, [['Jobs', String(rows.length)], ['Total earned (AED)', money(total), true], ['Paid', money(paid)], ['Still to pay (AED)', money(total - paid), true]]);
    return d.finish();
  }

  // ---------- inspection report ----------
  /** Loads everything the report needs (including image bytes) then lays it out twice: once to learn page numbers for the contents and summary. */
  async function reportPdf(rid) {
    const r = db.prepare('SELECT * FROM reports WHERE id=?').get(rid);
    const t = ctx.reports.tree(r.job_id, null);
    const j = ctx.jobs.getJob(r.job_id);
    const ins = j.inspector_id ? db.prepare('SELECT * FROM inspectors WHERE id=?').get(j.inspector_id) : null;
    const reviewer = r.reviewer_id ? db.prepare('SELECT name, credentials, signature_file_id FROM users WHERE id=?').get(r.reviewer_id) : null;
    const media = new Map(t.media.map((m) => [m.id, m]));
    const imgs = new Map();
    const load = async (fileId) => { try { return loadImage(await ctx.storage.read(fileId)); } catch { return null; } };
    for (const m of db.prepare('SELECT id, kind, file_id, thumb_file_id FROM media WHERE job_id=? AND in_pdf=1').all(r.job_id)) {
      const fid = m.kind === 'video' ? m.thumb_file_id : m.file_id;
      if (fid) imgs.set(m.id, await load(fid));
    }
    const atts = t.attachments.filter((a) => a.in_pdf);
    const attImgs = new Map();
    for (const a of atts.filter((x) => x.kind === 'image')) attImgs.set(a.id, await load(db.prepare('SELECT file_id FROM report_attachments WHERE id=?').get(a.id).file_id));
    const cover = r.cover_media_id && imgs.get(r.cover_media_id) ? imgs.get(r.cover_media_id) : [...imgs.entries()].find(([id]) => media.get(id)?.kind === 'photo')?.[1] || null;
    const revSig = reviewer?.signature_file_id ? await load(reviewer.signature_file_id) : null;
    const insUser = ins ? db.prepare('SELECT signature_file_id FROM users WHERE inspector_id=?').get(ins.id) : null;
    const insSig = insUser?.signature_file_id ? await load(insUser.signature_file_id) : null;
    const glossary = db.prepare(`SELECT DISTINCT g.* FROM glossary g JOIN observations o ON o.glossary_id=g.id JOIN report_items it ON it.id=o.item_id JOIN report_sections s ON s.id=it.section_id WHERE s.report_id=? ORDER BY g.term`).all(rid);
    const onDate = r.issued_at ? new Date(r.issued_at + 4 * 3600000).toISOString().slice(0, 10) : undefined;
    const data = { r, t, j, ins, reviewer, media, imgs, cover, revSig, insSig, glossary, onDate, atts, attImgs };
    const pass1 = layoutReport(data, null);
    const pass2 = layoutReport(data, pass1.marks);
    return { buf: pass2.buf, pages: pass2.pages };
  }

  function layoutReport({ r, t, j, ins, reviewer, media, imgs, cover, revSig, insSig, glossary, onDate, atts = [], attImgs = new Map() }, marks) {
    const s = S();
    const base = ctx.config.baseUrl;
    const online = `${base}/report.html?t=${r.verify_token}`;
    const verifyUrl = `${base}/verify.html?t=${r.verify_token}`;
    const foot = `${s.company_short || 'ARAL'} | ${[j.building, j.unit_no && `Unit ${j.unit_no}`, j.community].filter(Boolean).join(', ')}`;
    const rec = { sections: {}, obs: {}, parts: {}, atts: {} };
    const d = new FlowDoc({
      title: `${r.title} ${r.number || ''}`.trim(), author: s.company_name, margin: { top: 78, bottom: 56, left: 46, right: 46 },
      header: (doc) => {
        if (LOGO) doc.pdf.image(LOGO, 46, 22, 69, 40);
        doc.pdf.text(r.title, PAGE_W - 46, 40, { size: 10, bold: true, fill: C.navy, align: 'right' });
        doc.pdf.text([r.number, r.inspection_date && `Inspected ${dmy(r.inspection_date)}`].filter(Boolean).join('  ·  '), PAGE_W - 46, 53, { size: 8, fill: C.muted, align: 'right' });
        doc.pdf.rect(46, 66, PAGE_W - 92, 1.5, { fill: C.copper });
      },
      footer: (doc, n, total, page) => {
        doc.pdf.line(46, PAGE_H - 42, PAGE_W - 46, PAGE_H - 42, { stroke: C.line, lineWidth: 0.6, page });
        doc.pdf.text(foot, 46, PAGE_H - 28, { size: 8, fill: C.muted, page });
        doc.pdf.text(`Page ${n} of ${total}`, PAGE_W - 46, PAGE_H - 28, { size: 8, fill: C.muted, align: 'right', page });
      },
    });
    const part = (key, title) => { d.newPage(); rec.parts[key] = d.page; heading(d, title, { size: 15, before: 0 }); };

    // 1. cover (no header/footer)
    d.skipChrome.add(1);
    const p = d.pdf;
    p.rect(0, 0, PAGE_W, PAGE_H, { fill: '#FFFFFF' });
    p.rect(0, 0, PAGE_W, 8, { fill: C.navy });
    if (LOGO) p.image(LOGO, 46, 40, 156, 90);
    p.text(r.title.toUpperCase(), 46, 172, { size: 22, bold: true, fill: C.navy });
    p.rect(46, 182, 60, 3, { fill: C.copper });
    p.text(addr(j), 46, 206, { size: 12, fill: C.text });
    let cy = 224;
    if (cover) { const { w, h } = fit(cover, PAGE_W - 92, 330); p.image(cover, 46 + (PAGE_W - 92 - w) / 2, cy, w, h); cy += h + 18; } else cy += 10;
    const coverRows = [['Prepared for', j.client_name], ['Report no.', r.number || 'DRAFT'], ['Inspection', `${dmy(r.inspection_date)}${r.time_in ? `, ${r.time_in}${r.time_out ? ` – ${r.time_out}` : ''}` : ''}`], ['Report date', r.issued_at ? fmtDate(r.issued_at) : 'Draft'], ['Inspector', ins?.name || j.inspector_name || ''], ['Service', j.service_name]];
    coverRows.forEach(([k, v], i) => { p.text(k, 46, cy + i * 17, { size: 9.5, fill: C.muted }); p.text(String(v || ''), 150, cy + i * 17, { size: 10, bold: true, fill: C.text }); });
    const qm = qrMatrix(verifyUrl);
    p.qr(qm, PAGE_W - 46 - 86, cy - 6, 86);
    p.link(verifyUrl, PAGE_W - 46 - 86, cy - 6, 86, 86);
    p.text('Scan to verify', PAGE_W - 46 - 43, cy + 92, { size: 7.5, fill: C.muted, align: 'center' });
    p.rect(0, PAGE_H - 70, PAGE_W, 70, { fill: C.navy });
    p.text(s.company_name, 46, PAGE_H - 42, { size: 10, bold: true, fill: '#FFFFFF' });
    p.text([s.tagline, s.phone, s.website].filter(Boolean).join('  ·  '), 46, PAGE_H - 27, { size: 8, fill: '#D3A57C' });

    // 2–4. introduction, scope, standards
    part('intro', 'Introduction');
    bodyText(d, block('rpt_intro', onDate));
    heading(d, 'What we inspect');
    bodyText(d, block('rpt_what_we_inspect', onDate));
    heading(d, 'Inspection standards followed');
    bodyText(d, block('rpt_standards', onDate));

    // 5. contents (one page; page numbers come from the first pass)
    part('toc', 'Contents');
    const tocEntries = [['General information', 'general'], ['Understanding the report', 'understanding'], ...t.sections.map((sc, i) => [`${i + 1}. ${sc.name}`, `s${sc.id}`]), ...(glossary.length ? [['Glossary', 'glossary']] : []), ['Report summary', 'summary'], ['Report conclusion', 'conclusion'], ['Terms and conditions', 'terms'], ...(r.thermal_used ? [['Thermal imaging addendum', 'thermal']] : []), ['Sign-off', 'signoff'], ...(atts.length ? [['Attachments', 'attachments'], ...atts.map((a, i) => [`   A${i + 1}. ${a.title}`, `a${a.id}`])] : [])];
    const tocSize = tocEntries.length > 46 ? 7.5 : 9.5;
    const tocLine = tocSize * 1.55;
    for (const [label, key] of tocEntries) {
      if (d.y + tocLine > d.bottom) break; // never spill: keeps the page count stable between passes
      const pg = marks ? String((/^s\d+$/.test(key) ? marks.sections[key.slice(1)] : /^a\d+$/.test(key) ? marks.atts[key.slice(1)] : marks.parts[key]) ?? '') : '';
      d.pdf.text(label, d.x, d.y + tocSize, { size: tocSize, fill: C.text });
      const lw = d.pdf.textWidth(label, tocSize);
      for (let x = d.x + lw + 6; x < d.x + d.width - 26; x += 4) d.pdf.text('.', x, d.y + tocSize, { size: tocSize, fill: C.line });
      d.pdf.text(pg, d.x + d.width, d.y + tocSize, { size: tocSize, bold: true, fill: C.navy, align: 'right' });
      d.y += tocLine;
    }

    // 6. general information
    part('general', 'General information');
    const yn = (v) => (v === 1 ? 'Yes' : v === 0 ? 'No' : 'Not recorded');
    const ptype = j.property_type ? j.property_type.charAt(0).toUpperCase() + j.property_type.slice(1) : '';
    kv(d, [['Inspector', [ins?.name || j.inspector_name, ins?.credentials].filter(Boolean).join(', ')], ['Client', j.client_name], ['Property', addr(j)], ['Property type', `${ptype}${j.bedrooms ? `, ${j.bedrooms} bedroom${j.bedrooms > 1 ? 's' : ''}` : ''}`],
      ['Persons present', JSON.parse(r.persons_present || '[]').join(', ') || 'None'], ['Occupancy', r.occupancy || 'Not recorded'], ['Levels', r.levels ? String(r.levels) : ''], ['Estimated age', r.estimated_age], ['Weather', r.weather], ['Outdoor temperature', r.temperature_c != null ? `${r.temperature_c} °C` : ''],
      ['AC connected', yn(r.ac_connected)], ['DEWA connected', yn(r.dewa_connected)], ['Time in', r.time_in], ['Time out', r.time_out], ['Thermal imaging', r.thermal_used ? 'Used' : 'Not used'], ['Overall condition', r.overall_condition]], { cols: 1 });
    if (r.property_note) d.para(r.property_note, { size: 9, fill: C.muted });
    else if (['apartment', 'studio', 'penthouse'].includes(j.property_type)) d.para('This is a unit in a building. Common areas, the building structure, facade and shared services are the responsibility of the owners association or building management and are not part of this inspection.', { size: 9, fill: C.muted });
    const eq = JSON.parse(r.equipment_used || '[]');
    if (eq.length) {
      const list = db.prepare(`SELECT name, kind, calibration_due FROM equipment WHERE id IN (${eq.map(() => '?').join(',')})`).all(...eq);
      d.para(`Equipment used: ${list.map((e) => `${e.name}${e.calibration_due ? ` (calibration valid to ${dmy(e.calibration_due)})` : ''}`).join('; ')}.`, { size: 9 });
    }

    // 7. understanding the report + legend
    heading(d, 'Understanding the report');
    rec.parts.understanding = d.page;
    bodyText(d, block('rpt_understanding', onDate));
    d.need(30);
    let lx = d.x;
    for (const k of ['critical', 'attention', 'info']) { d.pdf.rect(lx, d.y, 10, 10, { fill: SEV[k].color }); d.pdf.text(SEV[k].label, lx + 15, d.y + 9, { size: 9.5, bold: true, fill: SEV[k].color }); lx += 150; }
    d.y += 22;
    const c = t.counts;
    d.para(`This report contains ${c.critical} critical finding${c.critical === 1 ? '' : 's'}, ${c.attention} finding${c.attention === 1 ? '' : 's'} needing attention and ${c.info} for information.`, { size: 9.5, bold: true });

    // 8–9. sections
    const photoW = (d.width - 12) / 2;
    const mediaGrid = (ids) => {
      const list = ids.map((id) => media.get(id)).filter((m) => m && m.in_pdf);
      // keep a thermal image next to its paired normal photo
      list.sort((a, b) => (a.pair_media_id === b.id ? 1 : b.pair_media_id === a.id ? -1 : 0));
      for (let i = 0; i < list.length; i += 2) {
        const row = list.slice(i, i + 2);
        const boxes = row.map((m) => {
          const img = imgs.get(m.id);
          const sz = img ? fit(img, photoW, 175) : { w: photoW, h: m.kind === 'video' ? 110 : 60 };
          const cap = [m.caption, m.kind === 'thermal' && (m.temp_min_c != null || m.temp_max_c != null) ? `Thermal: min ${m.temp_min_c ?? '–'} °C, max ${m.temp_max_c ?? '–'} °C` : '', m.kind === 'video' ? 'Video: scan the code or click to play' : ''].filter(Boolean).join(' · ');
          return { m, img, sz, cap, capLines: cap ? d.pdf.wrap(cap, photoW, 7.5) : [] };
        });
        const h = Math.max(...boxes.map((b) => b.sz.h + b.capLines.length * 9.5 + 6));
        d.need(h + 8);
        boxes.forEach((b, k) => {
          const x = d.x + k * (photoW + 12);
          const ox = x + (photoW - b.sz.w) / 2;
          if (b.img) d.pdf.image(b.img, ox, d.y, b.sz.w, b.sz.h);
          else d.pdf.rect(ox, d.y, b.sz.w, b.sz.h, { fill: C.zebra, stroke: C.line });
          if (b.m.kind === 'video') {
            const url = `${online}#m${b.m.id}`;
            const qs = Math.min(72, b.sz.h - 8);
            d.pdf.rect(ox + b.sz.w - qs - 8, d.y + b.sz.h - qs - 8, qs + 6, qs + 6, { fill: '#FFFFFF' });
            d.pdf.qr(qrMatrix(url), ox + b.sz.w - qs - 5, d.y + b.sz.h - qs - 5, qs);
            d.pdf.link(url, ox, d.y, b.sz.w, b.sz.h);
            if (!b.img) d.pdf.text('VIDEO', ox + 12, d.y + 24, { size: 14, bold: true, fill: C.muted });
          }
          b.capLines.forEach((ln, li) => d.pdf.text(ln, x, d.y + b.sz.h + 10 + li * 9.5, { size: 7.5, fill: C.muted }));
        });
        d.y += h + 8;
      }
    };
    t.sections.forEach((sc, si) => {
      d.need(120);
      rec.sections[sc.id] = d.page;
      heading(d, `${si + 1}. ${sc.name}`, { size: 13.5 });
      const cont = `${si + 1}. ${sc.name} (continued)`;
      d.onNewPage = (doc) => { doc.pdf.text(cont, doc.x, doc.y + 9, { size: 9, bold: true, fill: C.muted }); doc.y += 18; };
      if (sc.intro) bodyText(d, sc.intro, { size: 9, fill: C.muted });
      if (sc.not_inspected_reason) d.para(`Not inspected: ${sc.not_inspected_reason}.`, { size: 9.5, bold: true, fill: C.copper });
      const anyDefect = sc.items.some((it) => it.observations.some((o) => o.severity !== 'info'));
      if (!anyDefect && !sc.not_inspected_reason) d.para('No defects observed at the time of inspection.', { size: 9.5, bold: true, fill: C.blue });
      sc.items.forEach((it, ii) => {
        if (!it.observations.length && !it.attr_value) return;
        d.need(36);
        d.pdf.rect(d.x, d.y, d.width, 18, { fill: C.zebra });
        d.pdf.text(`${ii + 1}. ${it.name}`, d.x + 6, d.y + 12.5, { size: 10, bold: true, fill: C.navy });
        if (it.attr_value) d.pdf.text(`${it.attr_label || 'Type'}: ${it.attr_value}`, d.x + d.width - 6, d.y + 12.5, { size: 8.5, fill: C.muted, align: 'right' });
        d.y += 24;
        if (!it.observations.length) { d.para('No defects observed.', { size: 9, fill: C.muted, indent: 6 }); return; }
        d.para('Observations', { size: 8.5, bold: true, fill: C.muted, indent: 6, after: 3 });
        it.observations.forEach((o) => {
          rec.obs[o.id] = { page: d.page, section: si + 1, item: ii + 1 };
          const sev = SEV[o.severity];
          const text = `${o.text}${o.trade ? ` We recommend a ${o.trade} to assess and repair.` : ''}${o.reinspect_status ? `  [Re-inspection: ${REINSPECT[o.reinspect_status]}]` : ''}`;
          d.need(14);
          d.pdf.rect(d.x + 8, d.y + 4, 5, 5, { fill: sev.color });
          d.para(text, { size: 9.5, fill: sev.color, bold: o.severity === 'critical', indent: 20, after: 5 });
          if (o.media.length) mediaGrid(o.media);
        });
      });
      if (sc.media.length) { d.para('Other photos', { size: 8.5, bold: true, fill: C.muted, after: 3 }); mediaGrid(sc.media); }
      d.onNewPage = null;
      d.space(6);
    });

    // 10. glossary
    if (glossary.length) {
      part('glossary', 'Glossary');
      for (const g of glossary) { d.para(g.term, { size: 10, bold: true, fill: C.navy, after: 2 }); d.para(g.definition, { size: 9.5, after: 2 }); if (g.references_text) d.para(`Reference: ${g.references_text}`, { size: 8, fill: C.muted }); d.space(4); }
    }

    // 11. summary
    part('summary', 'Report summary');
    bodyText(d, block('rpt_summary_intro', onDate), { size: 9 });
    const sumRows = [];
    t.sections.forEach((sc, si) => sc.items.forEach((it, ii) => it.observations.forEach((o) => {
      if (!o.in_summary || o.severity === 'info') return;
      const pg = marks?.obs[o.id]?.page ?? '';
      const row = [String(pg), `${si + 1}.${ii + 1}`, `${sc.name}: ${it.name}`, o.text];
      row.fill = [C.text, C.text, C.text, SEV[o.severity].color];
      sumRows.push(row);
    })));
    if (sumRows.length) d.table([{ label: 'Page', w: 0.7 }, { label: 'Item', w: 0.8 }, { label: 'Area and item', w: 3 }, { label: 'Finding', w: 7 }], sumRows, { size: 8.5 });
    else d.para('No critical findings or findings needing attention were recorded.', { size: 10, bold: true, fill: C.blue });

    // 12–14. conclusion, terms, thermal
    part('conclusion', 'Report conclusion');
    bodyText(d, block('rpt_conclusion', onDate));
    heading(d, 'Terms and conditions');
    rec.parts.terms = d.page;
    const ag = db.prepare('SELECT tc_block_id FROM agreements WHERE job_id=? AND signed_at IS NOT NULL ORDER BY id DESC').get(j.id);
    bodyText(d, block('tc_report', onDate), { size: 8.5 });
    if (ag) d.para('The service agreement signed by the client before the inspection also applies.', { size: 8.5, fill: C.muted });
    if (r.thermal_used) { heading(d, 'Thermal imaging addendum'); rec.parts.thermal = d.page; bodyText(d, block('rpt_thermal_addendum', onDate), { size: 9 }); }

    // 15. sign-off
    heading(d, 'Sign-off');
    rec.parts.signoff = d.page;
    d.need(130);
    const colW = d.width / 2;
    const signer = (x, role, name, cred, sig, date) => {
      let y = d.y;
      d.pdf.text(role, x, y + 9, { size: 8.5, fill: C.muted });
      if (sig) { const { w, h } = fit(sig, 150, 46); d.pdf.image(sig, x, y + 14, w, h); }
      y += 64;
      d.pdf.line(x, y, x + colW - 30, y, { stroke: C.line });
      d.pdf.text(name || '', x, y + 13, { size: 10, bold: true, fill: C.text });
      d.pdf.wrap(cred || '', colW - 30, 8.5).slice(0, 2).forEach((ln, i) => d.pdf.text(ln, x, y + 25 + i * 10, { size: 8.5, fill: C.muted }));
      if (date) d.pdf.text(date, x, y + 47, { size: 8.5, fill: C.muted });
    };
    signer(d.x, 'Inspected by', ins?.name || j.inspector_name, ins?.credentials, insSig, r.inspection_date ? `Inspected ${dmy(r.inspection_date)}` : '');
    signer(d.x + colW, 'Reviewed and approved by', reviewer?.name, reviewer?.credentials, revSig, r.approved_at ? `Approved ${fmtDate(r.approved_at)}` : '');
    d.y += 120;
    d.para([s.company_name, s.rera_reg_no && `RERA registration ${s.rera_reg_no}`, s.det_licence_no && `DET licence ${s.det_licence_no}`].filter(Boolean).join('  ·  '), { size: 8.5, fill: C.muted });
    qrBox(d, online, 'Open the online report (photos and videos)');

    // 15a. attachments (appendix): an index, each image on its own page, PDF documents linked by QR code
    if (atts.length) {
      part('attachments', 'Attachments');
      d.para('The documents below are part of this report. Images are printed in this appendix. PDF documents are sent with the report email and can be downloaded from the online report: scan the code next to each one.', { size: 9.5, fill: C.muted });
      const attUrl = (a) => `${base}/api/public/report/${r.verify_token}/attachment/${a.id}`;
      const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
      d.table([{ label: 'No.', w: 0.6 }, { label: 'Title', w: 3.4 }, { label: 'Description', w: 4.2 }, { label: 'Type', w: 1.3 }, { label: 'Page', w: 0.9, align: 'right' }],
        atts.map((a, i) => [`A${i + 1}`, a.title, a.description || '', a.kind === 'pdf' ? `PDF, ${kb(a.size)}` : 'Image', a.kind === 'pdf' ? 'Online' : String(marks?.atts[a.id] ?? '')]), { size: 8.5 });
      atts.forEach((a, i) => {
        if (a.kind !== 'pdf') return;
        rec.atts[a.id] = d.page;
        const url = attUrl(a);
        const descLines = d.pdf.wrap(a.description || '', d.width - 110, 8.5).slice(0, 3);
        d.need(92);
        d.pdf.rect(d.x, d.y, d.width, 84, { fill: C.zebra, stroke: C.line });
        d.pdf.qr(qrMatrix(url), d.x + 8, d.y + 8, 68);
        d.pdf.link(url, d.x, d.y, d.width, 84);
        d.pdf.text(`A${i + 1}. ${a.title}`, d.x + 88, d.y + 22, { size: 10.5, bold: true, fill: C.navy });
        descLines.forEach((ln, k) => d.pdf.text(ln, d.x + 88, d.y + 37 + k * 11, { size: 8.5, fill: C.text }));
        d.pdf.text(`PDF document, ${kb(a.size)}. Scan or click to download.`, d.x + 88, d.y + 74, { size: 8, fill: C.sky });
        d.y += 92;
      });
      atts.forEach((a, i) => {
        if (a.kind !== 'image') return;
        d.newPage();
        rec.atts[a.id] = d.page;
        heading(d, `A${i + 1}. ${a.title}`, { size: 12.5, before: 0 });
        if (a.description) d.para(a.description, { size: 9, fill: C.muted });
        const img = attImgs.get(a.id);
        if (img) { const { w, h } = fit(img, d.width, d.bottom - d.y - 6); d.pdf.image(img, d.x + (d.width - w) / 2, d.y, w, h); d.y += h + 6; }
        else d.para('This image could not be printed. It is available from the online report.', { size: 9, fill: C.red });
      });
    }

    // 16. back page
    d.newPage({ chrome: false });
    d.pdf.rect(0, 0, PAGE_W, PAGE_H, { fill: C.navy });
    if (LOGO) { d.pdf.rect(PAGE_W / 2 - 98, 230, 196, 120, { fill: '#FFFFFF' }); d.pdf.image(LOGO, PAGE_W / 2 - 88, 240, 176, 100); }
    d.pdf.text('Thank you for choosing us', PAGE_W / 2, 410, { size: 18, bold: true, fill: '#FFFFFF', align: 'center' });
    const cl = companyLines(s);
    [s.tagline, cl.address, cl.contact, cl.regs].filter(Boolean).forEach((ln, i) => d.pdf.text(ln, PAGE_W / 2, 440 + i * 16, { size: 9.5, fill: i === 0 ? '#D3A57C' : '#FFFFFF', align: 'center' }));

    const buf = d.finish();
    return { buf, pages: d.pdf.pages.length, marks: rec };
  }

  return { quotePdf, agreementPdf: agreementPdfAsync, agreementPdfSync: agreementPdf, receiptPdf, invoicePdf, commissionPdf, reportPdf, amountInWords };
}
