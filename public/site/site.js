// A R A L public website: language switch, live prices, instant estimate and booking request.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

const AR = {
  skip: 'انتقل إلى الحجز', brandSub: 'خدمات فحص العقارات', navServices: 'الخدمات', navPrices: 'الأسعار', navHow: 'كيف نعمل', navAgents: 'للوسطاء', navBook: 'اعرف السعر',
  heroKick: 'فحص العقارات في دبي', heroTitle: 'اعرف حالة العقار بدقة قبل أن توقّع.',
  heroLead: 'فحص مستقل يقوده مهندسون للعقارات المعاد بيعها والتسليمات الجديدة والإيجارات. صور وفيديو وتصوير حراري في تقرير واضح خلال 24 ساعة.',
  heroCta: 'احصل على السعر فورًا', heroWa: 'تواصل عبر واتساب',
  trust1: 'لا نبيع أعمال الإصلاح', trust2: 'كل تقرير يراجعه مهندس معتمد', trust3: 'التقرير خلال 24 ساعة', trust4: 'مسجلون لدى دائرة الأراضي / ريرا',
  sampleCap: 'كل ملاحظة مرفقة بالصور ودرجة الأهمية والجهة المختصة بإصلاحها.',
  bookKick: 'سعر فوري', bookTitle: 'سعرك خلال 20 ثانية، ثم احجز بخطوة واحدة',
  step1: '1. العقار', fService: 'الخدمة', fType: 'نوع العقار', fBeds: 'عدد غرف النوم', fCommunity: 'المنطقة', fAddons: 'خدمة إضافية',
  estTitle: 'السعر التقديري', estEmpty: 'اختر الخدمة والعقار لمعرفة السعر.',
  incl1: 'تقرير لكل غرفة مع الصور والفيديو', incl2: 'فحص التكييف والكهرباء والسباكة والرطوبة', incl3: 'يراجعه المدير الفني', incl4: 'مكالمة متابعة لشرح النتائج',
  step2: '2. احجز', fName: 'الاسم الكامل', fMobile: 'الجوال (واتساب)', fEmail: 'البريد الإلكتروني (اختياري)', fDate: 'التاريخ المفضل', fBuilding: 'المبنى / المشروع ورقم الوحدة', fRef: 'رمز الوسيط (إن وجد)',
  fMsg: 'هل هناك ما يجب أن نعرفه؟ (موعد التسليم، الدخول للعقار، أسئلة)', fConsent: 'أوافق على تواصل A R A L معي هاتفيًا أو عبر واتساب أو البريد بخصوص هذا الطلب.',
  fSubmit: 'أرسل طلب الحجز', fNote: 'لا دفع الآن. نؤكد الموعد ونرسل عرض السعر أولاً.',
  doneTitle: 'شكرًا لك، استلمنا طلبك', doneText: 'سنتصل بك أو نراسلك عبر واتساب قريبًا لتأكيد الموعد. رقم المرجع:', doneWa: 'راسلنا على واتساب الآن',
  svcKick: 'سكني', svcTitle: 'فحص لكل مرحلة من مراحل امتلاك المنزل',
  s1t: 'فحص قبل الشراء', s1d: 'قبل توقيع مذكرة التفاهم أو نقل الملكية: تقرير كامل عن الحالة تستخدمه للتفاوض مع البائع. يشمل إعادة فحص واحدة.',
  s2t: 'فحص التسليم', s2d: 'قبل استلام مفاتيح وحدة جديدة: أكثر من 200 نقطة فحص وقائمة عيوب بصيغة المطور، مع إعادة فحص بعد الإصلاح.',
  s4t: 'تقرير دخول / خروج', s4d: 'سجل مؤرخ ومدعوم بالصور لحالة العقار يحمي مبلغ التأمين للمستأجر والمالك.',
  from: 'من', bizKick: 'تجاري', bizTitle: 'للبنوك والمطورين وجمعيات الملاك',
  b1: '<b>فحص الأصول المستردة أو المتعثرة</b> للبنوك: الحالة والإشغال والمفاتيح وتقدير تكلفة الإصلاح.',
  b2: '<b>برنامج تسليم المشترين</b>: فحص تسليم باسم البنك لعملاء التمويل العقاري للمنازل الجديدة.',
  b3: '<b>فحص الجودة قبل التسليم</b> للمطورين: فحص كل وحدة قبل تسليمها للمشترين مع متابعة العيوب حتى إغلاقها.',
  b4: '<b>متابعة فترة الضمان</b> للمطورين وجمعيات الملاك: إعادة فحص العيوب المفتوحة قبل انتهاء فترة المسؤولية.',
  bizBtn: 'اطلب عرض سعر للشركات',
  prKick: 'الأسعار', prTitle: 'أسعار واضحة بلا مفاجآت', thProp: 'العقار', thResale: 'قبل الشراء', thSnag: 'فحص التسليم', thMove: 'دخول / خروج',
  rStudio: 'استوديو', r1: 'شقة غرفة نوم', r2: 'شقة غرفتين', r3: 'شقة 3 غرف', rTh: 'تاون هاوس', rV4: 'فيلا حتى 4 غرف', rV5: 'فيلا 5 غرف أو أكثر',
  howKick: 'كيف نعمل', howTitle: 'من الحجز إلى التقرير في أربع خطوات',
  h1t: 'احجز', h1d: 'احصل على السعر هنا أو عبر واتساب. نرسل عرض السعر والاتفاقية للتوقيع إلكترونيًا.',
  h2t: 'جهّز العقار', h2d: 'تأكد من توصيل التكييف وديوا وإمكانية استلام المفاتيح. هذا كل ما نحتاجه.',
  h3t: 'الفحص', h3d: 'يفحص المفتش كل غرفة بالكاميرا الحرارية وجهاز الرطوبة وفاحص المقابس. يمكنك الحضور.',
  h4t: 'التقرير', h4d: 'خلال 24 ساعة تستلم التقرير بالصور والفيديو وملخصًا ترسله للمطور أو البائع.',
  agKick: 'للوسطاء العقاريين', agTitle: 'امنح عملاءك راحة البال، واربح من كل إحالة.',
  ag1: 'عمولة إحالة 10% على كل فحص مدفوع ترسله لنا', ag2: 'رمز إحالة خاص بك ليُحتسب لك كل حجز', ag3: 'التقرير خلال 24 ساعة حتى لا تتأخر صفقتك', ag4: 'مستقلون: لا نبيع الإصلاحات، فيثق البائع والمشتري بالتقرير',
  agBtn: 'احصل على رمز الإحالة',
  faqTitle: 'أسئلة شائعة', q1: 'ماذا تحتاجون مني يوم الفحص؟', a1: 'الدخول إلى العقار مع توصيل التكييف وديوا. بدونها لا يمكن فحص التبريد والكهرباء والسباكة بشكل صحيح.',
  q2: 'كم يستغرق الفحص؟', a2: 'حوالي ساعتين إلى ثلاث للشقة، ومن أربع إلى ست ساعات للفيلا.',
  q3: 'هل تقدمون خدمة التقييم؟', a3: 'لا. نحن نفحص الحالة. للتقييم نعمل مع شريك تقييم مسجل لدى ريرا ويمكننا تزويده بتقرير الفحص.',
  q4: 'هل تصلحون العيوب؟', a4: 'لا. لا نبيع الإصلاحات حتى يبقى تقريرنا مستقلاً، ونخبرك بالجهة المختصة لكل ملاحظة.',
  staff: 'دخول الموظفين',
  prNote: 'الأسعار بالدرهم. خدمة إضافية: التصوير الحراري 500.',
};
const EN = {};
const TYPES = { studio: ['Studio', 'استوديو'], apartment: ['Apartment', 'شقة'], townhouse: ['Townhouse', 'تاون هاوس'], villa: ['Villa', 'فيلا'], penthouse: ['Penthouse', 'بنتهاوس'], office: ['Office', 'مكتب'], retail: ['Shop / retail', 'محل تجاري'], warehouse: ['Warehouse', 'مستودع'], building: ['Whole building', 'مبنى كامل'], land: ['Land / plot', 'أرض'] };
const SVC_AR = { 'OWN-PPI': 'فحص قبل الشراء (إعادة بيع)', 'OWN-SNG': 'فحص التسليم من المطور', 'OWN-MIO': 'تقرير دخول / خروج', 'ADD-THM': 'تصوير حراري' };
const MSG = {
  quote: ['We will send you a tailored quotation within one working day.', 'سنرسل لك عرض سعر مخصصًا خلال يوم عمل واحد.'],
  total: ['Total', 'الإجمالي'], vat: ['VAT', 'الضريبة'], excl: ['Price before VAT', 'السعر قبل الضريبة'], noVat: ['No VAT is charged', 'لا تُضاف ضريبة'],
  report: ['Report within {h} hours', 'التقرير خلال {h} ساعة'], reinsp: ['Includes one re-inspection', 'يشمل إعادة فحص واحدة'],
  needName: ['Please enter your name.', 'يرجى إدخال الاسم.'], needMobile: ['Please enter your mobile number.', 'يرجى إدخال رقم الجوال.'], needConsent: ['Please tick the box to agree to be contacted.', 'يرجى الموافقة على التواصل معك.'],
  sending: ['Sending…', 'جارٍ الإرسال…'], net: ['Network problem. Please try again or WhatsApp us.', 'مشكلة في الاتصال. حاول مرة أخرى أو راسلنا عبر واتساب.'],
  agentMsg: ['I am a broker / agent and would like a referral code.', 'أنا وسيط عقاري وأرغب في الحصول على رمز إحالة.'],
  bizMsg: ['Business enquiry (bank / developer / owners association): ', 'استفسار للشركات (بنك / مطور / جمعية ملاك): '],
};

let lang = 'en';
let site = null;
const L = (pair) => (lang === 'ar' ? pair[1] : pair[0]);
try { lang = localStorage.getItem('aral_lang') === 'ar' ? 'ar' : 'en'; } catch { /* private mode */ }

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  for (const el of $$('[data-i18n]')) {
    const k = el.dataset.i18n;
    if (!(k in EN)) EN[k] = el.textContent;
    el.textContent = lang === 'ar' ? AR[k] || EN[k] : EN[k];
  }
  // a few list items carry bold text: their markup is our own fixed copy, never user input
  for (const el of $$('[data-i18n-html]')) {
    const k = el.dataset.i18nHtml;
    if (!(k in EN)) EN[k] = el.innerHTML;
    el.innerHTML = lang === 'ar' ? AR[k] || EN[k] : EN[k];
  }
  $('#lang').textContent = lang === 'ar' ? 'English' : 'العربية';
  if (site) { fillSelects(); fillPrices(); update(); }
}

$('#lang').addEventListener('click', () => {
  lang = lang === 'ar' ? 'en' : 'ar';
  try { localStorage.setItem('aral_lang', lang); } catch { /* ignore */ }
  applyLang();
});

const waLink = (text) => {
  const digits = String(site?.mobile || '').replace(/\D/g, '').replace(/^00/, '').replace(/^0(5\d{8})$/, '971$1');
  return digits ? `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}` : '';
};

function svcName(s) { return lang === 'ar' ? SVC_AR[s.code] || s.name_ar || s.name : s.name.replace(/^Add-on:\s*/, ''); }

function fillSelects() {
  const sel = $('#service'), cur = sel.value;
  sel.replaceChildren(...site.services.filter((s) => !s.is_addon).map((s) => new Option(svcName(s), s.code)));
  if (cur) sel.value = cur;
  const pt = $('#ptype'), curT = pt.value || 'apartment';
  const og = (label, list) => { const g = document.createElement('optgroup'); g.label = label; for (const tp of list) g.append(new Option(L(TYPES[tp] || [tp, tp]), tp)); return g; };
  pt.replaceChildren(...site.residential_types.map((tp) => new Option(L(TYPES[tp] || [tp, tp]), tp)));
  pt.value = curT;
  const box = $('#addons'), checked = new Set($$('input', box).filter((i) => i.checked).map((i) => i.value));
  box.replaceChildren(...site.services.filter((s) => s.is_addon).map((s) => {
    const l = document.createElement('label');
    const i = document.createElement('input'); i.type = 'checkbox'; i.name = 'addons'; i.value = s.code; i.checked = checked.has(s.code);
    l.append(i, ` ${svcName(s)}${site.addon_prices[s.code] ? ` +${fmt(site.addon_prices[s.code])}` : ''}`);
    return l;
  }));
}

function fillPrices() {
  for (const s of site.services) { const el = document.getElementById(`p_${s.code}`); if (el && s.from != null) el.textContent = `AED ${fmt(s.from)}`; }
  const rows = $$('.prices tbody tr');
  site.price_table.forEach((r, i) => {
    const tds = rows[i]?.querySelectorAll('td');
    if (!tds) return;
    ['OWN-PPI', 'OWN-SNG', 'OWN-MIO'].forEach((c, j) => { tds[j + 1].textContent = r.prices[c] != null ? fmt(r.prices[c]) : '–'; });
  });
  const ap = site.addon_prices;
  const thm = ap['ADD-THM'] ? fmt(ap['ADD-THM']) : '';
  $('#vatNote').textContent = lang === 'ar'
    ? `الأسعار بالدرهم${site.vat_registered ? ` وقبل ضريبة القيمة المضافة ${site.vat_rate}%` : ''}.${thm ? ` خدمة إضافية: التصوير الحراري ${thm}.` : ''}`
    : `Prices in AED${site.vat_registered ? `, before ${site.vat_rate}% VAT` : ''}.${thm ? ` Add-on: thermal imaging ${thm}.` : ''}`;
}

let lastEstimate = null;
let seq = 0;
async function update() {
  const type = $('#ptype').value;
  $('#bedsWrap').classList.toggle('hide', type === 'studio');
  const body = { service: $('#service').value, property_type: type, bedrooms: type === 'studio' ? 0 : Number($('#beds').value), addons: $$('#addons input:checked').map((i) => i.value) };
  const my = ++seq;
  try {
    const r = await (await fetch('/api/public/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    if (my !== seq) return;
    lastEstimate = r;
    const est = $('#est');
    if (r.error) { est.replaceChildren(p(r.error, 'muted')); return; }
    if (r.quote_needed) { est.replaceChildren(p(L(MSG.quote), 'meta')); mbar.ready = false; mbar.sync(); return; }
    const ul = document.createElement('ul'); ul.className = 'lines';
    for (const l of r.lines) { const li = document.createElement('li'); li.append(span(lang === 'ar' ? arLine(l.label) : l.label), span(fmt(l.amount))); ul.append(li); }
    if (r.vat) { const li = document.createElement('li'); li.append(span(`${L(MSG.vat)} ${r.vat_rate}%`), span(fmt(r.vat))); ul.append(li); }
    const price = document.createElement('p'); price.className = 'price'; price.append(Object.assign(document.createElement('small'), { textContent: 'AED' }), fmt(r.total));
    $('#mbarPrice').textContent = `AED ${fmt(r.total)}`;
    mbar.ready = true; mbar.sync();
    est.replaceChildren(price, p(r.vat ? L(MSG.total) : L(MSG.noVat), 'meta'), ul,
      p([L(MSG.report).replace('{h}', r.turnaround_hours), r.includes_reinspection ? L(MSG.reinsp) : ''].filter(Boolean).join(' · '), 'meta'));
  } catch { /* keep last estimate */ }
}
const p = (t, c) => Object.assign(document.createElement('p'), { textContent: t, className: c || '' });
const span = (t) => Object.assign(document.createElement('span'), { textContent: t });
function arLine(label) {
  const s = site.services.find((x) => x.name === label || x.name.replace(/^Add-on:\s*/, '') === label);
  return s ? svcName(s) : label;
}

// Phone price bar: shown while the booking section is on screen, but never while typing in a field
// and never when the full estimate panel is already visible, so it cannot cover any field.
const mbar = { ready: false, inBook: false, quoteVisible: false, typing: false };
mbar.sync = () => {
  const show = mbar.ready && mbar.inBook && !mbar.quoteVisible && !mbar.typing;
  $('#mbar').classList.toggle('hide', !show);
  document.body.classList.toggle('has-mbar', show);
};
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([e]) => { mbar.inBook = e.isIntersecting; mbar.sync(); }).observe($('#book'));
  new IntersectionObserver(([e]) => { mbar.quoteVisible = e.isIntersecting; mbar.sync(); }, { threshold: 0.25 }).observe($('.quote'));
}
document.addEventListener('focusin', (e) => { if (e.target.matches('input,select,textarea')) { mbar.typing = true; mbar.sync(); } });
document.addEventListener('focusout', () => { setTimeout(() => { mbar.typing = !!document.activeElement?.matches?.('input,select,textarea'); mbar.sync(); }, 50); });
$('#mbar a').addEventListener('click', (e) => { e.preventDefault(); $('#step2').scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => $('#name').focus({ preventScroll: true }), 450); });

$('#bookForm').addEventListener('input', (e) => { if (e.target.closest('.panel:not(.wide)')) update(); });
$('#bookForm').addEventListener('change', (e) => { if (e.target.closest('.panel:not(.wide)')) update(); });

$('#bookForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, err = $('#err');
  const show = (m) => { err.textContent = m; err.classList.remove('hide'); };
  err.classList.add('hide');
  if (!f.name.value.trim()) return show(L(MSG.needName));
  if (!f.mobile.value.trim()) return show(L(MSG.needMobile));
  if (!f.consent.checked) return show(L(MSG.needConsent));
  const type = f.property_type.value;
  const body = {
    name: f.name.value, mobile: f.mobile.value, email: f.email.value, preferred_date: f.preferred_date.value, building: f.building.value, community: f.community.value,
    referral_code: f.referral_code.value, message: f.message.value, consent: true, website: f.website.value, pref_lang: lang,
    service_code: business ? '' : f.service_code.value, property_type: type, bedrooms: type === 'studio' ? 0 : Number(f.bedrooms.value),
    addons: $$('#addons input:checked').map((i) => i.value), client_type: business ? 'company' : 'individual',
    estimate_total: !business && lastEstimate && !lastEstimate.quote_needed ? lastEstimate.total : null,
  };
  const btn = $('#submit'); const label = btn.textContent; btn.disabled = true; btn.textContent = L(MSG.sending);
  try {
    const res = await fetch('/api/public/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(r.error || L(MSG.net));
    f.classList.add('hide');
    $('#refno').textContent = r.ref || '';
    const wa = waLink(`${lang === 'ar' ? 'مرحبًا، أرسلت طلب حجز' : 'Hello, I sent a booking request'} ${r.ref || ''}`);
    if (wa) { $('#waDone').href = wa; $('#waDone').classList.remove('hide'); }
    $('#done').classList.remove('hide'); $('#done').focus();
  } catch (x) { show(x.message || L(MSG.net)); }
  finally { btn.disabled = false; btn.textContent = label; }
});

$('#agentBtn').addEventListener('click', () => { const m = $('#message'); if (!m.value) m.value = L(MSG.agentMsg); });
let business = false;
$('#bizBtn').addEventListener('click', () => { business = true; const m = $('#message'); if (!m.value) m.value = L(MSG.bizMsg); });

(async function init() {
  applyLang();
  try { site = await (await fetch('/api/public/site')).json(); } catch { return; }
  const wa = waLink(lang === 'ar' ? 'مرحبًا، أرغب في حجز فحص عقار' : 'Hello, I would like to book a property inspection');
  if (wa) { $('#waHero').href = wa; $('#waHero').classList.remove('hide'); }
  if (site.rera) $('#trustRera').classList.remove('hide');
  $('#communities').replaceChildren(...site.communities.map((c) => new Option(c)));
  const contact = $('#contact');
  const lines = [site.company, site.address, site.phone && `Tel ${site.phone}`, site.mobile && `Mobile / WhatsApp ${site.mobile}`, site.email, site.licence && `DET licence ${site.licence}`, site.rera && `RERA ${site.rera}`].filter(Boolean);
  contact.replaceChildren(...lines.flatMap((l, i) => (i ? [document.createElement('br'), l] : [l])));
  $('#date').min = new Date().toISOString().slice(0, 10);
  applyLang();
})();
