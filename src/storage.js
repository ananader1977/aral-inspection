// File storage: Google Drive (when GOOGLE_* variables are set) or the server disk.
// Every file gets a row in `files`. On Drive each job gets its own folder:
//   ARAL Jobs / JOB-2026-00001 – IL Primo 1205 / photos | videos | pdf
// Drive uses the "drive.file" scope, so the app only ever sees files it created itself.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from './http.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SUB = { photo: 'photos', thumb: 'photos', video: 'videos', thermal: 'photos' };

export function createStorage(ctx) {
  const { db, config } = ctx;
  const d = config.drive;
  const driveOn = !!(d.clientId && d.clientSecret && d.refreshToken);
  const baseDir = config.uploadDir || path.join(path.dirname(path.resolve(config.dbPath === ':memory:' ? `./data/test-${process.pid}/x` : config.dbPath)), 'uploads');
  let token = null;

  async function accessToken() {
    if (token && token.exp > Date.now() + 60000) return token.value;
    const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: d.clientId, client_secret: d.clientSecret, refresh_token: d.refreshToken, grant_type: 'refresh_token' }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new HttpError(502, `Google Drive sign-in failed: ${data.error_description || data.error || res.status}`);
    token = { value: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
    return token.value;
  }
  async function driveFolder(name, parent) {
    const res = await fetch(`${DRIVE}/files?fields=id`, { method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, `Google Drive folder failed: ${data?.error?.message || res.status}`);
    return data.id;
  }
  /** Folder ids for a job, created on first use and remembered on the job. */
  async function jobFolders(jobId) {
    const job = db.prepare('SELECT j.number, j.drive_folders, p.building, p.unit_no FROM jobs j JOIN properties p ON p.id=j.property_id WHERE j.id=?').get(jobId);
    if (!job) return null;
    if (job.drive_folders) return JSON.parse(job.drive_folders);
    let rootId = db.prepare("SELECT value FROM settings WHERE key='_drive_jobs_folder'").get()?.value;
    if (!rootId) {
      rootId = await driveFolder('ARAL Jobs', d.folderId || null);
      db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('_drive_jobs_folder',?)").run(rootId);
    }
    const root = await driveFolder(`${job.number} – ${[job.building, job.unit_no].filter(Boolean).join(' ')}`.trim(), rootId);
    const f = { root, photos: await driveFolder('photos', root), videos: await driveFolder('videos', root), pdf: await driveFolder('pdf', root) };
    db.prepare('UPDATE jobs SET drive_folders=? WHERE id=?').run(JSON.stringify(f), jobId);
    return f;
  }
  async function driveUpload(name, mime, buf, parent) {
    const boundary = `aral_${crypto.randomBytes(8).toString('hex')}`;
    const meta = { name, ...(parent ? { parents: [parent] } : d.folderId ? { parents: [d.folderId] } : {}) };
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`), buf, Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`, { method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, `Google Drive upload failed: ${data?.error?.message || res.status}`);
    return { drive_id: data.id, link: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view` };
  }

  // small in-memory cache so a report PDF with 200 photos does not download them twice
  const cache = new Map();
  const remember = (id, buf) => { cache.set(id, buf); if (cache.size > 400) cache.delete(cache.keys().next().value); return buf; };

  return {
    kind: driveOn ? 'drive' : 'disk',
    /** Saves bytes and returns the new files.id. purpose: photo, video, thermal, thumb, pdf_quote, pdf_report, signature, proof, logo… */
    async save({ name, mime, buf, jobId = null, purpose = 'attachment', userId = null }) {
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      let rec;
      if (driveOn) {
        let parent = null;
        if (jobId) { const f = await jobFolders(jobId); parent = f && (f[SUB[purpose] || (purpose.startsWith('pdf') ? 'pdf' : 'root')] || f.root); }
        else if (purpose === 'backup') {
          parent = db.prepare("SELECT value FROM settings WHERE key='_drive_backup_folder'").get()?.value;
          if (!parent) { parent = await driveFolder('ARAL Backups', d.folderId || null); db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('_drive_backup_folder',?)").run(parent); }
        }
        const up = await driveUpload(name, mime, buf, parent);
        rec = { storage: 'drive', drive_id: up.drive_id, link: up.link, local_path: null };
      } else {
        const job = jobId ? db.prepare('SELECT number FROM jobs WHERE id=?').get(jobId)?.number : null;
        const rel = path.join(job ? `jobs/${job}` : purpose === 'backup' ? 'backups' : 'general', purpose === 'backup' ? '.' : SUB[purpose] || (purpose.startsWith('pdf') ? 'pdf' : 'other'), `${Date.now()}_${crypto.randomBytes(5).toString('hex')}${path.extname(name).replace(/[^.\w]/g, '').slice(0, 10)}`);
        fs.mkdirSync(path.dirname(path.join(baseDir, rel)), { recursive: true });
        fs.writeFileSync(path.join(baseDir, rel), buf);
        rec = { storage: 'disk', drive_id: null, link: '', local_path: rel };
      }
      const id = Number(db.prepare('INSERT INTO files(job_id,purpose,name,mime,size,storage,drive_id,link,local_path,sha256,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(jobId, purpose, String(name).slice(0, 200), mime, buf.length, rec.storage, rec.drive_id, rec.link, rec.local_path, sha, userId, ctx.now()).lastInsertRowid);
      remember(id, buf);
      return id;
    },
    async read(fileId) {
      if (cache.has(fileId)) return cache.get(fileId);
      const f = db.prepare('SELECT * FROM files WHERE id=?').get(fileId);
      if (!f) throw new HttpError(404, 'File not found');
      if (f.storage === 'disk') {
        const full = path.normalize(path.join(baseDir, f.local_path));
        if (!full.startsWith(path.resolve(baseDir))) throw new HttpError(400, 'Bad path');
        return remember(fileId, fs.readFileSync(full));
      }
      const res = await fetch(`${DRIVE}/files/${encodeURIComponent(f.drive_id)}?alt=media`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
      if (!res.ok) throw new HttpError(502, `Google Drive download failed (${res.status})`);
      return remember(fileId, Buffer.from(await res.arrayBuffer()));
    },
    get: (fileId) => db.prepare('SELECT * FROM files WHERE id=?').get(fileId),
    async remove(fileId) {
      const f = db.prepare('SELECT * FROM files WHERE id=?').get(fileId);
      if (!f) return;
      cache.delete(fileId);
      try {
        if (f.storage === 'disk') fs.rmSync(path.join(baseDir, f.local_path), { force: true });
        else if (driveOn) await fetch(`${DRIVE}/files/${encodeURIComponent(f.drive_id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await accessToken()}` } });
      } catch (e) { console.error('[storage] remove failed:', e.message); }
    },
    jobFolderLink: (jobId) => {
      const j = db.prepare('SELECT drive_folders FROM jobs WHERE id=?').get(jobId);
      const f = j?.drive_folders ? JSON.parse(j.drive_folders) : null;
      return f ? `https://drive.google.com/drive/folders/${f.root}` : null;
    },
  };
}
