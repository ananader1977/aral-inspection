import { h, fill, toast, pill, t, fmtStamp, fmtDay, num2 } from '/js/common.js';
import { S, A, run, modal, closeModal, field, confirmBox, go } from '/js/app.js';

const KIND = { new: 'warn', contacted: 'attention', qualified: 'attention', onboarding: 'cu', converted: 'ok', lost: '' };
// a lead only moves forward; converted and lost are final (the server checks this too)
const STEP = { new: 0, contacted: 1, qualified: 2, onboarding: 3, converted: 4, lost: 4 };
const allowed = (from, all) => (from === 'converted' || from === 'lost' ? [from] : all.filter((s) => s === from || STEP[s] > STEP[from]));
const ref = (l) => `L-${String(l.id).padStart(5, '0')}`;
const waHref = (m) => { const d = String(m || '').replace(/\D/g, '').replace(/^00/, '').replace(/^0(5\d{8})$/, '971$1'); return d ? `https://wa.me/${d}` : null; };

export async function leadsView(el) {
  const st = { status: '', q: '', open: '1' };
  const box = h('div', {});
  const head = h('div', { class: 'kpis' });
  const load = async () => {
    const qs = new URLSearchParams(Object.entries(st).filter(([, v]) => v)).toString();
    const d = await A('GET', `/leads?${qs}`);
    head.replaceChildren(
      h('div', { class: 'kpi' }, h('b', {}, d.stats.open), h('span', {}, t('Open leads'))),
      h('div', { class: `kpi ${d.stats.overdue ? 'cu' : ''}` }, h('b', {}, d.stats.overdue), h('span', {}, t('New for more than 2 hours'))),
      h('div', { class: 'kpi' }, h('b', {}, d.stats.total), h('span', {}, t('All leads'))));
    const age = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
    box.replaceChildren(d.rows.length ? h('div', { class: 'tablewrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Ref', 'Received', 'Name', 'Service and property', 'Estimate', 'Source', 'Status'].map((c) => h('th', {}, t(c))))),
      h('tbody', {}, d.rows.map((l) => h('tr', { class: 'click', onclick: () => edit(l, d.statuses) },
        h('td', { class: 'nowrap ltr' }, ref(l)),
        h('td', { class: 'nowrap' }, fmtStamp(l.created_at), h('div', { class: 'small muted' }, t('{n} ago', { n: age(l.created_at) }))),
        h('td', {}, h('b', {}, l.name), h('div', { class: 'small muted ltr' }, l.mobile)),
        h('td', {}, l.service_name || '-', h('div', { class: 'small muted' }, [l.property_type, l.bedrooms != null ? `${l.bedrooms} BR` : '', l.sqft ? `${l.sqft} sq ft` : '', l.community].filter(Boolean).join(' · '))),
        h('td', { class: 'num' }, l.estimate_total != null ? num2(l.estimate_total) : '-'),
        h('td', {}, t(l.source), l.referral_code ? h('div', { class: 'small muted ltr' }, l.referral_code) : null),
        h('td', {}, pill(t(l.status), KIND[l.status]), l.status === 'lost' && l.lost_reason ? h('div', { class: 'small muted' }, l.lost_reason) : null)))))) : h('p', { class: 'muted' }, t('No leads yet. Website enquiries appear here automatically.')));
  };
  const edit = (l, statuses) => {
    const wa = waHref(l.mobile);
    const closed = l.status === 'converted' || l.status === 'lost';
    const reasons = S.lk?.lost_reason || [];
    const reasonSel = h('select', { name: 'lost_reason', disabled: l.status === 'lost' }, h('option', { value: '' }, '-'), reasons.map((r) => h('option', { value: r, selected: r === l.lost_reason }, t(r))),
      l.lost_reason && !reasons.includes(l.lost_reason) ? h('option', { value: l.lost_reason, selected: true }, l.lost_reason) : null);
    const reasonBox = field('Lost reason', reasonSel);
    const statusSel = h('select', { name: 'status', disabled: closed, onchange: () => showReason() }, allowed(l.status, statuses).map((s) => h('option', { value: s, selected: s === l.status }, t(s === 'converted' && l.status !== 'converted' ? 'converted (create job order)' : s))));
    const showReason = () => { const lost = statusSel.value === 'lost'; reasonBox.classList.toggle('hide', !lost); reasonSel.required = lost; };
    const CONVERT_TEXT = 'A job order is created with this client, property, service, preferred date and notes. The lead is then closed and cannot go back.';
    const save = async (v) => {
      const r = await run(() => A('PUT', `/leads/${l.id}`, v), v.status === 'converted' && l.status !== 'converted' ? 'Job order created' : 'Saved');
      if (!r) return;
      closeModal();
      if (r.row?.job_id && l.status !== 'converted') go(`jobs/${r.row.job_id}`); else load();
    };
    const f = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const v = { status: statusSel.value, lost_reason: statusSel.value === 'lost' ? reasonSel.value : '', notes: f.notes.value };
      if (v.status === 'converted' && l.status !== 'converted' && !(await confirmBox('Convert to a job order?', t(CONVERT_TEXT), 'Create job order', false))) return;
      if (v.status === 'lost' && l.status !== 'lost' && !(await confirmBox('Close this lead as lost?', t('A lost lead is closed and its status cannot change again.'), 'Close as lost'))) return;
      save(v);
    } }, h('div', { class: 'actions' }, h('h2', {}, `${ref(l)} · ${l.name}`), h('span', { class: 'spacer' }), pill(t(l.status), KIND[l.status])),
    l.job_id ? h('div', { class: 'alert ok' }, t('Converted to a job order.'), ' ', h('a', { class: 'btn sm', href: `#jobs/${l.job_id}`, onclick: closeModal }, t('Open the job'))) : null,
    h('dl', { class: 'kv' },
      h('dt', {}, t('Mobile')), h('dd', { class: 'ltr' }, l.mobile, ' ', wa ? h('a', { class: 'btn alt sm', href: wa, target: '_blank', rel: 'noopener' }, 'WhatsApp') : null),
      h('dt', {}, t('Email')), h('dd', { class: 'ltr' }, l.email || '-'),
      h('dt', {}, t('Service')), h('dd', {}, l.service_name || '-'),
      h('dt', {}, t('Property')), h('dd', {}, [l.property_type, l.bedrooms != null ? `${l.bedrooms} BR` : '', l.sqft ? `${l.sqft} sq ft` : '', l.building, l.community].filter(Boolean).join(' · ') || '-'),
      h('dt', {}, t('Preferred date')), h('dd', {}, l.preferred_date ? fmtDay(l.preferred_date) : '-'),
      h('dt', {}, t('Estimate shown')), h('dd', {}, l.estimate_total != null ? `AED ${num2(l.estimate_total)}` : '-'),
      h('dt', {}, t('Referral code')), h('dd', { class: 'ltr' }, l.referral_code || '-'),
      h('dt', {}, t('Message')), h('dd', {}, l.message || '-')),
    h('div', { class: 'grid2' }, field('Status', statusSel, closed ? 'Closed: the status cannot change.' : 'A lead only moves forward. Converted and lost are final.'), reasonBox),
    field('Notes', h('textarea', { name: 'notes', rows: 3 }, l.notes || '')),
    h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save')),
      !closed ? h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (await confirmBox('Convert to a job order?', t(CONVERT_TEXT), 'Create job order', false)) save({ status: 'converted', notes: f.notes.value });
      } }, t('Convert to job order')) : null,
      h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Close'))));
    modal(f);
    showReason();
  };
  const add = () => {
    const f = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      if (await run(() => A('POST', '/leads', v), 'Lead added')) { closeModal(); load(); }
    } }, h('h2', {}, t('Add a lead')),
    h('div', { class: 'grid2' },
      field('Name', h('input', { name: 'name', required: true })),
      field('Mobile', h('input', { name: 'mobile', required: true, class: 'ltr', placeholder: '+971 50 123 4567' })),
      field('Email', h('input', { name: 'email', type: 'email', class: 'ltr' })),
      field('Source', h('select', { name: 'source' }, ['phone', 'whatsapp', 'email', 'broker', 'bank', 'repeat', 'other'].map((s) => h('option', { value: s }, t(s))))),
      field('Property type', h('select', { name: 'property_type' }, h('option', { value: '' }, '-'), ['studio', 'apartment', 'townhouse', 'villa', 'penthouse', 'office', 'retail', 'warehouse', 'building', 'land'].map((s) => h('option', { value: s }, s)))),
      field('Bedrooms', h('input', { name: 'bedrooms', inputmode: 'numeric', class: 'ltr' })),
      field('Community', h('input', { name: 'community' })),
      field('Referral code', h('input', { name: 'referral_code', class: 'ltr' }))),
    field('Notes', h('textarea', { name: 'message', rows: 3 })),
    h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
    modal(f);
  };
  const chips = h('div', { class: 'actions' }, [['open', 'Open'], ['', 'All'], ['new', 'new'], ['converted', 'converted'], ['lost', 'lost']].map(([k, l]) =>
    h('button', { class: `btn sm ${k === 'open' ? '' : 'alt'}`, type: 'button', onclick: (e) => {
      st.open = k === 'open' ? '1' : ''; st.status = k === 'open' || k === '' ? '' : k;
      chips.querySelectorAll('button').forEach((b) => b.classList.add('alt')); e.target.classList.remove('alt'); load();
    } }, t(l))));
  fill(el, head, h('div', { class: 'card' }, h('div', { class: 'actions' }, h('h1', {}, t('Leads')), h('span', { class: 'spacer' }),
    h('a', { class: 'btn alt sm', href: '/', target: '_blank', rel: 'noopener' }, t('Open the website')),
    h('a', { class: 'btn alt sm', href: '/api/app/export/leads.xlsx', download: '' }, t('Export to Excel')), h('button', { class: 'btn cu', onclick: add }, t('+ Add a lead'))),
  h('p', { class: 'small muted' }, t('Website enquiries arrive here and by email. Call or WhatsApp new leads within 2 hours.')),
  h('div', { class: 'toolbar' }, chips, h('input', { type: 'search', placeholder: t('Search'), 'aria-label': t('Search'), oninput: (e) => { st.q = e.target.value.trim(); clearTimeout(edit.tm); edit.tm = setTimeout(load, 300); } })), box));
  await load();
}
