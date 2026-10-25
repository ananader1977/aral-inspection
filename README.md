# A R A L Property Inspection Services: Inspection Management App

Runs the inspection business end to end: request → quotation → agreement → card payment → scheduling → phone inspection with photos → technical review → English PDF report → invoice → inspector commission.

Built the same way as the Dar Al Bunyan app: Node.js 22 with the built-in SQLite database, plain HTML/CSS/JavaScript, no npm packages, Gmail for email, Google Drive for photos, a demo card checkout (Stripe-ready), Excel export, deployed on Render.

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Database design, report field mapping, screen layouts | Approved |
| 2 | Sign-in, roles, settings, users, terms, EN/AR screens | Done |
| 3–7 | Jobs, quotations, agreement, payments, scheduling and calendar, phone inspection app, review, PDF report, invoices, commissions, dashboard, exports | **Done, for review** |
| 8 | Lawyer-approved wording, Stripe live keys, Google Drive keys, user guide | Waiting for your inputs |

## Phase 1 documents

- `docs/requirements.md`: full requirements (the build prompt)
- `src/schema.sql`: database schema, 40 tables
- `docs/phase1/field-mapping.md`: every part of the sample report mapped to a database field
- `docs/phase1/review.html`: workflow, database diagram, screen and phone mockups, and open decisions (open in a browser)
- `public/brand/`: logo, icon mark, favicon

## What Phase 2 includes

- **Sign-in** with email and password. Super Admin, Admin coordinator, Technical Manager and Accountant must also use **two-step sign-in** (Google or Microsoft Authenticator). Inspectors can turn it on themselves.
- **Roles**, checked on the server for every request: Super Admin, Admin coordinator, Inspector, Technical Manager, Accountant (Client and Valuation partner portals come later).
- **Users:** add, edit, deactivate, reset password, reset two-step sign-in. The last Super Admin cannot be removed.
- **Company details:** licence and RERA numbers, contact details, VAT switch and TRN, bank details, document numbering, quotation and payment defaults, inspector commission, targets, brand colours.
- **Branch addresses**, with one marked as printed on documents.
- **Report & terms wording:** every text block is versioned with an effective date, so issued documents keep the wording they were issued with. Terms and the thermal addendum are loaded as **DRAFT** for your lawyer to replace.
- **Catalogue:** the 8 approved services (3 residential, 2 bank, 2 developer, thermal imaging add-on), prices by property type and bedrooms, picklists (communities, developers, banks, materials, trades…), valuation partners.
- **Field team:** inspectors (licence, insurance and agreement expiry are flagged) and equipment (calibration due dates).
- **Report content:** the residential checklist (sections and items from the sample report), a comment library of 26 ready-made findings, and a glossary.
- **Messages** (every email, with a "send me a test email" button) and an **audit log** of every sign-in and change.
- **Excel export** on every list.
- **English / Arabic screens** with right-to-left layout. PDFs and emails stay in English.
- **Dashboard** with a "before you go live" checklist and items expiring within 45 days.

## How a job runs

1. **Lead → job.** Website enquiries land in *Leads*; *Convert to job* (or *Jobs → + New job*) creates the client, property and job.
2. **Quotation.** *Prepare quotation* fills the lines from the price list (or the client's negotiated rate; developer services are priced per proposal). Discounts above 10% need the Super Admin. *Send quotation* emails the PDF and a secure link. Revisions are numbered `-R1`, `-R2`; unanswered quotations expire automatically.
3. **Client link.** The client accepts (or asks for a change / declines), then **signs the service agreement** online (typed name, optional drawn signature, time and IP recorded; signed PDF emailed), then **pays by card**. Bank and company clients on credit terms skip the payment step.
4. **Demo payments.** With `PAYMENT_PROVIDER=mock` the checkout is a demo page: card `4242 4242 4242 4242`, any future expiry, any CVC (`4000 0000 0000 0002` shows a decline). A receipt PDF is emailed. Switch to Stripe with `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (webhook URL `/api/public/stripe/webhook`).
5. **Scheduling.** *Schedule the inspection* shows who is free: inspectors with expired licence/insurance/agreement, double bookings and cameras out of calibration are blocked; services that need thermal imaging get a free thermal camera automatically. Client and inspector receive an email with a calendar invite (.ics).
6. **Calendar.** Week view (Mon–Sat, hour rows, Prev / Today / Next, colour legend, list on phones), filtered by inspector, as in the Consultancy app. *Subscribe in Outlook / Google* gives a private feed link for the office and one per inspector.
7. **Phone inspection.** Inspectors open the app on their phone (*Add to Home Screen*), press *I'm on site* (starts the report clock), and go room by room: the areas are built from the bedrooms and maid's room; findings come from the comment library or free text with severity Critical / Needs attention / For information; photos (camera or gallery, marked with arrows, circles, boxes or text), thermal images with min/max °C, and videos up to 60 s. **Everything is saved on the phone first and sent when there is signal.**
8. **Review.** *Submit for review* checks the basics (date, time, a photo on every critical finding). The Technical Manager can correct, return with comments, approve, then **issue**: the report gets its `RPT-` number, the PDF is stored as an unchangeable version, and the client gets the PDF plus the online report link (with videos and a star rating).
9. **Invoice and commission.** Issuing invoices the job (advance payments are applied, so paid jobs close at once). Banks/companies set to *monthly invoicing* get one invoice per month listing each report with its bank reference. Credit notes, part payments, aging, overdue reminders and the inspector's 42% commission (statement PDF, mark as paid) are under *Finance*.
10. **Attachments.** On the report (phone or office) *Add attachment* takes PDF, JPEG or PNG files up to 20 MB: lab results, floor plans, DEWA bills, the developer snag list. They are numbered A1, A2… and listed in the contents. Images get a full page in the report appendix; PDFs get a QR code and link. All of them go with the report email (up to 15 MB in total) and can be downloaded from the online report. You can choose, per attachment, whether it is printed and whether it is emailed.
11. **AI suggestions (optional).** A ✨ button under item photos and in the finding window: the AI reads the item's photos (up to 4) with the room, the item and A R A L's own wording, and suggests up to three findings with severity, trade and confidence. The inspector picks one, edits it and saves; nothing goes into the report without the inspector. Every use is in the audit log.
    - **Provider setting `AI_PROVIDER`:** `gemini` (Google, free tier; key `GEMINI_API_KEY` from aistudio.google.com; default model `gemini-3.5-flash-lite`) or `claude` (Anthropic, paid; key `ANTHROPIC_API_KEY`; default model `claude-sonnet-5-5`). `AI_MODEL` overrides the model. With no key the buttons are hidden.
    - **Gemini free tier:** Google may use what is sent to improve its products, and there are daily and per-minute limits (the app shows "free AI limit reached" when hit). Use a paid tier or Claude before sending client photos if that is not acceptable.
12. **Re-inspection.** *Book a re-inspection* creates a linked job whose report starts with the open findings, each marked Fixed / Partly fixed / Not fixed.

The **report PDF** follows the approved sample structure: cover with photo and verification QR, introduction, scope, standards, contents with page numbers, general information, colour legend, numbered sections and items with photos two per row (videos as a preview + QR to play online), glossary, summary with page numbers, conclusion, terms, thermal addendum, sign-off and back page. The footer reads `A R A L | building, unit, community` with *Page X of Y*.

**Excel exports:** jobs, SLA by client, quotations, invoices (with a VAT summary sheet), payments, aging, commissions, equipment calibration, clients, leads, plus every settings list.

**Photos and videos** go to Google Drive (`ARAL Jobs / JOB-… – building unit / photos | videos | pdf`) when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN` are set; otherwise to the server disk.

## Quick start (your computer)

```bash
cp .env.example .env      # set SUPERADMIN_PASSWORD (and SEED_DEMO=true to get demo users)
npm start                 # http://localhost:3000
npm test                  # automated tests
```

Needs Node.js 22.13 or later. There are no npm packages to install.

On the first sign-in as Super Admin you are asked to set up two-step sign-in: install Google Authenticator, choose "Enter a setup key", type the key shown, then the 6-digit code.

## Put it online (Render)

1. In Render: **New → Blueprint**, pick `ananader1977/aral-inspection`. `render.yaml` sets up the Starter plan with a 1 GB disk for the database.
2. Fill in `BASE_URL` (e.g. `https://aral-inspection.onrender.com`), `SUPERADMIN_PASSWORD`, `DEMO_PASSWORD` and `SMTP_PASS`.
3. Open the site and sign in with ananader1@gmail.com.

`SEED_DEMO=true` adds four demo users (admin.demo@, inspector.demo@, tm.demo@, accounts.demo@aral.example, all with `DEMO_PASSWORD`) plus demo inspectors and equipment. Set it to `false` and deactivate the demo users before real use.

## Gmail (ananader1@gmail.com)

1. Google Account → Security → turn on **2-Step Verification**.
2. Google Account → Security → **App passwords** → create one called "A R A L app".
3. Put the 16 letters in `SMTP_PASS` on Render.
4. In the app: **Settings → Messages → Send me a test email**.

Gmail allows about 500 emails a day from a normal account.
