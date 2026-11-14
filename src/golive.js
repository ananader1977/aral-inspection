// Go-live reset: clears the business data (leads, clients, jobs, quotations, agreements, reports, photos, invoices,
// payments, expenses, owner money and equipment records) and restarts every document number at 1, while keeping the
// setup (staff logins, prices, services, checklists, wording, settings). A backup is taken first.
// On the live system it can be used ONCE: after that the button is gone, so real business data can never be wiped
// by mistake. On a test system (APP_ENV=test) it can be used any number of times.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './http.js';
import { verifyPassword } from './auth.js';
import { tx } from './db.js';

// children first
const WIPE = ['invoice_lines', 'payment_sessions', 'payments', 'commissions', 'job_costs', 'invoices', 'feedback', 'observations', 'media',
  'report_attachments', 'report_versions', 'report_items', 'report_sections', 'reports', 'quote_lines', 'agreements', 'quotations',
  'equipment_bookings', 'job_events', 'jobs', 'properties', 'client_rates', 'leads', 'expenses', 'money_entries', 'fixed_assets', 'outbox'];
// signatures, the logo and the database backups are not business data, so those files stay
const KEEP_FILES = "purpose NOT IN ('signature','logo','backup','company_doc') AND id NOT IN (SELECT signature_file_id FROM users WHERE signature_file_id IS NOT NULL)";

// Second, narrower reset: only the work documents. Every quotation and invoice belongs to a job, so the jobs go with them.
const DOC_WIPE = ['invoice_lines', 'payment_sessions', 'payments', 'commissions', 'job_costs', 'invoices', 'feedback', 'observations', 'media',
  'report_attachments', 'report_versions', 'report_items', 'report_sections', 'reports', 'quote_lines', 'agreements', 'quotations',
  'equipment_bookings', 'job_events', 'jobs'];

export function createGoLive(ctx) {
  const { db, config } = ctx;
  const isTest = () => config.appEnv === 'test';
  const goneLive = () => db.prepare("SELECT value FROM settings WHERE key='go_live_at'").get()?.value || '';
  const count = (t) => { try { return db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; } catch { return 0; } };

  function status() {
    return {
      env: isTest() ? 'test' : 'live',
      go_live_at: goneLive() ? Number(goneLive()) : null,
      can_reset: isTest() || !goneLive(),
      can_reset_docs: isTest() || !db.prepare("SELECT 1 FROM settings WHERE key='docs_reset_at'").get(),
      counts: { leads: count('leads'), clients: count('clients'), jobs: count('jobs'), quotations: count('quotations'), reports: count('reports'), invoices: count('invoices'), payments: count('payments'), expenses: count('expenses') },
    };
  }

  async function reset(user, { password, phrase, remove_demo = true }, ip = '') {
    if (!isTest() && goneLive()) throw new HttpError(409, 'This system was already reset for go-live. For safety it cannot be reset again.');
    if (String(phrase || '').trim().toUpperCase() !== 'RESET') throw new HttpError(400, 'Type RESET to confirm.');
    const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id);
    if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(400, 'Your password is wrong.');
    // a copy of everything as it is now, so nothing is lost for good
    const bk = config.dbPath === ':memory:' ? null : await ctx.backup.run(user, 'before go-live reset'); // in-memory databases exist only in automated tests
    const files = db.prepare(`SELECT local_path FROM files WHERE storage='disk' AND local_path IS NOT NULL AND ${KEEP_FILES}`).all();
    const before = status().counts;
    tx(db, () => {
      db.exec('PRAGMA defer_foreign_keys=ON');
      for (const t of WIPE) { try { db.exec(`DELETE FROM ${t}`); } catch (e) { if (!/no such table/.test(e.message)) throw e; } }
      db.exec(`DELETE FROM files WHERE ${KEEP_FILES}`);
      db.exec("UPDATE users SET client_id=NULL, active=0 WHERE role IN ('client','partner_valuer')");
      db.exec('DELETE FROM clients');
      db.exec("DELETE FROM settings WHERE key LIKE 'next\\_%\\_no' ESCAPE '\\'");
      try { db.exec("DELETE FROM sqlite_sequence WHERE name IN ('" + [...WIPE, 'files', 'clients'].join("','") + "')"); } catch { /* no sequences */ }
      if (remove_demo) {
        db.prepare("UPDATE users SET active=0 WHERE email LIKE '%@aral.example' AND role<>'super_admin'").run();
        db.prepare("UPDATE inspectors SET active=0 WHERE email LIKE '%@aral.example'").run();
        db.prepare("UPDATE valuation_partners SET active=0 WHERE rera_firm_no='RERA-DEMO-1'").run();
        db.prepare("UPDATE equipment SET active=0 WHERE serial_no IN ('TC-0001','HV-0001','BS-0001','HT-0001')").run();
      }
      if (!isTest()) db.prepare("INSERT INTO settings(key,value) VALUES('go_live_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(ctx.now()));
      ctx.admin.audit(user, 'system', 0, isTest() ? 'test_reset' : 'go_live_reset', before, { backup: bk?.name || '', demo_removed: !!remove_demo }, ip);
    });
    // uploaded photos and documents kept on the server disk
    const base = ctx.storage?.baseDir;
    let removed = 0;
    if (base) for (const f of files) { try { fs.rmSync(path.join(base, f.local_path), { force: true }); removed++; } catch { /* ignore */ } }
    return { ok: true, backup: bk?.name || '', cleared: before, files_removed: removed };
  }

  /** Clears jobs, quotations, agreements, reports, invoices and payments; keeps leads, clients, expenses, owner money and setup. Once on live. */
  async function resetDocs(user, { password, phrase }, ip = '') {
    if (!isTest() && db.prepare("SELECT 1 FROM settings WHERE key='docs_reset_at'").get()) throw new HttpError(409, 'The quotations and invoices were already reset on this system. For safety it cannot be done again.');
    if (String(phrase || '').trim().toUpperCase() !== 'RESET') throw new HttpError(400, 'Type RESET to confirm.');
    const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id);
    if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(400, 'Your password is wrong.');
    const bk = config.dbPath === ':memory:' ? null : await ctx.backup.run(user, 'before quotation and invoice reset');
    const gone = "purpose NOT IN ('signature','logo','backup','company_doc','expense') AND (job_id IS NOT NULL OR purpose LIKE 'pdf%' OR purpose='thumb')";
    const files = db.prepare(`SELECT local_path FROM files WHERE storage='disk' AND local_path IS NOT NULL AND ${gone}`).all();
    const before = status().counts;
    tx(db, () => {
      db.exec('PRAGMA defer_foreign_keys=ON');
      // kept records must not point at jobs that are about to go
      db.exec('UPDATE leads SET job_id=NULL; UPDATE expenses SET job_id=NULL; DELETE FROM outbox WHERE job_id IS NOT NULL');
      for (const t of DOC_WIPE) { try { db.exec(`DELETE FROM ${t}`); } catch (e) { if (!/no such table/.test(e.message)) throw e; } }
      db.exec(`DELETE FROM files WHERE ${gone}`);
      db.exec("DELETE FROM settings WHERE key IN ('next_job_no','next_quote_no','next_report_no','next_invoice_no','next_credit_no')");
      try { db.exec("DELETE FROM sqlite_sequence WHERE name IN ('" + DOC_WIPE.join("','") + "')"); } catch { /* no sequences */ }
      if (!isTest()) db.prepare("INSERT INTO settings(key,value) VALUES('docs_reset_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(ctx.now()));
      ctx.admin.audit(user, 'system', 0, 'docs_reset', before, { backup: bk?.name || '' }, ip);
    });
    const base = ctx.storage?.baseDir;
    let removed = 0;
    if (base) for (const f of files) { try { fs.rmSync(path.join(base, f.local_path), { force: true }); removed++; } catch { /* ignore */ } }
    return { ok: true, backup: bk?.name || '', cleared: before, files_removed: removed };
  }
  return { status, reset, resetDocs };
}
