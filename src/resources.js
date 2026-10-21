// Admin-managed lists, described once and used by both the API (validation) and the screens (forms and tables).
// Field types: text, textarea, int, num, bool, date, enum (options), ref (another resource), lookup (picklist name).
const SEGMENTS = ['owner', 'bank', 'developer', 'any'];
const REPORT_TYPES = ['pre_purchase', 'snagging', 'move_in_out', 'collateral', 'progress', 'repossessed', 'building_audit', 'specialist', 'valuation_support'];
const LOOKUP_LISTS = ['property_type', 'purpose', 'community', 'developer', 'bank', 'material', 'trade', 'attendance', 'occupancy', 'weather', 'referral_source'];

export const RESOURCES = {
  branches: {
    table: 'branches', title: 'Branch addresses', group: 'Company', perm: 'settings.edit', order: 'is_default DESC, name', label: 'name',
    fields: [
      { k: 'name', t: 'text', label: 'Branch name', req: true, list: true },
      { k: 'address', t: 'textarea', label: 'Address', req: true, list: true },
      { k: 'phone', t: 'text', label: 'Phone', list: true },
      { k: 'is_default', t: 'bool', label: 'Printed on documents', list: true },
      { k: 'active', t: 'bool', label: 'Active', def: 1, list: true },
    ],
    stamp: true,
  },
  services: {
    table: 'services', title: 'Services', group: 'Catalogue & pricing', perm: 'catalogue.edit', order: 'sort, code', label: 'name',
    fields: [
      { k: 'code', t: 'text', label: 'Code', req: true, list: true, max: 20 },
      { k: 'name', t: 'text', label: 'Name (printed)', req: true, list: true },
      { k: 'name_ar', t: 'text', label: 'Name in Arabic (screens)', dir: 'rtl' },
      { k: 'segment', t: 'enum', label: 'Client group', options: SEGMENTS, req: true, list: true },
      { k: 'report_type', t: 'enum', label: 'Report type', options: REPORT_TYPES, req: true, list: true },
      { k: 'is_addon', t: 'bool', label: 'Add-on', list: true },
      { k: 'includes_reinspection', t: 'bool', label: 'Includes re-inspection' },
      { k: 'default_sla_hours', t: 'int', label: 'Turnaround (hours from access)', def: 48, list: true },
      { k: 'needs_thermal', t: 'bool', label: 'Needs thermal camera' },
      { k: 'checklist_id', t: 'ref', ref: 'checklists', label: 'Checklist' },
      { k: 'sort', t: 'int', label: 'Order', def: 0 },
      { k: 'active', t: 'bool', label: 'Active', def: 1, list: true },
    ],
  },
  price_rules: {
    table: 'price_rules', title: 'Prices', group: 'Catalogue & pricing', perm: 'catalogue.edit', order: 'service_id, property_type, bedrooms_min', label: 'id',
    hint: 'Base fee by service, property type and size. Use * for any property type. Leave bedrooms or area empty to match any.',
    fields: [
      { k: 'service_id', t: 'ref', ref: 'services', label: 'Service', req: true, list: true, filter: true },
      { k: 'property_type', t: 'lookup', list_name: 'property_type', any: true, label: 'Property type', def: '*', req: true, list: true },
      { k: 'bedrooms_min', t: 'int', label: 'Bedrooms from', list: true },
      { k: 'bedrooms_max', t: 'int', label: 'Bedrooms to', list: true },
      { k: 'sqft_min', t: 'num', label: 'Area from (sq ft)' },
      { k: 'sqft_max', t: 'num', label: 'Area to (sq ft)' },
      { k: 'price', t: 'num', label: 'Price (AED, excl. VAT)', req: true, list: true, money: true },
    ],
  },
  surcharges: {
    table: 'surcharges', title: 'Surcharges', group: 'Catalogue & pricing', perm: 'catalogue.edit', order: 'name', label: 'name',
    fields: [
      { k: 'name', t: 'text', label: 'Name', req: true, list: true },
      { k: 'kind', t: 'enum', label: 'Type', options: ['fixed', 'percent'], req: true, list: true },
      { k: 'value', t: 'num', label: 'Value (AED or %)', req: true, list: true },
      { k: 'active', t: 'bool', label: 'Active', def: 1, list: true },
    ],
  },
  lookups: {
    table: 'lookups', title: 'Picklists', group: 'Catalogue & pricing', perm: 'catalogue.edit', order: 'list, sort, value', label: 'value',
    hint: 'The choices offered in drop-down lists: property types, communities, developers, banks, materials, trades and so on.',
    fields: [
      { k: 'list', t: 'enum', label: 'List', options: LOOKUP_LISTS, req: true, list: true, filter: true },
      { k: 'value', t: 'text', label: 'Value', req: true, list: true },
      { k: 'sort', t: 'int', label: 'Order', def: 0, list: true },
      { k: 'active', t: 'bool', label: 'Active', def: 1, list: true },
    ],
  },
  valuation_partners: {
    table: 'valuation_partners', title: 'Valuation partners', group: 'Catalogue & pricing', perm: 'catalogue.edit', order: 'firm_name', label: 'firm_name',
    fields: [
      { k: 'firm_name', t: 'text', label: 'Firm', req: true, list: true },
      { k: 'rera_firm_no', t: 'text', label: 'RERA firm no.', list: true },
      { k: 'contact_name', t: 'text', label: 'Contact', list: true },
      { k: 'email', t: 'text', label: 'Email', list: true, email: true },
      { k: 'active', t: 'bool', label: 'Active', def: 1, list: true },
    ],
  },
  inspectors: {
    table: 'inspectors', title: 'Inspectors', group: 'Field team', perm: 'field.edit', order: 'active DESC, name', label: 'name',
    hint: 'Outsourced inspectors. Assignment is blocked when the licence, insurance or agreement has expired.',
    fields: [
      { k: 'name', t: 'text', label: 'Name', req: true, list: true },
      { k: 'mobile', t: 'text', label: 'Mobile', list: true },
      { k: 'email', t: 'text', label: 'Email', email: true },
      { k: 'engagement', t: 'enum', label: 'Engaged as', options: ['freelance', 'manpower_supplier', 'own_company'], def: 'freelance', list: true },
      { k: 'supplier_name', t: 'text', label: 'Supplier / company' },
      { k: 'licence_no', t: 'text', label: 'Licence no.' },
      { k: 'licence_expiry', t: 'date', label: 'Licence expiry', list: true, expiry: true },
      { k: 'insurance_expiry', t: 'date', label: 'Insurance expiry', list: true, expiry: true },
      { k: 'agreement_expiry', t: 'date', label: 'Agreement expiry', expiry: true },
      { k: 'credentials', t: 'text', label: 'Credentials (printed on reports)' },
      { k: 'thermal_certified', t: 'bool', label: 'Thermal certified', list: true },
      { k: 'areas', t: 'text', label: 'Areas covered' },
      { k: 'commission_pct', t: 'num', label: 'Commission % (empty = default)', list: true },
      { k: 'active', t: 'bool', label: 'Active', def: 1, list: true },
    ],
    stamp: true,
  },
  equipment: {
    table: 'equipment', title: 'Equipment', group: 'Field team', perm: 'field.edit', order: 'kind, name', label: 'name',
    fields: [
      { k: 'name', t: 'text', label: 'Name', req: true, list: true },
      { k: 'kind', t: 'enum', label: 'Type', options: ['thermal', 'hvac', 'borescope', 'hand_tools', 'moisture', 'other'], req: true, list: true },
      { k: 'serial_no', t: 'text', label: 'Serial no.', list: true },
      { k: 'calibration_due', t: 'date', label: 'Calibration due', list: true, expiry: true },
      { k: 'active', t: 'bool', label: 'Active', def: 1, list: true },
    ],
  },
  checklists: {
    table: 'checklists', title: 'Checklists', group: 'Report content', perm: 'technical.edit', order: 'name', label: 'name',
    fields: [
      { k: 'name', t: 'text', label: 'Name', req: true, list: true },
      { k: 'active', t: 'bool', label: 'Active', def: 1, list: true },
    ],
  },
  section_templates: {
    table: 'section_templates', title: 'Checklist sections', group: 'Report content', perm: 'technical.edit', order: 'checklist_id, sort', label: 'name',
    hint: 'Rooms and systems created for each new report. "{n}" is replaced by the room number. Repeat rules: once, per_extra_bedroom (bedrooms after the master), if_maid, if_villa.',
    fields: [
      { k: 'checklist_id', t: 'ref', ref: 'checklists', label: 'Checklist', req: true, list: true, filter: true },
      { k: 'name', t: 'text', label: 'Section name', req: true, list: true },
      { k: 'kind', t: 'enum', label: 'Type', options: ['system', 'area'], req: true, list: true },
      { k: 'repeat_rule', t: 'enum', label: 'Repeat', options: ['once', 'per_extra_bedroom', 'per_bathroom', 'if_maid', 'if_villa'], def: 'once', list: true },
      { k: 'intro_block_code', t: 'text', label: 'Intro text code (Report wording)' },
      { k: 'sort', t: 'int', label: 'Order', def: 0, list: true },
    ],
  },
  item_templates: {
    table: 'item_templates', title: 'Checklist items', group: 'Report content', perm: 'technical.edit', order: 'section_template_id, sort', label: 'name',
    fields: [
      { k: 'section_template_id', t: 'ref', ref: 'section_templates', label: 'Section', req: true, list: true, filter: true },
      { k: 'name', t: 'text', label: 'Item name', req: true, list: true },
      { k: 'attr_label', t: 'enum', label: 'Detail label', options: ['', 'Type', 'Materials', 'Location'], list: true },
      { k: 'attr_list', t: 'enum', label: 'Detail picklist', options: ['', ...LOOKUP_LISTS] },
      { k: 'sort', t: 'int', label: 'Order', def: 0, list: true },
    ],
  },
  comment_library: {
    table: 'comment_library', title: 'Comment library', group: 'Report content', perm: 'technical.edit', order: 'item_name, default_severity, id', label: 'text',
    hint: 'Ready-made findings the inspector picks on the phone. They can still edit the wording for each report.',
    fields: [
      { k: 'item_name', t: 'text', label: 'Suggested for item', def: '*', list: true, filter: true },
      { k: 'text', t: 'textarea', label: 'Finding text', req: true, list: true },
      { k: 'default_severity', t: 'enum', label: 'Severity', options: ['critical', 'attention', 'info'], def: 'attention', list: true },
      { k: 'default_trade', t: 'lookup', list_name: 'trade', label: 'Refer to' },
      { k: 'glossary_id', t: 'ref', ref: 'glossary', label: 'Glossary term' },
      { k: 'active', t: 'bool', label: 'Active', def: 1, list: true },
    ],
  },
  glossary: {
    table: 'glossary', title: 'Glossary', group: 'Report content', perm: 'technical.edit', order: 'term', label: 'term',
    fields: [
      { k: 'term', t: 'text', label: 'Term', req: true, list: true },
      { k: 'definition', t: 'textarea', label: 'Definition', req: true, list: true },
      { k: 'references_text', t: 'textarea', label: 'References' },
    ],
  },
};

export const resourceLabelSql = (name) => {
  const r = RESOURCES[name];
  if (name === 'section_templates') return "(SELECT c.name FROM checklists c WHERE c.id=section_templates.checklist_id) || ' · ' || section_templates.name";
  if (name === 'price_rules') return 'id';
  return r.label;
};

/** Public description sent to the screens. */
export const resourceMeta = () => Object.fromEntries(Object.entries(RESOURCES).map(([k, r]) => [k, { title: r.title, group: r.group, perm: r.perm, hint: r.hint || '', fields: r.fields }]));
