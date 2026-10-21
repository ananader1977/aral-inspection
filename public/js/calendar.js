// Appointment calendar: week view Mon–Sat with hour rows, Prev / Today / Next, a colour legend,
// a list on phones and a grid on wider screens (same layout as the Consultancy app), filtered by inspector.
import { h, fill, t, fmtStamp } from '/js/common.js';
import { S, A, can, go, modal, closeModal, run } from '/js/app.js';

const HOUR = 3600e3, DAY = 24 * HOUR;
const dubai = (ts) => new Date(ts + 4 * HOUR); // read with getUTC*
const mondayOf = (ts) => { const midnight = ts - ((ts + 4 * HOUR) % DAY); return midnight - ((dubai(midnight).getUTCDay() + 6) % 7) * DAY; };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (ts) => { const d = dubai(ts); return `${t(DOW[d.getUTCDay()])} ${d.getUTCDate()} ${t(MON[d.getUTCMonth()])}`; };
const hhmm = (ts) => dubai(ts).toISOString().slice(11, 16);
const CLS = (s) => (['report_issued', 'invoiced', 'closed'].includes(s) ? 'done' : s === 'access_failed' ? 'failed' : ['report_draft', 'under_review'].includes(s) ? 'progress' : 'booked');
export const LEGEND = [['booked', 'Booked'], ['progress', 'In progress / review'], ['done', 'Report issued'], ['failed', 'Access failed']];

const st = { week: null, inspector: '' };

export async function calendarView(el, parts = []) {
  // #calendar/2026-10-26 opens the week of that day (link from the job page)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(parts[0] || '');
  if (m) st.week = mondayOf(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 8) - 4 * HOUR);
  st.week ??= mondayOf(Date.now());
  const from = st.week, to = st.week + 7 * DAY;
  const d = await A('GET', `/calendar?from=${from}&to=${to}${st.inspector ? `&inspector_id=${st.inspector}` : ''}`);
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => from + i * DAY); // Monday to Sunday
  const { start: ws, end: we } = d.work;
  const hours = [];
  for (let hr = ws; hr < we; hr++) hours.push(hr);
  const now = Date.now();
  const cell = (a) => h('button', { class: `cell ${CLS(a.status)}${a.end < now ? ' past' : ''}`, type: 'button', title: `${a.number} · ${a.client}`, onclick: () => detail(a) },
    h('b', {}, `${hhmm(a.start)} ${a.number.replace(/^JOB-\d{4}-/, '#')}`), h('span', {}, a.where || a.client), st.inspector ? null : h('span', { class: 'ins' }, a.inspector || t('No inspector')));
  // the grid: one row per hour, appointments placed in the hour they start
  const grid = h('div', { class: 'calgrid' }, h('div', { class: 'h' }), days.map((x) => h('div', { class: `h ${x <= now && now < x + DAY ? 'today' : ''} ${dubai(x).getUTCDay() === 0 ? 'sun' : ''}` }, dayLabel(x))));
  for (const hr of hours) {
    grid.append(h('div', { class: 't' }, `${String(hr).padStart(2, '0')}:00`));
    for (const x of days) {
      const slotStart = x + hr * HOUR;
      const inSlot = d.rows.filter((a) => a.start >= slotStart && a.start < slotStart + HOUR);
      const early = hr === ws ? d.rows.filter((a) => a.start >= x && a.start < slotStart) : [];
      const late = hr === we - 1 ? d.rows.filter((a) => a.start >= slotStart + HOUR && a.start < x + DAY) : [];
      grid.append(h('div', { class: dubai(x).getUTCDay() === 0 ? 'sun' : '' }, [...early, ...inSlot, ...late].map(cell)));
    }
  }
  const mob = h('div', { class: 'calmob' }, days.map((x) => {
    const list = d.rows.filter((a) => a.start >= x && a.start < x + DAY);
    return h('div', { class: 'card' }, h('h3', {}, dayLabel(x)), list.length ? h('div', { class: 'callist' }, list.map(cell)) : h('p', { class: 'small muted' }, t('No appointments')));
  }));
  const step = (n) => { st.week = n === 0 ? mondayOf(Date.now()) : st.week + n * 7 * DAY; calendarView(el); };
  fill(el,
    h('div', { class: 'card' },
      h('div', { class: 'actions' }, h('h1', {}, t('Calendar')), h('span', { class: 'spacer' }),
        d.inspectors.length ? h('select', { 'aria-label': t('Inspector'), onchange: (e) => { st.inspector = e.target.value; calendarView(el); } }, h('option', { value: '' }, t('All inspectors')), d.inspectors.map((i) => h('option', { value: i.id, selected: String(i.id) === st.inspector }, i.name))) : null,
        can('jobs.manage') ? h('button', { class: 'btn alt sm', onclick: feedDialog }, t('Subscribe in Outlook / Google')) : null),
      h('div', { class: 'weekbar' }, h('button', { class: 'btn alt sm', onclick: () => step(-1) }, `‹ ${t('Prev')}`), h('b', {}, `${dayLabel(days[0])} – ${dayLabel(days[6])}`),
        h('button', { class: 'btn alt sm', onclick: () => step(0) }, t('Today')), h('button', { class: 'btn alt sm', onclick: () => step(1) }, `${t('Next')} ›`)),
      h('div', { class: 'legend' }, LEGEND.map(([k, l]) => h('span', {}, h('i', { class: `cell ${k}` }), t(l))), h('span', { class: 'muted' }, t('{n} appointments this week', { n: d.rows.length }))),
      mob, grid),
    upcomingCard(d.upcoming || []));

  function upcomingCard(list) {
    const later = list.filter((a) => a.start >= to);
    if (!later.length) return null;
    return h('div', { class: 'card' }, h('h2', {}, t('Coming up after this week')),
      h('div', { class: 'tablewrap' }, h('table', {}, h('tbody', {}, later.map((a) => h('tr', { class: 'click', onclick: () => { st.week = mondayOf(a.start); calendarView(el); window.scrollTo(0, 0); } },
        h('td', { class: 'nowrap' }, `${dayLabel(a.start)} ${hhmm(a.start)}`), h('td', { class: 'ltr' }, a.number), h('td', {}, a.client, h('div', { class: 'small muted' }, a.where)), h('td', {}, a.inspector || '-')))))));
  }
  function detail(a) {
    modal(h('h2', { class: 'ltr' }, a.number), h('dl', { class: 'kv' },
      h('dt', {}, t('When')), h('dd', {}, `${fmtStamp(a.start)} – ${hhmm(a.end)}`),
      h('dt', {}, t('Client')), h('dd', {}, a.client), h('dt', {}, t('Service')), h('dd', {}, a.service),
      h('dt', {}, t('Where')), h('dd', {}, a.where || '-'), h('dt', {}, t('Inspector')), h('dd', {}, a.inspector || '-'),
      h('dt', {}, t('Status')), h('dd', {}, t(a.status_label))),
    h('p', { class: 'actions' },
      can('jobs.view') ? h('button', { class: 'btn', onclick: () => { closeModal(); go(`jobs/${a.id}`); } }, t('Open job')) : null,
      can('inspect') && ['scheduled', 'report_draft', 'access_failed'].includes(a.status) ? h('button', { class: 'btn cu', onclick: () => { closeModal(); go(`inspect/${a.id}`); } }, t('Open the inspection')) : null,
      h('button', { class: 'btn alt', onclick: closeModal }, t('Close'))));
  }
  async function feedDialog() {
    const r = await run(() => A('GET', '/calendar/feed'));
    if (!r) return;
    const copy = (u) => h('button', { class: 'btn alt sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(u); } catch { /* ignore */ } } }, t('Copy'));
    modal(h('h2', {}, t('Calendar subscription')), h('p', { class: 'small muted' }, t('Add this link as an internet calendar in Outlook, Google Calendar or your phone. It updates automatically. Keep it private.')),
      h('h3', {}, t('All inspections')), h('div', { class: 'secret small' }, r.url), copy(r.url),
      r.inspectors.length ? h('h3', {}, t('One inspector (send this to the inspector)')) : null,
      r.inspectors.map((i) => h('div', { class: 'actions' }, h('b', {}, i.name), h('span', { class: 'spacer' }), copy(i.url))),
      h('p', { class: 'actions' }, h('button', { class: 'btn alt', onclick: closeModal }, t('Close'))));
  }
}
