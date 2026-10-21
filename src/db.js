import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCHEMA = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

export const SETTING_DEFAULTS = {
  company_name: 'ARAL Property Inspection Service',
  company_short: 'ARAL',
  tagline: 'Smarter Inspections | Safer Properties',
  det_licence_no: '',
  rera_reg_no: '',
  trn: '',
  vat_registered: '0',
  vat_rate: '5',
  vat_effective_date: '',
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
  ['VAT', ['vat_registered', 'trn', 'vat_rate', 'vat_effective_date']],
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
  db.exec(SCHEMA);
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
  for (const [k, v] of Object.entries(SETTING_DEFAULTS)) ins.run(k, v);
  ins.run('_secret', crypto.randomBytes(32).toString('base64url'));
  return db;
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
