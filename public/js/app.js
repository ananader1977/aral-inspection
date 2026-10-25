import { api, h, $, fill, toast, pill, t, money, fmtStamp } from '/js/common.js';
import { setLang, savedLang, getLang } from '/js/i18n.js';
import { settingsView } from '/js/settings.js';
import { leadsView } from '/js/leads.js';
import { jobsView, clientsView, statusPill } from '/js/jobs.js';
import { calendarView } from '/js/calendar.js';
import { inspectView } from '/js/inspect.js';
import { reviewsView } from '/js/reviews.js';
import { financeView } from '/js/finance.js';
import { isApp, startNative, forgetDevice, lockAvailable, lockOn, setLock, sendTestPush } from '/js/native.js';

const app = $('#app'), dlg = $('#dlg'), nav = $('#nav');
export const S = { me: null, cfg: null, lk: null };
export const A = (m, p, b) => api(m, `/api/app${p}`, b);
export const can = (perm) => !!S.me?.permissions?.includes(perm);
export const run = async (fn, ok) => { try { const r = await fn(); if (ok) toast(t(ok)); return r; } catch (e) { toast(e.message, 6000); return null; } };
export const go = (hash) => { if (location.hash === `#${hash}`) route(); else location.hash = hash; };
export function modal(...kids) {
  dlg.replaceChildren(h('div', { class: 'dlg' }, ...kids));
  if (!dlg.open) dlg.showModal();
  return dlg;
}
export const closeModal = () => dlg.open && dlg.close();
export const field = (label, input, hint) => h('div', {}, h('label', {}, t(label)), input, hint ? h('div', { class: 'small muted' }, t(hint)) : null);
/** In-page confirmation (no browser confirm()). Resolves true when the user presses the confirm button. */
export const confirmBox = (title, text, okLabel = 'Confirm', danger = true) => new Promise((resolve) => {
  const done = (v) => { closeModal(); resolve(v); };
  modal(h('h2', {}, t(title)), text ? h('p', {}, text) : null,
    h('p', { class: 'actions' }, h('button', { class: `btn ${danger ? 'danger' : ''}`, onclick: () => done(true) }, t(okLabel)), h('button', { class: 'btn alt', onclick: () => done(false) }, t('Cancel'))));
  dlg.addEventListener('close', () => resolve(false), { once: true });
});

window.addEventListener('hashchange', route);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();

async function boot() {
  S.cfg = await api('GET', '/api/config').catch(() => ({ lang: 'en' }));
  await setLang(savedLang(S.cfg.lang || 'en'));
  try { S.me = (await api('GET', '/api/me')).user; }
  catch (e) {
    if (e.extra?.setup_2fa) { S.me = null; return twoFactorSetup(true); }
    return loginView();
  }
  if (S.me.ui_lang && S.me.ui_lang !== getLang()) await setLang(S.me.ui_lang);
  if (S.me.must_setup_2fa) return twoFactorSetup(true);
  S.lk = await A('GET', '/lookups').catch(() => ({}));
  drawNav();
  route();
  startNative(S.me, S.cfg);
}

function langButtons(after) {
  return [['en', 'English'], ['ar', 'العربية']].map(([k, l]) => h('button', { class: `btn sm ${getLang() === k ? '' : 'alt'}`, type: 'button', onclick: async () => {
    await setLang(k);
    if (S.me) await api('POST', '/api/me/lang', { lang: k }).catch(() => {});
    after();
  } }, l));
}

function drawNav() {
  $('#brand-sub').textContent = t('Property Inspection Services');
  nav.replaceChildren(
    h('span', { class: 'who' }, `${S.me.name} · ${t(S.me.role_label)}`),
    h('a', { class: 'btn alt sm', href: '#account' }, t('My account')),
    h('button', { class: 'btn alt sm', onclick: async () => { await forgetDevice(); await api('POST', '/api/logout', {}); location.hash = ''; location.reload(); } }, t('Sign out')));
}

function loginView() {
  nav.replaceChildren();
  $('#brand-sub').textContent = t('Property Inspection Services');
  const err = h('div', { class: 'alert bad hide', role: 'alert' });
  const showErr = (m) => { err.textContent = m; err.classList.remove('hide'); };
  const pwForm = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(pwForm));
    try {
      const r = await api('POST', '/api/login', { ...v, lang: getLang() });
      if (r.need_code) return codeStep(r.token);
      boot();
    } catch (x) { showErr(x.message); }
  } },
  field('Email', h('input', { name: 'email', type: 'email', autocomplete: 'username', required: true, class: 'ltr' })),
  field('Password', h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })), err,
  h('p', {}, h('button', { class: 'btn block cu' }, t('Sign in'))));
  const card = h('div', { class: 'card' }, h('img', { class: 'logo', src: '/logo.jpg', alt: 'A R A L Property Inspection Services', width: 260, height: 150 }), h('h1', { class: 'center' }, t('Sign in')), pwForm, h('div', { class: 'lang' }, langButtons(loginView)));
  fill(app, h('div', { class: 'login' }, card));

  function codeStep(token) {
    const err2 = h('div', { class: 'alert bad hide', role: 'alert' });
    const f = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/login/code', { token, code: f.code.value }); boot(); }
      catch (x) { err2.textContent = x.message; err2.classList.remove('hide'); f.code.select(); }
    } }, h('p', {}, t('Open your authenticator app and enter the 6-digit code for A R A L.')),
    h('input', { name: 'code', class: 'code-in', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, required: true, 'aria-label': t('6-digit code') }), err2,
    h('p', {}, h('button', { class: 'btn block cu' }, t('Continue'))), h('p', { class: 'center' }, h('button', { class: 'btn alt sm', type: 'button', onclick: loginView }, t('Back'))));
    fill(card, h('img', { class: 'logo', src: '/logo.jpg', alt: '', width: 260, height: 150 }), h('h1', { class: 'center' }, t('Two-step sign-in')), f);
    f.code.focus();
  }
}

/** Authenticator app set-up. `forced` = the role requires it before anything else. */
async function twoFactorSetup(forced) {
  nav.replaceChildren(h('button', { class: 'btn alt sm', onclick: async () => { await api('POST', '/api/logout', {}); location.reload(); } }, t('Sign out')));
  const r = await api('POST', '/api/me/2fa/start', {}).catch((e) => { toast(e.message); return null; });
  if (!r) return;
  const err = h('div', { class: 'alert bad hide', role: 'alert' });
  const pretty = r.secret.match(/.{1,4}/g).join(' ');
  const f = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/me/2fa/confirm', { code: f.code.value }); toast(t('Two-step sign-in is on')); location.hash = forced ? 'dashboard' : 'account'; boot(); }
    catch (x) { err.textContent = x.message; err.classList.remove('hide'); }
  } },
  h('ol', {},
    h('li', {}, t('Install Google Authenticator or Microsoft Authenticator on your phone.')),
    h('li', {}, t('In the app, choose "Enter a setup key". Account name: A R A L. Key:'), h('div', { class: 'secret' }, pretty), h('div', { class: 'small muted' }, t('On this phone? '), h('a', { href: r.uri }, t('Open in authenticator app')))),
    h('li', {}, t('Type the 6-digit code the app shows:'))),
  h('input', { name: 'code', class: 'code-in', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, required: true, 'aria-label': t('6-digit code') }), err,
  h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Turn on two-step sign-in')), forced ? null : h('a', { class: 'btn alt', href: '#account' }, t('Cancel'))));
  fill(app, h('div', { class: 'login' }, h('div', { class: 'card' }, h('h1', {}, t('Set up two-step sign-in')),
    forced ? h('div', { class: 'alert info' }, t('Your role needs a code from an authenticator app each time you sign in. This protects client reports and payments.')) : null, f)));
}

// ---------- routing ----------
const TABS = () => [['dashboard', 'Dashboard'],
  ...(can('leads.manage') ? [['leads', 'Leads']] : []),
  ...(can('jobs.view') ? [['jobs', 'Jobs']] : []),
  ...(can('calendar.view') ? [['calendar', 'Calendar']] : []),
  ...(can('inspect') ? [['inspect', S.me.role === 'inspector' ? 'My inspections' : 'Inspections']] : []),
  ...(can('reports.review') ? [['reviews', 'Reviews']] : []),
  ...(can('finance.view') ? [['finance', 'Finance']] : []),
  ...(can('settings.view') ? [['settings', 'Settings']] : [])];
const VIEWS = { leads: ['leads.manage', (b) => leadsView(b)], jobs: ['jobs.view', jobsView], clients: ['jobs.view', clientsView], calendar: ['calendar.view', calendarView], inspect: ['inspect', inspectView], reviews: ['jobs.view', reviewsView], finance: ['finance.view', financeView], settings: ['settings.view', settingsView] };
async function route() {
  if (!S.me) return;
  const parts = (location.hash.slice(1) || 'dashboard').split('/');
  const name = parts[0];
  const tabs = h('div', { class: 'tabs' }, TABS().map(([k, l]) => h('a', { class: name === k || (name === 'clients' && k === 'jobs') ? 'on' : '', href: `#${k}` }, t(l))));
  const body = h('div', {}, h('p', { class: 'muted' }, t('Loading…')));
  fill(app, tabs, body);
  window.scrollTo(0, 0);
  try {
    const v = VIEWS[name];
    if (v && (can(v[0]) || (name === 'reviews' && can('reports.review')))) await v[1](body, parts.slice(1));
    else if (name === 'account') await accountView(body);
    else await dashboard(body);
  } catch (e) {
    fill(body, h('div', { class: 'alert bad' }, e.message));
  }
}
export const refresh = route;

async function dashboard(el) {
  const [d, k] = await Promise.all([A('GET', '/dashboard'), A('GET', '/kpis')]);
  const done = d.setup.filter((s) => s.done).length;
  const kpi = (v, label, href, cu) => h(href ? 'a' : 'div', { class: `kpi ${cu ? 'cu' : ''}`, ...(href ? { href } : {}) }, h('b', {}, v), h('span', {}, t(label)));
  const open = k.open || {};
  const sum = (...keys) => keys.reduce((a, x) => a + (open[x] || 0), 0);
  const visits = k.today_visits || [];
  fill(el,
    S.me.role === 'inspector' ? h('div', { class: 'kpis' }, kpi(k.mine, 'Visits to do', '#inspect', true), kpi(k.returned, 'Reports returned to you', '#inspect')) : h('div', { class: 'kpis' },
      d.leads ? kpi(d.leads.open, d.leads.overdue ? t('Open leads · {n} waiting over 2 hours', { n: d.leads.overdue }) : 'Open leads', '#leads', !!d.leads.overdue) : null,
      kpi(`${k.jobs_month}${k.target ? ` / ${k.target}` : ''}`, 'Jobs this month (target)', can('jobs.view') ? '#jobs' : null),
      kpi(sum('new', 'quoted', 'quote_accepted', 'agreement_signed', 'payment_pending'), 'Waiting for quote, signature or payment', can('jobs.view') ? '#jobs' : null),
      kpi(sum('paid', 'access_failed'), 'Paid, not yet booked', can('jobs.view') ? '#jobs' : null, sum('paid', 'access_failed') > 0),
      kpi(k.reviews_waiting, 'Reports waiting for review', can('reports.review') ? '#reviews' : null, k.reviews_waiting > 0),
      kpi(k.reports_month, 'Reports issued this month'),
      kpi(k.sla_pct == null ? '-' : `${k.sla_pct}%`, 'Reports on time this month'),
      kpi(k.review_score?.n ? `${k.review_score.a} ★` : '-', t('Client rating (target {n})', { n: k.review_target })),
      k.revenue_month != null ? kpi(money(k.revenue_month), 'Invoiced this month (excl. VAT)', '#finance', true) : null,
      k.collected_month != null ? kpi(money(k.collected_month), 'Collected this month', '#finance/payments', true) : null,
      k.outstanding != null ? kpi(money(k.outstanding), 'Outstanding invoices', '#finance/aging', true) : null,
      k.commission_payable != null ? kpi(money(k.commission_payable), 'Commission to pay', '#finance/commissions', true) : null),
    d.links?.mismatch ? h('div', { class: 'alert bad' }, h('b', {}, t('Client links will not open.')), ' ', t('Emails and the client link use {a}, but this app is at {b}. On Render, set BASE_URL to {b} and redeploy.', { a: d.links.base_url, b: d.links.using })) : null,
    k.turnover_12m != null && !k.vat_registered && k.turnover_12m > 300000 ? h('div', { class: 'alert' }, t('Turnover in the last 12 months is {n}. VAT registration is mandatory above AED 375,000.', { n: money(k.turnover_12m) })) : null,
    visits.length ? h('div', { class: 'card' }, h('h2', {}, t("Today's visits")), h('div', { class: 'tablewrap' }, h('table', {}, h('tbody', {}, visits.map((v) => h('tr', { class: 'click', onclick: () => go(can('jobs.view') ? `jobs/${v.id}` : `inspect/${v.id}`) }, h('td', { class: 'nowrap' }, fmtStamp(v.scheduled_start).slice(-5)), h('td', { class: 'ltr' }, v.number), h('td', {}, v.client_name, h('div', { class: 'small muted' }, [v.building, v.unit_no].filter(Boolean).join(' '))), h('td', {}, v.inspector_name || '-'), h('td', {}, statusPill(v.status)))))))) : null,
    k.sla_late?.length ? h('div', { class: 'card' }, h('h2', {}, t('Reports past their due time')), k.sla_late.map((j) => h('p', {}, h('a', { href: `#jobs/${j.id}`, class: 'ltr' }, j.number), ` · ${j.client_name} · `, pill(fmtStamp(j.sla_due_at), 'bad')))) : null,
    d.setup.length && done < d.setup.length ? h('div', { class: 'card' }, h('div', { class: 'actions' }, h('h2', {}, t('Before you go live')), h('span', { class: 'spacer' }), pill(`${done} / ${d.setup.length}`, done === d.setup.length ? 'ok' : 'cu')),
      h('ul', { class: 'checklist' }, d.setup.map((s) => h('li', { class: s.done ? 'done' : '' }, h('i', { class: 'dot', 'aria-hidden': 'true' }, s.done ? '✓' : ''), h('span', {}, t(s.label)), h('span', { class: 'spacer' }), s.done ? null : h('a', { class: 'btn alt sm', href: `#${s.href}` }, t('Open')))))) : null,
    d.expiring.length ? h('div', { class: 'card' }, h('h2', {}, t('Expiring in the next 45 days')), h('div', { class: 'tablewrap' }, h('table', {}, h('tbody', {}, d.expiring.map((x) => h('tr', {}, h('td', {}, t(x.kind === 'inspector' ? 'Inspector' : 'Equipment')), h('td', {}, x.name), h('td', { class: 'num' }, pill(x.due.split('-').reverse().join('/'), x.due < new Date().toISOString().slice(0, 10) ? 'bad' : 'warn')))))))) : null);
}

async function accountView(el) {
  const me = S.me;
  const pw = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(pw));
    if (v.password !== v.again) return toast(t('The two new passwords are different.'));
    if (await run(() => api('POST', '/api/me/password', { current: v.current, password: v.password }), 'Password changed')) pw.reset();
  } }, h('h2', {}, t('Change your password')),
  field('Current password', h('input', { name: 'current', type: 'password', required: true, autocomplete: 'current-password' })),
  field('New password', h('input', { name: 'password', type: 'password', required: true, minlength: 10, autocomplete: 'new-password' }), 'At least 10 characters, with letters and numbers.'),
  field('New password again', h('input', { name: 'again', type: 'password', required: true, autocomplete: 'new-password' })),
  h('p', {}, h('button', { class: 'btn' }, t('Change password'))));
  const twofa = h('div', { class: 'card' }, h('h2', {}, t('Two-step sign-in')),
    me.has2fa ? h('p', {}, pill(t('On'), 'ok'), ' ', t('A code from your authenticator app is needed at each sign-in.')) : h('p', {}, pill(t('Off')), ' ', t('Add a code from your phone to protect your account.')),
    h('p', { class: 'actions' },
      me.has2fa ? null : h('button', { class: 'btn cu', onclick: () => twoFactorSetup(false) }, t('Set up')),
      me.has2fa && !me.needs2fa ? h('button', { class: 'btn danger', onclick: () => disable2fa() }, t('Turn off')) : null,
      me.has2fa && me.needs2fa ? h('span', { class: 'small muted' }, t('Required for your role. Ask the Super Admin to reset it if you change phone.')) : null));
  const phone = isApp ? h('div', { class: 'card' }, h('h2', {}, t('This phone')), h('p', { class: 'muted' }, t('Loading…'))) : null;
  if (phone) (async () => {
    const lockOk = await lockAvailable();
    const dev = await A('GET', '/devices').catch(() => ({ rows: [], push: {} }));
    const lockBox = h('input', { type: 'checkbox', checked: lockOn(), onchange: () => { setLock(lockBox.checked); toast(t(lockBox.checked ? 'The app will ask for Face ID / fingerprint.' : 'The app lock is off.')); } });
    phone.replaceChildren(h('h2', {}, t('This phone')),
      lockOk ? h('label', { class: 'check' }, lockBox, ' ', t('Lock the app with Face ID / fingerprint (after 5 minutes away)')) : h('p', { class: 'small muted' }, t('Set a screen lock (Face ID, fingerprint or PIN) on this phone to lock the app.')),
      h('h3', {}, t('Notifications')),
      dev.rows.length ? h('p', {}, pill(t('On'), 'ok'), ' ', t('New jobs, returned reports and office alerts arrive on this phone.')) : h('p', { class: 'small muted' }, t(Object.values(dev.push || {}).some(Boolean) ? 'Allow notifications for A R A L in the phone settings, then open the app again.' : 'Notifications are not set up on the server yet.')),
      dev.rows.length ? h('p', {}, h('button', { class: 'btn alt sm', onclick: () => run(sendTestPush, 'Test sent') }, t('Send a test notification'))) : null);
  })();
  fill(el, h('h1', {}, t('My account')),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('dl', { class: 'kv' }, h('dt', {}, t('Name')), h('dd', {}, me.name), h('dt', {}, t('Email')), h('dd', { class: 'ltr' }, me.email), h('dt', {}, t('Role')), h('dd', {}, t(me.role_label))),
        h('h3', {}, t('Language')), h('div', { class: 'actions' }, langButtons(() => { drawNav(); route(); }))),
      h('div', { class: 'card' }, pw)),
    phone, twofa);
  function disable2fa() {
    const f = h('form', { onsubmit: async (e) => { e.preventDefault(); if (await run(() => api('POST', '/api/me/2fa/disable', { code: f.code.value }), 'Two-step sign-in is off')) { closeModal(); boot(); } } },
      h('h2', {}, t('Turn off two-step sign-in')), field('6-digit code', h('input', { name: 'code', class: 'code-in', inputmode: 'numeric', required: true })),
      h('p', { class: 'actions' }, h('button', { class: 'btn danger' }, t('Turn off')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
    modal(f);
  }
}
