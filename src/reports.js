// Inspection reports: built from the checklist when a job is scheduled, filled on the phone
// (sections → items → findings → photos/videos), then submitted, reviewed and issued as a PDF.
import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { tx } from './db.js';
import { clampStr } from './util.js';
import { dateKey, fmtStamp, HOUR, DAY, money } from './time.js';
import { layout, rows } from './emails.js';

const SEVERITIES = ['critical', 'attention', 'info'];
const token = () => crypto.randomBytes(18).toString('base64url');
const IMG_MIME = ['image/jpeg', 'image/png'];
const VID_MIME = ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp'];
export const MAX_PHOTO = 12 * 1024 * 1024;
export const MAX_VIDEO = 80 * 1024 * 1024;
export const MAX_ATTACHMENT = 20 * 1024 * 1024;
const EMAIL_ATTACH_LIMIT = 15 * 1024 * 1024; // Gmail accepts 25 MB per email; keep room for the report PDF

export function createReports(ctx) {
  const { db } = ctx;
  const S = () => ctx.settings();
  const J = () => ctx.jobs;

  /** Creates the report and its sections/items from the service checklist (once per job). */
  function ensureReport(jobId) {
    const existing = db.prepare('SELECT id FROM reports WHERE job_id=?').get(jobId);
    if (existing) return existing.id;
    const j = J().getJob(jobId);
    const svc = db.prepare('SELECT * FROM services WHERE id=?').get(j.service_id);
    const prop = db.prepare('SELECT * FROM properties WHERE id=?').get(j.property_id);
    const title = `${svc.name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/ Inspection$| Report$/, '').trim()} Inspection Report`.replace('Condition Report Inspection Report', 'Condition Report');
    const rid = Number(db.prepare(`INSERT INTO reports(job_id,title,status,occupancy,levels,ac_connected,dewa_connected,thermal_used,verify_token,created_at,updated_at)
      VALUES(?,?,'draft',?,?,?,?,?,?,?,?)`).run(jobId, title, j.occupancy || '', prop.levels || 1, j.ac_connected, j.dewa_connected, svc.needs_thermal ? 1 : 0, token(), ctx.now(), ctx.now()).lastInsertRowid);
    if (j.parent_job_id) { copyForReinspection(rid, j.parent_job_id); return rid; }
    const cl = svc.checklist_id || db.prepare('SELECT id FROM checklists WHERE active=1 ORDER BY id LIMIT 1').get()?.id;
    if (!cl) return rid;
    const beds = prop.property_type === 'studio' ? 0 : Number(prop.bedrooms ?? 1);
    const villa = ['villa', 'townhouse'].includes(prop.property_type);
    let sort = 0;
    for (const st of db.prepare('SELECT * FROM section_templates WHERE checklist_id=? ORDER BY sort').all(cl)) {
      let names = [st.name];
      if (st.repeat_rule === 'per_extra_bedroom' || st.repeat_rule === 'per_bedroom') {
        const from = st.repeat_rule === 'per_bedroom' ? 1 : 2;
        names = []; for (let n = from; n <= beds; n++) names.push(st.name.replace('{n}', n));
      } else if (st.repeat_rule === 'per_bathroom') {
        names = []; for (let n = 1; n <= Math.max(1, beds); n++) names.push(st.name.replace('{n}', n));
      } else if (st.repeat_rule === 'if_maid') { if (!prop.has_maid_room) names = []; }
      else if (st.repeat_rule === 'if_villa') { if (!villa) names = []; }
      if (beds === 0) names = names.map((n) => (n === 'Master Bedroom' ? 'Living / Sleeping Area' : n === 'Master Bathroom' ? 'Bathroom' : n)).filter((n) => n !== 'Living Room');
      const intro = st.intro_block_code ? ctx.admin.currentBlock(st.intro_block_code)?.body || '' : '';
      for (const name of names) {
        const sid = Number(db.prepare('INSERT INTO report_sections(report_id,name,kind,intro,sort) VALUES(?,?,?,?,?)').run(rid, name, st.kind, intro, ++sort).lastInsertRowid);
        for (const it of db.prepare('SELECT * FROM item_templates WHERE section_template_id=? ORDER BY sort').all(st.id))
          db.prepare('INSERT INTO report_items(section_id,name,attr_label,attr_list,attr_value,sort) VALUES(?,?,?,?,?,?)').run(sid, it.name, it.attr_label, it.attr_list, '', it.sort);
      }
    }
    return rid;
  }

  /** A re-inspection report starts with the open (critical / attention) findings of the original. */
  function copyForReinspection(rid, parentJobId) {
    const parent = db.prepare('SELECT id FROM reports WHERE job_id=?').get(parentJobId);
    if (!parent) return;
    let sort = 0;
    for (const sc of db.prepare('SELECT * FROM report_sections WHERE report_id=? ORDER BY sort').all(parent.id)) {
      const items = db.prepare(`SELECT it.* FROM report_items it WHERE it.section_id=? AND EXISTS (SELECT 1 FROM observations o WHERE o.item_id=it.id AND o.severity IN ('critical','attention')) ORDER BY sort`).all(sc.id);
      if (!items.length) continue;
      const sid = Number(db.prepare('INSERT INTO report_sections(report_id,name,kind,intro,sort) VALUES(?,?,?,?,?)').run(rid, sc.name, sc.kind, '', ++sort).lastInsertRowid);
      for (const it of items) {
        const iid = Number(db.prepare('INSERT INTO report_items(section_id,name,attr_label,attr_list,attr_value,sort) VALUES(?,?,?,?,?,?)').run(sid, it.name, it.attr_label, it.attr_list, it.attr_value, it.sort).lastInsertRowid);
        for (const o of db.prepare("SELECT * FROM observations WHERE item_id=? AND severity IN ('critical','attention') ORDER BY sort").all(it.id))
          db.prepare('INSERT INTO observations(item_id,text,severity,trade,in_summary,responsible,glossary_id,library_id,sort,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
            .run(iid, o.text, o.severity, o.trade, 1, o.responsible, o.glossary_id, o.library_id, o.sort, ctx.now());
      }
    }
  }

  const reportOfJob = (jobId) => { const r = db.prepare('SELECT * FROM reports WHERE job_id=?').get(jobId); if (!r) throw new HttpError(404, 'This job has no report yet. Schedule it first.'); return r; };
  const canEdit = (r, user) => {
    if (['issued', 'superseded'].includes(r.status)) throw new HttpError(409, 'This report is issued and can no longer be changed.');
    if (user?.role === 'inspector' && ['submitted', 'approved'].includes(r.status)) throw new HttpError(409, 'This report is with the reviewer.');
  };
  const own = (jobId, user) => {
    if (user?.role !== 'inspector') return;
    const j = db.prepare('SELECT inspector_id FROM jobs WHERE id=?').get(jobId);
    if (!j || j.inspector_id !== user.inspector_id) throw new HttpError(403, 'This job is not assigned to you.');
  };
  const jobOfSection = (sid) => db.prepare('SELECT r.job_id, r.id rid FROM report_sections s JOIN reports r ON r.id=s.report_id WHERE s.id=?').get(sid);
  const jobOfItem = (iid) => db.prepare('SELECT r.job_id, r.id rid FROM report_items it JOIN report_sections s ON s.id=it.section_id JOIN reports r ON r.id=s.report_id WHERE it.id=?').get(iid);
  const jobOfObs = (oid) => db.prepare('SELECT r.job_id, r.id rid FROM observations o JOIN report_items it ON it.id=o.item_id JOIN report_sections s ON s.id=it.section_id JOIN reports r ON r.id=s.report_id WHERE o.id=?').get(oid);
  function guard(ref, user) {
    if (!ref) throw new HttpError(404, 'Not found');
    own(ref.job_id, user);
    canEdit(db.prepare('SELECT * FROM reports WHERE id=?').get(ref.rid), user);
    db.prepare('UPDATE reports SET updated_at=? WHERE id=?').run(ctx.now(), ref.rid);
    return ref;
  }

  /** The whole report tree for the phone app and the review screen. */
  function tree(jobId, user) {
    own(jobId, user);
    const r = reportOfJob(jobId);
    const media = db.prepare('SELECT m.*, f.mime, f.size FROM media m JOIN files f ON f.id=m.file_id WHERE m.job_id=? ORDER BY m.sort, m.id').all(jobId);
    const sections = db.prepare('SELECT * FROM report_sections WHERE report_id=? ORDER BY sort, id').all(r.id).map((s) => ({
      ...s,
      items: db.prepare('SELECT * FROM report_items WHERE section_id=? ORDER BY sort, id').all(s.id).map((it) => ({
        ...it, media: media.filter((m) => m.item_id === it.id && !m.observation_id).map((m) => m.id), observations: db.prepare('SELECT * FROM observations WHERE item_id=? ORDER BY sort, id').all(it.id).map((o) => ({ ...o, media: media.filter((m) => m.observation_id === o.id).map((m) => m.id) })),
      })),
      media: media.filter((m) => m.section_id === s.id && !m.observation_id && !m.item_id).map((m) => m.id),
    }));
    const j = J().getJob(jobId);
    return {
      report: { ...r, persons_present: JSON.parse(r.persons_present || '[]'), equipment_used: JSON.parse(r.equipment_used || '[]') },
      job: { id: j.id, number: j.number, status: j.status, status_label: j.status_label || J().JOB_STATUS_LABEL[j.status], client_name: j.client_name, client_mobile: j.client_mobile, service_name: j.service_name, service_code: j.service_code, property_type: j.property_type, bedrooms: j.bedrooms, building: j.building, unit_no: j.unit_no, community: j.community, access_notes: j.access_notes, access_contact: j.access_contact, scheduled_start: j.scheduled_start, scheduled_end: j.scheduled_end, inspector_name: j.inspector_name, access_at: j.access_at, sla_due_at: j.sla_due_at, needs_thermal: j.needs_thermal, parent_job_id: j.parent_job_id },
      sections, media: media.map((m) => ({ id: m.id, kind: m.kind, observation_id: m.observation_id, section_id: m.section_id, item_id: m.item_id, caption: m.caption, mime: m.mime, size: m.size, has_thumb: !!m.thumb_file_id, in_pdf: m.in_pdf, temp_min_c: m.temp_min_c, temp_max_c: m.temp_max_c, pair_media_id: m.pair_media_id, client_uuid: m.client_uuid })),
      counts: countFindings(r.id),
      attachments: listAttachments(r.id),
    };
  }
  const listAttachments = (rid) => db.prepare('SELECT a.id, a.title, a.description, a.kind, a.in_pdf, a.send_with_report, a.sort, a.created_at, f.name, f.mime, f.size FROM report_attachments a JOIN files f ON f.id=a.file_id WHERE a.report_id=? ORDER BY a.sort, a.id').all(rid);

  // ---------- attachments (documents added to the report) ----------
  async function addAttachment(user, jobId, { buf, mime, name, title, description }) {
    own(jobId, user);
    const r = reportOfJob(jobId); canEdit(r, user);
    mime = String(mime || '').split(';')[0].toLowerCase();
    const kind = mime === 'application/pdf' ? 'pdf' : IMG_MIME.includes(mime) ? 'image' : null;
    if (!kind) throw new HttpError(415, 'Attachments must be PDF, JPEG or PNG files.');
    if (!buf?.length) throw new HttpError(400, 'The file is empty.');
    if (buf.length > MAX_ATTACHMENT) throw new HttpError(413, 'Attachments can be up to 20 MB.');
    if (kind === 'pdf' && buf.subarray(0, 5).toString() !== '%PDF-') throw new HttpError(415, 'This file is not a valid PDF.');
    const ttl = clampStr(title, 120) || clampStr(String(name || '').replace(/\.[a-z0-9]+$/i, ''), 120);
    if (!ttl) throw new HttpError(400, 'Give the attachment a title.');
    if (db.prepare('SELECT COUNT(*) n FROM report_attachments WHERE report_id=?').get(r.id).n >= 30) throw new HttpError(409, 'A report can have up to 30 attachments.');
    const safeName = clampStr(String(name || ttl).replace(/[^\w.\- ]+/g, '_'), 100) || `attachment.${kind === 'pdf' ? 'pdf' : 'jpg'}`;
    const fileId = await ctx.storage.save({ name: safeName, mime, buf, jobId, purpose: 'attachment', userId: user?.id });
    const sort = db.prepare('SELECT COALESCE(MAX(sort),0) m FROM report_attachments WHERE report_id=?').get(r.id).m + 1;
    const id = Number(db.prepare('INSERT INTO report_attachments(report_id,file_id,title,description,kind,sort,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(r.id, fileId, ttl, clampStr(description, 500), kind, sort, user?.id ?? null, ctx.now()).lastInsertRowid);
    db.prepare('UPDATE reports SET updated_at=? WHERE id=?').run(ctx.now(), r.id);
    return id;
  }
  const attachmentRow = (id) => {
    const a = db.prepare('SELECT a.*, r.job_id, r.status rstatus, r.verify_token FROM report_attachments a JOIN reports r ON r.id=a.report_id WHERE a.id=?').get(id);
    if (!a) throw new HttpError(404, 'Attachment not found');
    return a;
  };
  function updateAttachment(user, id, b) {
    const a = attachmentRow(id);
    own(a.job_id, user); canEdit(reportOfJob(a.job_id), user);
    if (b.title !== undefined) { if (!clampStr(b.title, 120)) throw new HttpError(400, 'Give the attachment a title.'); db.prepare('UPDATE report_attachments SET title=? WHERE id=?').run(clampStr(b.title, 120), id); }
    if (b.description !== undefined) db.prepare('UPDATE report_attachments SET description=? WHERE id=?').run(clampStr(b.description, 500), id);
    if (b.in_pdf !== undefined) db.prepare('UPDATE report_attachments SET in_pdf=? WHERE id=?').run(b.in_pdf ? 1 : 0, id);
    if (b.send_with_report !== undefined) db.prepare('UPDATE report_attachments SET send_with_report=? WHERE id=?').run(b.send_with_report ? 1 : 0, id);
    if (b.move) {
      const ids = db.prepare('SELECT id FROM report_attachments WHERE report_id=? ORDER BY sort, id').all(a.report_id).map((x) => x.id);
      const i = ids.indexOf(id), k = i + (b.move === 'up' ? -1 : 1);
      if (k >= 0 && k < ids.length) { [ids[i], ids[k]] = [ids[k], ids[i]]; ids.forEach((x, n) => db.prepare('UPDATE report_attachments SET sort=? WHERE id=?').run(n + 1, x)); }
    }
  }
  async function deleteAttachment(user, id) {
    const a = attachmentRow(id);
    own(a.job_id, user); canEdit(reportOfJob(a.job_id), user);
    db.prepare('DELETE FROM report_attachments WHERE id=?').run(id);
    await ctx.storage.remove(a.file_id);
  }
  /** Bytes of an attachment, for staff (user) or for the client through the report link (token). */
  async function attachmentBytes(id, { user, token: tok } = {}) {
    const a = attachmentRow(id);
    if (tok !== undefined) { if (tok !== a.verify_token || !['issued', 'superseded'].includes(a.rstatus)) throw new HttpError(404, 'Not found'); }
    else own(a.job_id, user);
    const f = ctx.storage.get(a.file_id);
    return { buf: await ctx.storage.read(a.file_id), mime: f.mime, name: f.name, title: a.title };
  }
  const countFindings = (rid) => Object.fromEntries(SEVERITIES.map((s) => [s, db.prepare('SELECT COUNT(*) n FROM observations o JOIN report_items it ON it.id=o.item_id JOIN report_sections sc ON sc.id=it.section_id WHERE sc.report_id=? AND o.severity=?').get(rid, s).n]));

  // ---------- on site ----------
  function checkIn(user, jobId) {
    own(jobId, user);
    const j = J().getJob(jobId);
    if (j.status === 'report_draft') return J().getJob(jobId);
    if (j.status !== 'scheduled') throw new HttpError(409, 'Only a scheduled job can be started.');
    const rate = db.prepare('SELECT sla_hours FROM client_rates WHERE client_id=? AND service_id=?').get(j.client_id, j.service_id);
    const sla = rate?.sla_hours || j.default_sla_hours || 48;
    const t = ctx.now();
    tx(db, () => {
      db.prepare('UPDATE jobs SET access_at=?, sla_due_at=? WHERE id=?').run(t, t + sla * HOUR, jobId);
      const r = reportOfJob(jobId);
      const hhmm = new Date(t + 4 * HOUR).toISOString().slice(11, 16);
      db.prepare('UPDATE reports SET inspection_date=COALESCE(inspection_date,?), time_in=COALESCE(time_in,?), equipment_used=?, updated_at=? WHERE id=?').run(dateKey(t), hhmm, j.equipment_ids || '[]', t, r.id);
      J().move(user, jobId, 'report_draft', `Inspector on site · report due ${fmtStamp(t + sla * HOUR)}`);
    });
    return J().getJob(jobId);
  }
  async function accessFailed(user, jobId, note) {
    own(jobId, user);
    J().move(user, jobId, 'access_failed', `Access failed: ${clampStr(note, 300) || 'no access to the property'}`);
    await J().notifyOffice(`Access failed on ${J().getJob(jobId).number}`, clampStr(note, 500));
  }

  function updateGeneral(user, jobId, b) {
    own(jobId, user);
    const r = reportOfJob(jobId);
    canEdit(r, user);
    const f = {};
    for (const k of ['inspection_date', 'time_in', 'time_out', 'occupancy', 'property_note', 'estimated_age', 'weather', 'overall_condition', 'title']) if (b[k] !== undefined) f[k] = clampStr(b[k], k === 'property_note' ? 1000 : 120);
    if (f.inspection_date && !/^\d{4}-\d{2}-\d{2}$/.test(f.inspection_date)) throw new HttpError(400, 'Inspection date: use the date picker.');
    for (const k of ['time_in', 'time_out']) if (f[k] && !/^\d{1,2}:\d{2}$/.test(f[k])) throw new HttpError(400, 'Times must look like 09:30.');
    if (b.levels !== undefined) f.levels = Number(b.levels) || null;
    if (b.temperature_c !== undefined) f.temperature_c = b.temperature_c === '' || b.temperature_c == null ? null : Number(b.temperature_c);
    for (const k of ['ac_connected', 'dewa_connected', 'thermal_used']) if (b[k] !== undefined) f[k] = b[k] === null || b[k] === '' ? null : b[k] ? 1 : 0;
    if (b.persons_present !== undefined) f.persons_present = JSON.stringify([].concat(b.persons_present).map((x) => clampStr(x, 40)).filter(Boolean).slice(0, 10));
    if (b.cover_media_id !== undefined) f.cover_media_id = b.cover_media_id ? Number(b.cover_media_id) : null;
    const keys = Object.keys(f);
    if (keys.length) db.prepare(`UPDATE reports SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`).run(...keys.map((k) => f[k]), ctx.now(), r.id);
  }

  function addSection(user, jobId, { name, kind = 'area', after }) {
    own(jobId, user);
    const r = reportOfJob(jobId); canEdit(r, user);
    if (!clampStr(name, 80)) throw new HttpError(400, 'Give the area a name.');
    const max = db.prepare('SELECT COALESCE(MAX(sort),0) m FROM report_sections WHERE report_id=?').get(r.id).m;
    const sid = Number(db.prepare('INSERT INTO report_sections(report_id,name,kind,intro,sort) VALUES(?,?,?,?,?)').run(r.id, clampStr(name, 80), kind === 'system' ? 'system' : 'area', '', max + 1).lastInsertRowid);
    // copy items from a matching template (e.g. "Bedroom 4" → the Bedroom items)
    const base = clampStr(name, 80).replace(/\s*\d+$/, '');
    const st = db.prepare("SELECT id FROM section_templates WHERE REPLACE(name,' {n}','')=? OR name=? ORDER BY id LIMIT 1").get(base, base);
    const items = st ? db.prepare('SELECT name, attr_label, attr_list, sort FROM item_templates WHERE section_template_id=? ORDER BY sort').all(st.id) : [{ name: 'Comments', attr_label: null, attr_list: null, sort: 1 }];
    for (const it of items) db.prepare('INSERT INTO report_items(section_id,name,attr_label,attr_list,attr_value,sort) VALUES(?,?,?,?,?,?)').run(sid, it.name, it.attr_label, it.attr_list, '', it.sort);
    if (after) {
      const ids = db.prepare('SELECT id FROM report_sections WHERE report_id=? ORDER BY sort, id').all(r.id).map((x) => x.id).filter((x) => x !== sid);
      const pos = ids.indexOf(Number(after));
      ids.splice(pos < 0 ? ids.length : pos + 1, 0, sid);
      ids.forEach((x, i) => db.prepare('UPDATE report_sections SET sort=? WHERE id=?').run(i + 1, x));
    }
    return sid;
  }
  function updateSection(user, sid, b) {
    guard(jobOfSection(sid), user);
    if (b.name !== undefined) { if (!clampStr(b.name, 80)) throw new HttpError(400, 'Give the area a name.'); db.prepare('UPDATE report_sections SET name=? WHERE id=?').run(clampStr(b.name, 80), sid); }
    if (b.intro !== undefined) db.prepare('UPDATE report_sections SET intro=? WHERE id=?').run(clampStr(b.intro, 4000), sid);
    if (b.not_inspected_reason !== undefined) db.prepare('UPDATE report_sections SET not_inspected_reason=? WHERE id=?').run(clampStr(b.not_inspected_reason, 200), sid);
    if (b.move) {
      const ref = jobOfSection(sid);
      const ids = db.prepare('SELECT id FROM report_sections WHERE report_id=? ORDER BY sort, id').all(ref.rid).map((x) => x.id);
      const i = ids.indexOf(sid), k = i + (b.move === 'up' ? -1 : 1);
      if (k >= 0 && k < ids.length) { [ids[i], ids[k]] = [ids[k], ids[i]]; ids.forEach((x, n) => db.prepare('UPDATE report_sections SET sort=? WHERE id=?').run(n + 1, x)); }
    }
  }
  function deleteSection(user, sid) {
    guard(jobOfSection(sid), user);
    if (db.prepare('SELECT COUNT(*) n FROM observations o JOIN report_items it ON it.id=o.item_id WHERE it.section_id=?').get(sid).n) throw new HttpError(409, 'This area has findings. Delete them first, or mark the area as not inspected.');
    db.prepare('DELETE FROM report_sections WHERE id=?').run(sid);
  }
  function addItem(user, sid, { name, attr_label }) {
    guard(jobOfSection(sid), user);
    if (!clampStr(name, 80)) throw new HttpError(400, 'Give the item a name.');
    const max = db.prepare('SELECT COALESCE(MAX(sort),0) m FROM report_items WHERE section_id=?').get(sid).m;
    return Number(db.prepare('INSERT INTO report_items(section_id,name,attr_label,attr_value,sort) VALUES(?,?,?,?,?)').run(sid, clampStr(name, 80), clampStr(attr_label, 30) || null, '', max + 1).lastInsertRowid);
  }
  function updateItem(user, iid, b) {
    guard(jobOfItem(iid), user);
    if (b.attr_value !== undefined) db.prepare('UPDATE report_items SET attr_value=? WHERE id=?').run(clampStr(b.attr_value, 120), iid);
    if (b.name !== undefined && clampStr(b.name, 80)) db.prepare('UPDATE report_items SET name=? WHERE id=?').run(clampStr(b.name, 80), iid);
  }
  function deleteItem(user, iid) {
    guard(jobOfItem(iid), user);
    if (db.prepare('SELECT COUNT(*) n FROM observations WHERE item_id=?').get(iid).n) throw new HttpError(409, 'This item has findings. Delete them first.');
    if (db.prepare('SELECT COUNT(*) n FROM media WHERE item_id=?').get(iid).n) throw new HttpError(409, 'This item has photos. Delete them first.');
    db.prepare('DELETE FROM report_items WHERE id=?').run(iid);
  }

  function obsFields(b, partial) {
    const f = {};
    if (b.text !== undefined || !partial) { f.text = clampStr(b.text, 2000); if (!f.text) throw new HttpError(400, 'Write the finding.'); }
    if (b.severity !== undefined || !partial) { f.severity = SEVERITIES.includes(b.severity) ? b.severity : 'attention'; }
    if (b.trade !== undefined) f.trade = clampStr(b.trade, 80);
    if (b.in_summary !== undefined) f.in_summary = b.in_summary ? 1 : 0;
    if (b.responsible !== undefined) f.responsible = clampStr(b.responsible, 40);
    if (b.repair_cost_est !== undefined) f.repair_cost_est = b.repair_cost_est === '' || b.repair_cost_est == null ? null : Number(b.repair_cost_est);
    if (b.glossary_id !== undefined) f.glossary_id = b.glossary_id ? Number(b.glossary_id) : null;
    if (b.reinspect_status !== undefined) f.reinspect_status = ['fixed', 'not_fixed', 'partly_fixed'].includes(b.reinspect_status) ? b.reinspect_status : null;
    return f;
  }
  function addObservation(user, iid, b) {
    guard(jobOfItem(iid), user);
    const lib = b.library_id ? db.prepare('SELECT * FROM comment_library WHERE id=?').get(Number(b.library_id)) : null;
    const f = obsFields({ text: lib?.text, severity: lib?.default_severity, trade: lib?.default_trade ?? '', glossary_id: lib?.glossary_id, ...b }, false);
    if (f.in_summary === undefined) f.in_summary = f.severity === 'info' ? 0 : 1;
    if (lib) db.prepare('UPDATE comment_library SET uses=uses+1 WHERE id=?').run(lib.id);
    const max = db.prepare('SELECT COALESCE(MAX(sort),0) m FROM observations WHERE item_id=?').get(iid).m;
    const keys = Object.keys(f);
    return Number(db.prepare(`INSERT INTO observations(item_id,${keys.join(',')},library_id,sort,created_by,created_at) VALUES(?,${keys.map(() => '?').join(',')},?,?,?,?)`).run(iid, ...keys.map((k) => f[k]), lib?.id ?? null, max + 1, user?.id ?? null, ctx.now()).lastInsertRowid);
  }
  function updateObservation(user, oid, b) {
    guard(jobOfObs(oid), user);
    const f = obsFields(b, true);
    const keys = Object.keys(f);
    if (keys.length) db.prepare(`UPDATE observations SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map((k) => f[k]), oid);
  }
  function deleteObservation(user, oid) {
    guard(jobOfObs(oid), user);
    const itemId = db.prepare('SELECT item_id FROM observations WHERE id=?').get(oid)?.item_id;
    db.prepare('UPDATE media SET observation_id=NULL, item_id=COALESCE(item_id,?) WHERE observation_id=?').run(itemId ?? null, oid);
    db.prepare('DELETE FROM observations WHERE id=?').run(oid);
  }
  /** Comment-library suggestions for an item (matching item name first, then general). */
  const suggestions = (itemName) => db.prepare("SELECT c.*, g.term FROM comment_library c LEFT JOIN glossary g ON g.id=c.glossary_id WHERE c.active=1 AND (c.item_name=? OR c.item_name='*') ORDER BY (c.item_name=?) DESC, c.uses DESC, c.id LIMIT 40").all(itemName, itemName);

  // ---------- photos and videos ----------
  /** Saves an uploaded photo/video. Idempotent on client_uuid so the phone can retry after going offline. */
  async function addMedia(user, jobId, { buf, mime, kind, client_uuid, observation_id, section_id, item_id, caption, temp_min_c, temp_max_c, pair_media_id, taken_at }) {
    own(jobId, user);
    const r = reportOfJob(jobId); canEdit(r, user);
    if (client_uuid) { const ex = db.prepare('SELECT id FROM media WHERE client_uuid=?').get(String(client_uuid)); if (ex) return ex.id; }
    kind = ['photo', 'video', 'thermal'].includes(kind) ? kind : 'photo';
    mime = String(mime || '').split(';')[0].toLowerCase();
    if (kind === 'video' ? !VID_MIME.includes(mime) : !IMG_MIME.includes(mime)) throw new HttpError(415, kind === 'video' ? 'Videos must be MP4, MOV or WebM.' : 'Photos must be JPEG or PNG.');
    if (!buf?.length) throw new HttpError(400, 'The file is empty.');
    if (buf.length > (kind === 'video' ? MAX_VIDEO : MAX_PHOTO)) throw new HttpError(413, kind === 'video' ? 'Videos can be up to 80 MB. Record a shorter clip.' : 'Photos can be up to 12 MB.');
    let oid = observation_id ? Number(observation_id) : null, sid = section_id ? Number(section_id) : null;
    if (oid) { const ref = jobOfObs(oid); if (!ref || ref.job_id !== jobId) throw new HttpError(400, 'Finding not found.'); }
    if (sid) { const ref = jobOfSection(sid); if (!ref || ref.job_id !== jobId) throw new HttpError(400, 'Area not found.'); }
    let iid = item_id ? Number(item_id) : null;
    if (iid) { const ref = jobOfItem(iid); if (!ref || ref.job_id !== jobId) throw new HttpError(400, 'Item not found.'); if (!sid) sid = db.prepare('SELECT section_id FROM report_items WHERE id=?').get(iid).section_id; }
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/3gpp': '.3gp' }[mime];
    const n = db.prepare('SELECT COUNT(*) n FROM media WHERE job_id=?').get(jobId).n + 1;
    const number = J().getJob(jobId).number;
    const fileId = await ctx.storage.save({ name: `${number}_${kind}_${String(n).padStart(3, '0')}${ext}`, mime, buf, jobId, purpose: kind, userId: user?.id });
    let size = null;
    if (mime === 'image/jpeg') { const { jpegInfo } = await import('./pdf.js'); size = jpegInfo(buf); }
    const id = Number(db.prepare(`INSERT INTO media(job_id,observation_id,section_id,item_id,kind,pair_media_id,file_id,width,height,caption,temp_min_c,temp_max_c,taken_at,sort,client_uuid,uploaded_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(jobId, oid, sid, iid, kind, pair_media_id ? Number(pair_media_id) : null, fileId, size?.width ?? null, size?.height ?? null, clampStr(caption, 200),
      temp_min_c === '' || temp_min_c == null ? null : Number(temp_min_c), temp_max_c === '' || temp_max_c == null ? null : Number(temp_max_c), Number(taken_at) || ctx.now(), n, client_uuid ? String(client_uuid).slice(0, 64) : null, user?.id ?? null, ctx.now()).lastInsertRowid);
    return id;
  }
  async function addThumb(user, mediaId, buf, mime) {
    const m = db.prepare('SELECT * FROM media WHERE id=?').get(mediaId);
    if (!m) throw new HttpError(404, 'Not found');
    own(m.job_id, user);
    if (!['image/jpeg', 'image/png'].includes(String(mime).split(';')[0])) throw new HttpError(415, 'The preview must be a JPEG.');
    if (buf.length > 2 * 1024 * 1024) throw new HttpError(413, 'Preview too large');
    const fid = await ctx.storage.save({ name: `thumb_${mediaId}.jpg`, mime: String(mime).split(';')[0], buf, jobId: m.job_id, purpose: 'thumb', userId: user?.id });
    db.prepare('UPDATE media SET thumb_file_id=? WHERE id=?').run(fid, mediaId);
  }
  function updateMedia(user, mediaId, b) {
    const m = db.prepare('SELECT * FROM media WHERE id=?').get(mediaId);
    if (!m) throw new HttpError(404, 'Not found');
    own(m.job_id, user); canEdit(reportOfJob(m.job_id), user);
    if (b.caption !== undefined) db.prepare('UPDATE media SET caption=? WHERE id=?').run(clampStr(b.caption, 200), mediaId);
    if (b.in_pdf !== undefined) db.prepare('UPDATE media SET in_pdf=? WHERE id=?').run(b.in_pdf ? 1 : 0, mediaId);
    if (b.observation_id !== undefined) {
      const oid = b.observation_id ? Number(b.observation_id) : null;
      if (oid && jobOfObs(oid)?.job_id !== m.job_id) throw new HttpError(400, 'Finding not found.');
      db.prepare('UPDATE media SET observation_id=? WHERE id=?').run(oid, mediaId);
    }
    if (b.section_id !== undefined) db.prepare('UPDATE media SET section_id=? WHERE id=?').run(b.section_id ? Number(b.section_id) : null, mediaId);
    if (b.item_id !== undefined) {
      const iid = b.item_id ? Number(b.item_id) : null;
      if (iid && jobOfItem(iid)?.job_id !== m.job_id) throw new HttpError(400, 'Item not found.');
      db.prepare('UPDATE media SET item_id=?, section_id=COALESCE((SELECT section_id FROM report_items WHERE id=?), section_id) WHERE id=?').run(iid, iid, mediaId);
    }
  }
  async function deleteMedia(user, mediaId) {
    const m = db.prepare('SELECT * FROM media WHERE id=?').get(mediaId);
    if (!m) return;
    own(m.job_id, user); canEdit(reportOfJob(m.job_id), user);
    db.prepare('UPDATE reports SET cover_media_id=NULL WHERE cover_media_id=?').run(mediaId);
    db.prepare('UPDATE media SET pair_media_id=NULL WHERE pair_media_id=?').run(mediaId);
    db.prepare('DELETE FROM media WHERE id=?').run(mediaId);
    await ctx.storage.remove(m.file_id);
    if (m.thumb_file_id) await ctx.storage.remove(m.thumb_file_id);
  }
  async function mediaBytes(mediaId, { thumb = false, user, token: tok } = {}) {
    const m = db.prepare('SELECT m.*, r.verify_token, r.status rstatus FROM media m JOIN reports r ON r.job_id=m.job_id WHERE m.id=?').get(mediaId);
    if (!m) throw new HttpError(404, 'Not found');
    if (tok !== undefined) { if (tok !== m.verify_token || !['issued', 'superseded'].includes(m.rstatus)) throw new HttpError(404, 'Not found'); }
    else own(m.job_id, user);
    const fid = thumb && m.thumb_file_id ? m.thumb_file_id : m.file_id;
    const f = ctx.storage.get(fid);
    return { buf: await ctx.storage.read(fid), mime: f.mime, name: f.name };
  }

  // ---------- submit → review → issue ----------
  function problems(r) {
    const out = [];
    if (!r.inspection_date) out.push('Inspection date is missing.');
    if (!r.time_in) out.push('Time in is missing.');
    const secs = db.prepare('SELECT * FROM report_sections WHERE report_id=?').all(r.id);
    if (!secs.length) out.push('The report has no areas.');
    const c = countFindings(r.id);
    if (!c.critical && !c.attention && !c.info) out.push('Add at least one finding.');
    const noText = db.prepare("SELECT COUNT(*) n FROM observations o JOIN report_items it ON it.id=o.item_id JOIN report_sections s ON s.id=it.section_id WHERE s.report_id=? AND TRIM(o.text)=''").get(r.id).n;
    if (noText) out.push(`${noText} finding(s) have no text.`);
    const noPhoto = db.prepare("SELECT COUNT(*) n FROM observations o JOIN report_items it ON it.id=o.item_id JOIN report_sections s ON s.id=it.section_id WHERE s.report_id=? AND o.severity='critical' AND NOT EXISTS (SELECT 1 FROM media m WHERE m.observation_id=o.id)").get(r.id).n;
    if (noPhoto) out.push(`${noPhoto} critical finding(s) have no photo or video.`);
    return out;
  }
  async function submit(user, jobId) {
    own(jobId, user);
    const r = reportOfJob(jobId);
    if (!['draft', 'returned'].includes(r.status)) throw new HttpError(409, 'This report is already with the reviewer.');
    const p = problems(r);
    if (p.length) throw new HttpError(400, `Before you submit: ${p.join(' ')}`, { problems: p });
    const hhmm = new Date(ctx.now() + 4 * HOUR).toISOString().slice(11, 16);
    tx(db, () => {
      db.prepare("UPDATE reports SET status='submitted', submitted_at=?, time_out=COALESCE(NULLIF(time_out,''),?), updated_at=? WHERE id=?").run(ctx.now(), hhmm, ctx.now(), r.id);
      J().move(user, jobId, 'under_review', 'Report submitted for review');
    });
    await J().notifyOffice(`Report ready for review: ${J().getJob(jobId).number}`, `${ctx.config.baseUrl}/app/#job/${jobId}`);
  }
  function returnReport(user, jobId, note) {
    const r = reportOfJob(jobId);
    if (r.status !== 'submitted' && r.status !== 'approved') throw new HttpError(409, 'Only a submitted report can be returned.');
    if (!clampStr(note, 1000)) throw new HttpError(400, 'Tell the inspector what to change.');
    tx(db, () => {
      db.prepare("UPDATE reports SET status='returned', review_note=?, reviewer_id=?, approved_at=NULL, updated_at=? WHERE id=?").run(clampStr(note, 1000), user.id, ctx.now(), r.id);
      J().move(user, jobId, 'report_draft', `Returned to inspector: ${clampStr(note, 300)}`);
    });
    const j = J().getJob(jobId);
    const ins = db.prepare('SELECT email FROM inspectors WHERE id=?').get(j.inspector_id);
    if (ins?.email) ctx.mailer.send({ to: ins.email, jobId, template: 'report_returned', subject: `Report returned: ${j.number}`, text: `${note}\n\nOpen: ${ctx.config.baseUrl}/app/#inspect/${jobId}` });
  }
  function approve(user, jobId) {
    const r = reportOfJob(jobId);
    if (r.status !== 'submitted') throw new HttpError(409, 'Only a submitted report can be approved.');
    const j = J().getJob(jobId);
    const ins = j.inspector_id && db.prepare('SELECT id FROM users WHERE inspector_id=?').get(j.inspector_id);
    if (ins && ins.id === user.id) throw new HttpError(403, 'The inspector cannot approve their own report.');
    db.prepare("UPDATE reports SET status='approved', reviewer_id=?, approved_at=?, review_note='', updated_at=? WHERE id=?").run(user.id, ctx.now(), ctx.now(), r.id);
    J().event(user, jobId, 'Report approved by the reviewer');
  }

  /** Issues the approved report: number, PDF (stored, versioned), email to the client, commission and invoice. */
  async function issue(user, jobId) {
    const r = reportOfJob(jobId);
    const j = J().getJob(jobId);
    if (r.status !== 'approved' && !(r.status === 'issued' && user.role === 'super_admin')) throw new HttpError(409, 'The report must be approved before it is issued.');
    if (j.client_kind !== 'company') {
      const q = db.prepare("SELECT * FROM quotations WHERE job_id=? AND status='accepted' ORDER BY id DESC").get(jobId);
      const due = q ? q.total : 0;
      if (!j.parent_job_id && J().paidForJob(jobId) + 0.001 < due) throw new HttpError(409, `The client still owes AED ${money(due - J().paidForJob(jobId))}. Record the payment before issuing the report.`);
    }
    const s = S();
    let number = r.number;
    tx(db, () => { if (!number) { number = J().nextNumber('report'); db.prepare('UPDATE reports SET number=? WHERE id=?').run(number, r.id); } });
    db.prepare("UPDATE reports SET status='issued', issued_at=?, updated_at=? WHERE id=?").run(ctx.now(), ctx.now(), r.id);
    let pdf;
    try { pdf = await ctx.docs.reportPdf(r.id); } catch (e) { db.prepare("UPDATE reports SET status='approved', issued_at=NULL WHERE id=?").run(r.id); throw e; }
    const version = (db.prepare('SELECT MAX(version) v FROM report_versions WHERE report_id=?').get(r.id).v || 0) + 1;
    const fileId = await ctx.storage.save({ name: `${number}${version > 1 ? `-v${version}` : ''}.pdf`, mime: 'application/pdf', buf: pdf.buf, jobId, purpose: 'pdf_report', userId: user.id });
    tx(db, () => {
      db.prepare('INSERT INTO report_versions(report_id,version,pdf_file_id,page_count,tc_block_id,issued_by,issued_at) VALUES(?,?,?,?,?,?,?)').run(r.id, version, fileId, pdf.pages, ctx.admin.currentBlock('tc_report')?.id ?? null, user.id, ctx.now());
      db.prepare('UPDATE jobs SET report_issued_at=? WHERE id=?').run(ctx.now(), jobId);
      if (j.status === 'under_review') J().move(user, jobId, 'report_issued', `Report ${number} issued`);
      else J().event(user, jobId, `Report ${number} re-issued (version ${version})`);
      ctx.finance.ensureCommission(jobId);
    });
    if (j.parent_job_id) { const p = db.prepare('SELECT status FROM jobs WHERE id=?').get(j.parent_job_id); if (p?.status === 'reinspection_due') J().move(user, j.parent_job_id, 'closed', `Re-inspection ${j.number} completed`); }
    const link = `${ctx.config.baseUrl}/report.html?t=${r.verify_token}`;
    if (j.client_email) {
      const c = countFindings(r.id);
      await ctx.mailer.send({
        to: j.client_email, jobId, template: 'report_issued', subject: `Your inspection report ${number} – ${[j.building, j.unit_no].filter(Boolean).join(' ')}`,
        text: `Dear ${j.client_name},\n\nYour inspection report ${number} is attached. You can also open it online, with the videos, here: ${link}\n\nCritical: ${c.critical} · Needs attention: ${c.attention}\n\nPlease call us if you have any questions.\n\n${s.company_name}`,
        html: layout(s, `Your report ${number} is ready`, `<p>Dear ${j.client_name},</p><p>Your inspection report is attached. You can also open it online, including the videos.</p>${rows([['Property', [j.building, j.unit_no && `Unit ${j.unit_no}`, j.community].filter(Boolean).join(', ')], ['Critical findings', String(c.critical)], ['Needs attention', String(c.attention)]])}<p>Please call us if you have any questions. We are happy to walk you through the findings.</p>`, { url: link, label: 'Open the online report' }),
        attachments: [{ filename: `${number}.pdf`, contentType: 'application/pdf', content: pdf.buf }, ...(await emailAttachments(r.id))],
      });
    }
    // invoice straight away unless the client is invoiced monthly
    const cl = db.prepare('SELECT monthly_invoicing FROM clients WHERE id=?').get(j.client_id);
    if (!cl.monthly_invoicing && !j.parent_job_id && version === 1) await ctx.finance.invoiceJob(user, jobId).catch((e) => console.error('[invoice]', e.message));
    if (j.parent_job_id && version === 1) J().move(user, jobId, 'closed', 'Re-inspection report issued');
    return { number, version, link };
  }

  /** Report attachments that go with the email, while the email stays under Gmail's size limit. */
  async function emailAttachments(rid) {
    const out = [];
    let total = 0;
    for (const a of db.prepare('SELECT a.*, f.name, f.mime, f.size FROM report_attachments a JOIN files f ON f.id=a.file_id WHERE a.report_id=? AND a.send_with_report=1 ORDER BY a.sort, a.id').all(rid)) {
      if (total + a.size > EMAIL_ATTACH_LIMIT) continue; // still available from the online report
      total += a.size;
      const ext = a.kind === 'pdf' ? '.pdf' : a.mime === 'image/png' ? '.png' : '.jpg';
      out.push({ filename: `${a.title.replace(/[^\w.\- ]+/g, '_').slice(0, 80)}${ext}`, contentType: a.mime, content: await ctx.storage.read(a.file_id) });
    }
    return out;
  }

  /** Books the free re-inspection that some services include (or a paid one). */
  function createReinspection(user, jobId) {
    const j = J().getJob(jobId);
    if (!['report_issued', 'invoiced'].includes(j.status)) throw new HttpError(409, 'The original report must be issued first.');
    if (db.prepare("SELECT 1 FROM jobs WHERE parent_job_id=? AND status NOT IN ('cancelled')").get(jobId)) throw new HttpError(409, 'A re-inspection already exists for this job.');
    const id = tx(db, () => {
      const number = J().nextNumber('job');
      const nid = Number(db.prepare(`INSERT INTO jobs(number,client_id,property_id,service_id,purpose,channel,status,parent_job_id,access_contact,access_notes,occupancy,client_kind,fee_net,created_by,created_at,updated_at)
        VALUES(?,?,?,?,'Re-inspection','internal','paid',?,?,?,?,?,0,?,?,?)`).run(number, j.client_id, j.property_id, j.service_id, jobId, j.access_contact, j.access_notes, j.occupancy, j.client_kind, user.id, ctx.now(), ctx.now()).lastInsertRowid);
      db.prepare('INSERT INTO job_events(job_id,ts,user_id,from_status,to_status,note) VALUES(?,?,?,?,?,?)').run(nid, ctx.now(), user.id, null, 'paid', `Re-inspection of ${j.number}${j.includes_reinspection ? ' (included in the original fee)' : ''}`);
      J().move(user, jobId, 'reinspection_due', `Re-inspection ${number} created`);
      return nid;
    });
    return id;
  }

  // ---------- public online report and QR verification ----------
  function byToken(tok) {
    const r = db.prepare("SELECT * FROM reports WHERE verify_token=? AND status IN ('issued','superseded')").get(String(tok || ''));
    if (!r) throw new HttpError(404, 'This report link is not valid.');
    return r;
  }
  function verify(tok) {
    const r = byToken(tok);
    const j = J().getJob(r.job_id);
    const v = db.prepare('SELECT version, issued_at, page_count FROM report_versions WHERE report_id=? ORDER BY version DESC LIMIT 1').get(r.id);
    return { valid: true, number: r.number, title: r.title, issued_at: r.issued_at, version: v?.version || 1, pages: v?.page_count, inspection_date: r.inspection_date, property: [j.building, j.unit_no && `Unit ${j.unit_no}`, j.community, j.emirate].filter(Boolean).join(', '), inspector: j.inspector_name, company: S().company_name, superseded: r.status === 'superseded' };
  }
  function online(tok) {
    const r = byToken(tok);
    const t = tree(r.job_id, null);
    const glossary = db.prepare(`SELECT DISTINCT g.* FROM glossary g JOIN observations o ON o.glossary_id=g.id JOIN report_items it ON it.id=o.item_id JOIN report_sections s ON s.id=it.section_id WHERE s.report_id=?`).all(r.id);
    return {
      ...verify(tok), general: { ...t.report, verify_token: undefined, review_note: undefined }, client: t.job.client_name, service: t.job.service_name,
      sections: t.sections.map((s) => ({ name: s.name, kind: s.kind, intro: s.intro, not_inspected_reason: s.not_inspected_reason, items: s.items.map((it) => ({ name: it.name, attr_label: it.attr_label, attr_value: it.attr_value, media: it.media, observations: it.observations.map((o) => ({ text: o.text, severity: o.severity, trade: o.trade, in_summary: o.in_summary, reinspect_status: o.reinspect_status, media: o.media })) })), media: s.media })),
      media: t.media.filter((m) => m.in_pdf).map((m) => ({ id: m.id, kind: m.kind, caption: m.caption, has_thumb: m.has_thumb, temp_min_c: m.temp_min_c, temp_max_c: m.temp_max_c })),
      counts: t.counts, glossary, pdf: `/api/public/report/${encodeURIComponent(tok)}/pdf`,
      attachments: t.attachments.map((a) => ({ id: a.id, title: a.title, description: a.description, kind: a.kind, size: a.size })),
    };
  }
  async function latestPdf(tok) {
    const r = byToken(tok);
    const v = db.prepare('SELECT pdf_file_id FROM report_versions WHERE report_id=? ORDER BY version DESC LIMIT 1').get(r.id);
    if (!v) throw new HttpError(404, 'Not found');
    return { buf: await ctx.storage.read(v.pdf_file_id), name: `${r.number}.pdf` };
  }

  /** Reviewer queue. */
  const queue = () => db.prepare(`SELECT r.id, r.status, r.submitted_at, r.approved_at, r.review_note, j.id job_id, j.number, j.sla_due_at, c.name client_name, s.name service_name, i.name inspector_name, p.building, p.unit_no
    FROM reports r JOIN jobs j ON j.id=r.job_id JOIN clients c ON c.id=j.client_id JOIN services s ON s.id=j.service_id JOIN properties p ON p.id=j.property_id LEFT JOIN inspectors i ON i.id=j.inspector_id
    WHERE r.status IN ('submitted','approved','returned') ORDER BY CASE r.status WHEN 'submitted' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, j.sla_due_at`).all();

  return { ensureReport, tree, addAttachment, updateAttachment, deleteAttachment, attachmentBytes, listAttachments, checkIn, accessFailed, updateGeneral, addSection, updateSection, deleteSection, addItem, updateItem, deleteItem, addObservation, updateObservation, deleteObservation, suggestions, addMedia, addThumb, updateMedia, deleteMedia, mediaBytes, problems, submit, returnReport, approve, issue, createReinspection, verify, online, latestPdf, queue, reportOfJob, countFindings };
}
