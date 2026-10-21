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

test('system sections get their own items and picklists, also on older databases', async () => {
  const { DatabaseSync: D } = await import('node:sqlite');
  const t = await startTestApp();
  try {
    const db = t.ctx.db;
    const items = (sec) => db.prepare("SELECT i.name, i.attr_list FROM item_templates i JOIN section_templates s ON s.id=i.section_template_id WHERE s.name=? ORDER BY i.sort").all(sec);
    const ac = items('Air Conditioning');
    assert.ok(ac.some((i) => i.name === 'Condensate Drain and Drip Tray'));
    assert.ok(!ac.some((i) => /Floor|Wall|Tile|Door/.test(i.name)), 'no civil items in AC');
    assert.equal(ac.find((i) => i.name === 'AC System Type').attr_list, 'ac_type');
    assert.equal(items('Electrical').find((i) => i.name === 'Breakers and RCD Protection').attr_list, 'protection_device');
    assert.equal(items('Water Heater').find((i) => i.name === 'Supply Lines Condition').attr_list, 'pipe_material');
    assert.ok(db.prepare("SELECT COUNT(*) n FROM lookups WHERE list='ac_type'").get().n >= 5);
    assert.ok(db.prepare("SELECT COUNT(*) n FROM comment_library WHERE item_name='Condensate Drain and Drip Tray'").get().n >= 1);
    // simulate an older database: old AC items and an existing draft report, then run the upgrade
    const { upgradeChecklists } = await import('../src/seed.js');
    const st = db.prepare("SELECT id FROM section_templates WHERE name='Air Conditioning'").get().id;
    db.prepare('DELETE FROM item_templates WHERE section_template_id=?').run(st);
    db.prepare("INSERT INTO item_templates(section_template_id,name,attr_label,attr_list,sort) VALUES(?,'Air Conditioning Comments','Type','material',1)").run(st);
    db.prepare("UPDATE settings SET value='1' WHERE key='_checklist_version'").run();
    assert.equal(upgradeChecklists(db, () => Date.now()), true);
    assert.equal(items('Air Conditioning').length, 10);
    assert.equal(upgradeChecklists(db, () => Date.now()), false, 'runs once');
    void D;
  } finally { await t.close(); }
});
