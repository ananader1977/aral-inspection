// Price calculation from the price list in Settings. Used by the website estimate now and by quotations in Phase 3.
import { HttpError } from './http.js';
import { round2 } from './time.js';

/** Property types on the booking form, mapped to the price-list type and bedroom count. */
export const RESIDENTIAL_TYPES = ['studio', 'apartment', 'townhouse', 'villa', 'penthouse'];
export const COMMERCIAL_TYPES = ['office', 'retail', 'warehouse', 'building', 'land'];

export function createPricing(ctx) {
  const { db } = ctx;

  /**
   * Finds the best price rule: exact property type beats "*", and a rule with a bedroom or area range
   * beats an open one. Returns null when no rule matches (the client gets a quote instead).
   */
  function basePrice(serviceId, propertyType, bedrooms, sqft) {
    let type = propertyType;
    let beds = bedrooms;
    if (type === 'studio') { type = 'apartment'; beds = 0; }
    if (type === 'penthouse') type = 'apartment';
    const rules = db.prepare("SELECT * FROM price_rules WHERE service_id=? AND property_type IN (?, '*')").all(serviceId, type);
    const fits = rules.filter((r) =>
      (r.bedrooms_min == null || (beds != null && beds >= r.bedrooms_min)) && (r.bedrooms_max == null || (beds != null && beds <= r.bedrooms_max)) &&
      (r.sqft_min == null || (sqft != null && sqft >= r.sqft_min)) && (r.sqft_max == null || (sqft != null && sqft <= r.sqft_max)));
    if (!fits.length) return null;
    const score = (r) => (r.property_type === '*' ? 0 : 10) + (r.bedrooms_min != null || r.bedrooms_max != null ? 2 : 0) + (r.sqft_min != null || r.sqft_max != null ? 1 : 0);
    fits.sort((a, b) => score(b) - score(a) || a.price - b.price);
    return fits[0];
  }

  /** Estimate for the website: base + add-ons + optional urgent surcharge. VAT added only when registered. */
  function estimate({ service, propertyType, bedrooms, sqft, addons = [], urgent = false }) {
    const svc = db.prepare('SELECT * FROM services WHERE code=? AND active=1 AND is_addon=0').get(String(service || ''));
    if (!svc) throw new HttpError(400, 'Choose a service.');
    const beds = bedrooms === '' || bedrooms == null ? null : Number(bedrooms);
    const area = sqft === '' || sqft == null ? null : Number(sqft);
    const rule = basePrice(svc.id, String(propertyType || ''), beds, area);
    if (!rule) return { service: svc.code, quote_needed: true };
    const lines = [{ label: svc.name, amount: rule.price }];
    for (const code of [].concat(addons).slice(0, 6)) {
      const a = db.prepare('SELECT * FROM services WHERE code=? AND active=1 AND is_addon=1').get(String(code));
      if (!a) continue;
      const r = basePrice(a.id, String(propertyType || ''), beds, area);
      if (r) lines.push({ label: a.name.replace(/^Add-on:\s*/, ''), amount: r.price });
    }
    let subtotal = lines.reduce((s, l) => s + l.amount, 0);
    if (urgent) {
      const sc = db.prepare("SELECT * FROM surcharges WHERE active=1 AND name LIKE '%urgent%' LIMIT 1").get();
      if (sc) {
        const amt = sc.kind === 'percent' ? round2((subtotal * sc.value) / 100) : sc.value;
        lines.push({ label: sc.name, amount: amt });
        subtotal += amt;
      }
    }
    const s = ctx.settings();
    const vatRate = s.vat_registered === '1' ? Number(s.vat_rate) || 0 : 0;
    const vat = round2((subtotal * vatRate) / 100);
    return { service: svc.code, quote_needed: false, lines, subtotal: round2(subtotal), vat_rate: vatRate, vat, total: round2(subtotal + vat), turnaround_hours: svc.default_sla_hours, includes_reinspection: !!svc.includes_reinspection };
  }

  return { basePrice, estimate };
}
