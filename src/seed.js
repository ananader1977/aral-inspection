// Reference data loaded on first start: service catalogue, prices, picklists, report wording (draft),
// checklists, comment library and glossary. Everything here can be edited in Settings afterwards.
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
  lost_reason: ['Price', 'Out of area', 'Timing', 'Valuation only (referred to partner)', 'No response', 'Chose a competitor'],
  referral_source: ['Website', 'Google', 'Instagram', 'WhatsApp', 'Broker / agent', 'Bank', 'Repeat client', 'Friend / referral'],
};

// Report and quotation wording. ARAL's own text, marked DRAFT where a lawyer should approve it.
const BLOCKS = [
  ['rpt_intro', 'Introduction', `Thank you for choosing ARAL. Please read the whole report, then call us with any questions. We stay available to you until your purchase or handover is complete.

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
  ['rpt_thermal_addendum', 'Thermal imaging addendum', `DRAFT: wording to be approved by ARAL's legal adviser.

Thermal imaging shows surface temperature differences. These can point to moisture, air leaks, missing insulation or overheating electrical parts. A thermal camera is not a moisture meter and cannot see through walls; it shows where further investigation may be needed. Thermal findings are limited to the areas scanned and the conditions on the day of the inspection.`],
  ['tc_report', 'Terms and conditions (report)', `DRAFT: these terms are placeholders and must be replaced by text approved by ARAL's legal adviser before the first client report is issued.

1. The inspection was visual and carried out under the signed service agreement.
2. The report is for the client named on the cover. Others who rely on it do so at their own risk.
3. ARAL does not carry out engineering, architectural or other licensed design work under this inspection.
4. Environmental testing (mould sampling, asbestos, radon, soil) is excluded unless agreed in writing.
5. Any claim must be notified in writing within the period stated in the service agreement.`],
  ['tc_quote', 'Terms and conditions (quotation)', `DRAFT: to be approved by ARAL's legal adviser.

1. Fees are in UAE dirhams. VAT is added where applicable.
2. Payment is due in full before the inspection unless agreed otherwise.
3. Air conditioning and DEWA must be connected on the day for a full inspection.
4. The report is delivered within the stated time after the inspection.
5. Rescheduling with less than 24 hours' notice may be charged.`],
  ['tc_booking', 'Service agreement', `DRAFT: the service agreement the client signs after accepting the quotation. To be approved by ARAL's legal adviser.`],
  ['tc_invoice', 'Invoice notes', `Thank you for your business. Please quote the invoice number with your payment.`],
  ['qt_cover_letter', 'Quotation cover letter', `Dear {{client_name}},

Thank you for the opportunity to inspect your property. We deliver an independent, unbiased assessment so that you can decide with confidence before handover or purchase.

Please review the proposal below. Once you accept it, you will receive the service agreement to sign, and we will then book your inspection.`],
  ['sec_intro_air_conditioning', 'Air Conditioning (section intro)', `The air conditioning system keeps the property cool and ventilated. We run the system from its controls and check each outlet for cooling, airflow, noise, leaks and condensate drainage. A licensed HVAC contractor should carry out any detailed servicing.`],
  ['sec_intro_electrical', 'Electrical (section intro)', `We inspect the visible parts of the electrical installation: the distribution board, breakers and residual-current device (RCD), and a representative number of sockets, switches and light fittings. Sockets are tested for correct wiring and earthing. Electrical findings can be safety risks and should be repaired by a licensed electrician.`],
  ['sec_intro_water_heater', 'Water Heater (section intro)', `We check the water heater, its supply and outlet pipes, valves and the hot water temperature at the taps.`],
];

// Checklist for apartments and villas: sections and the items inside them.
const ITEMS = {
  floor: ['Floor Condition', 'Materials', 'material'], walls: ['Walls Condition', 'Materials', 'material'], ceiling: ['Ceiling Condition', null, null],
  doors: ['Door Condition', 'Materials', 'material'], windows: ['Window Condition', 'Materials', 'material'], electrical: ['Electrical Condition', null, null],
  comments: ['Comments', null, null], location: ['Location', 'Location', null], counters: ['Counters/Cabinets Condition', 'Materials', 'material'],
  sink: ['Sink Condition', null, null], sinkfaucet: ['Sink Faucet Condition', null, null], shower: ['Shower Faucet Condition', null, null],
  showerbase: ['Shower Base Condition', 'Materials', 'material'], drains: ['Traps/Drains/Supply Condition', null, null], toilet: ['Toilet Condition', null, null],
};
const ROOM = ['location', 'floor', 'walls', 'ceiling', 'doors', 'windows', 'electrical', 'comments'];
const BATH = ['location', 'floor', 'walls', 'doors', 'sink', 'sinkfaucet', 'shower', 'showerbase', 'drains', 'toilet', 'counters', 'electrical'];
const SECTIONS = [
  ['Air Conditioning', 'system', 'once', 'sec_intro_air_conditioning', [['Air Conditioning Comments', 'Type', null]]],
  ['Electrical', 'system', 'once', 'sec_intro_electrical', [['Main Service Condition', 'Type', null], ['Electrical Panel Condition', 'Type', 'material']]],
  ['Water Heater', 'system', 'once', 'sec_intro_water_heater', [['Supply Lines Condition', 'Materials', 'material'], ['Water Heater Room Comments', null, null]]],
  ['Kitchen', 'area', 'once', null, ['floor', 'walls', 'counters', 'sink', 'sinkfaucet', 'drains', 'electrical', 'comments']],
  ['Laundry Area', 'area', 'once', null, ['location', 'floor', 'drains', 'electrical']],
  ['Living Room', 'area', 'once', null, ROOM],
  ['Living Room Balcony', 'area', 'once', null, ['location', 'floor', 'walls', 'windows', 'drains']],
  ["Maid's Room", 'area', 'if_maid', null, ROOM],
  ["Maid's Bath", 'area', 'if_maid', null, BATH],
  ['Powder Room', 'area', 'once', null, ['location', 'floor', 'doors', 'sink', 'sinkfaucet', 'toilet']],
  ['Master Bedroom', 'area', 'once', null, ROOM],
  ['Master Bathroom', 'area', 'once', null, BATH],
  ['Bedroom {n}', 'area', 'per_extra_bedroom', null, ROOM],
  ['Bathroom {n}', 'area', 'per_extra_bedroom', null, BATH],
  ['Exterior, Garden & Roof', 'area', 'if_villa', null, ['location', 'walls', 'floor', 'drains', 'comments']],
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
  ['Electrical Panel Condition', 'Sockets were tested with a socket tester and found correctly wired with adequate earthing. The RCD tripped correctly when tested.', 'info', '', 'RCD'],
  ['Air Conditioning Comments', 'No cold air from the AC outlet in this area. All other AC outlets in the property were cooling normally.', 'critical', 'licensed HVAC contractor', null],
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

export function seedReference(db, now) {
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
    for (const [list, values] of Object.entries(LOOKUPS)) values.forEach((v, i) => lk.run(list, v, i));
    const cb = db.prepare("INSERT INTO content_blocks(code,version,title,body,effective_from,created_at) VALUES(?,1,?,?,'2026-01-01',?)");
    for (const [code, title, body] of BLOCKS) cb.run(code, title, body, t);
    const g = db.prepare('INSERT INTO glossary(term,definition,references_text) VALUES(?,?,?)');
    for (const r of GLOSSARY) g.run(...r);
    const gid = (term) => (term ? db.prepare('SELECT id FROM glossary WHERE term=?').get(term).id : null);
    const cm = db.prepare('INSERT INTO comment_library(item_name,text,default_severity,default_trade,glossary_id) VALUES(?,?,?,?,?)');
    for (const [item, text, sev, trade, term] of COMMENTS) cm.run(item, text, sev, trade, gid(term));
    const cl = db.prepare('INSERT INTO checklists(name) VALUES(?)').run('Residential (apartment, townhouse, villa)');
    const clId = Number(cl.lastInsertRowid);
    SECTIONS.forEach(([name, kind, rule, intro, items], si) => {
      const st = db.prepare('INSERT INTO section_templates(checklist_id,name,kind,repeat_rule,intro_block_code,sort) VALUES(?,?,?,?,?,?)').run(clId, name, kind, rule, intro, si + 1);
      items.forEach((it, ii) => {
        const [iname, attr, list] = Array.isArray(it) ? it : ITEMS[it];
        db.prepare('INSERT INTO item_templates(section_template_id,name,attr_label,attr_list,sort) VALUES(?,?,?,?,?)').run(Number(st.lastInsertRowid), iname, attr, list, ii + 1);
      });
    });
    db.prepare("UPDATE services SET checklist_id=? WHERE is_addon=0").run(clId);
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
