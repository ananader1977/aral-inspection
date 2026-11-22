// Reference data loaded on first start: service catalogue, prices, picklists, report wording (draft),
// checklists, comment library and glossary. Everything here can be edited in Settings afterwards.
import { NEW_BLOCKS } from './blocks.js';
import crypto from 'node:crypto';
import { tx } from './db.js';
import { hashPassword } from './auth.js';

const SERVICES = [
  // code, name, segment, report_type, addon, reinspection, sla_h, thermal, sort
  ['OWN-PPI', 'Resale (Pre-purchase) Inspection', 'owner', 'pre_purchase', 0, 1, 24, 1, 1],
  ['OWN-SNG', 'Snagging & Handover Inspection', 'owner', 'snagging', 0, 1, 48, 1, 2],
  ['OWN-MIO', 'Move-in / Move-out Condition Report', 'owner', 'move_in_out', 0, 0, 24, 0, 3],
  ['BNK-REP', 'Repossessed / Distressed Asset Inspection', 'bank', 'repossessed', 0, 0, 48, 0, 10],
  ['BNK-HND', 'Buyer Handover Programme (white-label snagging)', 'bank', 'snagging', 0, 1, 72, 1, 11],
  ['DEV-PHQ', 'Pre-handover Quality Check', 'developer', 'snagging', 0, 0, 120, 1, 20],
  ['DEV-DPT', 'Defect-period Tracking', 'developer', 'snagging', 0, 0, 120, 0, 21],
  ['ADD-THM', 'Add-on: Thermal Imaging', 'any', 'specialist', 1, 0, 24, 1, 30],
];

// Base prices (AED, excl. VAT) by service, property type and bedrooms. Developer services are priced per proposal.
const PRICES = [
  ['OWN-PPI', 'apartment', 0, 0, 1200], ['OWN-PPI', 'apartment', 1, 1, 1500], ['OWN-PPI', 'apartment', 2, 2, 1700], ['OWN-PPI', 'apartment', 3, 3, 1860], ['OWN-PPI', 'apartment', 4, 9, 2300],
  ['OWN-PPI', 'townhouse', 0, 9, 2500], ['OWN-PPI', 'villa', 0, 4, 3000], ['OWN-PPI', 'villa', 5, 9, 3500],
  ['OWN-SNG', 'apartment', 0, 0, 1200], ['OWN-SNG', 'apartment', 1, 1, 1400], ['OWN-SNG', 'apartment', 2, 2, 1800], ['OWN-SNG', 'apartment', 3, 9, 2400],
  ['OWN-SNG', 'townhouse', 0, 9, 3000], ['OWN-SNG', 'villa', 0, 4, 4500], ['OWN-SNG', 'villa', 5, 9, 6000],
  ['OWN-MIO', 'apartment', 0, 1, 900], ['OWN-MIO', 'apartment', 2, 9, 1300], ['OWN-MIO', 'villa', 0, 9, 2200], ['OWN-MIO', 'townhouse', 0, 9, 1800],
  ['BNK-REP', '*', null, null, 1300], ['BNK-HND', '*', null, null, 2000],
  ['ADD-THM', '*', null, null, 500],
];

const SURCHARGES = [];

const LOOKUPS = {
  property_type: ['studio', 'apartment', 'townhouse', 'villa', 'penthouse', 'office', 'retail', 'warehouse', 'building', 'land'],
  purpose: ['Resale purchase', 'Handover from developer', 'Mortgage / refinance', 'Tenancy start', 'Tenancy end', 'Warranty claim', 'Insurance', 'Other'],
  community: ['Downtown Dubai', 'Business Bay', 'Dubai Marina', 'JLT', 'JVC', 'Dubai Hills Estate', 'Arabian Ranches', 'Palm Jumeirah', 'Dubai Creek Harbour', 'IMPZ (Dubai Production City)', 'Dubailand', 'International City', 'Sobha Hartland', 'Al Furjan', 'Town Square', 'Damac Hills', 'MBR City', 'Jumeirah Golf Estates'],
  developer: ['Emaar', 'Nakheel', 'Damac', 'Sobha', 'Meraas', 'Dubai Properties', 'Azizi', 'Ellington', 'Binghatti', 'Danube', 'Reportage', 'Select Group', 'Omniyat'],
  bank: ['Emirates NBD', 'ADCB', 'FAB', 'Mashreq', 'Dubai Islamic Bank', 'ADIB', 'RAKBANK', 'CBD', 'HSBC', 'Standard Chartered'],
  material: ['Tile', 'Ceramic tile', 'Porcelain', 'Marble', 'Marble/Porcelain', 'Cultured marble', 'Granite', 'Wood', 'Laminate', 'Gypsum', 'Painted plaster', 'Aluminium', 'uPVC', 'Glass', 'Galvanized', 'Copper', 'PPR', 'Breakers', 'Chrome fittings'],
  trade: ['licensed HVAC contractor', 'licensed electrician', 'licensed plumber', 'qualified contractor', 'qualified carpenter', 'qualified painter', 'licensed mould remediation specialist', 'waterproofing specialist', 'glazing contractor'],
  attendance: ['Owner', 'Buyer', 'Seller', 'Agent', 'Tenant', 'Landlord', 'Developer representative', 'None'],
  occupancy: ['Vacant', 'Occupied by owner', 'Tenanted', 'Furnished, vacant'],
  weather: ['Sunny', 'Hot and humid', 'Cloudy', 'Rain', 'Dusty / windy'],
  lost_reason: ['High Price', 'Customer Not Interested', 'Out of area', 'Timing', 'Valuation only (referred to partner)', 'No response', 'Chose a competitor'],
  referral_source: ['Website', 'Google', 'Instagram', 'WhatsApp', 'Broker / agent', 'Bank', 'Repeat client', 'Friend / referral'],
};

// Report and quotation wording. A R A L's own text, marked DRAFT where a lawyer should approve it.
const OLD_BLOCKS = [
  ['rpt_intro', 'Introduction', `Thank you for choosing A R A L. Please read the whole report, then call us with any questions. We stay available to you until your purchase or handover is complete.

A property does not "pass" or "fail" an inspection. This report lists the conditions we saw on the day of the visit so that you can ask the developer, seller or landlord to fix them, or take them into account in your decision.

We recommend that licensed professionals assess and repair the items we mark as critical. The report describes the property at the time of the inspection only, so please do a final walk-through before you sign, using this report as your checklist.`],
  ['rpt_what_we_inspect', 'What we inspect', `Our inspection is a visual, non-invasive examination of the parts of the property that are safely accessible on the day. We look at the structure, finishes, doors and windows, electrical, plumbing, air conditioning and other systems agreed with you before the visit.

We do not open walls, lift fixed flooring, move furniture or dismantle equipment. Some defects may therefore be hidden.

A material defect is a condition that would significantly affect the value of the property or create an unreasonable risk to people. An item that is old or near the end of its normal life is not a material defect on that basis alone.`],
  ['rpt_standards', 'Inspection standards followed', `We check the property against the installation requirements of the UAE authorities that apply to it, including Dubai Municipality, DEWA, Dubai Civil Defence and Trakhees, and against RERA guidance.

Our method follows the InterNACHI Standards of Practice for home inspection. For air conditioning we refer to ASHRAE guidance, and for fire and life safety to NFPA standards, as far as they are consistent with UAE regulations.`],
  ['rpt_understanding', 'Understanding the report', `Findings are written in colour:

RED: critical. A safety risk, or a defect that significantly affects the value of the property. Act on these first.
BLUE: needs attention. Repair, adjust or replace.
BLACK: for your information. Tested and working, or a note about the property.

If a room or system has no findings, nothing needing attention was seen there on the day. The Report Summary at the end lists the red and blue findings with their page numbers.`],
  ['rpt_summary_intro', 'Report summary', `This summary lists the findings that need your attention. It does not replace the full report, which contains the photos and details for each item. All repairs should be carried out by licensed and qualified professionals, and we recommend keeping receipts, warranties and permits for the work.`],
  ['rpt_conclusion', 'Report conclusion', `We hope this report gives you a clear picture of the property's condition. Because the inspection is visual, some defects may be hidden or may develop after our visit, and not every outlet, window or door may have been tested where access was limited.

This report is not a warranty or guarantee of the property's future condition. We recommend keeping suitable property insurance in place.`],
  ['rpt_thermal_addendum', 'Thermal imaging addendum', `DRAFT: wording to be approved by A R A L's legal adviser.

Thermal imaging shows surface temperature differences. These can point to moisture, air leaks, missing insulation or overheating electrical parts. A thermal camera is not a moisture meter and cannot see through walls; it shows where further investigation may be needed. Thermal findings are limited to the areas scanned and the conditions on the day of the inspection.`],
  ['tc_report', 'Terms and conditions (report)', `DRAFT: these terms are placeholders and must be replaced by text approved by A R A L's legal adviser before the first client report is issued.

1. The inspection was visual and carried out under the signed service agreement.
2. The report is for the client named on the cover. Others who rely on it do so at their own risk.
3. A R A L does not carry out engineering, architectural or other licensed design work under this inspection.
4. Environmental testing (mould sampling, asbestos, radon, soil) is excluded unless agreed in writing.
5. Any claim must be notified in writing within the period stated in the service agreement.`],
  ['tc_quote', 'Terms and conditions (quotation)', `DRAFT: to be approved by A R A L's legal adviser.

1. Fees are in UAE dirhams. VAT is added where applicable.
2. Payment is due in full before the inspection unless agreed otherwise.
3. Air conditioning and DEWA must be connected on the day for a full inspection.
4. The report is delivered within the stated time after the inspection.
5. Rescheduling with less than 24 hours' notice may be charged.`],
  ['tc_booking', 'Service agreement', `DRAFT: to be reviewed and approved by A R A L's legal adviser before use with clients.

1. Service. A R A L Property Inspection Services ("A R A L") will carry out the inspection described in the accepted quotation at the property named in it, and deliver a written report within the stated time after the inspection.

2. Nature of the inspection. The inspection is visual and non-invasive. It covers the parts of the property that are safely accessible on the day. A R A L does not open walls, lift fixed floors, move furniture or dismantle equipment. It is not a valuation, a structural engineering assessment, a survey of boundaries or a guarantee of the property's future condition.

3. Access and site conditions. The client arranges access to the whole property on the agreed date, with air conditioning and DEWA services connected. If A R A L cannot get access, or services are not connected, the affected areas are reported as not inspected and a further visit may be charged.

4. Fees and payment. The fee is shown in the quotation. Unless credit terms were agreed in writing, the fee is paid in full before the inspection. VAT is added where it applies.

5. Rescheduling and cancellation. The client may reschedule or cancel free of charge up to 24 hours before the visit. Later changes, or a visit where access fails, may be charged as set out in the quotation.

6. The report. The report is prepared for the client named in it and for the purpose stated. Others who rely on it do so at their own risk. The report reflects the condition seen on the day of the inspection only.

7. Liability. A R A L carries out the inspection with reasonable skill and care. A R A L's total liability arising from the inspection is limited to the fee paid, except where the law does not allow such a limit.

8. Claims. Any concern about the report must be raised in writing within 30 days of the report date, and A R A L must be given the chance to revisit the property before any repair is carried out.

9. Photos and data. A R A L may take photos and videos of the property for the report. Personal data is used only to provide the service and is kept securely.

10. Governing law. This agreement is governed by the laws of the Emirate of Dubai and the federal laws of the United Arab Emirates.`],
  ['tc_invoice', 'Invoice notes', `Thank you for your business. Please quote the invoice number with your payment.`],
  ['qt_cover_letter', 'Quotation cover letter', `Dear {{client_name}},

Thank you for the opportunity to inspect your property. We deliver an independent, unbiased assessment so that you can decide with confidence before handover or purchase.

Please review the proposal below. Once you accept it, you will receive the service agreement to sign, and we will then book your inspection.`],
  ['sec_intro_air_conditioning', 'Air Conditioning (section intro)', `The air conditioning system keeps the property cool and ventilated. We run the system from its controls and check each outlet for cooling, airflow, noise, leaks and condensate drainage. A licensed HVAC contractor should carry out any detailed servicing.`],
  ['sec_intro_electrical', 'Electrical (section intro)', `We inspect the visible parts of the electrical installation: the distribution board, breakers and residual-current device (RCD), and a representative number of sockets, switches and light fittings. Sockets are tested for correct wiring and earthing. Electrical findings can be safety risks and should be repaired by a licensed electrician.`],
  ['sec_intro_water_heater', 'Water Heater (section intro)', `We check the water heater, its supply and outlet pipes, valves and the hot water temperature at the taps.`],
];
// Wording from the scope-of-service review lives in blocks.js; it replaces the older text of the same code.
// One intro for Property Services: the old AC, Electrical and Water Heater intros together.
const SERVICES_INTRO = ['sec_intro_property_services', 'Property Services (section intro)', OLD_BLOCKS.filter(([c]) => /^sec_intro_(air|electrical|water)/.test(c)).map((b) => b[2]).join('\n\n')];
const BLOCKS = [...OLD_BLOCKS.filter(([c]) => !NEW_BLOCKS.some(([n]) => n === c)), ...NEW_BLOCKS, SERVICES_INTRO];

// Checklist for apartments and villas: sections and the items inside them.
const ITEMS = {
  floor: ['Floor Condition', 'Materials', 'material'], walls: ['Walls Condition', 'Materials', 'material'], ceiling: ['Ceiling Condition', null, null],
  doors: ['Door Condition', 'Materials', 'material'], windows: ['Window Condition', 'Materials', 'material'], electrical: ['Electrical Condition', null, null],
  comments: ['Comments', null, null], location: ['Location', 'Location', null], counters: ['Counters/Cabinets Condition', 'Materials', 'material'],
  sink: ['Sink Condition', null, null], sinkfaucet: ['Sink Faucet Condition', null, null], shower: ['Shower Faucet Condition', null, null],
  showerbase: ['Shower Base Condition', 'Materials', 'material'], drains: ['Traps/Drains/Supply Condition', null, null], toilet: ['Toilet Condition', null, null],
};
// System sections have their own items and picklists (no floor / wall / tile items here).
export const SYSTEM_ITEMS = {
  'Air Conditioning': [
    ['AC System Type', 'Type', 'ac_type'], ['Thermostats and Controls', null, null], ['Cooling Performance (supply air temperature)', null, null],
    ['Air Outlets and Return Grilles', null, null], ['Indoor Units / Fan Coil Units', 'Location', null], ['Condensate Drain and Drip Tray', null, null],
    ['Filters', null, null], ['Visible Ductwork and Insulation', null, null], ['Outdoor / Condensing Units', 'Location', null], ['Air Conditioning Comments', null, null],
  ],
  Electrical: [
    ['Main Service Condition', 'Type', 'electrical_service'], ['Distribution Board Condition', 'Location', null], ['Breakers and RCD Protection', 'Type', 'protection_device'],
    ['Sockets and Switches (sample tested)', null, null], ['Earthing and Bonding', null, null], ['Lighting', null, null], ['Electrical Comments', null, null],
  ],
  'Water Heater': [
    ['Water Heater Type', 'Type', 'water_heater_type'], ['Water Heater Condition', 'Location', null], ['Hot Water Temperature', null, null],
    ['Supply Lines Condition', 'Materials', 'pipe_material'], ['Pressure / Temperature Relief Valve', null, null], ['Water Heater Room Comments', null, null],
  ],
};
// Rooms come first; inside each room the items are grouped by system (Civil, AC, Plumbing, Electrical).
export const GROUPS = ['Civil', 'Air Conditioning', 'Plumbing', 'Electrical', 'General'];
const GRP = {};
for (const [g, names] of Object.entries({
  Civil: ['Location', 'Floor Condition', 'Walls Condition', 'Ceiling Condition', 'Door Condition', 'Window Condition', 'Counters/Cabinets Condition'],
  'Air Conditioning': ['AC System Type', 'Thermostats and Controls', 'Cooling Performance (supply air temperature)', 'Air Outlets and Return Grilles', 'Indoor Units / Fan Coil Units', 'Condensate Drain and Drip Tray', 'Filters', 'Visible Ductwork and Insulation', 'Outdoor / Condensing Units', 'Exhaust Fan / Ventilation'],
  Plumbing: ['Sink Condition', 'Sink Faucet Condition', 'Shower Faucet Condition', 'Shower Base Condition', 'Traps/Drains/Supply Condition', 'Toilet Condition', 'Water Heater Type', 'Water Heater Condition', 'Hot Water Temperature', 'Supply Lines Condition', 'Pressure / Temperature Relief Valve'],
  Electrical: ['Electrical Condition', 'Main Service Condition', 'Distribution Board Condition', 'Breakers and RCD Protection', 'Sockets and Switches (sample tested)', 'Earthing and Bonding', 'Lighting'],
})) for (const n of names) GRP[n] = g;
export const groupOf = (name) => GRP[name] || 'General';
// checked in every room, so they leave the whole-property section
const ROOM_LEVEL = new Set(['Thermostats and Controls', 'Cooling Performance (supply air temperature)', 'Air Outlets and Return Grilles', 'Air Conditioning Comments', 'Electrical Comments', 'Water Heater Room Comments']);
const SERVICE_ITEMS = [...Object.values(SYSTEM_ITEMS).flat().filter(([n]) => !ROOM_LEVEL.has(n)), ['Comments', null, null]];
const ROOM_AC = [['Cooling Performance (supply air temperature)', null, null], ['Air Outlets and Return Grilles', null, null], ['Thermostats and Controls', null, null]];
const BATH_AC = [['Exhaust Fan / Ventilation', null, null]];

const SYSTEM_LOOKUPS = {
  ac_type: ['Split units', 'Ducted split', 'Chilled water fan coil units (district cooling)', 'VRF / VRV', 'Package unit', 'Window unit'],
  electrical_service: ['DEWA meter, underground supply', 'Building main distribution (apartment)', 'Sub-meter'],
  protection_device: ['MCB', 'RCBO', 'RCD / ELCB', 'MCCB'],
  water_heater_type: ['Electric storage (geyser)', 'Central / district hot water', 'Solar water heater', 'Instant electric', 'Heat pump'],
  pipe_material: ['PPR', 'Copper', 'PEX', 'Galvanized', 'CPVC', 'Multilayer (PEX-AL-PEX)'],
};
const SYSTEM_COMMENTS = [
  ['Cooling Performance (supply air temperature)', 'Supply air temperature is higher than expected (above 16 °C at the outlet) and the room does not cool properly. The unit should be serviced and the refrigerant charge checked.', 'critical', 'licensed HVAC contractor'],
  ['Cooling Performance (supply air temperature)', 'Supply air temperature measured within the normal range at the outlets tested.', 'info', ''],
  ['Thermostats and Controls', 'The thermostat does not respond, or the set temperature is not reached. The controls should be checked.', 'attention', 'licensed HVAC contractor'],
  ['Air Outlets and Return Grilles', 'Dust and dirt on the air outlets and grilles. Cleaning is recommended.', 'attention', 'licensed HVAC contractor'],
  ['Air Outlets and Return Grilles', 'Condensation dripping from the air outlet, as shown in the photo.', 'critical', 'licensed HVAC contractor'],
  ['Indoor Units / Fan Coil Units', 'Unusual noise or vibration from the indoor unit while running.', 'attention', 'licensed HVAC contractor'],
  ['Condensate Drain and Drip Tray', 'Water in the drip tray is not draining. The condensate line may be blocked, which can cause leaks into the ceiling.', 'critical', 'licensed HVAC contractor'],
  ['Filters', 'Filters are dirty and should be cleaned or replaced.', 'attention', 'licensed HVAC contractor'],
  ['Visible Ductwork and Insulation', 'Damaged or missing insulation on the visible duct or pipe, which can cause condensation.', 'attention', 'licensed HVAC contractor'],
  ['Outdoor / Condensing Units', 'Corrosion on the outdoor unit casing and pipe connections.', 'attention', 'licensed HVAC contractor'],
  ['Distribution Board Condition', 'Circuits in the distribution board are not labelled. Labelling is recommended.', 'attention', 'licensed electrician'],
  ['Distribution Board Condition', 'The distribution board cover is missing or not fixed, leaving live parts exposed.', 'critical', 'licensed electrician'],
  ['Breakers and RCD Protection', 'The RCD did not trip when tested. The circuit has no working protection against electric shock.', 'critical', 'licensed electrician', 'RCD'],
  ['Breakers and RCD Protection', 'The RCD tripped correctly when tested.', 'info', '', 'RCD'],
  ['Sockets and Switches (sample tested)', 'A sample of sockets was tested and found correctly wired.', 'info', ''],
  ['Earthing and Bonding', 'No earth detected at the socket tested.', 'critical', 'licensed electrician'],
  ['Lighting', 'Light fittings not working in this area. Bulbs or fittings should be replaced.', 'attention', 'licensed electrician'],
  ['Water Heater Condition', 'Rust and water stains at the water heater connections, indicating a slow leak.', 'attention', 'licensed plumber'],
  ['Hot Water Temperature', 'Hot water temperature at the taps is below the recommended level.', 'attention', 'licensed plumber', 'Hot water below standard'],
  ['Pressure / Temperature Relief Valve', 'The relief valve drain is not connected to a drain point.', 'attention', 'licensed plumber'],
];

/** Puts the proper system items in place on databases created before they existed (keeps everything else). */
/** Existing systems: lost reasons "High Price" (was "Price") and "Customer Not Interested". Runs once. */
export function upgradeLookups(db) {
  if (db.prepare("SELECT value FROM settings WHERE key='_lookups_version'").get()?.value === '2') return false;
  tx(db, () => {
    const has = (v) => db.prepare("SELECT 1 FROM lookups WHERE list='lost_reason' AND value=?").get(v);
    if (has('Price') && !has('High Price')) db.prepare("UPDATE lookups SET value='High Price' WHERE list='lost_reason' AND value='Price'").run();
    db.prepare("UPDATE leads SET lost_reason='High Price' WHERE lost_reason='Price'").run();
    const ins = db.prepare("INSERT INTO lookups(list,value,sort) SELECT 'lost_reason',?,? WHERE NOT EXISTS (SELECT 1 FROM lookups WHERE list='lost_reason' AND value=?)");
    ins.run('High Price', 0, 'High Price');
    ins.run('Customer Not Interested', 1, 'Customer Not Interested');
    db.prepare("INSERT INTO settings(key,value) VALUES('_lookups_version','2') ON CONFLICT(key) DO UPDATE SET value='2'").run();
  });
  return true;
}

/**
 * Existing systems: puts the new report / quotation / agreement wording in place as a NEW VERSION of each block
 * (old versions stay, so signed agreements and issued reports keep the wording they were made with).
 * A block that someone at A R A L has already edited by hand is left alone. Runs once.
 */
export function upgradeBlocks(db, now) {
  if (db.prepare("SELECT value FROM settings WHERE key='_blocks_version'").get()?.value === '3') return 0;
  let n = 0;
  tx(db, () => {
    const today = new Date(now()).toISOString().slice(0, 10);
    for (const [code, title, body] of NEW_BLOCKS) {
      const last = db.prepare('SELECT * FROM content_blocks WHERE code=? ORDER BY version DESC LIMIT 1').get(code);
      if (last && (last.created_by || last.body === body)) continue;
      db.prepare('INSERT INTO content_blocks(code,version,title,body,effective_from,created_at) VALUES(?,?,?,?,?,?)').run(code, (last?.version || 0) + 1, title, body, today, now());
      n++;
    }
    db.prepare("INSERT INTO settings(key,value) VALUES('_blocks_version','3') ON CONFLICT(key) DO UPDATE SET value='3'").run();
  });
  return n;
}

export function upgradeChecklists(db, now) {
  const done = db.prepare("SELECT value FROM settings WHERE key='_checklist_version'").get()?.value;
  if (Number(done) >= 2) return false;
  tx(db, () => {
    const lk = db.prepare('INSERT INTO lookups(list,value,sort) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM lookups WHERE list=? AND value=?)');
    for (const [list, values] of Object.entries(SYSTEM_LOOKUPS)) values.forEach((v, i) => lk.run(list, v, i, list, v));
    const gid = (term) => (term ? db.prepare('SELECT id FROM glossary WHERE term=?').get(term)?.id ?? null : null);
    for (const [item, text, sev, trade, term] of SYSTEM_COMMENTS) {
      if (!db.prepare('SELECT 1 FROM comment_library WHERE item_name=? AND text=?').get(item, text)) db.prepare('INSERT INTO comment_library(item_name,text,default_severity,default_trade,glossary_id) VALUES(?,?,?,?,?)').run(item, text, sev, trade, gid(term));
    }
    // old comments that were filed under the old system items move to the new ones
    db.prepare("UPDATE comment_library SET item_name='Breakers and RCD Protection' WHERE item_name='Electrical Panel Condition'").run();
    db.prepare("UPDATE comment_library SET item_name='Cooling Performance (supply air temperature)' WHERE item_name='Air Conditioning Comments' AND text LIKE 'No cold air%'").run();
    for (const [secName, items] of Object.entries(SYSTEM_ITEMS)) {
      for (const st of db.prepare("SELECT id FROM section_templates WHERE name=? AND kind='system'").all(secName)) {
        db.prepare('DELETE FROM item_templates WHERE section_template_id=?').run(st.id);
        items.forEach(([n, a, l], i) => db.prepare('INSERT INTO item_templates(section_template_id,name,attr_label,attr_list,sort) VALUES(?,?,?,?,?)').run(st.id, n, a, l, i + 1));
      }
      // reports not yet issued: rebuild the system section when no finding has been recorded in it
      for (const sec of db.prepare("SELECT s.id FROM report_sections s JOIN reports r ON r.id=s.report_id WHERE s.name=? AND s.kind='system' AND r.status IN ('draft','returned')").all(secName)) {
        if (db.prepare('SELECT COUNT(*) n FROM observations o JOIN report_items it ON it.id=o.item_id WHERE it.section_id=?').get(sec.id).n) continue;
        db.prepare('DELETE FROM report_items WHERE section_id=?').run(sec.id);
        items.forEach(([n, a, l], i) => db.prepare('INSERT INTO report_items(section_id,name,attr_label,attr_list,attr_value,sort) VALUES(?,?,?,?,?,?)').run(sec.id, n, a, l, '', i + 1));
      }
    }
    // room items: materials picklist only where it makes sense
    db.prepare("UPDATE item_templates SET attr_list='material' WHERE attr_label='Materials' AND (attr_list IS NULL OR attr_list='') AND name NOT IN ('Supply Lines Condition')").run();
    db.prepare("INSERT INTO settings(key,value) VALUES('_checklist_version','2') ON CONFLICT(key) DO UPDATE SET value='2'").run();
  });
  return true;
}

/** Property Services gets the AC, Electrical and Water Heater intro text, in checklists and in reports not yet issued. Runs once. */
export function addServicesIntro(db, now) {
  if (db.prepare("SELECT 1 FROM settings WHERE key='_services_intro'").get()) return 0;
  let n = 0;
  tx(db, () => {
    const [code, title, body] = SERVICES_INTRO;
    if (!db.prepare('SELECT 1 FROM content_blocks WHERE code=?').get(code))
      db.prepare('INSERT INTO content_blocks(code,version,title,body,effective_from,created_at) VALUES(?,?,?,?,?,?)').run(code, 1, title, body, new Date(now()).toISOString().slice(0, 10), now());
    db.prepare("UPDATE section_templates SET intro_block_code=? WHERE name='Property Services' AND intro_block_code IS NULL").run(code);
    n = Number(db.prepare("UPDATE report_sections SET intro=? WHERE name='Property Services' AND COALESCE(intro,'')='' AND report_id IN (SELECT id FROM reports WHERE status NOT IN ('issued','superseded'))").run(body).changes);
    db.prepare("INSERT INTO settings(key,value) VALUES('_services_intro','1')").run();
  });
  return n;
}

/**
 * Existing systems: the report is organised room by room. Each room gets Civil / Air Conditioning / Plumbing / Electrical
 * groups, and the three whole-property system sections become one "Property Services" section. Reports that are not yet
 * issued are converted too: findings written in an AC / Electrical section that name one room move into that room.
 * Issued reports are not touched. Runs once.
 */
export function upgradeRoomLayout(db) {
  if (Number(db.prepare("SELECT value FROM settings WHERE key='_checklist_version'").get()?.value) >= 3) return null;
  const out = { reports: 0, moved: 0, left: 0 };
  tx(db, () => {
    const q = (sql, ...a) => db.prepare(sql).run(...a);
    const ROOM_FALLBACK = { 'Air Conditioning': 'Cooling Performance (supply air temperature)', Electrical: 'Electrical Condition' };
    // 1. checklists: group every item, add the room AC items, merge the system sections
    for (const cl of db.prepare('SELECT id FROM checklists').all()) {
      const secs = db.prepare('SELECT * FROM section_templates WHERE checklist_id=? ORDER BY sort').all(cl.id);
      const add = (sid, list) => list.forEach(([n, a, l]) => {
        if (!db.prepare('SELECT 1 FROM item_templates WHERE section_template_id=? AND name=?').get(sid, n))
          q('INSERT INTO item_templates(section_template_id,name,attr_label,attr_list,grp,sort) VALUES(?,?,?,?,?,?)', sid, n, a, l, groupOf(n), db.prepare('SELECT COALESCE(MAX(sort),0)+1 m FROM item_templates WHERE section_template_id=?').get(sid).m);
      });
      for (const st of secs.filter((x) => x.kind === 'area')) {
        const has = (n) => db.prepare('SELECT 1 FROM item_templates WHERE section_template_id=? AND name=?').get(st.id, n);
        if (has('Ceiling Condition')) add(st.id, ROOM_AC);
        if (has('Toilet Condition')) add(st.id, BATH_AC);
      }
      const sys = secs.filter((x) => x.kind === 'system');
      if (sys.length) {
        const svc = Number(q("INSERT INTO section_templates(checklist_id,name,kind,repeat_rule,sort) VALUES(?,'Property Services','area','once',?)", cl.id, (secs.at(-1)?.sort || 0) + 1).lastInsertRowid);
        for (const st of sys) { q('UPDATE item_templates SET section_template_id=? WHERE section_template_id=?', svc, st.id); q('DELETE FROM section_templates WHERE id=?', st.id); }
        for (const n of ROOM_LEVEL) q('DELETE FROM item_templates WHERE section_template_id=? AND name=?', svc, n);
        add(svc, [['Comments', null, null]]);
      }
    }
    for (const it of db.prepare('SELECT id, name FROM item_templates').all()) q('UPDATE item_templates SET grp=? WHERE id=?', groupOf(it.name), it.id);
    // 2. reports that are not issued yet
    for (const r of db.prepare("SELECT id FROM reports WHERE status NOT IN ('issued','superseded')").all()) {
      out.reports++;
      const max = (sql, id) => db.prepare(sql).get(id).m;
      const secs = () => db.prepare('SELECT * FROM report_sections WHERE report_id=? ORDER BY sort, id').all(r.id);
      const addItems = (sid, list) => list.forEach(([n, a, l]) => {
        if (!db.prepare('SELECT 1 FROM report_items WHERE section_id=? AND name=?').get(sid, n))
          q('INSERT INTO report_items(section_id,name,attr_label,attr_list,attr_value,grp,sort) VALUES(?,?,?,?,?,?,?)', sid, n, a, l, '', groupOf(n), max('SELECT COALESCE(MAX(sort),0)+1 m FROM report_items WHERE section_id=?', sid));
      });
      for (const sc of secs().filter((x) => x.kind === 'area')) {
        const has = (n) => db.prepare('SELECT 1 FROM report_items WHERE section_id=? AND name=?').get(sc.id, n);
        if (has('Ceiling Condition')) addItems(sc.id, ROOM_AC);
        if (has('Toilet Condition')) addItems(sc.id, BATH_AC);
      }
      const sys = secs().filter((x) => x.kind === 'system');
      if (sys.length) {
        const rooms = secs().filter((x) => x.kind === 'area');
        const svc = Number(q("INSERT INTO report_sections(report_id,name,kind,intro,sort) VALUES(?,'Property Services','area','',?)", r.id, max('SELECT COALESCE(MAX(sort),0)+1 m FROM report_sections WHERE report_id=?', r.id)).lastInsertRowid);
        for (const sc of sys) {
          const grp = sc.name;
          for (const it of db.prepare('SELECT * FROM report_items WHERE section_id=? ORDER BY sort, id').all(sc.id)) {
            for (const o of db.prepare('SELECT * FROM observations WHERE item_id=?').all(it.id)) {
              const named = rooms.filter((x) => new RegExp(`\\b${x.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(o.text));
              const hit = named.filter((x) => !named.some((y) => y !== x && y.name.includes(x.name))); // "Living Room Balcony" is not also "Living Room"
              const room = hit.length === 1 ? hit[0] : null;
              const target = room && (db.prepare('SELECT id FROM report_items WHERE section_id=? AND name=?').get(room.id, it.name) || db.prepare('SELECT id FROM report_items WHERE section_id=? AND name=?').get(room.id, ROOM_FALLBACK[grp] || ''));
              if (!target) { out.left++; continue; }
              q('UPDATE observations SET item_id=? WHERE id=?', target.id, o.id);
              q('UPDATE media SET item_id=?, section_id=? WHERE observation_id=?', target.id, room.id, o.id);
              out.moved++;
            }
          }
          // what is left moves to Property Services; room-level items that stayed empty are dropped
          for (const it of db.prepare('SELECT * FROM report_items WHERE section_id=?').all(sc.id)) {
            const used = it.attr_value || db.prepare('SELECT 1 FROM observations WHERE item_id=?').get(it.id) || db.prepare('SELECT 1 FROM media WHERE item_id=?').get(it.id);
            if (ROOM_LEVEL.has(it.name) && !used) { q('DELETE FROM report_items WHERE id=?', it.id); continue; }
            q('UPDATE report_items SET section_id=?, sort=? WHERE id=?', svc, max('SELECT COALESCE(MAX(sort),0)+1 m FROM report_items WHERE section_id=?', svc), it.id);
            q('UPDATE media SET section_id=? WHERE item_id=?', svc, it.id);
          }
          q('UPDATE media SET section_id=? WHERE section_id=? AND item_id IS NULL AND observation_id IS NULL', svc, sc.id);
          q('DELETE FROM report_sections WHERE id=?', sc.id);
        }
        addItems(svc, [['Comments', null, null]]);
      }
      for (const it of db.prepare('SELECT it.id, it.name FROM report_items it JOIN report_sections s ON s.id=it.section_id WHERE s.report_id=?').all(r.id)) q('UPDATE report_items SET grp=? WHERE id=?', groupOf(it.name), it.id);
    }
    q("INSERT INTO settings(key,value) VALUES('_checklist_version','3') ON CONFLICT(key) DO UPDATE SET value='3'");
  });
  return out;
}

// Walk-through order of the rooms in a report and in the checklist.
const ORDER = ['Main Entrance', 'Kitchen', 'Living Room', 'Guest Washroom', ['Master Bedroom', 'Living / Sleeping Area'], ['Master Bathroom', 'Bathroom'], /^Bedroom (\d+|\{n\})$/, /^Bathroom (\d+|\{n\})$/, 'Wardrobe Room', 'Living Room Balcony', 'Laundry Area', "Maid's Room", "Maid's Bath", /^Exterior/];
const roomRank = (name) => {
  if (name === 'Property Services') return 99;
  const i = ORDER.findIndex((o) => (o instanceof RegExp ? o.test(name) : Array.isArray(o) ? o.includes(name) : o === name));
  return i < 0 ? 50 : i;
};

/** Rooms in walk-through order: Powder Room becomes Guest Washroom, Main Entrance and Wardrobe Room are added. Runs once. */
export function reorderRooms(db) {
  if (db.prepare("SELECT 1 FROM settings WHERE key='_rooms_order'").get()) return false;
  tx(db, () => {
    const q = (sql, ...a) => db.prepare(sql).run(...a);
    const sortAll = (rows, table, where, id) => {
      rows.sort((a, b) => roomRank(a.name) - roomRank(b.name) || a.sort - b.sort || a.id - b.id).forEach((r, i) => q(`UPDATE ${table} SET sort=? WHERE id=?`, i + 1, r.id));
    };
    for (const cl of db.prepare('SELECT id FROM checklists').all()) {
      q("UPDATE section_templates SET name='Guest Washroom' WHERE checklist_id=? AND name='Powder Room'", cl.id);
      for (const [name, , rule, intro, items] of SECTIONS.filter(([n]) => n === 'Main Entrance' || n === 'Wardrobe Room')) {
        if (db.prepare('SELECT 1 FROM section_templates WHERE checklist_id=? AND name=?').get(cl.id, name)) continue;
        const st = Number(q('INSERT INTO section_templates(checklist_id,name,kind,repeat_rule,intro_block_code,sort) VALUES(?,?,?,?,?,0)', cl.id, name, 'area', rule, intro).lastInsertRowid);
        items.forEach((k) => { const [iname, attr, list] = ITEMS[k] || k; q('INSERT INTO item_templates(section_template_id,name,attr_label,attr_list,grp,sort) VALUES(?,?,?,?,?,?)', st, iname, attr, list, groupOf(iname), items.indexOf(k) + 1); });
      }
      sortAll(db.prepare('SELECT id, name, sort FROM section_templates WHERE checklist_id=?').all(cl.id), 'section_templates');
    }
    for (const r of db.prepare("SELECT id FROM reports WHERE status NOT IN ('issued','superseded')").all()) {
      q("UPDATE report_sections SET name='Guest Washroom' WHERE report_id=? AND name='Powder Room'", r.id);
      for (const [name, , , , items] of SECTIONS.filter(([n]) => n === 'Main Entrance' || n === 'Wardrobe Room')) {
        if (db.prepare('SELECT 1 FROM report_sections WHERE report_id=? AND name=?').get(r.id, name)) continue;
        const sid = Number(q("INSERT INTO report_sections(report_id,name,kind,intro,sort) VALUES(?,?,'area','',0)", r.id, name).lastInsertRowid);
        items.forEach((k, i) => { const [iname, attr, list] = ITEMS[k] || k; q('INSERT INTO report_items(section_id,name,attr_label,attr_list,attr_value,grp,sort) VALUES(?,?,?,?,?,?,?)', sid, iname, attr, list, '', groupOf(iname), i + 1); });
      }
      sortAll(db.prepare('SELECT id, name, sort FROM report_sections WHERE report_id=?').all(r.id), 'report_sections');
    }
    q("INSERT INTO settings(key,value) VALUES('_rooms_order','1')");
  });
  return true;
}

const ROOM = ['location', 'floor', 'walls', 'ceiling', 'doors', 'windows', ...ROOM_AC, 'electrical', 'comments'];
const BATH = ['location', 'floor', 'walls', 'doors', 'sink', 'sinkfaucet', 'shower', 'showerbase', 'drains', 'toilet', 'counters', ...BATH_AC, 'electrical'];
const ENTRY = ['location', 'floor', 'walls', 'ceiling', 'doors', 'electrical', 'comments'];
const GUEST_WC = ['location', 'floor', 'walls', 'doors', 'sink', 'sinkfaucet', 'toilet', ...BATH_AC, 'electrical'];
// Walk-through order: entrance, kitchen, living room, guest washroom, master suite, other bedrooms, wardrobe; the rest after.
const SECTIONS = [
  ['Main Entrance', 'area', 'once', null, ENTRY],
  ['Kitchen', 'area', 'once', null, ['floor', 'walls', 'counters', 'sink', 'sinkfaucet', 'drains', 'electrical', 'comments']],
  ['Living Room', 'area', 'once', null, ROOM],
  ['Guest Washroom', 'area', 'once', null, GUEST_WC],
  ['Master Bedroom', 'area', 'once', null, ROOM],
  ['Master Bathroom', 'area', 'once', null, BATH],
  ['Bedroom {n}', 'area', 'per_extra_bedroom', null, ROOM],
  ['Bathroom {n}', 'area', 'per_extra_bedroom', null, BATH],
  ['Wardrobe Room', 'area', 'once', null, ENTRY],
  ['Living Room Balcony', 'area', 'once', null, ['location', 'floor', 'walls', 'windows', 'drains']],
  ['Laundry Area', 'area', 'once', null, ['location', 'floor', 'drains', 'electrical']],
  ["Maid's Room", 'area', 'if_maid', null, ROOM],
  ["Maid's Bath", 'area', 'if_maid', null, BATH],
  ['Exterior, Garden & Roof', 'area', 'if_villa', null, ['location', 'walls', 'floor', 'drains', 'comments']],
  ['Property Services', 'area', 'once', 'sec_intro_property_services', SERVICE_ITEMS],
];

const GLOSSARY = [
  ['Hollow sound', 'A hollow sound when a floor or wall tile is tapped usually means the tile is not fully bonded to the surface beneath it. It may not fail straight away, but it can loosen or crack over time, and water can enter the gap. Repair or monitoring is recommended.', ''],
  ['Hot water below standard', 'Stored hot water is normally kept at about 60 °C to limit the growth of bacteria such as Legionella, while taps should be protected against scalding.', 'Guidance from public health and safety authorities on hot water systems (e.g. UK HSE, US CDC).'],
  ['RCD', 'Residual-current device: a safety switch in the distribution board that cuts power quickly if current leaks to earth, reducing the risk of electric shock.', ''],
  ['Live/neutral reversed', 'The live and neutral wires are connected the wrong way round at a socket. Appliances may still work, but parts that should be safe can stay live. It must be corrected by a licensed electrician.', ''],
];

const COMMENTS = [
  // item_name, text, severity, trade, glossary term
  ['Floor Condition', 'Hollow sound observed in the floor tiles, as shown in the photos/video. This may indicate voids under the tiles or poor bonding. Repair is recommended to avoid cracked or loose tiles later.', 'attention', 'qualified contractor', 'Hollow sound'],
  ['Floor Condition', 'Uneven floor tiles (lippage) observed in several areas, as shown in the photos.', 'attention', 'qualified contractor', null],
  ['Floor Condition', 'Damaged or missing grout observed between floor tiles.', 'attention', 'qualified contractor', null],
  ['Walls Condition', 'Cracked paint observed at the joint between the wall and the cabinets.', 'attention', 'qualified painter', null],
  ['Ceiling Condition', 'Thermal imaging shows cold spots on the ceiling that may indicate air leaking from the AC duct.', 'attention', 'licensed HVAC contractor', null],
  ['Ceiling Condition', 'Water staining observed on the ceiling, indicating a past or active leak from above.', 'critical', 'licensed plumber', null],
  ['Door Condition', 'The door does not close properly and the handle does not latch when closed. The door may need adjustment or the hinges/latch repaired.', 'attention', 'qualified carpenter', null],
  ['Door Condition', 'Door hinges are noisy when the door is opened and closed. Lubrication or adjustment is recommended.', 'attention', 'qualified carpenter', null],
  ['Window Condition', 'A gap is visible at the top of the sliding doors when fully closed, which may let in air, dust or light. Sealing is recommended.', 'attention', 'glazing contractor', null],
  ['Electrical Condition', 'Live and neutral are reversed at this socket, as shown in the photos.', 'critical', 'licensed electrician', 'Live/neutral reversed'],
  ['Electrical Condition', 'The socket is loose in the wall and must be secured.', 'attention', 'licensed electrician', null],
  ['Electrical Condition', 'Switch buttons are not level within the switch frame. Replacement is recommended.', 'attention', 'licensed electrician', null],
  ['Breakers and RCD Protection', 'Sockets were tested with a socket tester and found correctly wired with adequate earthing. The RCD tripped correctly when tested.', 'info', '', 'RCD'],
  ['Cooling Performance (supply air temperature)', 'No cold air from the AC outlet in this area. All other AC outlets in the property were cooling normally.', 'critical', 'licensed HVAC contractor', null],
  ['Comments', 'Noise from the ceiling when the AC in this room is switched on, which stops when it is switched off. This is likely to come from the AC duct or fan coil unit.', 'attention', 'licensed HVAC contractor', null],
  ['Supply Lines Condition', 'Hot water temperature at the taps is below the recommended level.', 'attention', 'licensed plumber', 'Hot water below standard'],
  ['Shower Faucet Condition', 'Sealant is missing between the wall and the base plate of the shower mixer. This can let water behind the fitting. Sealing is recommended.', 'attention', 'qualified contractor', null],
  ['Shower Faucet Condition', 'Water leaking at the joint between the rain shower head and its arm, as shown in the photo/video.', 'critical', 'licensed plumber', null],
  ['Shower Base Condition', 'The shower floor does not slope properly to the drain, so water collects and has stained the surface.', 'attention', 'qualified contractor', null],
  ['Traps/Drains/Supply Condition', 'Low water pressure at this tap, as shown in the video.', 'attention', 'licensed plumber', null],
  ['Traps/Drains/Supply Condition', 'The drain appears blocked: the water level did not drop for over 20 minutes.', 'critical', 'licensed plumber', null],
  ['Sink Condition', 'The sink stopper does not close properly.', 'attention', 'licensed plumber', null],
  ['Sink Faucet Condition', 'The tap is loose and should be secured.', 'attention', 'licensed plumber', null],
  ['Counters/Cabinets Condition', 'Mould-like growth and musty odour inside the cabinet under the sink. The cause should be found and the area treated.', 'critical', 'licensed mould remediation specialist', null],
  ['Counters/Cabinets Condition', 'A cabinet door hinge is broken.', 'attention', 'qualified carpenter', null],
  ['Counters/Cabinets Condition', 'Chipping on the edge of the countertop.', 'attention', 'qualified contractor', null],
];

/** One time: a unit type (studio, 1 bed, 2 bed, 3 bed, townhouse, villa) charges the same price for every inspection service: the highest of them. */
export function unifyPrices(db) {
  // Repair: an earlier release (flag _prices_unified) flattened whole property types to one price. Restore the list once, then unify by unit type below.
  if (db.prepare("SELECT 1 FROM settings WHERE key='_prices_unified'").get() && !db.prepare("SELECT 1 FROM settings WHERE key='_prices_repaired'").get()) {
    const ids = db.prepare("SELECT id, code FROM services WHERE code IN ('OWN-PPI','OWN-SNG','OWN-MIO')").all();
    db.prepare(`DELETE FROM price_rules WHERE service_id IN (${ids.map((x) => x.id).join(',') || 0})`).run();
    const pr = db.prepare('INSERT INTO price_rules(service_id,property_type,bedrooms_min,bedrooms_max,price) VALUES(?,?,?,?,?)');
    for (const [c, pt, bmin, bmax, price] of PRICES) { const sv = ids.find((x) => x.code === c); if (sv) pr.run(sv.id, pt, bmin, bmax, price); }
    db.prepare("DELETE FROM settings WHERE key='_prices_unified2'").run();
    db.prepare("INSERT INTO settings(key,value) VALUES('_prices_repaired','1')").run();
  }
  if (db.prepare("SELECT 1 FROM settings WHERE key='_prices_unified2'").get()) return 0;
  const svc = db.prepare("SELECT id FROM services WHERE code IN ('OWN-PPI','OWN-SNG','OWN-MIO')").all().map((x) => x.id);
  const find = db.prepare('SELECT * FROM price_rules WHERE service_id=? AND property_type=? AND bedrooms_min<=? AND bedrooms_max>=?');
  const ins = db.prepare('INSERT INTO price_rules(service_id,property_type,bedrooms_min,bedrooms_max,price) VALUES(?,?,?,?,?)');
  let n = 0;
  for (const [type, b] of [['apartment', 0], ['apartment', 1], ['apartment', 2], ['apartment', 3], ['townhouse', 3], ['villa', 4], ['villa', 5]]) {
    const rules = svc.map((id) => find.get(id, type, b, b)).filter(Boolean);
    for (const r of rules) { // give this unit its own band so its neighbours keep their price
      if (type === 'townhouse' || (r.bedrooms_min === b && r.bedrooms_max === b)) continue;
      db.prepare('UPDATE price_rules SET bedrooms_min=?, bedrooms_max=? WHERE id=?').run(b, b, r.id);
      if (r.bedrooms_min < b) ins.run(r.service_id, type, r.bedrooms_min, b - 1, r.price);
      if (r.bedrooms_max > b) ins.run(r.service_id, type, b + 1, r.bedrooms_max, r.price);
    }
    const top = Math.max(...rules.map((r) => r.price));
    n += db.prepare(`UPDATE price_rules SET price=? WHERE id IN (${rules.map((r) => r.id).join(',')})`).run(top).changes;
  }
  db.prepare("INSERT INTO settings(key,value) VALUES('_prices_unified2','1')").run();
  return n;
}

export function seedReference(db, now) {
  // existing databases: replace the one-line placeholder agreement with the full draft
  try {
    const ph = db.prepare("SELECT id, body FROM content_blocks WHERE code='tc_booking' AND version=1").get();
    if (ph && ph.body.length < 200 && db.prepare("SELECT COUNT(*) n FROM content_blocks WHERE code='tc_booking'").get().n === 1) db.prepare('UPDATE content_blocks SET body=? WHERE id=?').run(BLOCKS.find((b) => b[0] === 'tc_booking')[2], ph.id);
  } catch { /* fresh database */ }
  if (db.prepare('SELECT COUNT(*) n FROM services').get().n > 0) return false;
  tx(db, () => {
    const t = now();
    db.prepare('INSERT INTO branches(name,address,phone,is_default,created_at) VALUES(?,?,?,?,?)').run('Head office', 'Dubai, United Arab Emirates', '', 1, t);
    const svc = db.prepare('INSERT INTO services(code,name,segment,report_type,is_addon,includes_reinspection,default_sla_hours,needs_thermal,sort) VALUES(?,?,?,?,?,?,?,?,?)');
    for (const s of SERVICES) svc.run(...s);
    const sid = (code) => db.prepare('SELECT id FROM services WHERE code=?').get(code).id;
    const pr = db.prepare('INSERT INTO price_rules(service_id,property_type,bedrooms_min,bedrooms_max,price) VALUES(?,?,?,?,?)');
    for (const [c, pt, bmin, bmax, price] of PRICES) pr.run(sid(c), pt, bmin, bmax, price);
    const sc = db.prepare('INSERT INTO surcharges(name,kind,value) VALUES(?,?,?)');
    for (const s of SURCHARGES) sc.run(...s);
    const lk = db.prepare('INSERT INTO lookups(list,value,sort) VALUES(?,?,?)');
    for (const [list, values] of Object.entries({ ...LOOKUPS, ...SYSTEM_LOOKUPS })) values.forEach((v, i) => lk.run(list, v, i));
    const cb = db.prepare("INSERT INTO content_blocks(code,version,title,body,effective_from,created_at) VALUES(?,1,?,?,'2026-01-01',?)");
    for (const [code, title, body] of BLOCKS) cb.run(code, title, body, t);
    const g = db.prepare('INSERT INTO glossary(term,definition,references_text) VALUES(?,?,?)');
    for (const r of GLOSSARY) g.run(...r);
    const gid = (term) => (term ? db.prepare('SELECT id FROM glossary WHERE term=?').get(term).id : null);
    const cm = db.prepare('INSERT INTO comment_library(item_name,text,default_severity,default_trade,glossary_id) VALUES(?,?,?,?,?)');
    for (const [item, text, sev, trade, term] of [...COMMENTS, ...SYSTEM_COMMENTS]) cm.run(item, text, sev, trade, gid(term));
    const cl = db.prepare('INSERT INTO checklists(name) VALUES(?)').run('Residential (apartment, townhouse, villa)');
    const clId = Number(cl.lastInsertRowid);
    SECTIONS.forEach(([name, kind, rule, intro, items], si) => {
      const st = db.prepare('INSERT INTO section_templates(checklist_id,name,kind,repeat_rule,intro_block_code,sort) VALUES(?,?,?,?,?,?)').run(clId, name, kind, rule, intro, si + 1);
      items.forEach((it, ii) => {
        const [iname, attr, list] = Array.isArray(it) ? it : ITEMS[it];
        db.prepare('INSERT INTO item_templates(section_template_id,name,attr_label,attr_list,grp,sort) VALUES(?,?,?,?,?,?)').run(Number(st.lastInsertRowid), iname, attr, list, groupOf(iname), ii + 1);
      });
    });
    db.prepare("UPDATE services SET checklist_id=? WHERE is_addon=0").run(clId);
    db.prepare("INSERT INTO settings(key,value) VALUES('_checklist_version','3') ON CONFLICT(key) DO UPDATE SET value='3'").run();
  });
  return true;
}

/** Demo people and equipment so every screen has something to show (SEED_DEMO=true). Returns created logins. */
export function seedDemo(db, now, password) {
  if (db.prepare("SELECT COUNT(*) n FROM inspectors").get().n > 0) return [];
  const pw = password || crypto.randomBytes(9).toString('base64url') + '7a';
  const created = [];
  tx(db, () => {
    const t = now();
    const ins = db.prepare('INSERT INTO inspectors(name,mobile,email,engagement,supplier_name,licence_no,licence_expiry,insurance_expiry,agreement_expiry,credentials,thermal_certified,areas,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const i1 = Number(ins.run('Eng. Omar Haddad (demo)', '+971500000001', 'inspector.demo@aral.example', 'freelance', '', 'FL-000001', '2027-06-30', '2027-03-31', '2027-09-30', 'B.Sc. Mechanical Engineering, InterNACHI CPI', 1, 'Downtown Dubai, Business Bay, Dubai Marina', t).lastInsertRowid);
    ins.run('Eng. Sara Malik (demo)', '+971500000002', 'sara.demo@aral.example', 'manpower_supplier', 'Demo Manpower LLC', 'MP-000002', '2027-01-31', '2026-12-31', '2027-01-31', 'B.Sc. Civil Engineering', 0, 'JVC, Dubailand, IMPZ', t);
    const eq = db.prepare('INSERT INTO equipment(name,kind,serial_no,calibration_due) VALUES(?,?,?,?)');
    eq.run('Thermal camera #1', 'thermal', 'TC-0001', '2027-05-31');
    eq.run('HVAC diagnostic set #1', 'hvac', 'HV-0001', '2027-05-31');
    eq.run('Borescope #1', 'borescope', 'BS-0001', null);
    eq.run('Hand-tool kit #1 (moisture meter, laser, socket tester)', 'hand_tools', 'HT-0001', '2027-05-31');
    db.prepare('INSERT INTO valuation_partners(firm_name,rera_firm_no,contact_name,email) VALUES(?,?,?,?)').run('Demo Valuers LLC (RERA-registered partner)', 'RERA-DEMO-1', 'Valuation desk', 'valuer.demo@aral.example');
    const u = db.prepare('INSERT INTO users(email,name,role,password_hash,credentials,inspector_id,created_at) VALUES(?,?,?,?,?,?,?)');
    for (const [email, name, role, cred, insp] of [
      ['admin.demo@aral.example', 'Admin Coordinator (demo)', 'admin', '', null],
      ['inspector.demo@aral.example', 'Eng. Omar Haddad (demo)', 'inspector', 'B.Sc. Mechanical Engineering, InterNACHI CPI', i1],
      ['tm.demo@aral.example', 'Technical Manager (demo)', 'reviewer', 'Chartered Engineer', null],
      ['accounts.demo@aral.example', 'Accountant (demo)', 'accountant', '', null],
    ]) {
      if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) continue;
      u.run(email, name, role, hashPassword(pw), cred, insp, t);
      created.push({ email, role, password: password ? null : pw });
    }
  });
  return created;
}
