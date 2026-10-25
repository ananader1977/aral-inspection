# Inspection report — field mapping (Phase 1, for approval)

Source: sample resale report (67 pages, IL Primo, Downtown). Structure is replicated; all fixed wording is A R A L's own, edited in **Admin → Content**.

Legend for **Source**: `DB` = typed by staff/inspector · `AUTO` = generated · `BLOCK` = admin text block (versioned) · `SET` = company settings · `LIB` = library pick.

## Every page

| Sample element | DB field | Source | PDF label / output |
|---|---|---|---|
| Header logo | `settings.brand_logo_file_id` | SET | A R A L logo (left) |
| Footer company + address | `settings.company_short` + `properties.building`, `unit_no`, `community` | AUTO | `A R A L  |  IL Primo, Unit 1205, Downtown` |
| "Page X of Y" | — | AUTO (2nd pass) | `Page 7 of 67` |
| "(continued)" | — | AUTO | `Air Conditioning (continued)` on spill-over pages |

## 1. Cover page

| Sample element | DB field | Source | PDF label |
|---|---|---|---|
| Company name | `settings.company_name` | SET | A R A L Property Inspection Services |
| Property line "IL Primo, Unit XXX, Downtown" | `properties.building`, `unit_no`, `community`, `emirate` | DB | Property |
| Report title | `reports.title` (default from `services.name`) | DB | e.g. Resale Inspection Report |
| Inspector "Ehab Farid, GTA INSPECTORS" | `inspectors.name`, `inspectors.credentials` | DB | Inspector |
| Cover photo | `reports.cover_media_id` | DB | — |
| *(new)* Client | `clients.name` | DB | Prepared for |
| *(new)* Inspection date | `reports.inspection_date` | DB | Inspection date |
| *(new)* Report no. / date | `reports.number`, `reports.issued_at` | AUTO | Report No. RPT-2026-00001 · Date |
| *(new)* QR verification | `reports.verify_token` | AUTO | QR + "Verify at aral…/v/…" |

## 2–4. Fixed text pages

| Sample section | DB field | Source |
|---|---|---|
| INTRODUCTION | `content_blocks[code='rpt_intro']` | BLOCK |
| WHAT WE INSPECT (incl. "material defect" definition) | `content_blocks[code='rpt_what_we_inspect']` | BLOCK |
| INSPECTION STANDARD FOLLOWED | `content_blocks[code='rpt_standards']` | BLOCK |

## 5. Table of contents

| Sample element | DB field | Source |
|---|---|---|
| Section name + page range ("Air Conditioning 7-10") | `report_sections.name` + page numbers from layout pass | AUTO |
| Glossary, Report Summary entries | — | AUTO |

## 6. General Information (numbered 1–7 in sample)

| # | Sample label | DB field | Source | Input on phone |
|---|---|---|---|---|
| 1 | Inspector | `jobs.inspector_id → inspectors.name` | DB | pre-filled |
| 2 | Persons in Attendance | `reports.persons_present` (JSON) | LIB | multi-select: Owner, Buyer, Seller, Agent, Tenant, Developer rep, None |
| 3 | Occupancy | `reports.occupancy` | LIB | Vacant / Occupied by owner / Tenanted / Furnished |
| 4 | Property Information | `properties.property_type` + `reports.property_note` | DB + LIB | type picks the standard note (e.g. condominium → owners association responsible for common areas) |
| 5 | Levels | `reports.levels` | DB | number |
| 6 | Estimated Age | `reports.estimated_age` | DB | text, default "Unable to determine" |
| 7 | Weather conditions | `reports.weather`, `reports.temperature_c` | DB | picklist + °C → "Temperature at the time of inspection was approximately 40 °C" |
| *(new)* | AC / DEWA connected | `reports.ac_connected`, `reports.dewa_connected` | DB | Yes/No |
| *(new)* | Time in / out | `reports.time_in`, `time_out` | AUTO | arrival tap + submit time |
| *(new)* | Equipment used | `reports.equipment_used` | DB | toolset with calibration date |

## 7. Understanding the report

| Sample element | DB field | Source | PDF output |
|---|---|---|---|
| Explanatory text | `content_blocks[code='rpt_understanding']` | BLOCK | — |
| BLUE comments = needs repair | `observations.severity='attention'` | DB | blue text `#0B4F8C` |
| RED comments = CRITICAL | `observations.severity='critical'` | DB | red text `#C62828` |
| *(new)* Informational | `observations.severity='info'` | DB | dark text |
| Condition symbols | legend | AUTO | 3 coloured markers |

## 8–9. System and area sections (the body)

**Section** (e.g. "Air Conditioning", "Master Bathroom")

| Sample element | DB field | Source |
|---|---|---|
| Section title | `report_sections.name` | LIB (from checklist, editable) |
| Section intro paragraph (AC, Electrical) | `report_sections.intro` ← `content_blocks[sec_intro_*]` | BLOCK |
| Order | `report_sections.sort` | AUTO from template, re-orderable |
| *(new)* No access | `report_sections.not_inspected_reason` | DB |
| Empty section | — | AUTO prints "No defects observed at the time of inspection." |

**Item** (numbered within section)

| Sample element | DB field | Source | Example |
|---|---|---|---|
| Item number | `report_items.sort` | AUTO | 2. |
| Item name | `report_items.name` | LIB | Shower Base Condition |
| Type / Materials / Location label | `report_items.attr_label` | LIB | Materials: |
| …value | `report_items.attr_value` | LIB / DB | Cultured Marble |

**Observation** (bullets under "Observations:")

| Sample element | DB field | Source | Example |
|---|---|---|---|
| Bullet text | `observations.text` | LIB / DB | "Improper slope observed in the shower area…" |
| Colour | `observations.severity` | DB | red / blue / dark |
| "Please get it checked through a licensed plumber" | `observations.trade` | LIB | appended sentence |
| Appears in Report Summary | `observations.in_summary` | DB | default on for red/blue |
| Glossary link (Hollow Sound…) | `observations.glossary_id` | LIB | adds term to glossary |
| *(new)* Responsible party | `observations.responsible` | DB | Developer (snagging) |
| *(new)* Re-inspection result | `observations.reinspect_status` | DB | Fixed / Not fixed |

**Photos & videos** (pages of images under each item)

| Sample element | DB field | Source | PDF output |
|---|---|---|---|
| Photos | `media(kind='photo', observation_id)` | Phone | 2 per row, caption below |
| Thermal images | `media(kind='thermal', pair_media_id, temp_min_c, temp_max_c)` | Phone/gallery | side by side with normal photo + °C |
| Videos ("as per video") | `media(kind='video')` | Phone | thumbnail + QR link to online report |
| Caption | `media.caption` | DB | below photo |
| Hide from PDF | `media.in_pdf` | DB | — |

## 10. Glossary

| Sample element | DB field | Source |
|---|---|---|
| Term / Definition / References | `glossary.term`, `definition`, `references_text` | LIB — only terms linked by observations in this report |

## 11. Report Summary

| Sample column | DB field | Source |
|---|---|---|
| Section heading | `report_sections.name` | AUTO |
| "Page 37" | page where the item starts | AUTO (layout pass) |
| "Item: 2 Shower Base Condition" | `report_items.sort`, `name` | AUTO |
| Bullet text (coloured) | `observations.text`, `severity` where `in_summary=1` | AUTO |
| Summary intro text | `content_blocks[code='rpt_summary_intro']` | BLOCK |

## 12–16. Closing pages

| Sample section | DB field | Source |
|---|---|---|
| REPORT CONCLUSION | `content_blocks[code='rpt_conclusion']` | BLOCK |
| TERMS AND CONDITIONS | `content_blocks` version linked in `agreements.tc_block_id` | BLOCK (lawyer-approved) |
| THERMAL IMAGING ADDENDUM | `content_blocks[code='rpt_thermal_addendum']`, printed if `reports.thermal_used=1` | BLOCK |
| *(new)* Sign-off | inspector + reviewer (`users.name`, `credentials`, `signature_file_id`), `reports.approved_at` | DB |
| Back page: thank you, address, phones, email, website | `settings.*`, default `branches` row | SET |

## Decisions for you

1. **Severity scale:** keep the sample's two colours (red Critical / blue Attention) plus a third "Informational"? *(Recommended — matches the sample, and "info" covers "sockets tested OK".)*
2. **Indicative repair cost** per observation: show on PDF or keep internal? *(Recommended: internal for resale, optional on snagging.)*
3. **Videos:** QR link to the online report page is the only way to "include" video in a PDF. OK?
4. **Report summary:** include all red + blue items (as in the sample), or red only?
