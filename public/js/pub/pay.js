// Invoice payment page (link in the invoice email and the QR code on the invoice PDF).
import { api, h, fill, t, money, fmtDay, toast, app, param, initLang, card, kv, failBox } from '/js/pub/shared.js';

const tok = param('i');
let inv;
initLang(draw);
start();

async function start() {
  try {
    if (param('done') && param('s')) await api('POST', `/api/public/checkout/${encodeURIComponent(param('s'))}/confirm`, {}).catch(() => {});
    inv = await api('GET', `/api/public/invoice/${encodeURIComponent(tok)}`);
    draw();
  } catch (e) { failBox(e); }
}
function draw() {
  if (!inv) return;
  fill(app, h('h1', {}, `${t(inv.tax ? 'Tax invoice' : 'Invoice')} ${inv.number}`), h('p', { class: 'muted' }, `${inv.company} · ${inv.client}`),
    inv.balance > 0 ? card(h('h2', {}, t('Balance due'), ': ', money(inv.balance)), h('p', {}, h('button', { class: 'btn cu block', onclick: pay }, t('Pay by card')))) : h('div', { class: 'alert good' }, inv.status === 'cancelled' ? t('This invoice was cancelled.') : t('This invoice is paid in full. Thank you.')),
    card(kv([['Issued', fmtDay(inv.issue_date)], ['Due', fmtDay(inv.due_date)], ['Total', money(inv.total)]]),
      h('div', { class: 'tablewrap' }, h('table', {}, h('tbody', {}, inv.lines.map((l) => h('tr', {}, h('td', {}, l.description), h('td', { class: 'num' }, money(l.amount))))))),
      h('p', {}, h('a', { class: 'btn alt sm', href: `/api/public/invoice/${encodeURIComponent(tok)}/pdf`, target: '_blank' }, t('Download the PDF')))));
}
async function pay() {
  try { const r = await api('POST', `/api/public/invoice/${encodeURIComponent(tok)}/pay`, {}); location.href = r.url; }
  catch (e) { toast(e.message, 6000); }
}
