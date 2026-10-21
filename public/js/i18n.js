// Screens in English or Arabic. English text is the key; Arabic comes from /i18n/ar.json.
// Anything not in the dictionary (names, addresses, data typed by users) is shown as it is.
let lang = 'en';
let dict = {};

export const getLang = () => lang;

export async function setLang(next) {
  lang = next === 'ar' ? 'ar' : 'en';
  try { localStorage.setItem('aral_lang', lang); } catch { /* private mode */ }
  if (lang === 'ar' && !Object.keys(dict).length) {
    try { dict = await (await fetch('/i18n/ar.json', { cache: 'no-cache' })).json(); } catch { dict = {}; }
  }
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

export function savedLang(fallback = 'en') {
  try { return localStorage.getItem('aral_lang') || fallback; } catch { return fallback; }
}

/** t('Saved {n} rows', { n: 3 }) */
export function t(s, vars) {
  let out = lang === 'ar' && dict[s] ? dict[s] : String(s ?? '');
  if (lang === 'ar' && !dict[s] && /[A-Za-z]{3}/.test(String(s))) (globalThis.__i18nMissing ||= new Set()).add(String(s));
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
  return out;
}
