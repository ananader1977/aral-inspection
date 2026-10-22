// Inspection app for the phone (installable PWA). Offline-first: every change and every photo/video goes into a
// queue in the phone's storage (IndexedDB) and is sent in order when there is signal. Nothing is lost if the app closes.
import { h, fill, toast, pill, t, fmtStamp, todayIso } from '/js/common.js';
import { S, A, can, run, modal, closeModal, field, confirmBox, go } from '/js/app.js';

const SYS_ITEMS = {
  'Air Conditioning': ['AC System Type', 'Thermostats and Controls', 'Cooling Performance (supply air temperature)', 'Air Outlets and Return Grilles', 'Indoor Units / Fan Coil Units', 'Condensate Drain and Drip Tray', 'Filters', 'Visible Ductwork and Insulation', 'Outdoor / Condensing Units', 'Air Conditioning Comments'],
  Electrical: ['Main Service Condition', 'Distribution Board Condition', 'Breakers and RCD Protection', 'Sockets and Switches (sample tested)', 'Earthing and Bonding', 'Lighting', 'Electrical Comments'],
  'Water Heater': ['Water Heater Type', 'Water Heater Condition', 'Hot Water Temperature', 'Supply Lines Condition', 'Pressure / Temperature Relief Valve', 'Water Heater Room Comments'],
};
const SEV = [['critical', 'Critical'], ['attention', 'Needs attention'], ['info', 'For information']];
const MAX_VIDEO_S = 60;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

// ---------- IndexedDB: queue + cached reports ----------
let dbp;
const idb = () => (dbp ||= new Promise((res, rej) => {
  const r = indexedDB.open('aral-inspect', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('queue', { keyPath: 'qid', autoIncrement: true }); r.result.createObjectStore('trees', { keyPath: 'job' }); r.result.createObjectStore('map', { keyPath: 'tmp' }); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
const store = async (name, mode, fn) => { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction(name, mode); const st = tx.objectStore(name); const out = fn(st); tx.oncomplete = () => res(out?.result ?? out); tx.onerror = () => rej(tx.error); }); };
const qAll = () => store('queue', 'readonly', (s) => s.getAll());
const qAdd = (item) => store('queue', 'readwrite', (s) => s.add(item));
const qDel = (qid) => store('queue', 'readwrite', (s) => s.delete(qid));
const mapGet = (tmp) => store('map', 'readonly', (s) => s.get(tmp));
const mapPut = (tmp, id) => store('map', 'readwrite', (s) => s.put({ tmp, id }));
const treePut = (tree) => store('trees', 'readwrite', (s) => s.put({ job: tree.job.id, tree, at: Date.now() })).catch(() => {});
const treeGet = (job) => store('trees', 'readonly', (s) => s.get(job));

// ---------- sync engine ----------
const sync = { busy: false, pending: 0, listeners: new Set(), createdTmp: false };
const notify = () => sync.listeners.forEach((f) => f());
async function resolveTmp(v) {
  if (typeof v === 'string' && v.startsWith('tmp-')) { const m = await mapGet(v); if (!m) throw Object.assign(new Error('waiting'), { wait: true }); return m.id; }
  return v;
}
async function resolveDeep(o) {
  if (Array.isArray(o)) return Promise.all(o.map(resolveDeep));
  if (o && typeof o === 'object' && !(o instanceof Blob)) { const out = {}; for (const [k, v] of Object.entries(o)) out[k] = await resolveDeep(v); return out; }
  return resolveTmp(o);
}
async function flush() {
  if (sync.busy) return;
  sync.busy = true;
  try {
    for (;;) {
      const items = await qAll();
      sync.pending = items.length; notify();
      if (!items.length) break;
      const it = items[0];
      try {
        let path = it.path;
        for (const m of path.match(/tmp-[\w-]+/g) || []) path = path.replace(m, await resolveTmp(m));
        let res;
        if (it.blob) {
          const q = new URLSearchParams(await resolveDeep(it.query || {})).toString();
          res = await fetch(`${path}?${q}`, { method: 'POST', headers: { 'X-Requested-With': 'aral', 'Content-Type': it.blob.type || 'application/octet-stream' }, body: it.blob, credentials: 'same-origin' });
        } else {
          res = await fetch(path, { method: it.method, headers: { 'X-Requested-With': 'aral', 'Content-Type': 'application/json' }, body: it.body ? JSON.stringify(await resolveDeep(it.body)) : undefined, credentials: 'same-origin' });
        }
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) { toast(t('Please sign in again. Your changes are kept on this phone.'), 8000); break; }
        if (!res.ok) { toast(`${t('Not saved')}: ${t(data.error || res.status)}`, 7000); await qDel(it.qid); sync.createdTmp = true; continue; }
        if (it.tmp && data.id) { await mapPut(it.tmp, data.id); sync.createdTmp = true; }
        if (it.thumbOf && data.id) { /* thumb uploads queued separately reference tmp ids */ }
        await qDel(it.qid);
      } catch (e) {
        if (e.wait) { await qDel(it.qid); continue; } // parent was dropped by the server: skip the child
        break; // offline: try again later
      }
    }
  } finally { sync.busy = false; sync.pending = (await qAll()).length; notify(); }
}
const enqueue = async (item) => { await qAdd(item); sync.pending++; notify(); flush(); };
window.addEventListener('online', flush);
setInterval(flush, 20000);

document.addEventListener('click', (e) => { if (!e.target.closest?.('.capwrap')) document.querySelectorAll('.capmenu').forEach((m) => m.classList.add('hide')); });

// ---------- list of my visits ----------
export async function inspectView(el, parts) {
  if (parts[0]) return inspectJob(el, Number(parts[0]));
  const d = await A('GET', '/inspect');
  const groups = { today: [], next: [], other: [] };
  const today = todayIso();
  for (const j of d.rows) {
    const day = j.scheduled_start ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(j.scheduled_start) : '';
    (day === today ? groups.today : day > today ? groups.next : groups.other).push(j);
  }
  const unbooked = d.rows.filter((j) => !j.scheduled_start);
  for (const k of Object.keys(groups)) groups[k] = groups[k].filter((j) => j.scheduled_start);
  const cardFor = (j) => h('a', { class: 'card jobcard', href: j.scheduled_start ? `#inspect/${j.id}` : `#jobs/${j.id}` },
    h('div', { class: 'actions' }, h('b', { class: 'ltr' }, j.number), h('span', { class: 'spacer' }), !j.scheduled_start ? pill(t('Paid – not scheduled yet'), 'warn') : j.report_status === 'returned' ? pill(t('Returned for changes'), 'bad') : pill(t(j.status === 'report_draft' ? 'In progress' : j.status === 'under_review' ? 'With the reviewer' : j.status === 'access_failed' ? 'Access failed' : 'Scheduled'), j.status === 'report_draft' ? 'cu' : '')),
    h('div', {}, h('b', {}, j.scheduled_start ? fmtStamp(j.scheduled_start) : '-'), ' · ', j.service_name),
    h('div', { class: 'muted' }, [j.building, j.unit_no && `${t('Unit')} ${j.unit_no}`, j.community].filter(Boolean).join(', ')),
    h('div', { class: 'small muted' }, `${j.client_name} · ${[j.property_type, j.bedrooms != null ? `${j.bedrooms} BR` : ''].filter(Boolean).join(' ')}${S.me.role !== 'inspector' && j.inspector_name ? ` · ${j.inspector_name}` : ''}`));
  fill(el, h('h1', {}, t(S.me.role === 'inspector' ? 'My inspections' : 'Inspections')), syncBadge(),
    !d.linked ? h('div', { class: 'alert bad' }, t('Your login is not linked to an inspector record. Ask the Super Admin to set "Inspector record" on your user in Settings → Users.')) : null,
    S.me.role !== 'inspector' && !d.inspectors ? h('div', { class: 'alert' }, t('There are no inspectors yet. Add one in Settings → Inspectors, then schedule the job.'), ' ', h('a', { class: 'btn alt sm', href: '#settings/list/inspectors' }, t('Add an inspector'))) : null,
    unbooked.length ? h('section', {}, h('h2', {}, t('Paid, waiting to be scheduled')), h('p', { class: 'small muted' }, t('Open the job and press "Schedule the inspection" to choose the date and the inspector. The inspection opens here once it is booked.')), unbooked.map(cardFor)) : null,
    [['today', 'Today'], ['next', 'Coming up'], ['other', 'Earlier / open']].map(([k, l]) => groups[k].length ? h('section', {}, h('h2', {}, t(l)), groups[k].map(cardFor)) : null),
    d.rows.length ? null : h('div', { class: 'card' }, h('p', { class: 'muted' }, t('No visits assigned to you right now.'))));
}

function syncBadge() {
  const b = h('div', { class: 'syncbar' });
  let shown = false;
  const draw = () => { if (shown && !b.isConnected) { sync.listeners.delete(draw); return; } shown = true; fill(b, !navigator.onLine ? pill(t('Offline: changes are saved on this phone'), 'warn') : sync.pending ? pill(t('Sending {n} change(s)…', { n: sync.pending }), 'cu') : pill(t('All changes saved'), 'ok')); };
  sync.listeners.add(draw);
  window.addEventListener('online', draw); window.addEventListener('offline', draw);
  draw();
  return b;
}

// ---------- one inspection ----------
async function inspectJob(el, jobId) {
  let tree;
  try { tree = await A('GET', `/inspect/${jobId}`); treePut(tree); }
  catch (e) { const c = await treeGet(jobId).catch(() => null); if (!c || e.status) throw e; tree = c.tree; toast(t('Offline: showing the copy saved on this phone.')); }
  const st = { open: new Set(JSON.parse(sessionStorage.getItem(`open-${jobId}`) || '[]')) };
  const saveOpen = () => { try { sessionStorage.setItem(`open-${jobId}`, JSON.stringify([...st.open])); } catch { /* ignore */ } };
  const R = tree.report, J = tree.job;
  // inspectors edit while drafting; the reviewer and office can also correct a submitted report
  const editable = (['draft', 'returned'].includes(R.status) && (J.status === 'report_draft' || S.me.role !== 'inspector')) || (S.me.role !== 'inspector' && R.status === 'submitted');
  const mediaById = new Map(tree.media.map((m) => [m.id, m]));
  const local = []; // media waiting to upload: {key, blobUrl, kind, observation_id, section_id}
  const reloadAfterSync = () => { if (sync.createdTmp && !sync.pending && !document.querySelector('dialog[open]')) { sync.createdTmp = false; inspectJob(el, jobId); } };
  sync.listeners.add(reloadAfterSync);
  window.addEventListener('hashchange', () => sync.listeners.delete(reloadAfterSync), { once: true });
  const persist = () => treePut(tree);

  const op = (method, path, body, extra = {}) => enqueue({ method, path: `/api/app${path}`, body, ...extra });
  const head = h('div', {});
  const body = h('div', {});

  function drawHead() {
    const c = { critical: 0, attention: 0, info: 0 };
    tree.sections.forEach((s) => s.items.forEach((i) => i.observations.forEach((o) => c[o.severity]++)));
    fill(head,
      h('div', { class: 'actions' }, h('a', { class: 'btn alt sm', href: '#inspect' }, '‹ ', t('My inspections')), h('span', { class: 'spacer' }), syncBadge()),
      h('h1', { class: 'ltr' }, J.number), h('p', {}, h('b', {}, J.service_name), h('br'), [J.building, J.unit_no && `${t('Unit')} ${J.unit_no}`, J.community].filter(Boolean).join(', '), h('br'),
        h('span', { class: 'small muted' }, `${J.client_name} · `, h('a', { href: `tel:${J.client_mobile}`, class: 'ltr' }, J.client_mobile))),
      J.access_notes ? h('div', { class: 'alert info' }, h('b', {}, t('Access')), ': ', J.access_notes, J.access_contact ? ` · ${J.access_contact}` : '') : null,
      R.status === 'returned' && R.review_note ? h('div', { class: 'alert bad' }, h('b', {}, t('Returned by the reviewer')), ': ', R.review_note) : null,
      R.status === 'submitted' || R.status === 'approved' ? h('div', { class: 'alert info' }, t('This report is with the reviewer. You can look but not change it.')) : null,
      h('div', { class: 'sevbar' }, SEV.map(([k, l]) => h('span', { class: `sev ${k}` }, h('b', {}, c[k]), ' ', t(l)))),
      J.status === 'scheduled' ? h('div', { class: 'card actions' },
        h('button', { class: 'btn cu block', onclick: async () => { const r = await run(() => A('POST', `/inspect/${jobId}/checkin`), 'Started. The report time starts now.'); if (r) inspectJob(el, jobId); } }, t("I'm on site: start the inspection")),
        h('button', { class: 'btn danger', onclick: accessFailed }, t('No access'))) : null,
      J.sla_due_at && J.status === 'report_draft' ? h('p', { class: 'small muted' }, t('Report due'), ': ', h('b', {}, fmtStamp(J.sla_due_at))) : null);
  }

  function drawBody() {
    fill(body,
      generalCard(),
      attachmentsCard(),
      editable ? h('div', { class: 'card' }, h('h2', {}, t('Quick photos')), h('p', { class: 'small muted' }, t('Take photos room by room now and attach them to findings later.')), captureButtons({ section_id: null }), mediaStrip(tree.media.filter((m) => !m.observation_id && !m.section_id).map((m) => m.id), {})) : null,
      tree.sections.map((s, si) => sectionCard(s, si)),
      editable ? h('p', {}, h('button', { class: 'btn alt block', onclick: addArea }, t('+ Add an area or room'))) : null,
      h('div', { class: 'stickybar' },
        h('a', { class: 'btn alt', href: `/api/app/inspect/${jobId}/preview.pdf`, target: '_blank' }, t('Preview PDF')),
        editable && J.status === 'report_draft' ? h('button', { class: 'btn cu', onclick: submit }, t('Submit for review')) : null));
  }

  function generalCard() {
    const yn = (name, v) => h('select', { name, disabled: !editable }, [['', '-'], ['1', t('Yes')], ['0', t('No')]].map(([k, l]) => h('option', { value: k, selected: String(v ?? '') === k }, l)));
    const people = new Set(R.persons_present || []);
    const f = h('form', { class: 'general', onchange: () => save() },
      h('div', { class: 'grid3' },
        field('Inspection date', h('input', { name: 'inspection_date', type: 'date', value: R.inspection_date || '', disabled: !editable })),
        field('Time in', h('input', { name: 'time_in', type: 'time', value: R.time_in || '', disabled: !editable })),
        field('Time out', h('input', { name: 'time_out', type: 'time', value: R.time_out || '', disabled: !editable })),
        field('Occupancy', h('select', { name: 'occupancy', disabled: !editable }, h('option', { value: '' }, '-'), (S.lk?.occupancy || []).map((v) => h('option', { value: v, selected: v === R.occupancy }, v)))),
        field('Weather', h('select', { name: 'weather', disabled: !editable }, h('option', { value: '' }, '-'), (S.lk?.weather || []).map((v) => h('option', { value: v, selected: v === R.weather }, v)))),
        field('Outdoor temperature °C', h('input', { name: 'temperature_c', inputmode: 'decimal', class: 'ltr', value: R.temperature_c ?? '', disabled: !editable })),
        field('AC connected', yn('ac_connected', R.ac_connected)), field('DEWA connected', yn('dewa_connected', R.dewa_connected)),
        field('Levels', h('input', { name: 'levels', inputmode: 'numeric', class: 'ltr', value: R.levels ?? '', disabled: !editable })),
        field('Estimated age', h('input', { name: 'estimated_age', value: R.estimated_age || '', disabled: !editable })),
        field('Thermal imaging used', yn('thermal_used', R.thermal_used)),
        field('Overall condition (optional)', h('input', { name: 'overall_condition', value: R.overall_condition || '', disabled: !editable }))),
      h('label', {}, t('Persons present')), h('div', { class: 'chips' }, (S.lk?.attendance || ['Owner', 'Buyer', 'Agent', 'Tenant', 'None']).map((p) => h('label', { class: 'chip' }, h('input', { type: 'checkbox', disabled: !editable, checked: people.has(p), onchange: (e) => { e.target.checked ? people.add(p) : people.delete(p); } }), t(p)))),
      field('Property note (printed under general information)', h('textarea', { name: 'property_note', rows: 2, disabled: !editable }, R.property_note || '')));
    let tm;
    const save = () => { clearTimeout(tm); tm = setTimeout(() => {
      const v = Object.fromEntries(new FormData(f));
      for (const k of ['ac_connected', 'dewa_connected', 'thermal_used']) v[k] = v[k] === '' || v[k] === undefined ? null : v[k] === '1';
      v.persons_present = [...people];
      Object.assign(R, v); persist();
      op('PUT', `/inspect/${jobId}/general`, v);
    }, 400); };
    f.addEventListener('input', save);
    const det = h('details', { class: 'card', open: !R.time_in }, h('summary', {}, h('b', {}, t('General information'))), f);
    return det;
  }

  // ---------- documents attached to the report ----------
  function attachmentsCard() {
    const list = tree.attachments || [];
    if (!editable && !list.length) return null;
    const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
    const inp = h('input', { type: 'file', class: 'hide', multiple: true, accept: 'application/pdf,image/jpeg,image/png' });
    inp.addEventListener('change', async () => { const files = [...inp.files]; inp.value = ''; for (const f of files) await uploadAttachment(f); });
    return h('details', { class: 'card', open: list.length > 0 }, h('summary', {}, h('b', {}, t('Attachments')), ' ', list.length ? pill(String(list.length)) : null),
      h('p', { class: 'small muted' }, t('Documents that belong to the report: lab results, floor plans, DEWA bills, the developer snag list. Images are printed in the report appendix; PDFs are linked by QR code and sent with the report email.')),
      list.length ? h('div', { class: 'attlist' }, list.map((a, i) => h('div', { class: 'att' },
        h('span', { class: 'attno' }, `A${i + 1}`),
        h('div', { class: 'spacer' }, h('a', { href: `/api/app/attachments/${a.id}`, target: '_blank' }, h('b', {}, a.title)), h('div', { class: 'small muted' }, `${a.kind === 'pdf' ? 'PDF' : t('Image')} · ${kb(a.size)}${a.description ? ` · ${a.description}` : ''}${a.in_pdf ? '' : ` · ${t('not printed')}`}${a.send_with_report ? '' : ` · ${t('not emailed')}`}`)),
        editable ? h('button', { class: 'btn alt sm', onclick: () => attachmentMenu(a, i) }, t('Edit')) : null))) : null,
      editable ? [inp, h('p', {}, h('button', { class: 'btn alt sm', type: 'button', onclick: () => inp.click() }, '📎 ', t('Add attachment')))] : null);
  }
  async function uploadAttachment(file) {
    if (!navigator.onLine) return toast(t('Connect to the internet to add attachments.'));
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return toast(t('Attachments must be PDF, JPEG or PNG files.'));
    const meta = await askAttachment(file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '));
    if (!meta) return;
    let blob = file;
    if (file.type !== 'application/pdf' && file.size > 4 * 1024 * 1024) { try { blob = await compress(file, 2400, 0.85); } catch { /* send the original */ } }
    if (blob.size > 20 * 1024 * 1024) return toast(t('Attachments can be up to 20 MB.'));
    toast(t('Uploading…'));
    const q = new URLSearchParams({ name: file.name, title: meta.title, description: meta.description });
    try {
      const res = await fetch(`/api/app/inspect/${jobId}/attachments?${q}`, { method: 'POST', headers: { 'X-Requested-With': 'aral', 'Content-Type': blob.type || file.type }, body: blob, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(t(data.error || res.status));
      toast(t('Attachment added'));
      inspectJob(el, jobId);
    } catch (e) { toast(e.message, 6000); }
  }
  function askAttachment(title, description = '') {
    return new Promise((resolve) => {
      const f = h('form', { onsubmit: (e) => { e.preventDefault(); closeModal(); resolve({ title: f.ttl.value.trim(), description: f.desc.value.trim() }); } },
        h('h2', {}, t('Attachment')), field('Title (printed in the report)', h('input', { name: 'ttl', required: true, value: title, maxlength: 120 })),
        field('Description (optional)', h('textarea', { name: 'desc', rows: 2, maxlength: 500 }, description)),
        h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save')), h('button', { class: 'btn alt', type: 'button', onclick: () => { closeModal(); resolve(null); } }, t('Cancel'))));
      modal(f);
    });
  }
  function attachmentMenu(a, i) {
    const ttl = h('input', { value: a.title, maxlength: 120 });
    const desc = h('textarea', { rows: 2, maxlength: 500 }, a.description || '');
    const inPdf = h('input', { type: 'checkbox', checked: !!a.in_pdf });
    const mail = h('input', { type: 'checkbox', checked: !!a.send_with_report });
    const doit = async (fn, msg) => { if (await run(fn, msg)) { closeModal(); inspectJob(el, jobId); } };
    modal(h('h2', {}, `A${i + 1}. ${a.title}`),
      field('Title (printed in the report)', ttl), field('Description (optional)', desc),
      h('label', { class: 'check' }, inPdf, t('Include in the report appendix')),
      h('label', { class: 'check' }, mail, t('Send with the report email')),
      h('p', { class: 'actions' },
        h('button', { class: 'btn cu', onclick: () => doit(() => A('PUT', `/attachments/${a.id}`, { title: ttl.value, description: desc.value, in_pdf: inPdf.checked, send_with_report: mail.checked }), 'Saved') }, t('Save')),
        h('button', { class: 'btn alt', onclick: () => doit(() => A('PUT', `/attachments/${a.id}`, { move: 'up' })) }, '↑'),
        h('button', { class: 'btn alt', onclick: () => doit(() => A('PUT', `/attachments/${a.id}`, { move: 'down' })) }, '↓'),
        h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Delete this attachment?', null, 'Delete')) doit(() => A('DELETE', `/attachments/${a.id}`), 'Deleted'); } }, t('Delete')),
        h('button', { class: 'btn alt', onclick: closeModal }, t('Close'))));
  }

  function sectionCard(s, si) {
    const count = s.items.reduce((a, i) => a + i.observations.length, 0);
    const worst = s.items.some((i) => i.observations.some((o) => o.severity === 'critical')) ? 'critical' : s.items.some((i) => i.observations.some((o) => o.severity === 'attention')) ? 'attention' : '';
    // an item counts as recorded when it has a detail, a photo or a finding
    const done = s.items.filter((i) => i.attr_value || i.media?.length || i.observations.length || local.some((l) => l.item_id === i.id)).length;
    const det = h('details', { class: `card sect ${worst}`, open: st.open.has(String(s.id)), ontoggle: () => { det.open ? st.open.add(String(s.id)) : st.open.delete(String(s.id)); saveOpen(); } },
      h('summary', {}, h('span', { class: 'sname' }, `${si + 1}. ${s.name}`),
        s.not_inspected_reason ? pill(t('Not inspected'), 'warn') : h('span', { class: `prog ${done === s.items.length && s.items.length ? 'full' : ''}` }, `${done}/${s.items.length}`),
        count ? pill(String(count), worst || '') : null),
      s.not_inspected_reason ? h('div', { class: 'alert' }, t('Not inspected'), ': ', s.not_inspected_reason) : null,
      h('div', { class: 'items' }, s.items.map((it, ii) => itemBlock(s, it, ii))),
      s.media.length || local.some((l) => l.section_id === s.id && !l.item_id && !l.observation_id) ? h('div', { class: 'secmedia' }, h('div', { class: 'small muted' }, t('Other photos in this area')), mediaStrip(s.media, { section_id: s.id })) : null,
      editable ? h('div', { class: 'secfoot' },
        h('button', { class: 'btn alt sm', onclick: () => addItem(s) }, t('+ Item')),
        captureMenuButton({ section_id: s.id }, t('Area photo')),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn alt sm', onclick: () => sectionMenu(s, si) }, '⋯ ', t('Area options'))) : null);
    return det;
  }

  /** One checklist item: name, detail, a camera button next to it, and its findings. */
  function itemBlock(s, it, ii) {
    // each item offers its own picklist (AC type, pipe material, tile material…); rooms default to materials
    const attrList = it.attr_label ? S.lk?.[it.attr_list || (it.attr_label === 'Materials' && s.kind === 'area' ? 'material' : '')] || [] : [];
    const listId = `dl-${it.id}`;
    const nPhotos = (it.media?.length || 0) + local.filter((l) => l.item_id === it.id).length;
    return h('div', { class: `irow ${it.observations.some((o) => o.severity === 'critical') ? 'critical' : it.observations.some((o) => o.severity === 'attention') ? 'attention' : ''}` },
      h('div', { class: 'ihead' },
        h('span', { class: 'inum' }, String(ii + 1)),
        h('div', { class: 'iname' }, t(it.name)),
        editable ? captureMenuButton({ item_id: it.id, section_id: s.id }, null, nPhotos) : nPhotos ? h('span', { class: 'ibadge' }, `📷 ${nPhotos}`) : null,
        editable ? h('button', { class: 'ibtn add', type: 'button', title: t('Add a finding'), 'aria-label': t('Add a finding'), onclick: () => findingDialog(s, it) }, '+') : null),
      it.attr_label ? h('div', { class: 'iattr' }, h('label', { for: `a-${it.id}` }, t(it.attr_label)),
        h('input', { id: `a-${it.id}`, value: it.attr_value || '', list: listId, disabled: !editable, placeholder: t('Choose or type'), onchange: (e) => { it.attr_value = e.target.value; persist(); op('PUT', `/items/${it.id}`, { attr_value: e.target.value }); } }),
        h('datalist', { id: listId }, attrList.map((v) => h('option', { value: v })))) : null,
      mediaStrip(it.media || [], { item_id: it.id }),
      editable && S.cfg?.ai && (it.media || []).some((x) => typeof x === 'number' && mediaById.get(x)?.kind !== 'video') ? h('button', { class: 'aichip', type: 'button', onclick: () => findingDialog(s, it, null, { photoIds: (it.media || []).filter((x) => typeof x === 'number').slice(-4), autoAi: true }) }, '✨ ', t('Suggest a finding from the photo')) : null,
      it.observations.map((o) => h('div', { class: `obs ${o.severity}` },
        h('div', { class: 'ohead' },
          h('button', { class: 'otext', type: 'button', disabled: !editable, onclick: () => findingDialog(s, it, o) }, o.text, o.trade ? h('span', { class: 'small muted' }, ` · ${o.trade}`) : null),
          o.reinspect_status ? pill(t(o.reinspect_status), o.reinspect_status === 'fixed' ? 'ok' : 'bad') : null,
          editable ? captureMenuButton({ observation_id: o.id, section_id: s.id }, null, o.media.length + local.filter((l) => l.observation_id === o.id).length, true) : null),
        mediaStrip(o.media, { observation_id: o.id }))));
  }

  /** Camera button that opens a small menu: take photo, gallery, video, thermal. */
  function captureMenuButton(target, label, n = 0, small = false) {
    const wrap = h('span', { class: 'capwrap' });
    const menu = h('span', { class: 'capmenu hide' }, captureButtons(target, true));
    const btn = h('button', { class: `ibtn cam ${small ? 'sm' : ''} ${label ? 'lbl' : ''}`, type: 'button', title: t('Add photo'), 'aria-label': t('Add photo'), 'aria-expanded': 'false', onclick: (e) => {
      e.stopPropagation();
      document.querySelectorAll('.capmenu:not(.hide)').forEach((m) => { if (m !== menu) m.classList.add('hide'); });
      menu.classList.toggle('hide');
      // open upwards when there is no room below (the bottom bar covers the last 70 px)
      menu.classList.toggle('up', btn.getBoundingClientRect().bottom > window.innerHeight - 260);
      btn.setAttribute('aria-expanded', String(!menu.classList.contains('hide')));
    } }, '📷', label ? ` ${label}` : null, n ? h('b', {}, String(n)) : null);
    wrap.append(btn, menu);
    return wrap;
  }

  // ---------- photos / videos ----------
  function mediaStrip(ids, target) {
    const pend = local.filter((l) => (target.observation_id ? l.observation_id === target.observation_id : target.item_id ? l.item_id === target.item_id && !l.observation_id : target.section_id !== undefined ? l.section_id === target.section_id && !l.item_id && !l.observation_id : false));
    const all = [...ids.map((id) => mediaById.get(id)).filter(Boolean), ...pend];
    if (!all.length) return null;
    return h('div', { class: 'strip' }, all.map((m) => {
      const src = m.blobUrl || (m.kind === 'video' && !m.has_thumb ? null : `/api/app/media/${m.id}?thumb=1`);
      return h('button', { class: `thumb ${m.kind}`, type: 'button', onclick: () => (m.id ? mediaMenu(m) : toast(t('Waiting to upload'))) },
        src ? h('img', { src, alt: m.caption || t(m.kind), loading: 'lazy' }) : h('span', {}, '▶'),
        m.kind === 'video' ? h('i', {}, '▶') : null, m.kind === 'thermal' ? h('i', {}, '°C') : null, m.blobUrl ? h('em', {}, '⟳') : null);
    }));
  }
  function captureButtons(target, compact = false) {
    const inp = (accept, capture, multiple, kind) => {
      const i = h('input', { type: 'file', accept, class: 'hide', multiple: !!multiple, ...(capture ? { capture } : {}) });
      i.addEventListener('change', async () => { for (const f of i.files) await addFile(f, kind, target); i.value = ''; });
      return i;
    };
    const photo = inp('image/*', 'environment', false, 'photo'), gal = inp('image/*', null, true, 'photo'), vid = inp('video/*', 'environment', false, 'video'), th = inp('image/*', null, false, 'thermal');
    const close = () => document.querySelectorAll('.capmenu').forEach((m) => m.classList.add('hide'));
    if (compact) return h('span', { class: 'capture compact' }, photo, gal, vid, th,
      h('button', { type: 'button', onclick: () => { close(); photo.click(); } }, '📷 ', t('Camera')),
      h('button', { type: 'button', onclick: () => { close(); gal.click(); } }, '🖼 ', t('Gallery')),
      h('button', { type: 'button', onclick: () => { close(); vid.click(); } }, '🎥 ', t('Video')),
      tree.report.thermal_used || J.needs_thermal ? h('button', { type: 'button', onclick: () => { close(); th.click(); } }, '🌡 ', t('Thermal')) : null);
    return h('div', { class: 'capture' }, photo, gal, vid, th,
      h('button', { class: 'btn alt sm', type: 'button', onclick: () => photo.click() }, '📷 ', t('Photo')),
      h('button', { class: 'btn alt sm', type: 'button', onclick: () => gal.click() }, '🖼 ', t('Gallery')),
      h('button', { class: 'btn alt sm', type: 'button', onclick: () => vid.click() }, '🎥 ', t('Video')),
      tree.report.thermal_used || J.needs_thermal ? h('button', { class: 'btn alt sm', type: 'button', onclick: () => th.click() }, '🌡 ', t('Thermal')) : null);
  }
  async function addFile(file, kind, target) {
    if (kind === 'video' || file.type.startsWith('video/')) return addVideo(file, target);
    let blob;
    try { blob = await compress(file); } catch { return toast(t('This photo could not be read. Try another one.')); }
    const res = await annotate(blob, kind);
    if (!res) return;
    const extra = {};
    if (kind === 'thermal') {
      const v = await askTemps(); if (!v) return; Object.assign(extra, { temp_min: v.min, temp_max: v.max });
    }
    queueMedia(res.blob, kind, target, { caption: res.caption, ...extra });
  }
  function queueMedia(blob, kind, target, extra = {}, thumb) {
    const key = uuid();
    const l = { key, blobUrl: URL.createObjectURL(thumb || blob), kind, observation_id: target.observation_id, item_id: target.observation_id ? undefined : target.item_id, section_id: target.section_id ?? null };
    local.push(l);
    const query = { kind, uuid: key, taken_at: Date.now(), ...(target.observation_id ? { observation_id: target.observation_id } : {}), ...(target.section_id ? { section_id: target.section_id } : {}), ...(target.item_id && !target.observation_id ? { item_id: target.item_id } : {}), ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined && v !== '')) };
    const tmp = `tmp-${key}`;
    enqueue({ path: `/api/app/inspect/${jobId}/media`, blob, query, tmp });
    if (thumb) enqueue({ path: `/api/app/media/${tmp}/thumb`, blob: thumb, query: {} });
    drawBody();
  }
  async function addVideo(file, target) {
    const url = URL.createObjectURL(file);
    const v = h('video', { src: url, muted: true, playsinline: true, preload: 'metadata' });
    v.muted = true;
    const ok = await new Promise((r) => { v.onloadedmetadata = () => r(true); v.onerror = () => r(false); setTimeout(() => r(false), 8000); });
    if (ok && v.duration > MAX_VIDEO_S + 1) { URL.revokeObjectURL(url); return toast(t('Videos can be up to {n} seconds. Record a shorter clip.', { n: MAX_VIDEO_S })); }
    if (file.size > 80 * 1024 * 1024) { URL.revokeObjectURL(url); return toast(t('Videos can be up to 80 MB. Record a shorter clip.')); }
    let thumb = null;
    if (ok) {
      try {
        v.currentTime = Math.min(1, (v.duration || 1) / 2);
        await new Promise((r) => { v.onseeked = r; setTimeout(r, 4000); });
        const c = document.createElement('canvas');
        const sc = Math.min(1, 800 / (v.videoWidth || 800));
        c.width = Math.max(1, Math.round((v.videoWidth || 640) * sc)); c.height = Math.max(1, Math.round((v.videoHeight || 360) * sc));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        thumb = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
      } catch { thumb = null; }
    }
    URL.revokeObjectURL(url);
    const type = /^video\/(mp4|quicktime|webm|3gpp)/.test(file.type) ? file.type : 'video/mp4';
    queueMedia(file.slice(0, file.size, type), 'video', target, {}, thumb);
  }
  function mediaMenu(m) {
    // where the photo belongs: an item, a finding under an item, or the area in general
    const opts = [];
    tree.sections.forEach((sc) => {
      opts.push([`s:${sc.id}`, `${sc.name} · ${t('area photo')}`]);
      sc.items.forEach((it) => {
        opts.push([`i:${it.id}`, `${sc.name} · ${t(it.name)}`]);
        it.observations.forEach((o) => { if (typeof o.id === 'number') opts.push([`o:${o.id}`, `${sc.name} · ${t(it.name)} · ${o.text.slice(0, 40)}`]); });
      });
    });
    const cur = m.observation_id ? `o:${m.observation_id}` : m.item_id ? `i:${m.item_id}` : m.section_id ? `s:${m.section_id}` : '';
    const cap = h('input', { value: m.caption || '' });
    const sel = h('select', {}, h('option', { value: '' }, t('Quick photos (not placed yet)')), opts.map(([k, l]) => h('option', { value: k, selected: k === cur }, l)));
    const unlink = () => tree.sections.forEach((sc) => { sc.media = sc.media.filter((x) => x !== m.id); sc.items.forEach((it) => { it.media = (it.media || []).filter((x) => x !== m.id); it.observations.forEach((o) => { o.media = o.media.filter((x) => x !== m.id); }); }); });
    modal(h('h2', {}, t(m.kind === 'video' ? 'Video' : 'Photo')),
      m.kind === 'video' ? h('video', { src: `/api/app/media/${m.id}`, controls: true, playsinline: true, class: 'preview' }) : h('img', { src: `/api/app/media/${m.id}`, class: 'preview', alt: '' }),
      m.temp_min_c != null || m.temp_max_c != null ? h('p', { class: 'small' }, `${t('Thermal')}: min ${m.temp_min_c ?? '-'} °C, max ${m.temp_max_c ?? '-'} °C`) : null,
      editable ? [field('Caption', cap), field('Place it under', sel),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!m.in_pdf, onchange: (e) => { m.in_pdf = e.target.checked ? 1 : 0; op('PUT', `/media/${m.id}`, { in_pdf: e.target.checked }); } }), t('Show in the PDF'))] : null,
      h('p', { class: 'actions' },
        editable ? h('button', { class: 'btn cu', onclick: () => {
          const [kind, raw] = sel.value ? sel.value.split(':') : ['', ''];
          const idv = Number(raw) || null;
          unlink();
          let body = { caption: cap.value, observation_id: null, item_id: null, section_id: null };
          tree.sections.forEach((sc) => {
            if (kind === 's' && sc.id === idv) { sc.media.push(m.id); body.section_id = sc.id; }
            sc.items.forEach((it) => {
              if (kind === 'i' && it.id === idv) { (it.media ||= []).push(m.id); body = { ...body, item_id: it.id, section_id: sc.id }; }
              it.observations.forEach((o) => { if (kind === 'o' && o.id === idv) { o.media.push(m.id); body = { ...body, observation_id: o.id, item_id: it.id, section_id: sc.id }; } });
            });
          });
          Object.assign(m, { observation_id: body.observation_id, item_id: body.item_id, section_id: body.section_id, caption: cap.value });
          persist();
          op('PUT', `/media/${m.id}`, body);
          closeModal(); drawBody();
        } }, t('Save')) : null,
        editable && S.cfg?.ai && m.kind !== 'video' && !m.observation_id && m.item_id ? h('button', { class: 'btn ai', onclick: () => {
          const sc = tree.sections.find((x) => x.items.some((i) => i.id === m.item_id));
          const itm = sc?.items.find((i) => i.id === m.item_id);
          if (!itm) return;
          closeModal(); findingDialog(sc, itm, null, { photoIds: [m.id], autoAi: true });
        } }, '✨ ', t('Suggest a finding')) : null,
        editable && m.kind === 'photo' ? h('button', { class: 'btn alt', onclick: () => { R.cover_media_id = m.id; op('PUT', `/inspect/${jobId}/general`, { cover_media_id: m.id }); toast(t('Cover photo set')); closeModal(); } }, t('Use as cover photo')) : null,
        editable ? h('button', { class: 'btn danger', onclick: async () => {
          if (!(await confirmBox('Delete this file?', null, 'Delete'))) return;
          unlink();
          tree.media = tree.media.filter((x) => x.id !== m.id); mediaById.delete(m.id); persist();
          op('DELETE', `/media/${m.id}`); drawBody();
        } }, t('Delete')) : null,
        h('button', { class: 'btn alt', onclick: closeModal }, t('Close'))));
  }

  // ---------- findings ----------
  /** opts.photoIds: photos to attach to the new finding; opts.autoAi: ask the AI as soon as the dialog opens. */
  async function findingDialog(s, it, o, opts = {}) {
    let sugg = { rows: [], glossary: [], trades: [] };
    try { sugg = await A('GET', `/suggestions?item=${encodeURIComponent(it.name)}`); } catch { /* offline: free text only */ }
    let sev = o?.severity || 'attention';
    let libId = null;
    const text = h('textarea', { rows: 4, required: true }, o?.text || '');
    const trade = h('input', { value: o?.trade || '', list: 'dl-trade' });
    const inSum = h('input', { type: 'checkbox', checked: o ? !!o.in_summary : true });
    const gl = h('select', {}, h('option', { value: '' }, t('No glossary term')), sugg.glossary.map((g) => h('option', { value: g.id, selected: g.id === o?.glossary_id }, g.term)));
    const re = h('select', {}, [['', t('Re-inspection: not checked')], ['fixed', t('Fixed')], ['partly_fixed', t('Partly fixed')], ['not_fixed', t('Not fixed')]].map(([k, l]) => h('option', { value: k, selected: (o?.reinspect_status || '') === k }, l)));
    const sevBtns = h('div', { class: 'sevpick' });
    const drawSev = () => fill(sevBtns, SEV.map(([k, l]) => h('button', { type: 'button', class: `sevbtn ${k} ${sev === k ? 'on' : ''}`, onclick: () => { sev = k; inSum.checked = k !== 'info'; drawSev(); } }, t(l))));
    drawSev();
    const list = h('div', { class: 'sugg' }, sugg.rows.map((r) => h('button', { type: 'button', class: `suggbtn ${r.default_severity}`, onclick: () => { text.value = r.text; sev = r.default_severity; trade.value = r.default_trade || ''; if (r.glossary_id) gl.value = r.glossary_id; inSum.checked = sev !== 'info'; libId = r.id; drawSev(); text.focus(); } }, r.text)));
    // ---- AI: read the photos and suggest wording ----
    const aiPhotos = opts.photoIds?.length ? opts.photoIds : [...(o ? o.media : []), ...(it.media || [])].filter((x) => typeof x === 'number');
    const aiBox = h('div', { class: 'aibox' });
    const askAi = async () => {
      if (!navigator.onLine) return fill(aiBox, h('p', { class: 'small muted' }, t('AI suggestions need an internet connection.')));
      fill(aiBox, h('p', { class: 'aiwait' }, h('span', { class: 'spin' }), t('Reading the photo…')));
      try {
        const r = await A('POST', '/ai/suggest', { item_id: it.id, media_ids: aiPhotos.slice(0, 4) });
        fill(aiBox,
          h('div', { class: 'aihead' }, h('b', {}, '✨ ', t('AI suggestions')), h('span', { class: 'small muted' }, `${S.cfg?.ai_provider ? `${S.cfg.ai_provider} · ` : ''}${t('Check before saving. You are responsible for the report.')}`)),
          r.findings.length ? h('div', { class: 'sugg' }, r.findings.map((x) => h('button', { type: 'button', class: `suggbtn ai ${x.severity}`, onclick: () => {
            text.value = x.text; sev = x.severity; trade.value = x.trade || ''; inSum.checked = sev !== 'info'; libId = null; drawSev(); text.focus();
            if (r.caption && opts.photoIds?.length) opts.caption = r.caption;
          } }, x.text, h('span', { class: `conf ${x.confidence}` }, `${t(SEV.find(([k]) => k === x.severity)?.[1] || x.severity)} · ${t(`confidence ${x.confidence}`)}${x.trade ? ` · ${x.trade}` : ''}`)))) : null,
          r.note ? h('p', { class: 'small muted' }, r.note) : null,
          h('button', { class: 'btn alt sm', type: 'button', onclick: askAi }, t('Try again')));
      } catch (e) { fill(aiBox, h('p', { class: 'small bad' }, e.message), h('button', { class: 'btn alt sm', type: 'button', onclick: askAi }, t('Try again'))); }
    };
    if (S.cfg?.ai && aiPhotos.length) fill(aiBox, h('button', { class: 'btn ai', type: 'button', onclick: askAi }, '✨ ', t('Suggest from the photo')));
    const f = h('form', { onsubmit: (e) => {
      e.preventDefault();
      const v = { text: text.value.trim(), severity: sev, trade: trade.value.trim(), in_summary: inSum.checked, glossary_id: gl.value ? Number(gl.value) : null, ...(J.parent_job_id ? { reinspect_status: re.value || null } : {}) };
      if (!v.text) return toast(t('Write the finding.'));
      if (o) { Object.assign(o, v); op('PUT', `/observations/${o.id}`, v); }
      else {
        const tmp = `tmp-${uuid()}`;
        const moved = (opts.photoIds || []).filter((x) => typeof x === 'number');
        it.observations.push({ id: tmp, ...v, media: moved });
        op('POST', `/items/${it.id}/observations`, { ...v, library_id: libId || undefined }, { tmp });
        // the photo the suggestion came from moves under the new finding
        for (const mid of moved) {
          it.media = (it.media || []).filter((x) => x !== mid);
          s.media = s.media.filter((x) => x !== mid);
          const m = mediaById.get(mid); if (m) { m.observation_id = tmp; m.item_id = it.id; }
          op('PUT', `/media/${mid}`, { observation_id: tmp, item_id: it.id, section_id: s.id, ...(opts.caption && !m?.caption ? { caption: opts.caption } : {}) });
        }
      }
      persist(); closeModal(); st.open.add(String(s.id)); saveOpen(); drawHead(); drawBody();
    } }, h('h2', {}, `${s.name} · ${t(it.name)}`),
    opts.photoIds?.length ? h('div', { class: 'strip' }, opts.photoIds.map((mid) => h('span', { class: 'thumb' }, h('img', { src: `/api/app/media/${mid}?thumb=1`, alt: '' })))) : null,
    aiBox,
    sugg.rows.length && !o ? h('details', { open: !S.cfg?.ai || !aiPhotos.length }, h('summary', {}, t('Ready-made findings')), list) : null,
    field('Finding', text), h('label', {}, t('Severity')), sevBtns,
    h('div', { class: 'grid2' }, field('Recommended trade', trade), field('Glossary', gl)),
    h('datalist', { id: 'dl-trade' }, (sugg.trades.length ? sugg.trades : S.lk?.trade || []).map((v) => h('option', { value: v }))),
    J.parent_job_id ? field('Re-inspection result', re) : null,
    h('label', { class: 'check' }, inSum, t('Include in the report summary')),
    h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save')),
      o ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!(await confirmBox('Delete this finding?', t('Its photos stay in the report as area photos.'), 'Delete'))) return;
        it.observations = it.observations.filter((x) => x !== o); persist(); op('DELETE', `/observations/${o.id}`); drawHead(); drawBody();
      } }, t('Delete')) : null,
      h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
    modal(f);
    if (opts.autoAi && S.cfg?.ai && aiPhotos.length) askAi();
  }

  // ---------- areas and items ----------
  function addArea() {
    const f = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const r = await run(() => A('POST', `/inspect/${jobId}/sections`, { name: f.n.value, kind: f.kind.value, after: f.after.value || undefined }), 'Area added');
      if (r) { closeModal(); st.open.add(String(r.id)); saveOpen(); inspectJob(el, jobId); }
    } }, h('h2', {}, t('Add an area or room')),
    field('Name', h('input', { name: 'n', required: true, list: 'dl-areas', placeholder: t('e.g. Bedroom 4, Show Kitchen, Master Balcony') })),
    h('datalist', { id: 'dl-areas' }, ['Bedroom', 'Bathroom', 'Balcony', 'Master Balcony', 'Show Kitchen', 'Store Room', 'Study', 'Dining Room', 'Staircase', 'Roof', 'Garden', 'Parking', 'Plumbing', 'Life Safety'].map((v) => h('option', { value: v }))),
    field('Type', h('select', { name: 'kind' }, h('option', { value: 'area' }, t('Room / area')), h('option', { value: 'system' }, t('System (AC, electrical…)')))),
    field('Place after', h('select', { name: 'after' }, h('option', { value: '' }, t('At the end')), tree.sections.map((s) => h('option', { value: s.id }, s.name)))),
    h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Add')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
    modal(f);
  }
  function addItem(s) {
    const f = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      if (await run(() => A('POST', `/sections/${s.id}/items`, { name: f.n.value, attr_label: f.attr.value }), 'Item added')) { closeModal(); inspectJob(el, jobId); }
    } }, h('h2', {}, `${s.name}: ${t('add an item')}`),
    field('Item', h('input', { name: 'n', required: true, list: 'dl-items' })),
    h('datalist', { id: 'dl-items' }, (s.kind === 'system' ? (SYS_ITEMS[s.name] || ['Comments']) : ['Floor Condition', 'Walls Condition', 'Ceiling Condition', 'Door Condition', 'Window Condition', 'Electrical Condition', 'Counters/Cabinets Condition', 'Sink Condition', 'Toilet Condition', 'Traps/Drains/Supply Condition', 'Comments']).map((v) => h('option', { value: v }))),
    field('Attribute', h('select', { name: 'attr' }, h('option', { value: '' }, '-'), ['Materials', 'Type', 'Location'].map((v) => h('option', { value: v }, t(v))))),
    h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Add')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
    modal(f);
  }
  function sectionMenu(s, si) {
    const name = h('input', { value: s.name });
    const why = h('input', { value: s.not_inspected_reason || '', placeholder: t('e.g. No access – locked') });
    const doit = async (fn, msg) => { if (await run(fn, msg)) { closeModal(); inspectJob(el, jobId); } };
    modal(h('h2', {}, `${si + 1}. ${s.name}`),
      field('Name', name), field('Not inspected because (leave empty if inspected)', why),
      h('p', { class: 'actions' }, h('button', { class: 'btn cu', onclick: () => doit(() => A('PUT', `/sections/${s.id}`, { name: name.value, not_inspected_reason: why.value }), 'Saved') }, t('Save')),
        h('button', { class: 'btn alt', onclick: () => doit(() => A('PUT', `/sections/${s.id}`, { move: 'up' })) }, '↑ ', t('Move up')),
        h('button', { class: 'btn alt', onclick: () => doit(() => A('PUT', `/sections/${s.id}`, { move: 'down' })) }, '↓ ', t('Move down')),
        h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Delete this area?', t('Only areas without findings can be deleted.'), 'Delete')) doit(() => A('DELETE', `/sections/${s.id}`), 'Deleted'); } }, t('Delete')),
        h('button', { class: 'btn alt', onclick: closeModal }, t('Close'))));
  }

  async function accessFailed() {
    const f = h('form', { onsubmit: async (e) => { e.preventDefault(); if (await run(() => A('POST', `/inspect/${jobId}/access-failed`, { note: f.note.value }), 'The office has been told.')) { closeModal(); go('inspect'); } } },
      h('h2', {}, t('No access to the property')), field('What happened', h('textarea', { name: 'note', rows: 3, required: true })),
      h('p', { class: 'actions' }, h('button', { class: 'btn danger' }, t('Report no access')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
    modal(f);
  }
  async function submit() {
    if (sync.pending) { toast(t('Wait until all changes are sent, then submit.')); return flush(); }
    const p = await run(() => A('GET', `/inspect/${jobId}/problems`));
    if (!p) return;
    if (p.problems.length) return modal(h('h2', {}, t('Before you submit')), h('ul', {}, p.problems.map((x) => h('li', {}, t(x)))), h('p', {}, h('button', { class: 'btn alt', onclick: closeModal }, t('Close'))));
    if (!(await confirmBox('Submit for review?', t('The Technical Manager will check the report. You cannot change it unless it is returned.'), 'Submit', false))) return;
    if (await run(() => A('POST', `/inspect/${jobId}/submit`), 'Submitted for review')) go('inspect');
  }

  fill(el, head, body);
  drawHead(); drawBody();
  flush();
}

// ---------- image helpers ----------
/** Resizes to max 1600 px (orientation fixed) and re-encodes as JPEG 80%. */
async function compress(file, max = 1600, quality = 0.8) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('encode'))), 'image/jpeg', quality));
}

/** Red arrow / circle / box / text on the photo before it is saved. Resolves {blob, caption} or null. */
function annotate(blob, kind) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const c = h('canvas', { class: 'annot' });
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d');
      const shapes = [];
      let tool = 'arrow', cur = null;
      const lw = Math.max(4, Math.round(c.width / 220));
      const draw = () => {
        g.drawImage(img, 0, 0);
        g.strokeStyle = '#E53935'; g.fillStyle = '#E53935'; g.lineWidth = lw; g.lineCap = 'round';
        for (const s of [...shapes, cur].filter(Boolean)) {
          g.beginPath();
          if (s.t === 'rect') g.strokeRect(s.x, s.y, s.x2 - s.x, s.y2 - s.y);
          else if (s.t === 'circle') { g.ellipse((s.x + s.x2) / 2, (s.y + s.y2) / 2, Math.abs(s.x2 - s.x) / 2, Math.abs(s.y2 - s.y) / 2, 0, 0, Math.PI * 2); g.stroke(); }
          else if (s.t === 'arrow') {
            g.moveTo(s.x, s.y); g.lineTo(s.x2, s.y2); g.stroke();
            const a = Math.atan2(s.y2 - s.y, s.x2 - s.x), L = lw * 5;
            g.beginPath(); g.moveTo(s.x2, s.y2); g.lineTo(s.x2 - L * Math.cos(a - 0.45), s.y2 - L * Math.sin(a - 0.45)); g.lineTo(s.x2 - L * Math.cos(a + 0.45), s.y2 - L * Math.sin(a + 0.45)); g.closePath(); g.fill();
          } else if (s.t === 'text') {
            g.font = `bold ${lw * 7}px system-ui, sans-serif`; g.lineWidth = lw; g.strokeStyle = '#fff'; g.strokeText(s.text, s.x, s.y); g.fillText(s.text, s.x, s.y); g.strokeStyle = '#E53935';
          }
        }
      };
      const pt = (e) => { const r = c.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }; };
      c.addEventListener('pointerdown', (e) => {
        const p = pt(e);
        if (tool === 'text') { const txt = textIn.value.trim(); if (!txt) return toast(t('Type the text first, then tap the photo.')); shapes.push({ t: 'text', x: p.x, y: p.y, text: txt }); draw(); return; }
        c.setPointerCapture(e.pointerId); cur = { t: tool, x: p.x, y: p.y, x2: p.x, y2: p.y };
      });
      c.addEventListener('pointermove', (e) => { if (!cur) return; const p = pt(e); cur.x2 = p.x; cur.y2 = p.y; draw(); });
      c.addEventListener('pointerup', () => { if (cur && (Math.abs(cur.x2 - cur.x) > 4 || Math.abs(cur.y2 - cur.y) > 4)) shapes.push(cur); cur = null; draw(); });
      const textIn = h('input', { placeholder: t('Text'), class: 'annot-text' });
      const caption = h('input', { placeholder: t('Caption (optional)') });
      const toolBtns = h('div', { class: 'actions' });
      const drawTools = () => fill(toolBtns, [['arrow', '↗'], ['circle', '◯'], ['rect', '▭'], ['text', 'T']].map(([k, l]) => h('button', { type: 'button', class: `btn sm ${tool === k ? '' : 'alt'}`, onclick: () => { tool = k; drawTools(); } }, l)),
        h('button', { type: 'button', class: 'btn alt sm', onclick: () => { shapes.pop(); draw(); } }, t('Undo')), tool === 'text' ? textIn : null);
      drawTools(); draw();
      let done = false;
      const finish = (ok) => {
        if (done) return; done = true;
        URL.revokeObjectURL(url);
        if (!ok) { closeModal(); return resolve(null); }
        if (!shapes.length) { closeModal(); return resolve({ blob, caption: caption.value }); }
        c.toBlob((b) => { closeModal(); resolve({ blob: b || blob, caption: caption.value }); }, 'image/jpeg', 0.82);
      };
      const d = modal(h('h2', {}, t(kind === 'thermal' ? 'Thermal image' : 'Mark the photo')), h('p', { class: 'small muted' }, t('Draw on the photo to point at the defect, or just save it.')), toolBtns, c, caption,
        h('p', { class: 'actions' }, h('button', { class: 'btn cu', type: 'button', onclick: () => finish(true) }, t('Save photo')), h('button', { class: 'btn alt', type: 'button', onclick: () => finish(false) }, t('Discard'))));
      d.addEventListener('close', () => finish(false), { once: true });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ blob, caption: '' }); };
    img.src = url;
  });
}
function askTemps() {
  return new Promise((resolve) => {
    const f = h('form', { onsubmit: (e) => { e.preventDefault(); closeModal(); resolve({ min: f.min.value, max: f.max.value }); } },
      h('h2', {}, t('Thermal readings')), h('div', { class: 'grid2' }, field('Minimum °C', h('input', { name: 'min', inputmode: 'decimal', class: 'ltr' })), field('Maximum °C', h('input', { name: 'max', inputmode: 'decimal', class: 'ltr' }))),
      h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save')), h('button', { class: 'btn alt', type: 'button', onclick: () => { closeModal(); resolve(null); } }, t('Cancel'))));
    modal(f);
  });
}
