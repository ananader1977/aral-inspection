import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCHEMA = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

export const SETTING_DEFAULTS = {
  company_name: 'A R A L Property Inspection Services',
  company_short: 'A R A L',
  tagline: 'Smarter Inspections | Safer Properties',
  det_licence_no: '',
  rera_reg_no: '',
  trn: '',
  vat_registered: '0',
  vat_rate: '5',
  vat_effective_date: '',
  fy_start_month: '1', // financial year start month for the statements (1 = January)
  phone: '',
  mobile: '',
  email: 'ananader1@gmail.com',
  website: '',
  bank_name: '',
  bank_account_name: '',
  bank_account_number: '',
  bank_iban: '',
  bank_swift: '',
  job_prefix: 'JOB-{YYYY}-',
  quote_prefix: 'QT-{YYYY}-',
  report_prefix: 'RPT-{YYYY}-',
  invoice_prefix: 'INV-{YYYY}-',
  credit_prefix: 'CN-{YYYY}-',
  number_digits: '5',
  next_job_no: '1',
  next_quote_no: '1',
  next_report_no: '1',
  next_invoice_no: '1',
  next_credit_no: '1',
  quote_validity_days: '14',
  deposit_pct: '100',
  payment_terms_days: '30',
  reminder_days: '3',
  default_commission_pct: '42',
  default_turnaround: 'Within 24 hours of the inspection',
  monthly_job_target: '100',
  review_score_target: '4.8',
  brand_navy: '#0A1F4A',
  brand_blue: '#0B4F8C',
  brand_copper: '#8C5A36',
  ui_default_lang: 'en',
};

/** Groups shown on the Company settings screen, in order. */
export const SETTING_GROUPS = [
  ['Company', ['company_name', 'company_short', 'tagline', 'det_licence_no', 'rera_reg_no', 'phone', 'mobile', 'email', 'website']],
  ['VAT and accounts', ['vat_registered', 'trn', 'vat_rate', 'vat_effective_date', 'fy_start_month']],
  ['Bank details (printed on quotations and invoices)', ['bank_name', 'bank_account_name', 'bank_account_number', 'bank_iban', 'bank_swift']],
  ['Document numbers', ['job_prefix', 'next_job_no', 'quote_prefix', 'next_quote_no', 'report_prefix', 'next_report_no', 'invoice_prefix', 'next_invoice_no', 'credit_prefix', 'next_credit_no', 'number_digits']],
  ['Quotations and payment', ['quote_validity_days', 'deposit_pct', 'payment_terms_days', 'reminder_days', 'default_turnaround']],
  ['Inspectors and targets', ['default_commission_pct', 'monthly_job_target', 'review_score_target']],
  ['Brand colours', ['brand_navy', 'brand_blue', 'brand_copper', 'ui_default_lang']],
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  db.exec(SCHEMA);
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
  for (const [k, v] of Object.entries(SETTING_DEFAULTS)) ins.run(k, v);
  ins.run('_secret', crypto.randomBytes(32).toString('base64url'));
  renameBrand(db);
  return db;
}

/**
 * Brings a database created by an earlier version up to date: every column that schema.sql has and the
 * database lacks is added (with its default), so existing data is kept. New tables and indexes are then
 * created by schema.sql itself (CREATE ... IF NOT EXISTS).
 */
export function migrate(db) {
  const ref = new DatabaseSync(':memory:');
  ref.exec(SCHEMA);
  const tables = (d) => d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  const have = new Set(tables(db));
  const added = [];
  for (const t of tables(ref)) {
    if (!have.has(t)) continue;
    const cur = new Set(db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name));
    for (const c of ref.prepare(`PRAGMA table_info("${t}")`).all()) {
      if (cur.has(c.name)) continue;
      const def = c.dflt_value != null ? ` DEFAULT ${c.dflt_value}` : '';
      const notNull = c.notnull && c.dflt_value != null ? ' NOT NULL' : '';
      db.exec(`ALTER TABLE "${t}" ADD COLUMN "${c.name}" ${c.type || ''}${notNull}${def}`);
      added.push(`${t}.${c.name}`);
    }
  }
  ref.close();
  if (added.length) console.log(`[db] upgraded database: added ${added.join(', ')}`);
  return added;
}

export function getSettings(db) {
  const out = { ...SETTING_DEFAULTS };
  for (const r of db.prepare('SELECT key,value FROM settings').all()) if (!r.key.startsWith('_')) out[r.key] = r.value;
  return out;
}

/** Runs fn inside a transaction (rolls back on error). */
/** Nested calls join the outer transaction. */
export function tx(db, fn) {
  if (db.__txDepth) { db.__txDepth++; try { return fn(); } finally { db.__txDepth--; } }
  db.__txDepth = 1;
  try { db.exec('BEGIN IMMEDIATE'); } catch (e) { db.__txDepth = 0; throw e; }
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.__txDepth = 0;
  }
}

/** Formats a document number from settings: prefix "QT-{YYYY}-" + zero-padded counter. */
export function formatNumber(settings, kind, n, year) {
  const prefix = String(settings[`${kind}_prefix`] || '').replace('{YYYY}', String(year));
  return prefix + String(n).padStart(Number(settings.number_digits) || 5, '0');
}

/** One-time rename (Oct 2026): "ARAL Property Inspection Service" -> "A R A L Property Inspection Services" in stored settings and wording. */
export function renameBrand(db) {
  if (db.prepare("SELECT 1 FROM settings WHERE key='_m_brand_spaced'").get()) return;
  const fix = (t) => String(t).replace(/ARAL Property Inspection Service(?!s)/g, 'A R A L Property Inspection Services').replace(/\bARAL\b(?! (Jobs|Backups)\b)/g, 'A R A L');
  db.prepare("UPDATE settings SET value='A R A L Property Inspection Services' WHERE key='company_name' AND value='ARAL Property Inspection Service'").run();
  db.prepare("UPDATE settings SET value='A R A L' WHERE key='company_short' AND value='ARAL'").run();
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='content_blocks'").get();
  if (has) {
    const up = db.prepare('UPDATE content_blocks SET title=?, body=? WHERE id=?');
    for (const r of db.prepare('SELECT id, title, body FROM content_blocks').all()) {
      const t = fix(r.title), b = fix(r.body);
      if (t !== r.title || b !== r.body) up.run(t, b, r.id);
    }
  }
  db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('_m_brand_spaced','1')").run();
}
