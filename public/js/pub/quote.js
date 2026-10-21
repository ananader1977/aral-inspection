// Client quotation page: review → accept / ask for a change / decline → sign the service agreement → pay by card.
import { api, h, fill, t, money, fmtDay, fmtStamp, toast, app, param, initLang, card, kv, paras, demoBanner, failBox } from '/js/pub/shared.js';

const tok = param('t');
let q;

initLang(draw);
start();

async function start() {
  try {
    if (param('done') && param('s')) await api('POST', `/api/public/checkout/${encodeURIComponent(param('s'))}/confirm`, {}).catch(() => {});
    q = await api('GET', `/api/public/quote/${encodeURIComponent(tok)}`);
    draw();
  } catch (e) { failBox(e); }
}

function draw() {
  if (!q) return;
  const lines = h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, t('Description')), h('th', { class: 'num' }, 'AED'))),
    h('tbody', {}, q.lines.map((l) => h('tr', {}, h('td', {}, l.description, l.qty !== 1 ? ` × ${l.qty}` : ''), h('td', { class: 'num' }, money(l.amount).replace('AED ', '')))),
      q.discount ? h('tr', {}, h('td', {}, t('Discount')), h('td', { class: 'num' }, `- ${money(q.discount).replace('AED ', '')}`)) : null,
      q.vat_rate ? h('tr', {}, h('td', {}, `${t('VAT')} ${q.vat_rate}%`), h('td', { class: 'num' }, money(q.vat).replace('AED ', ''))) : null,
      h('tr', { class: 'total' }, h('td', {}, h('b', {}, t('Total'))), h('td', { class: 'num' }, h('b', {}, money(q.total)))))));
  const steps = h('ol', { class: 'steps3' }, [['Accept the quotation', ['accepted', 'superseded'].includes(q.status) || !!q.agreement], ['Sign the service agreement', !!q.agreement?.signed], [q.credit ? 'We book your inspection' : 'Pay online', q.credit ? false : q.agreement?.signed && q.due_now <= 0]].map(([l, done]) => h('li', { class: done ? 'done' : '' }, t(l))));
  fill(app,
    h('h1', {}, `${t('Quotation')} ${q.number}`),
    h('p', { class: 'muted' }, `${q.company} · ${t('for')} ${q.client}`),
    steps,
    action(),
    card(h('h2', {}, t(q.service)), kv([['Property', q.property], ['Issued', fmtDay(q.issue_date)], ['Valid until', fmtDay(q.valid_until)], ['Report delivery', q.turnaround], ['Payment terms', q.payment_terms]]),
      q.components.length ? h('p', { class: 'small' }, h('b', {}, t('In scope')), ': ', q.components.map((x) => t(x)).join(', ')) : null,
      q.prerequisites.length ? h('p', { class: 'small' }, h('b', {}, t('Please arrange before the visit')), ': ', q.prerequisites.map((x) => t(x)).join(', ')) : null,
      lines, h('p', {}, h('a', { class: 'btn alt sm', href: `/api/public/quote/${encodeURIComponent(tok)}/pdf`, target: '_blank' }, t('Download the PDF')))),
    q.quote_terms ? h('details', { class: 'card' }, h('summary', {}, h('b', {}, t('Terms and conditions'))), paras(q.quote_terms)) : null);
}

function action() {
  if (q.superseded) return h('div', { class: 'alert' }, t('This quotation was replaced by a newer one. Please use the latest link we sent you.'));
  if (q.status === 'sent' && q.expired) return h('div', { class: 'alert' }, t('This quotation has expired. Please contact us for an updated one.'));
  if (q.status === 'rejected') return h('div', { class: 'alert' }, t('You declined this quotation. Contact us any time if you change your mind.'));
  if (q.status === 'change_requested') return h('div', { class: 'alert info' }, t('Thank you. We received your change request and will send you an updated quotation.'));
  if (q.status === 'sent') {
    const name = h('input', { required: true, autocomplete: 'name' });
    const f = h('form', { onsubmit: (e) => { e.preventDefault(); decide('accept', { name: name.value }); } },
      h('h2', {}, t('Accept the quotation')), h('label', {}, t('Your full name')), name,
      h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Accept')),
        h('button', { class: 'btn alt', type: 'button', onclick: () => noteForm('change') }, t('Ask for a change')),
        h('button', { class: 'btn danger', type: 'button', onclick: () => noteForm('reject') }, t('Decline'))),
      h('p', { class: 'small muted' }, t('By accepting you agree to the terms shown below. Next you sign the service agreement.')));
    return card(f);
  }
  if (q.agreement && !q.agreement.signed) return card(signForm());
  if (q.agreement?.signed && q.due_now > 0) {
    return card(h('h2', {}, t('Pay online')), q.payments === 'mock' ? demoBanner() : null,
      h('p', {}, t('Amount due now'), ': ', h('b', {}, money(q.due_now))),
      h('p', {}, h('button', { class: 'btn cu block', onclick: pay }, t('Pay by card'))),
      h('p', { class: 'small muted' }, t('You can also pay by bank transfer using the details in the PDF. Please quote the quotation number.')),
      h('p', {}, h('a', { class: 'btn alt sm', href: `/api/public/quote/${encodeURIComponent(tok)}/agreement.pdf`, target: '_blank' }, t('Signed agreement (PDF)'))));
  }
  if (q.agreement?.signed) return h('div', { class: 'alert good' }, h('b', {}, t('Thank you.')), ' ', q.paid > 0 ? t('Your payment is received. We will contact you to confirm the inspection date.') : t('Your agreement is signed. We will contact you to book the inspection.'), ' ',
    h('a', { href: `/api/public/quote/${encodeURIComponent(tok)}/agreement.pdf`, target: '_blank' }, t('Signed agreement (PDF)')));
  return null;
}

function noteForm(kind) {
  const box = document.getElementById('dlg');
  const note = h('textarea', { rows: 4, required: kind === 'change' });
  const name = h('input', {});
  const f = h('form', { onsubmit: (e) => { e.preventDefault(); box.close(); decide(kind, { note: note.value, name: name.value }); } },
    h('h2', {}, t(kind === 'change' ? 'Ask for a change' : 'Decline the quotation')), h('label', {}, t('Your name')), name,
    h('label', {}, t(kind === 'change' ? 'What would you like to change?' : 'Could you tell us why? (optional)')), note,
    h('p', { class: 'actions' }, h('button', { class: kind === 'change' ? 'btn cu' : 'btn danger' }, t('Send')), h('button', { class: 'btn alt', type: 'button', onclick: () => box.close() }, t('Cancel'))));
  box.replaceChildren(h('div', { class: 'dlg' }, f));
  box.showModal();
}

async function decide(action, body) {
  try { q = await api('POST', `/api/public/quote/${encodeURIComponent(tok)}/decide`, { action, ...body }); draw(); window.scrollTo(0, 0); }
  catch (e) { toast(e.message, 6000); }
}

function signForm() {
  const pad = h('canvas', { class: 'sigpad', width: 600, height: 180, 'aria-label': t('Signature') });
  const g = pad.getContext('2d');
  let drawing = false, drawn = false;
  g.lineWidth = 2.5; g.lineCap = 'round'; g.strokeStyle = '#0A1F4A';
  const pt = (e) => { const r = pad.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * pad.width, ((e.clientY - r.top) / r.height) * pad.height]; };
  pad.addEventListener('pointerdown', (e) => { drawing = true; pad.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pt(e)); });
  pad.addEventListener('pointermove', (e) => { if (!drawing) return; g.lineTo(...pt(e)); g.stroke(); drawn = true; });
  pad.addEventListener('pointerup', () => { drawing = false; });
  const name = h('input', { required: true, autocomplete: 'name' });
  const agree = h('input', { type: 'checkbox', required: true });
  const f = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    try { q = await api('POST', `/api/public/quote/${encodeURIComponent(tok)}/sign`, { name: name.value, agree: agree.checked, signature: drawn ? pad.toDataURL('image/png') : '' }); draw(); window.scrollTo(0, 0); }
    catch (x) { toast(x.message, 6000); }
  } },
  h('h2', {}, t('Sign the service agreement')),
  h('div', { class: 'pre' }, q.terms),
  h('label', {}, t('Your full name')), name,
  h('label', {}, t('Signature (draw with your finger or mouse, optional)')), pad,
  h('p', {}, h('button', { class: 'btn alt sm', type: 'button', onclick: () => { g.clearRect(0, 0, pad.width, pad.height); drawn = false; } }, t('Clear'))),
  h('label', { class: 'check' }, agree, t('I have read and agree to the service agreement and the terms.')),
  h('p', {}, h('button', { class: 'btn cu block' }, t('Sign'))),
  h('p', { class: 'small muted' }, t('Your name, the time and your IP address are recorded as your electronic signature. A copy is emailed to you.')));
  return f;
}

async function pay() {
  try { const r = await api('POST', `/api/public/quote/${encodeURIComponent(tok)}/pay`, {}); location.href = r.url; }
  catch (e) { toast(e.message, 6000); }
}
export { fmtStamp };
