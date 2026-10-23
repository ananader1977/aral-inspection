// Nightly database backup: a consistent copy of the SQLite file (VACUUM INTO), compressed, optionally
// encrypted with BACKUP_KEY (AES-256-GCM), saved to Google Drive when it is set up (otherwise the server disk).
// The last BACKUP_KEEP copies are kept (default 30). Runs once a day after 02:00 Dubai time, and on demand.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { dateKey, HOUR } from './time.js';

const MAGIC = Buffer.from('ARALBK1'); // encrypted backups start with this marker

export function createBackup(ctx) {
  const { db, config } = ctx;
  const keep = () => Math.max(3, Number(config.backup?.keep) || 30);
  const keyBuf = () => (config.backup?.key ? crypto.createHash('sha256').update(String(config.backup.key)).digest() : null);

  /** Encrypts with AES-256-GCM: MAGIC | iv(12) | tag(16) | data. */
  function encrypt(buf) {
    const key = keyBuf();
    if (!key) return buf;
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([MAGIC, iv, c.getAuthTag(), data]);
  }
  /** Reverses encrypt + gzip: gives back the raw SQLite file (used by the restore instructions and the tests). */
  function decode(buf, key = config.backup?.key) {
    let b = buf;
    if (b.subarray(0, MAGIC.length).equals(MAGIC)) {
      if (!key) throw new Error('This backup is encrypted: BACKUP_KEY is needed.');
      const k = crypto.createHash('sha256').update(String(key)).digest();
      const iv = b.subarray(7, 19), tag = b.subarray(19, 35);
      const d = crypto.createDecipheriv('aes-256-gcm', k, iv);
      d.setAuthTag(tag);
      b = Buffer.concat([d.update(b.subarray(35)), d.final()]);
    }
    return zlib.gunzipSync(b);
  }

  async function run(user = null, reason = 'nightly') {
    if (config.dbPath === ':memory:' && !config.backup?.allowMemory) throw new HttpError(400, 'Backups need a database file.');
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aral-bk-')), 'app.db');
    try {
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); // consistent copy while the app keeps running
      const raw = fs.readFileSync(tmp);
      const out = encrypt(zlib.gzipSync(raw, { level: 9 }));
      const stamp = new Date(ctx.now() + 4 * HOUR).toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
      const name = `aral-db-${stamp}${keyBuf() ? '.enc' : ''}.gz`;
      const fileId = await ctx.storage.save({ name, mime: 'application/octet-stream', buf: out, jobId: null, purpose: 'backup', userId: user?.id ?? null });
      db.prepare("INSERT INTO settings(key,value) VALUES('_last_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({ at: ctx.now(), day: dateKey(ctx.now()), fileId, size: out.length, raw: raw.length, reason }));
      // keep the newest copies only
      const old = db.prepare("SELECT id FROM files WHERE purpose='backup' ORDER BY id DESC LIMIT -1 OFFSET ?").all(keep());
      for (const f of old) { await ctx.storage.remove(f.id); db.prepare('DELETE FROM files WHERE id=?').run(f.id); }
      if (user) ctx.admin.audit(user, 'backup', fileId, 'create', null, { name, size: out.length });
      return { fileId, name, size: out.length, encrypted: !!keyBuf(), storage: ctx.storage.kind };
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  }

  /** Called every hour: makes the day's backup once it is past 02:00 in Dubai. */
  async function tick() {
    const last = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='_last_backup'").get()?.value || '{}');
    const dubaiHour = new Date(ctx.now() + 4 * HOUR).getUTCHours();
    if (last.day === dateKey(ctx.now()) || dubaiHour < 2) return null;
    return run(null, 'nightly');
  }

  const list = () => db.prepare("SELECT id, name, size, storage, link, created_at, created_by FROM files WHERE purpose='backup' ORDER BY id DESC").all();
  const status = () => ({ last: JSON.parse(db.prepare("SELECT value FROM settings WHERE key='_last_backup'").get()?.value || 'null'), encrypted: !!keyBuf(), storage: ctx.storage.kind, keep: keep() });

  return { run, tick, list, status, decode };
}
