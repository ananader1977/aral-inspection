// Technical review: the Technical Manager checks submitted reports, returns them with comments,
// approves them and issues the final PDF (numbered, locked, emailed to the client with the online link).
import { h, fill, pill, t, fmtStamp } from '/js/common.js';
import { A, can, run, modal, closeModal, field, confirmBox, go } from '/js/app.js';

const KIND = { submitted: 'warn', approved: 'ok', returned: 'bad' };

export async function reviewsView(el, parts) {
  if (parts[0]) return reviewJob(el, Number(parts[0]));
  const d = await A('GET', '/reviews');
  fill(el, h('div', { class: 'card' }, h('h1', {}, t('Reviews')),
    h('p', { class: 'small muted' }, t('Reports submitted by inspectors. Check them, return them with comments, or approve and issue.')),
    d.rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Job', 'Client and property', 'Inspector', 'Submitted', 'Report due', 'Status'].map((x) => h('th', {}, t(x))))),
      h('tbody', {}, d.rows.map((r) => h('tr', { class: 'click', onclick: () => go(`reviews/${r.job_id}`) },
        h('td', { class: 'ltr nowrap' }, r.number), h('td', {}, r.client_name, h('div', { class: 'small muted' }, `${r.service_name} · ${[r.building, r.unit_no].filter(Boolean).join(' ')}`)),
        h('td', {}, r.inspector_name || '-'), h('td', { class: 'nowrap' }, fmtStamp(r.submitted_at)),
        h('td', { class: 'nowrap' }, r.sla_due_at ? pill(fmtStamp(r.sla_due_at), r.sla_due_at < Date.now() ? 'bad' : '') : '-'),
        h('td', {}, pill(t(r.status), KIND[r.status]), r.status === 'returned' && r.review_note ? h('div', { class: 'small muted' }, r.review_note) : null)))))) : h('p', { class: 'muted' }, t('Nothing to review.'))));
}

async function reviewJob(el, jobId) {
  const tr = await A('GET', `/inspect/${jobId}`);
  const R = tr.report, J = tr.job;
  const reload = () => reviewJob(el, jobId);
  const sevCls = { critical: 'critical', attention: 'attention', info: '' };
  const findings = [];
  tr.sections.forEach((s, si) => s.items.forEach((it, ii) => it.observations.forEach((o) => findings.push({ s, si, it, ii, o }))));
  const R_ = can('reports.review');
  fill(el,
    h('div', { class: 'actions' }, h('a', { class: 'btn alt sm', href: '#reviews' }, '‹ ', t('Reviews')), h('h1', { class: 'ltr' }, J.number), pill(t(R.status), KIND[R.status])),
    h('p', { class: 'muted' }, `${J.service_name} · ${[J.building, J.unit_no, J.community].filter(Boolean).join(', ')} · ${J.client_name} · ${t('Inspector')}: ${J.inspector_name || '-'}`),
    h('div', { class: 'card actions' },
      h('a', { class: 'btn alt', href: `/api/app/inspect/${jobId}/preview.pdf`, target: '_blank' }, t('Preview the PDF')),
      h('a', { class: 'btn alt', href: `#inspect/${jobId}` }, t('Open and correct the report')),
      h('a', { class: 'btn alt', href: `#jobs/${jobId}` }, t('Job file')),
      h('span', { class: 'spacer' }),
      R_ && ['submitted', 'approved'].includes(R.status) ? h('button', { class: 'btn danger', onclick: back }, t('Return to inspector')) : null,
      R_ && R.status === 'submitted' ? h('button', { class: 'btn', onclick: async () => { if (await run(() => A('POST', `/reviews/${jobId}/approve`), 'Approved')) reload(); } }, t('Approve')) : null,
      R_ && R.status === 'approved' ? h('button', { class: 'btn cu', onclick: issue }, t('Issue the report')) : null),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('b', {}, tr.counts.critical), h('span', {}, t('Critical'))),
      h('div', { class: 'kpi' }, h('b', {}, tr.counts.attention), h('span', {}, t('Needs attention'))),
      h('div', { class: 'kpi' }, h('b', {}, tr.counts.info), h('span', {}, t('For information'))),
      h('div', { class: 'kpi cu' }, h('b', {}, tr.media.length), h('span', {}, t('Photos and videos')))),
    h('div', { class: 'card' }, h('h2', {}, t('Findings')), findings.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('tbody', {}, findings.map(({ s, si, it, ii, o }) => h('tr', {},
      h('td', { class: 'nowrap' }, `${si + 1}.${ii + 1}`), h('td', {}, h('b', {}, s.name), h('div', { class: 'small muted' }, it.name)),
      h('td', {}, pill(t(o.severity), sevCls[o.severity]), ' ', o.text, o.trade ? h('div', { class: 'small muted' }, o.trade) : null, !o.in_summary && o.severity !== 'info' ? h('div', { class: 'small muted' }, t('Not in summary')) : null),
      h('td', {}, h('div', { class: 'strip' }, o.media.map((m) => h('a', { class: 'thumb', href: `/api/app/media/${m}`, target: '_blank' }, h('img', { src: `/api/app/media/${m}?thumb=1`, alt: '', loading: 'lazy' })))), o.severity === 'critical' && !o.media.length ? pill(t('No photo'), 'bad') : null)))))) : h('p', { class: 'muted' }, t('No findings.'))),
    h('div', { class: 'card' }, h('h2', {}, t('General information')), h('dl', { class: 'kv' },
      [['Inspection date', R.inspection_date], ['Time', `${R.time_in || '-'} – ${R.time_out || '-'}`], ['Persons present', (R.persons_present || []).join(', ')], ['Occupancy', R.occupancy], ['Weather', R.weather], ['AC / DEWA', `${R.ac_connected ? t('Yes') : t('No')} / ${R.dewa_connected ? t('Yes') : t('No')}`], ['Areas not inspected', tr.sections.filter((s) => s.not_inspected_reason).map((s) => `${s.name} (${s.not_inspected_reason})`).join(', ')]]
        .flatMap(([k, v]) => [h('dt', {}, t(k)), h('dd', {}, v || '-')]))));

  function back() {
    const f = h('form', { onsubmit: async (e) => { e.preventDefault(); if (await run(() => A('POST', `/reviews/${jobId}/return`, { note: f.note.value }), 'Returned to the inspector')) { closeModal(); go('reviews'); } } },
      h('h2', {}, t('Return to inspector')), field('What needs changing', h('textarea', { name: 'note', rows: 4, required: true })),
      h('p', { class: 'actions' }, h('button', { class: 'btn danger' }, t('Return')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
    modal(f);
  }
  async function issue() {
    if (!(await confirmBox('Issue the report?', t('The report gets its number, is locked, and is emailed to the client with the online link. An invoice is issued unless the client is invoiced monthly.'), 'Issue', false))) return;
    const r = await run(() => A('POST', `/reviews/${jobId}/issue`), 'Report issued and emailed');
    if (r) { window.open(`/api/app/reports/${jobId}/pdf`, '_blank'); go(`jobs/${jobId}`); }
  }
}
