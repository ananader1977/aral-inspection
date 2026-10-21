# ARAL Property Inspection Service: Inspection Management App

Runs the inspection business end to end: request → quotation → agreement → card payment → scheduling → phone inspection with photos → technical review → English PDF report → invoice → inspector commission.

Built the same way as the Dar Al Bunyan app: Node.js 22 with the built-in SQLite database, plain HTML/CSS/JavaScript, no npm packages, Gmail for email, Google Drive for photos, a demo card checkout (Stripe-ready), Excel export, deployed on Render.

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Database design, report field mapping, screen layouts | **For approval** |
| 2 | Sign-in, roles, settings, users, terms, EN/AR screens | Next |
| 3 | Requests, pricing, quotations, PDF engine | |
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
