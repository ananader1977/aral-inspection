// Roles and what each one may do. Checked on the server for every request (the screens only hide buttons).
export const ROLES = ['super_admin', 'admin', 'inspector', 'reviewer', 'accountant', 'client', 'partner_valuer'];

export const ROLE_LABEL = {
  super_admin: 'Super Admin',
  admin: 'Admin coordinator',
  inspector: 'Inspector',
  reviewer: 'Technical Manager',
  accountant: 'Accountant',
  client: 'Client',
  partner_valuer: 'Valuation partner',
};

/** Roles that must use an authenticator app (2FA). */
export const ROLES_2FA = ['super_admin', 'admin', 'reviewer', 'accountant'];

/** Roles that sign in to the staff app (clients and partners get their own portal in later phases). */
export const STAFF_ROLES = ['super_admin', 'admin', 'inspector', 'reviewer', 'accountant'];

// Permissions used in Phase 2. Later phases add jobs.*, quotes.*, reports.*, invoices.*.
const P = {
  'users.manage': ['super_admin'],
  'settings.view': ['super_admin', 'admin', 'reviewer', 'accountant'],
  'settings.edit': ['super_admin'],
  'content.edit': ['super_admin'], // terms & conditions and report wording
  'catalogue.edit': ['super_admin'], // services, prices, surcharges, lookups, valuation partners
  'technical.edit': ['super_admin', 'reviewer'], // checklists, comment library, glossary
  'field.edit': ['super_admin', 'admin'], // inspectors, equipment
  'audit.view': ['super_admin'],
  'messages.view': ['super_admin', 'admin'],
  'export': ['super_admin', 'admin', 'reviewer', 'accountant'],
};

export const can = (role, perm) => !!P[perm]?.includes(role);
export const permissionsOf = (role) => Object.keys(P).filter((k) => P[k].includes(role));
