// Shared helpers. No inline scripts or styles anywhere (strict Content-Security-Policy).
import { t } from '/js/i18n.js';
export { t };

export const money = (n) => `AED ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const num2 = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** DD/MM/YYYY, the UAE format. */
export const fmtDay = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : '-'; };
export const fmtMonth = (ym) => { const m = /^(\d{4})-(\d{2})/.exec(String(ym || '')); return m ? `${MO[Number(m[2]) - 1]} ${m[1]}` : ym; };
export const fmtStamp = (ts) => (ts ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ts) : '-');
export const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(Date.now());

export class ApiError extends Error { constructor(msg, status, extra) { super(msg); this.status = status; this.extra = extra || {}; } }
export async function api(method, path, body) {
  const headers = { 'X-Requested-With': 'aral' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' }); }
  catch { throw new ApiError(t('Network problem. Check your connection and try again.'), 0); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(t(data.error || `Request failed (${res.status})`), res.status, data);
  return data;
}

/** Tiny DOM builder (no innerHTML, so text typed by users can never become HTML). */
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'readOnly' || k === 'required') e[k] = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
export const $ = (s, r = document) => r.querySelector(s);
export const fill = (el, ...kids) => { el.replaceChildren(...kids.flat(9).filter((k) => k != null && k !== false)); return el; };
export function toast(msg, ms = 3500) {
  const el = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}
export const pill = (text, kind = '') => h('span', { class: `pill ${kind}` }, /^[a-z_]+$/.test(String(text)) ? String(text).replace(/_/g, ' ') : text);
export const yes = (v) => (v ? t('Yes') : t('No'));
