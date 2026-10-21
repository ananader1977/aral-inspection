// QR verification page printed on every report cover.
import { api, h, fill, t, fmtDay, fmtStamp, app, param, initLang, card, kv } from '/js/pub/shared.js';

let v, err;
initLang(draw);
start();
async function start() {
  try { v = await api('GET', `/api/public/verify/${encodeURIComponent(param('t'))}`); } catch (e) { err = e; }
  draw();
}
function draw() {
  if (err) return fill(app, card(h('div', { class: 'alert bad' }, h('b', {}, t('Not verified.')), ' ', t('We could not find a report for this code. Please contact us.'))));
  if (!v) return;
  fill(app, card(v.superseded ? h('div', { class: 'alert' }, h('b', {}, t('Superseded.')), ' ', t('A newer version of this report exists.')) : h('div', { class: 'alert good' }, h('b', {}, t('Verified.')), ' ', t('This report was issued by {c}.', { c: v.company })),
    kv([['Report no.', v.number], ['Title', v.title], ['Property', v.property], ['Inspection date', fmtDay(v.inspection_date)], ['Issued', fmtStamp(v.issued_at)], ['Version', String(v.version)], ['Pages', v.pages ? String(v.pages) : ''], ['Inspector', v.inspector]]),
    h('p', {}, h('a', { class: 'btn alt', href: `/report.html?t=${encodeURIComponent(param('t'))}` }, t('Open the online report')))));
}
