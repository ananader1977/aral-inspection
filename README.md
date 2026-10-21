# ARAL Property Inspection Service: Inspection Management App

Runs the inspection business end to end: request → quotation → agreement → card payment → scheduling → phone inspection with photos → technical review → English PDF report → invoice → inspector commission.

Built the same way as the Dar Al Bunyan app: Node.js 22 with the built-in SQLite database, plain HTML/CSS/JavaScript, no npm packages, Gmail for email, Google Drive for photos, a demo card checkout (Stripe-ready), Excel export, deployed on Render.

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Database design, report field mapping, screen layouts | Approved |
| 2 | Sign-in, roles, settings, users, terms, EN/AR screens | **Done, for review** |
| 3 | Requests, pricing, quotations, PDF engine | Next |
| 4 | Agreement, demo card payments, Gmail | |
| 5 | Scheduling, phone inspection app, photos, report, review, QR | |
| 6 | Invoices, VAT switch, credit notes, commissions, client portal | |
| 7 | Dashboard, KPIs, Excel exports | |
| 8 | Tests, security review, deployment, user guide | |

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
- **Catalogue:** 15 services from the business plan, prices by property type and bedrooms, surcharges, picklists (communities, developers, banks, materials, trades…), valuation partners.
- **Field team:** inspectors (licence, insurance and agreement expiry are flagged) and equipment (calibration due dates).
- **Report content:** the residential checklist (sections and items from the sample report), a comment library of 26 ready-made findings, and a glossary.
- **Messages** (every email, with a "send me a test email" button) and an **audit log** of every sign-in and change.
- **Excel export** on every list.
- **English / Arabic screens** with right-to-left layout. PDFs and emails stay in English.
- **Dashboard** with a "before you go live" checklist and items expiring within 45 days.

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
2. Google Account → Security → **App passwords** → create one called "ARAL app".
3. Put the 16 letters in `SMTP_PASS` on Render.
4. In the app: **Settings → Messages → Send me a test email**.

Gmail allows about 500 emails a day from a normal account.
