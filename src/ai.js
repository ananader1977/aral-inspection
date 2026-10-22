// AI help for inspectors: an AI model looks at the photos of an item and suggests findings to write.
// The inspector always chooses, edits and saves the text; nothing is written to the report automatically.
// Providers (AI_PROVIDER): "gemini" (Google, free tier, GEMINI_API_KEY) or "claude" (Anthropic, ANTHROPIC_API_KEY).
// Without a key the feature is simply hidden.
import { HttpError } from './http.js';

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_MODEL = { gemini: 'gemini-3.5-flash-lite', claude: 'claude-sonnet-5-5' };
export const PROVIDER_LABEL = { gemini: 'Google Gemini', claude: 'Anthropic Claude' };
const SEVERITIES = ['critical', 'attention', 'info'];

const SYSTEM = `You help a property inspector in Dubai write findings for an ARAL Property Inspection Service report (resale, snagging/handover or move-in/move-out inspections of apartments, townhouses and villas).

You see one or more photos of ONE checklist item. Suggest findings the inspector could write about what is VISIBLE in the photos.

Rules:
- Describe only what can be seen. Do not guess hidden causes as facts; say "may indicate" or "appears to" when it is a likely cause.
- Never invent measurements, temperatures, brands, ages or test results that are not readable in the photo.
- Write in plain, professional English, one or two sentences per finding, in the style of the examples given. End with the effect or the action, e.g. "Repair is recommended." Do not add "We recommend a ... to assess" at the end: the trade is a separate field.
- Severity: "critical" = safety risk, active leak, electrical hazard, mould, or a defect that significantly affects value; "attention" = needs repair, adjustment, cleaning or replacement; "info" = tested or seen working, or a neutral note.
- Trade: who should fix it, e.g. "licensed plumber", "licensed electrician", "licensed HVAC contractor", "qualified contractor", "qualified carpenter", "qualified painter", "waterproofing specialist", "glazing contractor", "licensed mould remediation specialist". Empty for info findings.
- If nothing is wrong in the photos, return one "info" finding saying so, and set no_defect to true.
- If the photo is unclear, too dark or does not show the item, say so in "note" and return no findings.
- Also suggest a short photo caption (max 8 words).

Answer with JSON only, no other text:
{"findings":[{"text":"...","severity":"critical|attention|info","trade":"...","confidence":"high|medium|low"}],"caption":"...","no_defect":false,"note":""}`;

export function createAi(ctx) {
  const cfg = ctx.config.ai || {};
  const provider = cfg.provider === 'gemini' ? 'gemini' : 'claude';
  const enabled = () => !!cfg.apiKey;
  const model = () => cfg.model || DEFAULT_MODEL[provider];

  async function suggest({ images, section, item, detail, propertyType, examples = [] }) {
    if (!enabled()) throw new HttpError(503, 'AI suggestions are not set up. Add GEMINI_API_KEY (or ANTHROPIC_API_KEY) on the server.');
    const imgs = images.filter((x) => x?.buf?.length && /^image\/(jpeg|png|webp|gif)$/.test(x.mime)).slice(0, 4);
    if (!imgs.length) throw new HttpError(400, 'Add a photo first. The AI reads photos only.');
    const total = imgs.reduce((a, x) => a + x.buf.length, 0);
    if (total > 15 * 1024 * 1024) throw new HttpError(413, 'The photos are too large to analyse together.');
    const context = [
      `Property: ${propertyType || 'property'} in Dubai.`,
      `Area / system: ${section}.`,
      `Checklist item: ${item}${detail ? ` (${detail})` : ''}.`,
      examples.length ? `Examples of ARAL wording for this kind of item:\n${examples.slice(0, 12).map((e) => `- [${e.severity}] ${e.text}`).join('\n')}` : '',
      'Suggest up to 3 findings, most important first.',
    ].filter(Boolean).join('\n');
    const text = provider === 'gemini' ? await callGemini(imgs, context) : await callClaude(imgs, context);
    return { ...parse(text), model: model(), provider };
  }

  async function post(url, headers, body) {
    let res;
    try { res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) }); }
    catch (e) { throw new HttpError(502, `The AI service could not be reached (${e.name === 'TimeoutError' ? 'timed out' : e.message}). Try again.`); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) throw new HttpError(429, 'The free AI limit is reached for now. Try again in a minute, or write the finding yourself.');
    if (!res.ok) throw new HttpError(502, `AI service error: ${data?.error?.message || res.status}`);
    return data;
  }
  async function callClaude(imgs, context) {
    const data = await post(cfg.baseUrl || CLAUDE_API, { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }, {
      model: model(), max_tokens: 700, system: SYSTEM,
      messages: [{ role: 'user', content: [
        ...imgs.map((x) => ({ type: 'image', source: { type: 'base64', media_type: x.mime, data: x.buf.toString('base64') } })),
        { type: 'text', text: context },
      ] }],
    });
    return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  }
  async function callGemini(imgs, context) {
    const url = `${cfg.baseUrl || GEMINI_API}/${encodeURIComponent(model())}:generateContent`;
    const data = await post(url, { 'x-goog-api-key': cfg.apiKey }, {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [...imgs.map((x) => ({ inline_data: { mime_type: x.mime, data: x.buf.toString('base64') } })), { text: context }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 800, temperature: 0.3 },
    });
    const c = data.candidates?.[0];
    if (!c && data.promptFeedback?.blockReason) throw new HttpError(422, 'The AI could not read this photo. Write the finding yourself.');
    return (c?.content?.parts || []).map((p) => p.text || '').join('');
  }

  return { enabled, suggest, provider, model, label: () => PROVIDER_LABEL[provider] + (provider === 'gemini' && !cfg.paidTier ? ' (free tier)' : '') };
}

/** Pulls the JSON object out of the reply and cleans every field. */
export function parse(text) {
  const m = /\{[\s\S]*\}/.exec(String(text || ''));
  let j = {};
  try { j = m ? JSON.parse(m[0]) : {}; } catch { j = {}; }
  const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const findings = (Array.isArray(j.findings) ? j.findings : []).slice(0, 4).map((f) => ({
    text: clean(f.text, 600),
    severity: SEVERITIES.includes(f.severity) ? f.severity : 'attention',
    trade: clean(f.trade, 80),
    confidence: ['high', 'medium', 'low'].includes(f.confidence) ? f.confidence : 'medium',
  })).filter((f) => f.text);
  return { findings, caption: clean(j.caption, 80), no_defect: !!j.no_defect, note: clean(j.note, 300) || (findings.length ? '' : 'No suggestion. Write the finding yourself.') };
}
