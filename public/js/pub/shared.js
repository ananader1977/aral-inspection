// Shared helpers for the client pages (quotation, payment, online report, verification).
import { api, h, $, fill, t, money, fmtDay, fmtStamp, toast } from '/js/common.js';
import { setLang, savedLang, getLang } from '/js/i18n.js';

export { api, h, $, fill, t, money, fmtDay, fmtStamp, toast };
export const app = $('#app');
export const param = (k) => new URLSearchParams(location.search).get(k) || '';

/** Language buttons in the header; redraw() is called after switching. */
export async function initLang(redraw) {
  await setLang(savedLang('en'));
  const nav = $('#nav');
  const draw = () => fill(nav, [['en', 'EN'], ['ar', 'ع']].map(([k, l]) => h('button', { class: `btn sm ${getLang() === k ? '' : 'alt'}`, onclick: async () => { await setLang(k); draw(); redraw(); } }, l)));
  draw();
}
export const card = (...kids) => h('div', { class: 'card' }, ...kids);
export const kv = (pairs) => h('dl', { class: 'kv' }, pairs.filter(([, v]) => v !== '' && v != null).flatMap(([k, v]) => [h('dt', {}, t(k)), h('dd', {}, v)]));
export const paras = (text) => String(text || '').split(/\n\s*\n/).filter((p) => p.trim()).map((p) => h('p', { class: 'small' }, p.trim()));
export const demoBanner = () => h('div', { class: 'alert demo' }, h('b', {}, t('DEMO — no real payment.')), ' ', t('Use the test card 4242 4242 4242 4242, any future expiry date and any 3-digit CVC.'));
export const failBox = (e) => fill(app, card(h('h1', {}, t('Sorry')), h('p', {}, e.message)));
