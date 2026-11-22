// A database created by an earlier version must keep working after an upgrade (Render keeps the database file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { startTestApp, SA } from './helpers.js';

test('upgrading a Phase 2 database adds the new columns and jobs can be created', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aral-mig-'));
  const file = path.join(dir, 'app.db');
  let oldSchema;
  try { oldSchema = execFileSync('git', ['show', '53795e0:src/schema.sql'], { cwd: new URL('..', import.meta.url).pathname }).toString(); } catch { return; } // no git history (e.g. Docker build)
  const old = new DatabaseSync(file);
  old.exec(oldSchema);
  old.close();
  const t = await startTestApp({ dbPath: file, uploadDir: path.join(dir, 'up') });
  try {
    const cols = t.ctx.db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
    for (const c of ['client_kind', 'drive_folders', 'lead_id', 'equipment_ids']) assert.ok(cols.includes(c), c);
    await t.login('sa', SA.email, SA.password);
    // exactly what the "New job" form sends, including empty optional fields
    const r = await t.call('sa', 'POST', '/api/app/jobs', {
      service_code: 'OWN-PPI', purpose: '', bank_reference: '', access_contact: '', access_notes: '', preferred_dates: '', occupancy: '', channel: 'internal',
      client: { name: 'Form Client', type: 'individual', mobile: '050 123 4567', email: '', contact_person: '', name_ar: '', trn: '', credit_terms_days: '0', monthly_invoicing: false, address: '' },
      property: { property_type: 'apartment', bedrooms: '', has_maid_room: false, community: '', building: '', unit_no: '', developer: '', bua_sqft: '', levels: '1', title_deed_no: '', handover_date: '', map_link: '' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await t.call('sa', 'GET', `/api/app/jobs/${r.body.id}`)).status, 200);
  } finally { await t.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('report is room by room: each room has Civil / AC / Plumbing / Electrical groups, no separate AC section', async () => {
  const t = await startTestApp();
  try {
    const { call, ctx } = t;
    await t.login('sa', SA.email, SA.password);
    const job = await call('sa', 'POST', '/api/app/jobs', { service_code: 'OWN-MIO', client: { name: 'Rooms', mobile: '0501112233', type: 'company' }, property: { property_type: 'apartment', bedrooms: 2 } });
    ctx.db.prepare("UPDATE jobs SET status='paid' WHERE id=?").run(job.body.id);
    const ins = Number(ctx.db.prepare("INSERT INTO inspectors(name,created_at) VALUES('R',?)").run(Date.now()).lastInsertRowid);
    await call('sa', 'POST', `/api/app/jobs/${job.body.id}/schedule`, { date: '2026-10-22', time: '15:00', hours: 2, inspector_id: ins, notify: false });
    const tree = (await call('sa', 'POST', `/api/app/inspect/${job.body.id}/checkin`)).body;
    assert.ok(!tree.sections.some((s) => s.kind === 'system'), 'no system sections');
    assert.deepEqual(tree.sections.map((s) => s.name), ['Main Entrance', 'Kitchen', 'Living Room', 'Guest Washroom', 'Master Bedroom', 'Master Bathroom', 'Bedroom 2', 'Bathroom 2', 'Wardrobe Room', 'Living Room Balcony', 'Laundry Area', 'Property Services']);
    const room = tree.sections.find((s) => s.name === 'Master Bedroom');
    assert.deepEqual([...new Set(room.items.map((i) => i.grp))], ['Civil', 'Air Conditioning', 'Electrical', 'General']);
    assert.ok(room.items.some((i) => i.name === 'Cooling Performance (supply air temperature)' && i.grp === 'Air Conditioning'));
    const bath = tree.sections.find((s) => s.name === 'Master Bathroom');
    assert.ok(bath.items.some((i) => i.name === 'Toilet Condition' && i.grp === 'Plumbing'));
    const svc = tree.sections.find((s) => s.name === 'Property Services');
    assert.ok(svc.items.some((i) => i.name === 'Distribution Board Condition') && svc.items.some((i) => i.name === 'Water Heater Condition'));
    assert.ok(!svc.items.some((i) => i.name === 'Cooling Performance (supply air temperature)'));
    // a new item can be put in a group
    const id = (await call('sa', 'POST', `/api/app/sections/${room.id}/items`, { name: 'Curtain track', grp: 'Civil' })).body.id;
    assert.equal(ctx.db.prepare('SELECT grp FROM report_items WHERE id=?').get(id).grp, 'Civil');
  } finally { await t.close(); }
});

test('an older report with AC / Electrical sections is converted room by room, findings follow their room', async () => {
  const t = await startTestApp();
  try {
    const { call, ctx } = t;
    const db = ctx.db;
    await t.login('sa', SA.email, SA.password);
    const job = await call('sa', 'POST', '/api/app/jobs', { service_code: 'OWN-MIO', client: { name: 'Old', mobile: '0501112233', type: 'company' }, property: { property_type: 'apartment', bedrooms: 1 } });
    db.prepare("UPDATE jobs SET status='paid' WHERE id=?").run(job.body.id);
    const ins = Number(db.prepare("INSERT INTO inspectors(name,created_at) VALUES('R',?)").run(Date.now()).lastInsertRowid);
    await call('sa', 'POST', `/api/app/jobs/${job.body.id}/schedule`, { date: '2026-10-22', time: '15:00', hours: 2, inspector_id: ins, notify: false });
    await call('sa', 'POST', `/api/app/inspect/${job.body.id}/checkin`);
    const rid = db.prepare('SELECT id FROM reports WHERE job_id=?').get(job.body.id).id;
    // turn the report back into the old shape: remove the new items, add AC + Electrical system sections with findings
    db.prepare("DELETE FROM report_items WHERE name IN ('Cooling Performance (supply air temperature)','Air Outlets and Return Grilles','Thermostats and Controls','Exhaust Fan / Ventilation')").run();
    db.prepare("UPDATE report_items SET grp=''").run();
    const svc = db.prepare("SELECT id FROM report_sections WHERE report_id=? AND name='Property Services'").get(rid).id;
    db.prepare('DELETE FROM report_sections WHERE id=?').run(svc);
    const mk = (name, items) => { const sid = Number(db.prepare("INSERT INTO report_sections(report_id,name,kind,sort) VALUES(?,?,'system',99)").run(rid, name).lastInsertRowid); return items.map((n) => Number(db.prepare("INSERT INTO report_items(section_id,name,sort) VALUES(?,?,1)").run(sid, n).lastInsertRowid)); };
    const [cool, filters] = mk('Air Conditioning', ['Cooling Performance (supply air temperature)', 'Filters']);
    const [dist] = mk('Electrical', ['Distribution Board Condition']);
    const obs = (item, text) => Number(db.prepare("INSERT INTO observations(item_id,text,severity,sort,created_at) VALUES(?,?,'attention',1,1)").run(item, text).lastInsertRowid);
    const inMaster = obs(cool, 'No cold air in the Master Bedroom.');
    const general = obs(cool, 'Supply air is warm at all outlets.');
    const board = obs(dist, 'Circuits are not labelled.');
    db.prepare("UPDATE settings SET value='2' WHERE key='_checklist_version'").run();
    const { upgradeRoomLayout } = await import('../src/seed.js');
    const r = upgradeRoomLayout(db);
    assert.deepEqual(r, { reports: 1, moved: 1, left: 2 });
    assert.equal(upgradeRoomLayout(db), null, 'runs once');
    const sections = db.prepare('SELECT * FROM report_sections WHERE report_id=?').all(rid);
    assert.ok(!sections.some((s) => s.kind === 'system'));
    const roomOf = (obsId) => db.prepare('SELECT s.name sec, it.name item, it.grp FROM observations o JOIN report_items it ON it.id=o.item_id JOIN report_sections s ON s.id=it.section_id WHERE o.id=?').get(obsId);
    assert.deepEqual({ ...roomOf(inMaster) }, { sec: 'Master Bedroom', item: 'Cooling Performance (supply air temperature)', grp: 'Air Conditioning' });
    assert.equal(roomOf(general).sec, 'Property Services');
    assert.equal(roomOf(board).sec, 'Property Services');
    assert.equal(db.prepare('SELECT grp FROM report_items WHERE id=?').get(dist).grp, 'Electrical');
    assert.equal(db.prepare('SELECT section_id FROM report_items WHERE id=?').get(filters).section_id, db.prepare("SELECT id FROM report_sections WHERE report_id=? AND name='Property Services'").get(rid).id);
    // the intro text of the three old sections is kept, once, on Property Services
    db.prepare("DELETE FROM settings WHERE key='_services_intro'").run();
    const { addServicesIntro } = await import('../src/seed.js');
    assert.equal(addServicesIntro(db, () => Date.now()), 1);
    const intro = db.prepare("SELECT intro FROM report_sections WHERE report_id=? AND name='Property Services'").get(rid).intro;
    assert.match(intro, /air conditioning system[\s\S]*electrical installation[\s\S]*water heater/);
    // room order and names, for an open report made before the change
    db.prepare("UPDATE report_sections SET name='Powder Room' WHERE report_id=? AND name='Guest Washroom'").run(rid);
    db.prepare("DELETE FROM report_sections WHERE report_id=? AND name IN ('Main Entrance','Wardrobe Room')").run(rid);
    db.prepare("UPDATE report_sections SET sort=100-sort WHERE report_id=?").run(rid);
    db.prepare("DELETE FROM settings WHERE key='_rooms_order'").run();
    const { reorderRooms } = await import('../src/seed.js');
    assert.equal(reorderRooms(db), true);
    assert.deepEqual(db.prepare('SELECT name FROM report_sections WHERE report_id=? ORDER BY sort').all(rid).map((x) => x.name),
      ['Main Entrance', 'Kitchen', 'Living Room', 'Guest Washroom', 'Master Bedroom', 'Master Bathroom', 'Wardrobe Room', 'Living Room Balcony', 'Laundry Area', 'Property Services']);
    // checklists for new reports follow the same layout
    assert.ok(!db.prepare("SELECT 1 FROM section_templates WHERE kind='system'").get());
    // an issued report is left alone
    const t2 = (await call('sa', 'GET', `/api/app/inspect/${job.body.id}`)).body;
    assert.ok(t2.sections.find((s) => s.name === 'Master Bedroom').items.some((i) => i.name === 'Cooling Performance (supply air temperature)'));
  } finally { await t.close(); }
});
