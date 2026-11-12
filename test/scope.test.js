// Scope-of-service wording in the agreement, quotation and report; and its upgrade on existing databases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers.js';
import { upgradeBlocks } from '../src/seed.js';

test('new installs carry the scope wording; the upgrade adds a new version only where nobody has edited the text', async () => {
  const t = await startTestApp();
  const { ctx } = t;
  try {
    const cur = (c) => ctx.admin.currentBlock(c);
    assert.match(cur('tc_booking').body, /full access to the property, given by the landlord without any restriction/);
    assert.match(cur('tc_booking').body, /Environmental testing|environmental testing/);
    assert.match(cur('qt_about').body, /non-invasive visual inspection and snagging/);
    for (const c of ['rpt_scope_components', 'rpt_environmental', 'rpt_equipment']) assert.ok(cur(c)?.body, c);

    // an existing system: old agreement text (never edited) and an agreement text a person has edited
    const db = ctx.db;
    db.prepare("DELETE FROM settings WHERE key='_blocks_version'").run();
    db.prepare("UPDATE content_blocks SET body='old agreement' WHERE code='tc_booking'").run();
    db.prepare("UPDATE content_blocks SET body='our lawyer wrote this', created_by=1 WHERE code='tc_quote'").run();
    const n = upgradeBlocks(db, ctx.now);
    assert.ok(n >= 1);
    const versions = (c) => db.prepare('SELECT version, body FROM content_blocks WHERE code=? ORDER BY version').all(c);
    assert.equal(versions('tc_booking').length, 2);               // old version kept, new one added
    assert.equal(versions('tc_booking')[0].body, 'old agreement');
    assert.match(cur('tc_booking').body, /Scope\./);
    assert.equal(versions('tc_quote').length, 1);                 // hand-edited text is left alone
    assert.equal(cur('tc_quote').body, 'our lawyer wrote this');
    assert.equal(upgradeBlocks(db, ctx.now), 0);                  // runs once
  } finally { await t.close(); }
});

test('the public site shows Studio under Apartment data: studio still prices as a studio', async () => {
  const t = await startTestApp();
  try {
    const r = await fetch(`${t.url}/api/public/estimate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'OWN-PPI', property_type: 'studio', bedrooms: 0, addons: [] }) });
    assert.equal((await r.json()).total, 1200);
  } finally { await t.close(); }
});
