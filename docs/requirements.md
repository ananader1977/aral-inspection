# Build Prompt: ARAL Property Inspection Service — Management App (Dubai)

> Version 2 — aligned with *Business Plan & Feasibility Study: Property Inspection Services in Dubai* (Sept 2026, DET activity 6820007).

---

## ROLE & WORKING RULES
You are a senior full-stack engineer. Build a production-ready web application (screens in English and Arabic; all PDFs in English) that runs a Dubai property inspection business end to end:

**request → quotation → payment → scheduling → field inspection → technical review → report issue → invoice → inspector commission → closure.**

- Work in the phases in Section 18. After each phase, stop, summarise what was built, list assumptions, and wait for my approval.
- Before Phase 1, ask clarifying questions on anything ambiguous. Do not invent business rules, fees or legal wording.
- All amounts in AED. Timezone Asia/Dubai. Dates DD/MM/YYYY.

## BRAND & THEME
- **Trade name:** ARAL Property Inspection Service · Arabic: **آرال لخدمات فحص العقارات** (confirm with trade licence)
- **Tagline:** Smarter Inspections | Safer Properties · فحص أذكى | عقارات أكثر أماناً
- **Colours (sampled from the logo file):**
  - Navy (text, top bar, headers): `#0A1F4A`
  - Royal blue (primary buttons, links, "Attention" findings): `#0B4F8C`
  - Sky blue (accents, focus): `#2283C8`
  - Copper (secondary accent, dividers, active tab): `#8C5A36`
  - Copper tint (soft backgrounds): `#F4ECE4`
  - Page background `#F5F7FA`, surface `#FFFFFF`, body text `#16213A`
  - Critical findings `#C62828`
- **Typography:** headings in a wide geometric sans (e.g. Montserrat, letter-spaced caps like the logo's "PROPERTY INSPECTION"); body Inter; Arabic screens IBM Plex Sans Arabic. PDFs use built-in Helvetica (bold/regular) in the brand colours.
- **UI style:** clean white layout, navy top bar, copper thin rule dividers (like the logo's "— SERVICE —"), rounded corners 8 px, house-roof motif only in empty states/login.
- **Assets needed:** logo as SVG or transparent PNG (full logo, icon-only "A-roof + house" mark, white version for dark backgrounds), favicon and PWA app icon generated from the icon mark.
- All brand values stored in Admin → Company settings so they can be changed without code.

## 0. REGULATORY SCOPE GUARD (non-negotiable)
The business holds a DET licence for **property inspection services (activity 6820007)**, registered with DLD/RERA via Trakheesi. It is **not** a licensed valuation firm.
- The app must **not** produce a market-value opinion, valuation figure or "valuation report" under our name.
- Valuation work is handled through a **RERA-registered valuation partner**: we produce a *Valuation-Support Inspection Pack* (verified areas, finishes, floor, view, photos) and hand it to the partner's valuer.
- Build a feature flag `VALUATION_MODULE_ENABLED` (default **off**) and data structures that allow a full valuation report later (Phase 3 of the business plan, Year 3+), once the firm and a registered valuer hold RERA authorisation.
- Every report carries admin-editable scope-and-limitation wording.

## 1. TECH STACK — same architecture as the Dar Al Bunyan app
Reference implementation: GitHub repo `ananader1977/dar-al-bunyan`. Reuse its structure, conventions and modules (copy and adapt; do not import across repos).

- **Runtime:** Node.js 22.13+ (JavaScript, ES modules). **Frontend:** plain HTML, CSS and vanilla JavaScript in `public/` (no React, no build step).
- **Database:** Node's built-in SQLite (`node:sqlite`), one file at `DB_PATH`, schema + migrations in `src/db.js`.
- **Structure (mirror Dar Al Bunyan):** `src/server.js`, `app.js`, `http.js`, `routes.js`, `auth.js`, `config.js`, `db.js`, `service.js`, `docs.js`, `pdf.js`, `xlsx.js`, `smtp.js`, `notify.js`, `payments.js`, `storage.js`, `importer.js`, `time.js`, `util.js`; `public/app/index.html`, `public/js/{app,admin,common,pay,paydemo}.js`, `public/css/app.css`; `test/*.test.js` with `node --test`; `scripts/`.
- **Dependencies:** zero npm packages, exactly as in Dar Al Bunyan.
- **PDF (English only):** all PDFs (quotation, report, invoice, receipt, credit note, statements) are **English only**. Reuse and extend Dar Al Bunyan's dependency-free `pdf.js`:
  - add **JPEG embedding** (DCTDecode pass-through: read width/height from the SOF marker and embed the bytes as-is) so phone photos go into the PDF without decoding;
  - add multi-page flow helpers: automatic page breaks, repeating header (logo) and footer (`ARAL | {building}, Unit {unit}, {community}` + "Page X of Y", filled in a second pass), "(continued)" section headings, a 2-photo-per-row grid with captions, coloured severity text, and a table of contents with page ranges (second pass);
  - target: a 60–70 page report with 200+ photos generated in under 30 s and under ~20 MB.
- **Excel:** reuse Dar Al Bunyan's dependency-free `xlsx.js`; exports are in English (Arabic client names must still display correctly — UTF-8).
- **Email:** reuse `smtp.js` — Gmail SMTP (`smtp.gmail.com:587`) with an **app password** for ananader1@gmail.com, `SMTP_*` env vars, Settings → "Send me a test email", all messages logged under Messages.
- **Payments:** reuse `payments.js` — `PAYMENT_PROVIDER=mock` (**demo card checkout**, see Section 8) by default, Stripe ready behind env vars.
- **Files & photos:** reuse `storage.js` with **Google Drive** (`drive.file` scope) for all photos, videos and issued PDFs: one Drive folder per job (`ARAL/Jobs/{job no.} – {building} {unit}/photos|videos|pdf`). The phone uploads an optimised JPEG (~1600 px); the server fetches those from Drive when building a PDF and caches them temporarily on disk. The Render disk holds only the SQLite database and temp cache.
- **i18n (screens only):** the app interface is English + Arabic: JSON dictionaries `public/i18n/en.json` and `ar.json`, a language toggle, and `dir="rtl"` + mirrored CSS (logical properties) for Arabic.
- **Auth:** reuse `auth.js` (sessions, hashed passwords, seeded admin accounts from env vars); add TOTP 2FA for Admin, Reviewer and Accountant.
- **Deployment:** reuse `Dockerfile` and `render.yaml` (Render Blueprint, persistent disk, health check `/api/health`). Code in a **private** GitHub repo, e.g. `ananader1977/aral-inspection`.

## 2. USER ROLES (RBAC, enforced server-side on every route)
| Role | Business-plan equivalent | Permissions |
|---|---|---|
| Super Admin | Founder / GM | Everything: users, settings, T&Cs, addresses, fees, templates, numbering, tax, audit log |
| Admin Coordinator | Admin & report coordinator | Requests, quotes, scheduling, clients, report QA support, exports; no system settings |
| Inspector (outsourced) | Inspection network | Own assigned jobs only: inspection form, photos, draft report; sees own commission statement |
| Technical Manager / Reviewer | Outsourced chartered engineer | Review, return or approve reports; holds engineer sign-off |
| Accountant | Outsourced accounting | Invoices, payments, refunds, credit notes, commission payouts, financial exports |
| Bank / Corporate Client user | Lender, developer or owners association | Portal: bulk-submit requests, track SLA, download reports and invoices, statement of account |
| Individual Client | Owner, buyer, tenant | Portal: book, accept quote, pay, download own reports and invoices |
| Valuation Partner (external) | RERA-registered valuer | Read-only access to Valuation-Support Packs assigned to them |

## 3. CLIENT SEGMENTS & COMMERCIAL TERMS
- Segments: **Banks & lenders**, **Owners / buyers / tenants**, **Developers & owners associations**, **Brokers / referrers**.
- Corporate clients have: a contract or panel record, negotiated rate card (bulk per-unit rates), SLA turnaround per service, credit terms (e.g., 30 days, monthly consolidated invoicing), and multiple users and branches.
- Individual clients: pay upfront (full or deposit) before inspection.
- Referral source tracking (broker, mortgage adviser, website, WhatsApp, Google) with optional referral fee.

## 4. SERVICE CATALOGUE (admin-editable; seed with these)
| Code | Service | Segment | Default fee range (AED) | Default turnaround |
|---|---|---|---|---|
| BNK-COL | Collateral condition inspection | Bank | 600–900 | 24–48 h |
| BNK-VSI | Valuation-support site inspection (pack to RERA valuer partner) | Bank | 500–700 | 24 h |
| BNK-CPM | Construction-progress monitoring (per stage) | Bank | 2,000–3,500 | 3–5 days |
| BNK-REP | Repossessed / distressed asset inspection | Bank | 1,000–1,500 | 48 h |
| BNK-POR | Portfolio re-inspection (batch) | Bank | 500–800 | 5 days |
| BNK-HND | Buyer handover programme (white-label snagging) | Bank | 1,200–3,500 | 3 days |
| OWN-SNG | New-owner snagging & handover (200+ points, incl. 1 re-inspection) | Owner | 1,200–6,000 | 48 h |
| OWN-MIO | Move-in / move-out condition report | Owner / tenant | 900–2,200 | 24 h |
| OWN-PPI | Pre-purchase (resale) inspection | Buyer | 1,500–3,500 | 48 h |
| ADD-SPC | Specialist add-on: thermal, moisture/leak, HVAC/VRF, pool/waterproofing | Any | 500–1,500 | with parent job |
| DEV-AUD | Building / common-area audit & developer QA | Developer / OA | 10,000–40,000 per project | per proposal |
| OWN-DLP | Defect-liability-period re-inspection | Owner | 800–2,000 | 48 h |

**Pricing engine:** fee = base by service × property type × size band (sq ft) + add-ons + urgency surcharge − discount (discount limit per role) ± client rate-card override. Show an **instant quote** on the public booking page by property type and size.

## 5. WORKFLOW (state machine)
`NEW_REQUEST → QUOTED → QUOTE_ACCEPTED → PAYMENT_PENDING → PAID → SCHEDULED → INSPECTED → REPORT_DRAFT → UNDER_REVIEW → REPORT_ISSUED → INVOICED → CLOSED`

Side states: `QUOTE_REJECTED, QUOTE_EXPIRED, ON_HOLD, ACCESS_FAILED, RE_INSPECTION_DUE, CANCELLED, REFUNDED`.
- Corporate clients on credit skip `PAYMENT_PENDING`; they are invoiced on report issue or monthly.
- Every transition is logged (who, when, from → to, note). Invalid transitions are blocked.
- SLA clock starts at **property access** (not at booking), per the business plan. Track and flag SLA breaches.

## 5a. LEAD MANAGEMENT (added in v3, see docs/ARAL_Inspection_App_Build_Prompt_and_Workflows.docx, Workflow 1)
- Sources: website form (auto), WhatsApp, phone, email, broker, bank, repeat client.
- Fields: name, mobile, email, client type, service, property type, bedrooms, community, preferred date, source, notes, assigned Admin.
- Statuses: New → Contacted → Qualified → Converted, plus Onboarding (banks/developers) and Lost (reason picklist: price, out of area, timing, valuation only, no response, competitor).
- Reminder if not contacted within 2 hours; auto-Lost after 2 follow-ups in 7 days. Instant price estimate. Convert creates client + property + job in one step. Duplicate check on mobile/unit within 90 days.

## 6. REQUEST INTAKE
- Channels: public booking form (English/Arabic screens), client portal, bulk upload (Excel/CSV) for banks, internal entry by Admin.
- Fields: client type, name, company, TRN (optional), email, mobile (+971 validation), preferred language (EN/AR), service(s), purpose, property type (studio, apartment, townhouse, villa, office, retail, warehouse, building, land), emirate, community, project/building, unit no., plot no., title deed no., developer, handover date, built-up area / plot area (sq ft ↔ sq m), bedrooms, occupancy (vacant / owner / tenanted), access contact & key arrangements, preferred dates, documents (title deed, affection plan, Oqood, SPA, handover letter), bank reference no. (for lender jobs).
- On submit: job no. `JOB-YYYY-#####`, acknowledgement email in the client's language, duplicate warning (same unit within 90 days).
- Optional: WhatsApp Business booking link.

## 7. QUOTATION
- Built from the pricing engine; editable lines; VAT shown only when VAT is enabled (Section 12).
- Number `QT-YYYY-#####`, revisions `-R1, -R2`. Validity configurable (default 14 days); auto-expire; reminder N days before expiry.
- PDF (English) emailed with a secure link: **Accept / Reject / Pay**. Acceptance captures name, timestamp and IP (acts as the client's agreement to the T&Cs version shown).

### 7.1 PROPOSAL / QUOTATION TEMPLATE — FIELDS
Flow: Proposal sent → client accepts → **service agreement e-signed** (separate email) → payment → scheduling.

**A. Document meta:** proposal no., issue date (on every page header), validity date, revision, language mode.
**B. Client:** attention name, company (optional), email, mobile, client type.
**C. Property:** property type, bedrooms, community/area, project/building, unit no., built-up area. Auto-title, e.g. "2 Bedroom Apartment – IMPZ".
**D. Service:** service type (Pre-Handover / 11th-Month Warranty / Resale / Move-in-out / Bank), re-inspection included (Y/N, number of visits), components in scope (multi-select: Exterior, Interior, Structural, Concrete NDT, MEP, HVAC, Water leak & moisture, Pool/spa, Life safety). "Villa/townhouse only" components auto-hidden for apartments.
**E. Site prerequisites (checklist):** AC connected, DEWA connected, keys/access arranged, unit empty/clean (admin-editable list).
**F. Report & delivery:** turnaround (default 24 h), deliverables (photos, videos, defect categories Minor / Major / Material, follow-up consultation).
**G. Admin-editable content blocks (English, versioned):** cover letter, introduction, scope / what we inspect, component descriptions (one block per component, each with an image), equipment used, standards followed, environmental-testing exclusions, why choose us, thank-you note. Only blocks for selected components are printed.
**H. Fees:** fee lines (service, re-inspection, add-ons), discount, subtotal, VAT 5% (if registered), total, amount in words, payment terms (e.g. 100% in advance), payment methods: bank details from settings + live **card payment link / QR**.
**I. Optional add-ons offered:** mold lab test (third party), extra re-inspection, specialist diagnostics.
**J. Sign-off:** signatory name, credentials, signature image.
**K. Footer:** company name, address, phone, mobile, email, website, DET licence no., DLD/RERA registration no., page X of Y.
**L. Actions on the web version:** Accept / Reject / Request change / Pay; accepted proposal triggers the agreement email.

## 8. PAYMENTS (demo card first, real gateway later)
- Start with `PAYMENT_PROVIDER=mock`, exactly as in Dar Al Bunyan: a built-in **demo checkout page** (`pay-demo.html`) that accepts the standard test card **4242 4242 4242 4242**, any future expiry, any CVC, and marks the quote/invoice paid with a `demo_pi_…` reference.
- The demo page shows a clear **"DEMO — no real payment"** banner. While in demo mode, payment links are **not** sent to real clients; admins test with "Test online payment (demo)" on a quote or invoice.
- Provider interface (`createCheckout`, `retrieve`, webhook handler, `payUrl`) stays the same so I can later switch to Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, webhook `BASE_URL/api/webhooks/stripe`) or add N-Genius/Telr without changing other code.
- Full amount or deposit %; receipt PDF emailed on payment.
- Manual payments (bank transfer, cheque, cash) with proof upload by Accountant.
- Partial payments, refunds + credit note, payment ledger per job and per client.
- Real gateway: webhook signature verification and idempotent processing; no card data ever stored.

## 9. SCHEDULING & FIELD INSPECTION
- Assign an inspector by availability, area and qualification (e.g., thermal-certified); calendar per inspector; no double-booking.
- **Equipment booking:** track toolsets (thermal camera, HVAC set, borescope, hand-tool kit) and their calibration due dates; a thermal job cannot be scheduled without a free toolset.
- Confirmation email (and optional WhatsApp/SMS) to client with date, time and inspector name.
- **Mobile inspection app (PWA, offline-capable):**
  - Configurable checklists per service (200+ point snagging list seeded, editable by admin)
  - Room-by-room / area-by-area structure; each defect: category, location, description, **severity (Critical / Attention / Informational, approved in Phase 1)**, responsible party (developer / owner / tenant), indicative repair cost (optional), photos with annotations
  - **Thermal / radiometric images** with min/max temperature and finding note
  - Measurements (moisture %, temperature, airflow, refrigerant pressures for HVAC/VRF)
  - Verified details for valuation-support: actual areas, finishes, floor, view, occupancy
  - GPS + timestamp on arrival and on photos; access-failed reason capture
  - Autosave, offline sync, client-side photo compression
  - Client / tenant on-site signature (move-in / move-out)

## 10. REPORTS & TECHNICAL REVIEW
- Report types: Snagging / Handover, Move-in / Move-out, Pre-purchase, Collateral Condition, Construction Progress (stage % vs. milestone), Repossessed Asset, Building Audit, Specialist Diagnostic, **Valuation-Support Pack**.
- **Two-step review** (risk mitigation in the business plan): Inspector submits → Technical Manager approves or returns with comments → issued and locked. Each issued version is immutable; corrections create a new version.
- Report no. `RPT-YYYY-#####`. QR code linking to a public **verification page** (report no., date, property, status: valid / superseded).
- Re-inspection: create a linked job from an issued snagging report; show each defect as Fixed / Not fixed / Partly fixed with before/after photos.
- Valuation-Support Pack: shared with the assigned partner valuer through their portal login; delivery logged.
- Sign-off block: inspector name, Technical Manager name and engineering credential, signature images, company DLD/RERA registration no.

### 10.1 INSPECTION REPORT — STRUCTURE TO REPLICATE (from sample resale report)
Use the sample's structure and logic; **write our own wording** (do not copy third-party text).

**Every page:** header with ARAL logo; footer with `ARAL | {building}, Unit {unit}, {community}` and "Page X of Y".

| # | Section | Source | Fields / content |
|---|---|---|---|
| 1 | **Cover page** | Data | Logo, report title (e.g. "Resale Inspection Report"), cover photo, property (building, unit, community, emirate), client name, inspection date & time, report no., report date, inspector, QR verification code |
| 2 | **Introduction** | Admin text | How to read the report; properties do not "pass" or "fail"; snapshot in time; final walk-through advice |
| 3 | **What we inspect** | Admin text | Visual, non-invasive scope; definition of "material defect" |
| 4 | **Inspection standards followed** | Admin text | Authorities and standards referenced (DM, DEWA, DCD, Trakhees, InterNACHI SOP, ASHRAE, NFPA), editable list |
| 5 | **Table of contents** | Auto | Section names with page ranges, generated after layout |
| 6 | **General information** | Data | Inspector (name, credentials); persons in attendance (owner / buyer / agent / tenant / none); occupancy (vacant / owner-occupied / tenanted / furnished); property type + standard note (e.g. apartment: common areas are the owners association's responsibility); levels; estimated age (or "unable to determine"); weather & outdoor temperature °C; AC and DEWA connected (Y/N); time in / time out |
| 7 | **Understanding the report** | Admin text + legend | Severity colour legend and condition symbols |
| 8 | **System sections** | Data (repeating) | Air Conditioning, Electrical, Water Heater (+ Plumbing, Life Safety, Structure when in scope). Each with an admin-editable intro paragraph |
| 9 | **Area / room sections** | Data (repeating) | Auto-built from property type + bedrooms (e.g. 3BR + maid: Kitchen, Show Kitchen, Laundry, Living Room, Living Room Balcony, Maid's Room, Maid's Bath, Powder Room, Master Bedroom, Master Balcony, Master Bathroom, Bedroom 1–3, Bathroom 1–3, Bedroom balconies). Inspector can add, rename, duplicate, reorder, remove |
| 10 | **Glossary** | Auto | Only terms used in this report, from the glossary library, with references |
| 11 | **Report summary** | Auto | Observations flagged "include in summary", grouped by section: page no., item no., item name, observation text, severity colour |
| 12 | **Report conclusion** | Admin text | Limitations, latent defects, not a warranty |
| 13 | **Terms & conditions** | Admin text (versioned) | The T&C version linked to the client's signed agreement |
| 14 | **Thermal imaging addendum** | Admin text | Printed only if thermal imaging was used |
| 15 | **Sign-off** | Data | Inspector + Technical Manager name, credentials, signature, approval date |
| 16 | **Back page** | Settings | Thank-you note, address, phones, email, website, tagline |

**Data model: Section → Item → Observation → Media**
- **Section:** name, type (system / area), order, intro text. If a section has no defects, print "No defects observed at the time of inspection" (do not leave it blank).
- **Item** (numbered within section, e.g. "2. Floor Condition"): name from item library (Location, Floor, Walls, Ceiling, Doors, Windows, Electrical, Counters/Cabinets, Sink, Sink Faucet, Shower Faucet, Shower Base, Traps/Drains/Supply, Supply Lines, Panel, Comments…); attributes **Type / Materials / Location** (picklists: Tile, Ceramic tile, Marble/Porcelain, Cultured marble, Wood, Galvanized, Breakers, "Ensuite to Bedroom 1", "Main floor"…).
- **Observation** (bullets under "Observations"): text (comment library or free text), **severity**, recommended trade (licensed HVAC contractor / electrician / plumber / qualified contractor / mould specialist), include-in-summary flag (default on for Critical and Attention), glossary-term link, linked photos/videos.
- **Severity:** 🔴 **Critical** — safety or value impact (red text) · 🔵 **Attention** — needs repair or replacement (blue text) · ⚪ **Informational** — tested OK or for information (dark text, e.g. "sockets correct polarity, RCD tripped correctly"). Optional mapping to the plan's Critical / Major / Minor / Cosmetic.
- **Comment library:** admin-managed canned observations in English (hollow tiles, door not latching, missing sealant at faucet base plate, live/neutral reversed, loose socket, low water pressure, blocked drain, mould-like odour, AC no cold air, duct noise, hot water below 60 °C, etc.). Inspector picks and edits.
- **Media in PDF:** photos under their observation, 2 per row (configurable 1/2/3), caption below, annotations preserved. Thermal image printed next to the matching normal photo with min/max °C. **Videos cannot play inside a PDF**: print a thumbnail + QR code linking to the video on the secure online report.
- **Online report page:** the same report as a secure web page (via QR/link) with playable videos, full-size photos and PDF download.

### 10.2 PHOTO & VIDEO CAPTURE FROM PHONE
- Inspection app is a **PWA** installed on iPhone/Android via "Add to Home Screen"; no app-store release needed.
- On each observation: **Take photo** (rear camera), **Add from gallery** (multi-select; includes thermal images exported from the thermal camera's app), **Record video** (max 60 s, configurable).
- **Annotate** before saving: arrow, circle, rectangle, text (red).
- Auto-captured: timestamp, GPS, inspector, device; orientation fixed.
- On-device compression (photos ~1600 px, JPEG ~80%; videos transcoded server-side) so 200+ photos upload over mobile data.
- **Offline-first:** data and photos saved on the phone (IndexedDB), queued and synced when signal returns; per-file progress and retry; nothing lost if the app is closed.
- **Quick mode:** shoot photos room by room first, then assign them to observations later (tap on phone or drag on desktop).
- Reorder, set cover photo, exclude from PDF, replace or delete before submitting.
- Originals kept in storage; the PDF uses optimised copies (target under ~20 MB).

Before coding the final template, produce a **field-mapping table** (sample section/field → DB field → source → PDF label) for my approval.

## 11. PDF DOCUMENTS
Quotation, inspection report (all types), invoice, receipt, credit note, statement of account, inspector commission statement.
- A4, English only. Client names entered in Arabic must be transliterated/entered in English for PDFs (add an English-name field).
- Header: ARAL logo, company name, branch address, TRN (if VAT-registered), DET licence no., DLD/RERA registration no.
- Footer: contact details, "Page X of Y".
- T&Cs, addresses and disclaimers pulled from admin settings at generation time and frozen into the issued PDF.
- Bank clients: optional white-label header (bank's logo) for the buyer handover programme.

## 12. INVOICING & TAX
- **VAT switch:** the business must register for VAT once taxable supplies exceed AED 375,000. Admin setting: VAT registered (yes/no), TRN, effective date. Before registration, documents show "Invoice" with no VAT; after registration, they show "Tax Invoice / فاتورة ضريبية" with 5% VAT and all FTA-required fields.
- Invoice no. `INV-YYYY-#####`; supplier and customer details, supply date, lines, subtotal, VAT, total, amount in words (English).
- Per-job invoices for individuals; consolidated monthly invoices for corporate clients (list of jobs with bank reference nos.).
- Credit notes only; issued invoices can never be edited or deleted.
- Data model ready for structured export under the UAE e-invoicing mandate.
- Statement of account and receivables aging (0–30, 31–60, 61–90, 90+).

## 13. INSPECTOR COMMISSIONS & SUBCONTRACTORS
- Inspectors are outsourced: store their own trade licence / manpower supplier, agreement, insurance and expiry dates (block assignment when expired).
- Commission rule: default **42% of job fee (excl. VAT)**, overridable per inspector or service; optional performance bonus.
- Commission becomes payable when the report is issued **and** (for individuals) the job is paid.
- Monthly commission statement PDF per inspector; payout batch export for the Accountant.
- Specialist subcontractors (NDT, pool, waterproofing, drone): cost recorded per job.

## 14. EMAIL (Gmail)
- Gmail SMTP with an app password (as in Dar Al Bunyan); sender name "ARAL Property Inspection Service"; Settings → send test email.
- Admin-editable English email templates with variables (`{{client_name}}`, `{{job_no}}`, `{{quote_link}}`, `{{pay_link}}`, `{{inspection_date}}`, `{{report_link}}`…): request acknowledgement, quotation, quote reminder, payment receipt, inspection confirmation, access-failed notice, report issued, invoice, payment reminder, re-inspection due, valuation-pack delivered to partner.
- Attach relevant PDF; log every email; queue with retry; respect Gmail sending limits (personal Gmail ≈ 500/day — warn when near the limit).

## 15. ADMIN CONTROLS
- **Users:** create, disable, assign roles, reset password, enforce 2FA.
- **Company settings:** name, multiple branch addresses, DET licence no., DLD/RERA registration no., TRN, logo, bank details, signatures, PI insurance details.
- **Terms & Conditions:** rich-text editor (English), separate per document type (quote, report, invoice, booking), versioned with effective dates; each issued document records the T&C version used.
- **Catalogue & pricing:** services, size bands, add-ons, surcharges, discount limits, corporate rate cards.
- **Checklists:** create and edit inspection checklists and defect categories.
- **Numbering, VAT switch, quote validity, deposit %, reminder intervals, SLA targets.**
- **Lookups:** property types, communities, developers, purposes, banks.
- **Audit log:** user, action, entity, before/after, timestamp, IP; searchable and exportable.

## 16. DASHBOARD, KPIs & EXCEL EXPORT
- Dashboard: jobs by status, jobs this month vs. target (100/month by Month 12), revenue by segment (banks / owners / developers), receivables, SLA compliance %, average turnaround, inspector workload, equipment utilisation, review score (post-job survey), quote conversion rate, bookings by referral source.
- Every list: filters (date, status, service, segment, client, inspector), search, pagination, **Export to Excel** of the filtered result (formatted headers, frozen top row, AED number format, real date cells, Arabic preserved).
- Prebuilt exports: job register, SLA report per bank, quotations, invoices + VAT summary, payments, aging, inspector commissions, equipment calibration.

## 17. NON-FUNCTIONAL
- App screens: complete English/Arabic translation with toggle and RTL mirroring; no hard-coded strings. PDFs and emails: English.
- Security: OWASP Top 10, server-side input validation on every route, rate limiting, CSRF protection, secrets in env vars only, HTTPS, encrypted storage, signed, expiring file links.
- **UAE PDPL alignment:** data retention rules per record type, consent capture, client data export/delete on request, access logs. Bank information-security questionnaires should be answerable from this design (document it).
- Daily backups with restore test; soft delete on master data.
- Responsive; inspection app usable on a phone in the field.
- Tests with `node --test` (as in Dar Al Bunyan): unit tests for pricing, VAT switch, commission and the state machine; end-to-end test from booking to commission statement.

## 18. GITHUB & DEPLOYMENT
- Private GitHub repo `ananader1977/aral-inspection` (separate from Dar Al Bunyan).
- README in the same style as Dar Al Bunyan: features, roles table, quick start (`cp .env.example .env`, `npm start`, `npm test`), Render deploy steps, Gmail app-password steps, Google Drive steps, payments (demo → live), backups.
- `.env.example`, seeded accounts from env vars, seed data (service catalogue from Section 4, comment library, checklists, demo clients).
- GitHub Actions: run `npm test` on every push and pull request.
- Deploy: Render Blueprint (`render.yaml`), Starter plan (persistent disk needed) for the SQLite database.

## 19. DELIVERY PHASES (stop for approval after each)
1. ERD, report field-mapping table, wireframes of key screens (booking, inspection app, review, dashboard)
2. Auth, RBAC, admin settings, i18n/RTL foundation
3. Intake, pricing engine, quotation, PDF engine
4. Payments + Gmail integration
5. Scheduling, equipment, offline inspection app, reports, two-step review, QR verification
6. Invoicing, VAT switch, credit notes, commissions, corporate portal
7. Dashboard, KPIs, Excel exports
8. Tests, security review, CI/CD, deployment, user guide (English)

## ACCEPTANCE CRITERIA
- An individual job runs from public booking → card payment → inspection → review → issued report → receipt, with no manual DB edits.
- A bank job runs from bulk upload → inspection within SLA → issued report → monthly consolidated invoice.
- A Valuation-Support Pack reaches the partner valuer's portal; the app never shows a market value while `VALUATION_MODULE_ENABLED` is off.
- All PDFs render correctly in English; the app screens work fully in Arabic (RTL) and English.
- The inspection report matches the supplied sample field-for-field.
- Turning the VAT switch on changes new documents to Tax Invoice with 5% VAT; existing documents are unchanged.
- Admin adds a user, edits T&Cs and an address, and the change appears on the next generated PDF.
- Inspector commission statement equals 42% (or override) of eligible jobs.
- Every list exports correctly to Excel.
