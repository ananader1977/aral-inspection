// Demo card checkout (PAYMENT_PROVIDER=mock). No real money: accepts the test card 4242 4242 4242 4242.
import { api, h, fill, t, money, toast, app, param, initLang, card, demoBanner, failBox } from '/js/pub/shared.js';

const sid = param('s');
let s;
initLang(draw);
start();

async function start() {
  try { s = await api('GET', `/api/public/pay-demo/${encodeURIComponent(sid)}`); draw(); } catch (e) { failBox(e); }
}
function draw() {
  if (!s) return;
  if (s.status === 'paid') return fill(app, card(h('h1', {}, t('Payment received')), h('p', {}, t('Thank you.')), h('p', {}, h('a', { class: 'btn cu', href: s.back }, t('Back')))));
  const fmt = (e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 16); e.target.value = d.replace(/(.{4})/g, '$1 ').trim(); };
  const f = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try { const r = await api('POST', `/api/public/pay-demo/${encodeURIComponent(sid)}`, { card: f.card.value, expiry: f.expiry.value, cvc: f.cvc.value }); location.href = r.back; }
    catch (x) { toast(x.message, 6000); btn.disabled = false; }
  } },
  h('label', {}, t('Card number')), h('input', { name: 'card', inputmode: 'numeric', autocomplete: 'cc-number', class: 'ltr', required: true, placeholder: '4242 4242 4242 4242', oninput: fmt }),
  h('div', { class: 'grid2' }, h('div', {}, h('label', {}, t('Expiry (MM/YY)')), h('input', { name: 'expiry', class: 'ltr', required: true, placeholder: '12/30', autocomplete: 'cc-exp' })),
    h('div', {}, h('label', {}, 'CVC'), h('input', { name: 'cvc', class: 'ltr', inputmode: 'numeric', required: true, maxlength: 4, placeholder: '123', autocomplete: 'cc-csc' }))));
  const btn = h('button', { class: 'btn cu block' }, `${t('Pay')} ${money(s.amount)}`);
  f.append(h('p', {}, btn));
  fill(app, h('h1', {}, t('Secure payment')), demoBanner(), card(h('p', {}, h('b', {}, s.what), ' · ', s.company), f), h('p', {}, h('a', { href: s.back }, t('Cancel and go back'))));
}
