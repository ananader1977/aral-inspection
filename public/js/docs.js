// Company documents: trade licence, MOA, IDs, insurance and other papers, with expiry warnings.
import { h, fill, t, fmtDay, todayIso, toast, pill } from '/js/common.js';
import { A, run, modal, closeModal, field, confirmBox } from '/js/app.js';

const TYPES = ['Trade licence', 'Memorandum of Association (MOA)', 'Establishment card', 'Owner / partner ID', 'Passport and visa', 'RERA / DLD registration', 'Tax registration (VAT, corporate tax)', 'Insurance', 'Tenancy contract (Ejari)', 'Bank documents', 'Certificate', 'Other'];

export async function docsView(el) {
  const box = h('div', {});
  fill(el, h('div', { class: 'actions' }, h('h2', {}, t('Company documents')), h('span', { class: 'spacer' }), h('button', { class: 'btn cu', onclick: () => addForm(load) }, t('Add a document'))),
    h('p', { class: 'small muted' }, t('Keep the company papers here. Only Super Admin and Admin can see them. Add an expiry date to be warned before a paper runs out.')), box);
  async function load() {
    const { rows } = await A('GET', '/company-docs');
    const soon = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10), today = todayIso();
    fill(box, rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Type', 'Title', 'Number', 'Expiry', 'File', ''].map((x) => h('th', {}, t(x))))),
      h('tbody', {}, rows.map((d) => h('tr', {},
        h('td', {}, t(d.category)), h('td', {}, h('b', {}, d.title), d.notes ? h('div', { class: 'small muted' }, d.notes) : null), h('td', { class: 'ltr' }, d.doc_no || '-'),
        h('td', { class: 'nowrap' }, d.expiry_date ? [fmtDay(d.expiry_date), ' ', d.expiry_date < today ? pill(t('Expired'), 'bad') : d.expiry_date <= soon ? pill(t('Expires soon'), 'warn') : null] : '-'),
        h('td', {}, h('a', { class: 'btn alt sm', href: `/api/app/company-docs/${d.id}/file`, target: '_blank' }, t('Open'))),
        h('td', {}, h('button', { class: 'btn danger sm', onclick: async () => { if (await confirmBox('Delete this document?', d.title, 'Delete')) { if (await run(() => A('DELETE', `/company-docs/${d.id}`), 'Deleted')) load(); } } }, t('Delete')))))))) : h('p', { class: 'muted' }, t('No documents yet.')));
  }
  load();
}

function addForm(reload) {
  const file = h('input', { type: 'file', required: true, accept: 'application/pdf,image/jpeg,image/png,image/webp,.doc,.docx,.xls,.xlsx' });
  const f = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const fl = file.files[0];
    if (!fl) return;
    const q = new URLSearchParams({ name: fl.name, category: f.category.value, title: f.title.value, doc_no: f.doc_no.value, issue_date: f.issue_date.value, expiry_date: f.expiry_date.value, notes: f.notes.value });
    const mime = fl.type || ({ doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })[fl.name.split('.').pop().toLowerCase()] || '';
    const res = await fetch(`/api/app/company-docs?${q}`, { method: 'POST', headers: { 'X-Requested-With': 'aral', 'Content-Type': mime }, body: fl });
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error || t('The document could not be saved.'), 6000);
    toast(t('Saved')); closeModal(); reload();
  } }, h('h2', {}, t('Add a document')),
  h('div', { class: 'grid3' }, field('Type', h('select', { name: 'category' }, TYPES.map((x) => h('option', { value: x }, t(x))))), field('Title', h('input', { name: 'title', required: true, maxlength: 120 })), field('Number', h('input', { name: 'doc_no', maxlength: 60 }))),
  h('div', { class: 'grid3' }, field('Issue date', h('input', { name: 'issue_date', type: 'date' })), field('Expiry date', h('input', { name: 'expiry_date', type: 'date' })), field('Notes', h('input', { name: 'notes', maxlength: 500 }))),
  field('File (PDF, photo, Word or Excel, up to 15 MB)', file),
  h('p', { class: 'actions' }, h('button', { class: 'btn cu' }, t('Save')), h('button', { class: 'btn alt', type: 'button', onclick: closeModal }, t('Cancel'))));
  modal(f);
}
