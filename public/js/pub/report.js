// Online report: the same report as the PDF, with playable videos, full-size photos, the PDF download and a rating.
import { api, h, fill, t, fmtDay, fmtStamp, toast, app, param, initLang, card, kv, paras } from '/js/pub/shared.js';

const tok = encodeURIComponent(param('t'));
let r, err;
const SEV = { critical: 'Critical', attention: 'Needs attention', info: 'For information' };
initLang(draw);
start();

async function start() {
  try { r = await api('GET', `/api/public/report/${tok}`); } catch (e) { err = e; }
  draw();
  const m = /^#m(\d+)$/.exec(location.hash);
  if (m) setTimeout(() => { const el = document.getElementById(`m${m[1]}`); if (el) { el.scrollIntoView({ block: 'center' }); el.querySelector('video')?.focus(); } }, 300);
}

function draw() {
  if (err) return fill(app, card(h('h1', {}, t('Sorry')), h('p', {}, err.message)));
  if (!r) return;
  const media = new Map(r.media.map((m) => [m.id, m]));
  const strip = (ids) => {
    const list = ids.map((id) => media.get(id)).filter(Boolean);
    return list.length ? h('div', { class: 'gallery' }, list.map((m) => h('figure', { id: `m${m.id}` },
      m.kind === 'video' ? h('video', { src: `/api/public/report/${tok}/media/${m.id}`, controls: true, preload: 'none', playsinline: true, ...(m.has_thumb ? { poster: `/api/public/report/${tok}/media/${m.id}?thumb=1` } : {}) })
        : h('a', { href: `/api/public/report/${tok}/media/${m.id}`, target: '_blank' }, h('img', { src: `/api/public/report/${tok}/media/${m.id}`, alt: m.caption || '', loading: 'lazy' })),
      m.caption || m.temp_min_c != null ? h('figcaption', {}, [m.caption, m.temp_min_c != null || m.temp_max_c != null ? `${t('Thermal')}: min ${m.temp_min_c ?? '-'} °C, max ${m.temp_max_c ?? '-'} °C` : ''].filter(Boolean).join(' · ')) : null))) : null;
  };
  const summary = [];
  r.sections.forEach((s, si) => s.items.forEach((it, ii) => it.observations.forEach((o) => { if (o.in_summary && o.severity !== 'info') summary.push({ n: `${si + 1}.${ii + 1}`, s, it, o }); })));
  fill(app,
    h('div', { class: 'actions' }, h('h1', {}, r.title), h('span', { class: 'spacer' }), h('a', { class: 'btn cu', href: r.pdf, target: '_blank' }, t('Download the PDF'))),
    h('p', { class: 'muted' }, `${r.number} · ${r.property} · ${t('Inspected')} ${fmtDay(r.inspection_date)}`),
    h('div', { class: 'sevbar' }, Object.entries(SEV).map(([k, l]) => h('span', { class: `sev ${k}` }, h('b', {}, r.counts[k]), ' ', t(l)))),
    summary.length ? card(h('h2', {}, t('Report summary')), h('div', { class: 'tablewrap' }, h('table', {}, h('tbody', {}, summary.map((x) => h('tr', {}, h('td', { class: 'nowrap' }, x.n), h('td', {}, h('b', {}, x.s.name), h('div', { class: 'small muted' }, x.it.name)), h('td', { class: `sevtext ${x.o.severity}` }, x.o.text))))))) : null,
    card(h('h2', {}, t('General information')), kv([['Client', r.client], ['Service', r.service], ['Inspector', r.inspector], ['Issued', fmtStamp(r.issued_at)], ['Time', `${r.general.time_in || '-'} – ${r.general.time_out || '-'}`], ['Weather', r.general.weather], ['Occupancy', r.general.occupancy]])),
    r.sections.map((s, si) => h('section', { class: 'card' }, h('h2', {}, `${si + 1}. ${s.name}`),
      s.not_inspected_reason ? h('div', { class: 'alert' }, t('Not inspected'), ': ', s.not_inspected_reason) : null,
      s.items.filter((it) => it.observations.length || it.attr_value).map((it, ii) => h('div', { class: 'item' },
        h('div', { class: 'actions' }, h('b', {}, `${ii + 1}. ${it.name}`), h('span', { class: 'spacer' }), it.attr_value ? h('span', { class: 'small muted' }, `${it.attr_label || ''}: ${it.attr_value}`) : null),
        it.observations.map((o) => h('div', { class: `obs ${o.severity}` }, h('div', { class: 'otext' }, o.text, o.trade ? h('span', { class: 'small muted' }, ` · ${t('Recommended')}: ${o.trade}`) : null, o.reinspect_status ? ` [${t(o.reinspect_status)}]` : ''), strip(o.media))))),
      s.items.every((it) => it.observations.every((o) => o.severity === 'info')) && !s.not_inspected_reason ? h('p', { class: 'small muted' }, t('No defects observed at the time of inspection.')) : null,
      strip(s.media))),
    r.glossary.length ? card(h('h2', {}, t('Glossary')), r.glossary.map((g) => h('div', {}, h('b', {}, g.term), paras(g.definition)))) : null,
    feedback());
}

function feedback() {
  let score = 0;
  const stars = h('div', { class: 'stars' });
  const drawStars = () => fill(stars, [1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', class: n <= score ? 'on' : '', 'aria-label': `${n}`, onclick: () => { score = n; drawStars(); } }, '★')));
  drawStars();
  const c = h('textarea', { rows: 2, placeholder: t('Anything we could do better? (optional)') });
  const f = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    if (!score) return toast(t('Choose 1 to 5 stars.'));
    try { await api('POST', `/api/public/report/${tok}/feedback`, { score, comment: c.value }); fill(f, h('p', {}, h('b', {}, t('Thank you for your feedback!')))); } catch (x) { toast(x.message); }
  } }, h('h2', {}, t('How did we do?')), stars, c, h('p', {}, h('button', { class: 'btn cu' }, t('Send'))));
  return card(f);
}
