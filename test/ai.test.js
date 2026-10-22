// AI photo suggestions: the server sends the item's photos to Claude and returns cleaned suggestions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestApp, SA } from './helpers.js';
import { parse } from '../src/ai.js';

const JPEG = fs.readFileSync(new URL('../public/logo.jpg', import.meta.url));

test('parse() keeps only clean, valid suggestions', () => {
  const r = parse('Here you go: {"findings":[{"text":"  Water stain on the ceiling near the AC outlet. ","severity":"critical","trade":"licensed HVAC contractor","confidence":"high"},{"text":"","severity":"x"}],"caption":"Ceiling stain","no_defect":false} thanks');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].text, 'Water stain on the ceiling near the AC outlet.');
  assert.equal(r.caption, 'Ceiling stain');
  assert.match(parse('not json').note, /No suggestion/);
});

test('suggest a finding from the photos of a checklist item', async () => {
  let seen = null;
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      seen = { headers: req.headers, body: JSON.parse(b) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'claude-sonnet-5-5', content: [{ type: 'text', text: '{"findings":[{"text":"Cracked floor tile near the kitchen sink, as shown in the photo. Replacement is recommended.","severity":"attention","trade":"qualified contractor","confidence":"high"}],"caption":"Cracked tile by the sink","no_defect":false,"note":""}' }] }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aral-ai-'));
  const t = await startTestApp({ uploadDir, ai: { apiKey: 'test-key', model: 'claude-sonnet-5-5', baseUrl: `http://127.0.0.1:${fake.address().port}/v1/messages` } });
  const { call, ctx } = t;
  try {
    await t.login('sa', SA.email, SA.password);
    assert.equal((await call(null, 'GET', '/api/config')).body.ai, true);
    const job = await call('sa', 'POST', '/api/app/jobs', { service_code: 'OWN-MIO', client: { name: 'AI Test', mobile: '0501112233', type: 'company' }, property: { property_type: 'apartment', bedrooms: 1 } });
    ctx.db.prepare("UPDATE jobs SET status='paid' WHERE id=?").run(job.body.id);
    const ins = Number(ctx.db.prepare("INSERT INTO inspectors(name,created_at) VALUES('AI Inspector',?)").run(Date.now()).lastInsertRowid);
    await call('sa', 'POST', `/api/app/jobs/${job.body.id}/schedule`, { date: '2026-10-22', time: '15:00', hours: 2, inspector_id: ins, notify: false });
    const tree = (await call('sa', 'POST', `/api/app/inspect/${job.body.id}/checkin`)).body;
    const floor = tree.sections.find((s) => s.name === 'Kitchen').items.find((i) => i.name === 'Floor Condition');
    // no photo yet: refused
    assert.equal((await call('sa', 'POST', '/api/app/ai/suggest', { item_id: floor.id })).status, 400);
    const up = await fetch(`${t.url}/api/app/inspect/${job.body.id}/media?kind=photo&uuid=ai-1&item_id=${floor.id}`, { method: 'POST', headers: { Cookie: t.jars.sa, 'X-Requested-With': 'aral', 'Content-Type': 'image/jpeg' }, body: JPEG }).then((r) => r.json());
    const r = await call('sa', 'POST', '/api/app/ai/suggest', { item_id: floor.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.findings[0].severity, 'attention');
    assert.equal(r.body.caption, 'Cracked tile by the sink');
    assert.deepEqual(r.body.media_ids, [up.id]);
    // what was sent to Claude: the key, the photo and the item context
    assert.equal(seen.headers['x-api-key'], 'test-key');
    assert.equal(seen.headers['anthropic-version'], '2023-06-01');
    assert.equal(seen.body.model, 'claude-sonnet-5-5');
    const content = seen.body.messages[0].content;
    assert.equal(content[0].type, 'image');
    assert.equal(content[0].source.media_type, 'image/jpeg');
    assert.match(content.at(-1).text, /Kitchen[\s\S]*Floor Condition/);
    assert.match(content.at(-1).text, /Hollow sound/, 'ARAL wording examples from the comment library are included');
    // from a photo id alone
    assert.equal((await call('sa', 'POST', '/api/app/ai/suggest', { media_ids: [up.id] })).body.item_id, floor.id);
    // logged in the audit trail
    assert.ok(ctx.db.prepare("SELECT 1 FROM audit_log WHERE entity='ai' AND action='suggest'").get());
    // an inspector who is not on the job cannot use it
    await t.addUser('other', 'inspector');
    assert.equal((await call('other', 'POST', '/api/app/ai/suggest', { item_id: floor.id })).status, 403);
  } finally { await t.close(); await new Promise((r) => fake.close(r)); fs.rmSync(uploadDir, { recursive: true, force: true }); }
});

test('without an API key the feature is off', async () => {
  const t = await startTestApp({ ai: { apiKey: '' } });
  try {
    assert.equal((await t.call(null, 'GET', '/api/config')).body.ai, false);
    await t.login('sa', SA.email, SA.password);
    assert.equal((await t.call('sa', 'POST', '/api/app/ai/suggest', { media_ids: [1] })).status, 404);
  } finally { await t.close(); }
});
