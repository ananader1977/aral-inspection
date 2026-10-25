// Branded email layout and the standard messages sent to clients, inspectors and the office.
import { escHtml } from './util.js';

export function layout(s, headline, bodyHtml, button) {
  const btn = button ? `<p style="margin:22px 0"><a href="${escHtml(button.url)}" style="display:inline-block;background:#8C5A36;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">${escHtml(button.label)}</a></p><p style="font-size:12px;color:#5B6782;word-break:break-all">${escHtml(button.url)}</p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#F5F7FA;font-family:Segoe UI,Arial,sans-serif;color:#16213A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FA;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0A1F4A;padding:18px 24px;color:#ffffff;font-weight:bold;letter-spacing:.14em">${escHtml(s.company_short || 'A R A L')}<div style="font-size:11px;letter-spacing:.12em;color:#D3A57C;font-weight:normal">${escHtml(s.company_name)}</div></td></tr>
<tr><td style="height:3px;background:#8C5A36"></td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55"><h2 style="margin:0 0 12px;color:#0A1F4A;font-size:20px">${escHtml(headline)}</h2>${bodyHtml}${btn}</td></tr>
<tr><td style="padding:14px 24px;background:#F5F7FA;font-size:12px;color:#5B6782">${escHtml(s.company_name)} · ${escHtml(s.tagline)}${s.phone ? ` · ${escHtml(s.phone)}` : ''}${s.website ? ` · ${escHtml(s.website)}` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Key/value table for emails. */
export const rows = (pairs) => `<table style="border-collapse:collapse;font-size:14px;margin:8px 0">${pairs.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<tr><td style="padding:5px 14px 5px 0;color:#5B6782;white-space:nowrap">${escHtml(k)}</td><td style="padding:5px 0"><b>${escHtml(v)}</b></td></tr>`).join('')}</table>`;
export const plainRows = (pairs) => pairs.filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n');
