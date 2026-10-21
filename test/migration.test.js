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
