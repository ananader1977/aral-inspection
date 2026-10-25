-- A R A L Property Inspection Services — database schema (Phase 1 draft for approval)
-- Engine: Node 22 built-in SQLite (node:sqlite). Same conventions as Dar Al Bunyan:
--   * INTEGER primary keys, created_at/updated_at as epoch milliseconds (INTEGER)
--   * business dates as ISO text 'YYYY-MM-DD' (Asia/Dubai)
--   * money as REAL AED rounded to 2 dp in service code
--   * settings as key/value; event tables log every status change
PRAGMA foreign_keys = ON;

-- ───────────────────────── 1. SYSTEM ─────────────────────────
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- keys: company_name, company_short, tagline, det_licence_no, rera_reg_no, trn, vat_registered(0/1),
-- vat_rate, vat_effective_date, phone, mobile, email, website, bank_*, quote_prefix, next_quote_no,
-- job_prefix, next_job_no, report_prefix, next_report_no, invoice_prefix, next_invoice_no,
-- credit_prefix, next_credit_no, quote_validity_days, deposit_pct, payment_terms_days,
-- reminder_days, default_commission_pct, brand_* colours, drive_root_folder_id, ui_default_lang

CREATE TABLE IF NOT EXISTS branches (            -- multiple office addresses
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN
    ('super_admin','admin','inspector','reviewer','accountant','client','partner_valuer')),
  password_hash TEXT NOT NULL,
  totp_secret TEXT,                                -- 2FA (required for super_admin/admin/reviewer/accountant)
  totp_pending TEXT,                               -- secret being set up, confirmed with a first code
  phone TEXT NOT NULL DEFAULT '',
  credentials TEXT NOT NULL DEFAULT '',            -- e.g. "B.Sc. Mech. Eng., InterNACHI CPI" (printed on reports)
  signature_file_id INTEGER REFERENCES files(id),
  client_id INTEGER REFERENCES clients(id),        -- for client portal users
  inspector_id INTEGER REFERENCES inspectors(id),  -- for inspector logins
  ui_lang TEXT NOT NULL DEFAULT 'en' CHECK (ui_lang IN ('en','ar')),
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  ip TEXT NOT NULL DEFAULT '',
  entity TEXT NOT NULL,                            -- 'job','quotation','invoice','settings',...
  entity_id INTEGER,
  action TEXT NOT NULL,                            -- 'create','update','status','delete','login',...
  before_json TEXT,
  after_json TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_log(entity, entity_id);

CREATE TABLE IF NOT EXISTS lookups (               -- editable picklists
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list TEXT NOT NULL,                              -- property_type, community, developer, purpose, bank,
                                                   -- material, trade, attendance, occupancy, referral_source
  value TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (list, value)
);

-- Versioned text blocks: T&Cs, report intro, standards, conclusion, thermal addendum, email templates...
CREATE TABLE IF NOT EXISTS content_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,                              -- 'tc_quote','tc_report','tc_invoice','tc_booking',
                                                   -- 'rpt_intro','rpt_what_we_inspect','rpt_standards',
                                                   -- 'rpt_understanding','rpt_conclusion','rpt_thermal_addendum',
                                                   -- 'qt_cover_letter','qt_component_<x>','email_<event>',...
  version INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,                              -- plain text with simple markdown (bold, bullets)
  effective_from TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  UNIQUE (code, version)
);

-- ───────────────────────── 2. CLIENTS ─────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('individual','company','bank','developer','owners_association','broker')),
  name TEXT NOT NULL,                              -- English name, printed on PDFs
  name_ar TEXT NOT NULL DEFAULT '',                -- shown on screens only
  contact_person TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  trn TEXT NOT NULL DEFAULT '',
  id_number TEXT NOT NULL DEFAULT '',              -- Emirates ID / passport (optional)
  pref_lang TEXT NOT NULL DEFAULT 'en',
  credit_terms_days INTEGER NOT NULL DEFAULT 0,    -- 0 = pay in advance
  monthly_invoicing INTEGER NOT NULL DEFAULT 0,    -- consolidated monthly invoice (banks)
  referral_source TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_clients_name ON clients(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS client_rates (          -- negotiated bank / corporate rate card
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id),
  price REAL NOT NULL,
  sla_hours INTEGER,                               -- turnaround from property access
  UNIQUE (client_id, service_id)
);

-- ───────────────────────── 3. CATALOGUE & PRICING ─────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                       -- BNK-COL, OWN-SNG, OWN-PPI, ...
  name TEXT NOT NULL,                              -- printed name, e.g. "Resale Inspection"
  name_ar TEXT NOT NULL DEFAULT '',
  segment TEXT NOT NULL CHECK (segment IN ('bank','owner','developer','any')),
  report_type TEXT NOT NULL,                       -- snagging, move_in_out, pre_purchase, collateral, progress,
                                                   -- repossessed, building_audit, specialist, valuation_support
  is_addon INTEGER NOT NULL DEFAULT 0,
  includes_reinspection INTEGER NOT NULL DEFAULT 0,
  default_sla_hours INTEGER NOT NULL DEFAULT 48,
  checklist_id INTEGER REFERENCES checklists(id),
  needs_thermal INTEGER NOT NULL DEFAULT 0,        -- requires a free thermal toolset when scheduling
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS price_rules (           -- base fee by service x property type x size band
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  property_type TEXT NOT NULL DEFAULT '*',
  bedrooms_min INTEGER, bedrooms_max INTEGER,
  sqft_min REAL, sqft_max REAL,
  price REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS surcharges (            -- urgent (same day), weekend, out-of-Dubai, ...
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fixed','percent')),
  value REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- ───────────────────────── 4. PEOPLE IN THE FIELD ─────────────────────────
CREATE TABLE IF NOT EXISTS inspectors (            -- outsourced network (not on payroll)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  engagement TEXT NOT NULL DEFAULT 'freelance' CHECK (engagement IN ('freelance','manpower_supplier','own_company')),
  supplier_name TEXT NOT NULL DEFAULT '',
  licence_no TEXT NOT NULL DEFAULT '',
  licence_expiry TEXT,
  insurance_expiry TEXT,
  agreement_expiry TEXT,
  credentials TEXT NOT NULL DEFAULT '',
  thermal_certified INTEGER NOT NULL DEFAULT 0,
  areas TEXT NOT NULL DEFAULT '',                  -- comma list of communities/zones covered
  commission_pct REAL,                             -- NULL = settings.default_commission_pct (42)
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                              -- "Thermal camera #1", "HVAC set #1"
  kind TEXT NOT NULL CHECK (kind IN ('thermal','hvac','borescope','hand_tools','moisture','other')),
  serial_no TEXT NOT NULL DEFAULT '',
  calibration_due TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS valuation_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  firm_name TEXT NOT NULL,
  rera_firm_no TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

-- ───────────────────────── 5. JOBS (the spine) ─────────────────────────
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_type TEXT NOT NULL,                     -- apartment, villa, townhouse, studio, office, ...
  emirate TEXT NOT NULL DEFAULT 'Dubai',
  community TEXT NOT NULL DEFAULT '',              -- "Downtown", "IMPZ"
  building TEXT NOT NULL DEFAULT '',               -- "IL Primo"
  unit_no TEXT NOT NULL DEFAULT '',
  plot_no TEXT NOT NULL DEFAULT '',
  title_deed_no TEXT NOT NULL DEFAULT '',
  developer TEXT NOT NULL DEFAULT '',
  bedrooms INTEGER,                                -- 0 = studio
  has_maid_room INTEGER NOT NULL DEFAULT 0,
  levels INTEGER NOT NULL DEFAULT 1,
  bua_sqft REAL,                                   -- built-up area
  plot_sqft REAL,
  handover_date TEXT,
  map_link TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_prop_unit ON properties(building, unit_no);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,                     -- JOB-2026-00001
  client_id INTEGER NOT NULL REFERENCES clients(id),
  property_id INTEGER NOT NULL REFERENCES properties(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  purpose TEXT NOT NULL DEFAULT '',                -- resale, handover, mortgage, tenancy ...
  channel TEXT NOT NULL DEFAULT 'internal' CHECK (channel IN ('web','portal','bulk','internal','whatsapp')),
  bank_reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new','quoted','quote_accepted','agreement_signed','payment_pending','paid','scheduled','inspected',
    'report_draft','under_review','report_issued','invoiced','closed',
    'quote_rejected','quote_expired','on_hold','access_failed','reinspection_due','cancelled','refunded')),
  parent_job_id INTEGER REFERENCES jobs(id),       -- re-inspection links to the original job
  access_contact TEXT NOT NULL DEFAULT '',
  access_notes TEXT NOT NULL DEFAULT '',           -- keys, gate pass, security
  preferred_dates TEXT NOT NULL DEFAULT '',
  occupancy TEXT NOT NULL DEFAULT '',              -- vacant / owner_occupied / tenanted / furnished
  ac_connected INTEGER,                            -- site prerequisites (from proposal)
  dewa_connected INTEGER,
  -- scheduling
  inspector_id INTEGER REFERENCES inspectors(id),
  scheduled_start INTEGER,
  scheduled_end INTEGER,
  -- SLA (clock starts at property access)
  access_at INTEGER,
  sla_due_at INTEGER,
  report_issued_at INTEGER,
  -- partner (valuation-support jobs)
  valuation_partner_id INTEGER REFERENCES valuation_partners(id),
  pack_delivered_at INTEGER,
  -- money snapshot (from accepted quote)
  fee_net REAL NOT NULL DEFAULT 0,
  client_kind TEXT NOT NULL DEFAULT 'individual',   -- individual pays in advance; company = credit terms
  drive_folders TEXT NOT NULL DEFAULT '',          -- JSON {root, photo, video, pdf} Google Drive folder ids
  lead_id INTEGER,
  equipment_ids TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS ix_jobs_client ON jobs(client_id);
CREATE INDEX IF NOT EXISTS ix_jobs_inspector ON jobs(inspector_id, scheduled_start);

CREATE TABLE IF NOT EXISTS job_events (            -- every status transition
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  from_status TEXT, to_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS equipment_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL
);

-- ───────────────────────── 6. QUOTATION → AGREEMENT ─────────────────────────
CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL,                            -- QT-2026-00001
  revision INTEGER NOT NULL DEFAULT 0,             -- printed as -R1, -R2
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  issue_date TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','sent','accepted','rejected','change_requested','expired','superseded')),
  components TEXT NOT NULL DEFAULT '[]',           -- JSON: selected scope components
  prerequisites TEXT NOT NULL DEFAULT '[]',        -- JSON: AC connected, DEWA connected, ...
  turnaround_text TEXT NOT NULL DEFAULT 'Within 24 hours of the inspection',
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  net REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 0,                -- 0 until VAT-registered
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  deposit_pct REAL NOT NULL DEFAULT 100,
  payment_terms TEXT NOT NULL DEFAULT '100% in advance',
  tc_block_id INTEGER REFERENCES content_blocks(id),
  public_token TEXT NOT NULL,                      -- secure accept / pay link
  sent_at INTEGER,
  decided_at INTEGER,
  decided_name TEXT NOT NULL DEFAULT '',
  decided_ip TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  pdf_file_id INTEGER REFERENCES files(id),
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  UNIQUE (number, revision)
);

CREATE TABLE IF NOT EXISTS quote_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  service_id INTEGER REFERENCES services(id),
  description TEXT NOT NULL,                       -- "Inspection & re-inspection service"
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL,
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS agreements (            -- e-signed service agreement after quote acceptance
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id),
  tc_block_id INTEGER NOT NULL REFERENCES content_blocks(id),
  public_token TEXT NOT NULL,
  sent_at INTEGER,
  signed_at INTEGER,
  signed_name TEXT NOT NULL DEFAULT '',
  signed_ip TEXT NOT NULL DEFAULT '',
  signature_file_id INTEGER REFERENCES files(id),
  pdf_file_id INTEGER REFERENCES files(id)
);

-- ───────────────────────── 7. INSPECTION & REPORT ─────────────────────────
-- Reusable libraries (admin-managed)
CREATE TABLE IF NOT EXISTS checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                              -- "Resale – apartment", "Snagging 200-point"
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS section_templates (     -- sections a checklist creates
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                              -- "Air Conditioning", "Bathroom {n}", "Bedroom {n} Balcony"
  kind TEXT NOT NULL CHECK (kind IN ('system','area')),
  repeat_rule TEXT NOT NULL DEFAULT 'once',        -- once | per_bedroom | per_bathroom | if_maid | if_villa
  intro_block_code TEXT,                           -- e.g. 'sec_intro_air_conditioning'
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS item_templates (        -- default items inside a section
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_template_id INTEGER NOT NULL REFERENCES section_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                              -- "Floor Condition", "Shower Faucet Condition"
  attr_label TEXT,                                 -- 'Type' | 'Materials' | 'Location' | NULL
  attr_list TEXT,                                  -- lookups.list to offer, e.g. 'material'
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS comment_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_name TEXT NOT NULL DEFAULT '*',             -- suggest for matching items
  text TEXT NOT NULL,
  default_severity TEXT NOT NULL DEFAULT 'attention' CHECK (default_severity IN ('critical','attention','info')),
  default_trade TEXT NOT NULL DEFAULT '',
  glossary_id INTEGER REFERENCES glossary(id),
  uses INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS glossary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL UNIQUE,
  definition TEXT NOT NULL,
  references_text TEXT NOT NULL DEFAULT ''
);

-- One report per job (versions via report_versions)
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  number TEXT UNIQUE,                              -- RPT-2026-00001, assigned on issue
  title TEXT NOT NULL,                             -- "Resale Inspection Report"
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','returned','approved','issued','superseded')),
  -- General Information
  inspection_date TEXT,
  time_in TEXT, time_out TEXT,
  persons_present TEXT NOT NULL DEFAULT '[]',      -- JSON ['Owner','Buyer agent']
  occupancy TEXT NOT NULL DEFAULT '',
  property_note TEXT NOT NULL DEFAULT '',          -- e.g. condominium / HOA responsibility note
  levels INTEGER,
  estimated_age TEXT NOT NULL DEFAULT 'Unable to determine',
  weather TEXT NOT NULL DEFAULT '',
  temperature_c REAL,
  ac_connected INTEGER, dewa_connected INTEGER,
  thermal_used INTEGER NOT NULL DEFAULT 0,
  equipment_used TEXT NOT NULL DEFAULT '[]',       -- JSON equipment ids (with calibration dates at time of issue)
  cover_media_id INTEGER REFERENCES media(id),
  overall_condition TEXT NOT NULL DEFAULT '',      -- optional rating
  -- review
  submitted_at INTEGER,
  reviewer_id INTEGER REFERENCES users(id),
  review_note TEXT NOT NULL DEFAULT '',
  approved_at INTEGER,
  issued_at INTEGER,
  verify_token TEXT NOT NULL,                      -- QR verification page
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS report_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                              -- "Master Bathroom"
  kind TEXT NOT NULL CHECK (kind IN ('system','area')),
  intro TEXT NOT NULL DEFAULT '',                  -- copied from template block, editable
  sort INTEGER NOT NULL,
  not_inspected_reason TEXT NOT NULL DEFAULT ''    -- e.g. "No access – locked"
);
CREATE INDEX IF NOT EXISTS ix_rsec_report ON report_sections(report_id, sort);

CREATE TABLE IF NOT EXISTS report_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES report_sections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                              -- "Shower Base Condition"
  attr_label TEXT,                                 -- Type / Materials / Location
  attr_value TEXT NOT NULL DEFAULT '',             -- "Cultured Marble"
  attr_list TEXT,                                  -- picklist offered for the detail (material, ac_type, pipe_material…)
  sort INTEGER NOT NULL                            -- printed as item number 1,2,3...
);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES report_items(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'attention' CHECK (severity IN ('critical','attention','info')),
  trade TEXT NOT NULL DEFAULT '',                  -- "licensed plumber"
  in_summary INTEGER NOT NULL DEFAULT 1,
  responsible TEXT NOT NULL DEFAULT '',            -- developer / owner / tenant (snagging)
  repair_cost_est REAL,                            -- optional
  glossary_id INTEGER REFERENCES glossary(id),
  library_id INTEGER REFERENCES comment_library(id),
  reinspect_status TEXT CHECK (reinspect_status IN ('fixed','not_fixed','partly_fixed')),
  sort INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media (                 -- photos / videos / thermal images (in Google Drive)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  observation_id INTEGER REFERENCES observations(id) ON DELETE SET NULL,  -- NULL = unassigned (quick mode)
  section_id INTEGER REFERENCES report_sections(id) ON DELETE SET NULL,
  item_id INTEGER REFERENCES report_items(id) ON DELETE SET NULL,   -- photo taken next to a checklist item (no finding needed)
  kind TEXT NOT NULL CHECK (kind IN ('photo','video','thermal')),
  pair_media_id INTEGER REFERENCES media(id),      -- thermal ↔ normal photo
  file_id INTEGER NOT NULL REFERENCES files(id),
  thumb_file_id INTEGER REFERENCES files(id),
  width INTEGER, height INTEGER, duration_s REAL,
  caption TEXT NOT NULL DEFAULT '',
  temp_min_c REAL, temp_max_c REAL,
  taken_at INTEGER, lat REAL, lng REAL,
  in_pdf INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  client_uuid TEXT UNIQUE,                         -- idempotent offline sync from the phone
  uploaded_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_media_obs ON media(observation_id);

CREATE TABLE IF NOT EXISTS report_attachments (    -- documents attached to the report: lab results, floor plans, DEWA bills, developer snag lists...
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES files(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('image','pdf')),
  in_pdf INTEGER NOT NULL DEFAULT 1,               -- printed in the report appendix
  send_with_report INTEGER NOT NULL DEFAULT 1,     -- attached to the report email
  sort INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS report_versions (       -- immutable issued PDFs
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  pdf_file_id INTEGER NOT NULL REFERENCES files(id),
  page_count INTEGER,
  tc_block_id INTEGER REFERENCES content_blocks(id),
  issued_by INTEGER REFERENCES users(id),
  issued_at INTEGER NOT NULL,
  UNIQUE (report_id, version)
);

-- ───────────────────────── 8. MONEY ─────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,                     -- INV-2026-00001
  kind TEXT NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice','credit_note')),
  credit_for_id INTEGER REFERENCES invoices(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  issue_date TEXT NOT NULL,
  supply_date TEXT,
  due_date TEXT,
  is_tax_invoice INTEGER NOT NULL DEFAULT 0,       -- 1 once VAT-registered
  subtotal REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, net REAL NOT NULL,
  vat_rate REAL NOT NULL DEFAULT 0, vat REAL NOT NULL DEFAULT 0, total REAL NOT NULL,
  paid REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('draft','issued','part_paid','paid','cancelled')),
  pay_token TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  pdf_file_id INTEGER REFERENCES files(id),
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_lines (         -- one line per job (monthly bank invoices list many)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id),
  pos INTEGER NOT NULL,
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1, unit_price REAL NOT NULL, amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  invoice_id INTEGER REFERENCES invoices(id),
  quotation_id INTEGER REFERENCES quotations(id),  -- advance payment against an accepted quote
  method TEXT NOT NULL CHECK (method IN ('card','bank_transfer','cheque','cash')),
  provider TEXT NOT NULL DEFAULT '',               -- mock | stripe | ngenius | telr
  provider_ref TEXT NOT NULL DEFAULT '',           -- demo_pi_... / pi_...
  amount REAL NOT NULL,
  gateway_fee REAL NOT NULL DEFAULT 0,
  paid_on TEXT NOT NULL,
  proof_file_id INTEGER REFERENCES files(id),
  receipt_no TEXT,
  refunded REAL NOT NULL DEFAULT 0,
  recorded_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_sessions (      -- same as Dar Al Bunyan (demo / Stripe checkout)
  id TEXT PRIMARY KEY,
  quotation_id INTEGER REFERENCES quotations(id),
  invoice_id INTEGER REFERENCES invoices(id),
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  amount REAL NOT NULL,
  payment_ref TEXT,
  return_url TEXT,                                 -- where the payer goes back to (job page when the office takes the card)
  initiated_by INTEGER REFERENCES users(id),       -- staff member who took the card payment for the client
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commissions (           -- inspector payouts
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspector_id INTEGER NOT NULL REFERENCES inspectors(id),
  job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id),
  base_amount REAL NOT NULL,                       -- job fee excl. VAT
  pct REAL NOT NULL,
  amount REAL NOT NULL,
  bonus REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','payable','paid','void')),
  payable_on TEXT,                                 -- report issued AND (paid OR credit client)
  statement_month TEXT,                            -- 'YYYY-MM'
  paid_on TEXT
);

CREATE TABLE IF NOT EXISTS job_costs (             -- specialist subcontractors etc.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  supplier TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL,
  paid_on TEXT
);

-- ───────────────────────── 9. FILES & MESSAGES ─────────────────────────
CREATE TABLE IF NOT EXISTS files (                 -- Google Drive (or disk fallback) — as Dar Al Bunyan attachments
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL DEFAULT 'attachment',      -- photo, video, thumb, pdf_quote, pdf_report, pdf_invoice,
                                                   -- title_deed, proof, signature, logo, ...
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  storage TEXT NOT NULL CHECK (storage IN ('drive','disk')),
  sha256 TEXT NOT NULL DEFAULT '',
  drive_id TEXT, link TEXT, local_path TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (                -- every email (as Dar Al Bunyan "Messages")
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  to_addr TEXT NOT NULL, cc TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL, body TEXT NOT NULL,
  template_code TEXT NOT NULL DEFAULT '',
  job_id INTEGER REFERENCES jobs(id),
  attachments TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','logged')),
  error TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS feedback (              -- post-job review score (target ≥ 4.8)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id),
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- ───────────────────────── 10. LEADS (website and manual enquiries) ─────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'website',          -- website, whatsapp, phone, email, broker, bank, repeat
  name TEXT NOT NULL,
  mobile TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  client_type TEXT NOT NULL DEFAULT 'individual',
  pref_lang TEXT NOT NULL DEFAULT 'en',
  service_code TEXT NOT NULL DEFAULT '',
  property_type TEXT NOT NULL DEFAULT '',
  bedrooms INTEGER,
  sqft REAL,
  community TEXT NOT NULL DEFAULT '',
  building TEXT NOT NULL DEFAULT '',
  preferred_date TEXT,
  addons TEXT NOT NULL DEFAULT '[]',
  urgent INTEGER NOT NULL DEFAULT 0,
  estimate_total REAL,                             -- what the website showed, AED
  referral_code TEXT NOT NULL DEFAULT '',          -- broker / agent code
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','onboarding','converted','lost')),
  lost_reason TEXT NOT NULL DEFAULT '',
  assigned_to INTEGER REFERENCES users(id),
  contacted_at INTEGER,
  job_id INTEGER REFERENCES jobs(id),
  consent INTEGER NOT NULL DEFAULT 0,
  ip TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_leads_status ON leads(status, created_at);
