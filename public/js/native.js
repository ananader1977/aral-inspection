// Phone features of the ARAL mobile app (Android and iPhone, built with Capacitor from the mobile/ folder).
// The app shows these same screens; this file adds the native camera, notifications, Face ID / fingerprint lock,
// the Android back button and opening PDFs and Excel files in the phone's viewer.
// In a normal browser everything here does nothing.
import { api, h, t, toast } from '/js/common.js';

const C = window.Capacitor;
export const isApp = !!(C?.isNativePlatform?.());
export const platform = isApp ? C.getPlatform() : 'web';
const appVersion = (/ARALApp\/([\d.]+)/.exec(navigator.userAgent) || [])[1] || '';
const has = (name) => isApp && (C.isPluginAvailable ? C.isPluginAvailable(name) : !!C.Plugins?.[name]);
/** Calls a native plugin without bundling @capacitor/core: uses the bridge the app injects into the page. */
const call = (name, method, opts = {}) => (C.Plugins?.[name]?.[method] ? C.Plugins[name][method](opts) : C.nativePromise(name, method, opts));
const on = (name, event, cb) => (C.Plugins?.[name]?.addListener ? C.Plugins[name].addListener(event, cb) : C.nativeCallback(name, 'addListener', { eventName: event }, cb));
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

export const hasCamera = () => has('Camera');

/** Opens the phone camera. Returns a File (JPEG), or null when the inspector cancels. */
export async function takePhoto() {
  try {
    const p = await call('Camera', 'getPhoto', { source: 'CAMERA', resultType: 'base64', quality: 85, width: 2560, height: 2560, correctOrientation: true, saveToGallery: false, allowEditing: false });
    const bin = atob(p.base64String);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (has('Haptics')) call('Haptics', 'impact', { style: 'LIGHT' }).catch(() => {});
    return new File([bytes], `photo-${Date.now()}.${p.format === 'png' ? 'png' : 'jpg'}`, { type: p.format === 'png' ? 'image/png' : 'image/jpeg' });
  } catch (e) {
    if (/cancel/i.test(e?.message || '')) return null;
    if (/denied|permission/i.test(e?.message || '')) toast(t('Allow the camera for A R A L in the phone settings.'), 6000);
    else toast(e?.message || t('The camera could not be opened.'), 6000);
    return null;
  }
}

// ---------- start-up ----------
let started = false;
/** Called once the user is signed in. */
export function startNative(me, cfg) {
  if (!isApp || started) return;
  started = true;
  document.documentElement.classList.add('native', `native-${platform}`);
  if (has('StatusBar')) { call('StatusBar', 'setStyle', { style: 'DARK' }).catch(() => {}); if (platform === 'android') call('StatusBar', 'setBackgroundColor', { color: '#0A1F4A' }).catch(() => {}); }
  backButton();
  downloads();
  lockSetup();
  setupPush(cfg?.push || {}).catch((e) => console.warn('push', e));
}

function backButton() {
  if (!has('App')) return;
  on('App', 'backButton', () => {
    const dlg = document.querySelector('dialog[open]');
    if (dlg) return dlg.close();
    const menu = document.querySelector('.capmenu:not(.hide)');
    if (menu) return menu.classList.add('hide');
    if (location.hash && !/^#(dashboard|inspect)?$/.test(location.hash)) return history.back();
    call('App', 'minimizeApp').catch(() => call('App', 'exitApp'));
  });
}

/** PDFs, Excel files and attachments open in the phone's own viewer (the app screen cannot show them). */
function downloads() {
  document.addEventListener('click', async (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href.startsWith('/api/app/') && !href.startsWith('/report.html')) return;
    e.preventDefault();
    try {
      const url = href.startsWith('/api/') ? (await api('POST', '/api/app/download-link', { path: href })).url : location.origin + href;
      if (has('Browser')) await call('Browser', 'open', { url, presentationStyle: 'popover', toolbarColor: '#0A1F4A' });
      else window.open(url, '_blank');
    } catch (x) { toast(x.message, 6000); }
  }, true);
}

// ---------- Face ID / fingerprint lock ----------
const LOCK_KEY = 'aral.lock', AFTER_MS = 5 * 60 * 1000;
export const lockAvailable = async () => {
  if (!has('NativeBiometric')) return false;
  try { return !!(await call('NativeBiometric', 'isAvailable', { useFallback: true })).isAvailable; } catch { return false; }
};
export const lockOn = () => store.get(LOCK_KEY) !== 'off';
export const setLock = (v) => store.set(LOCK_KEY, v ? 'on' : 'off');
let hiddenAt = 0, locked = false, freshLogin = false;
/** The user has just signed in (password or Face ID): no lock screen straight after. */
export const markFreshLogin = () => { freshLogin = true; };
async function lockSetup() {
  if (!(await lockAvailable())) return;
  if (lockOn() && !freshLogin) showLock();
  if (has('App')) on('App', 'appStateChange', ({ isActive }) => {
    if (!isActive) hiddenAt = Date.now();
    else if (lockOn() && hiddenAt && Date.now() - hiddenAt > AFTER_MS) showLock();
  });
}
async function showLock() {
  if (locked) return;
  locked = true;
  const go = async () => {
    try {
      await call('NativeBiometric', 'verifyIdentity', { reason: t('Unlock the A R A L app'), title: 'A R A L', subtitle: t('Unlock the A R A L app'), useFallback: true, maxAttempts: 3 });
      overlay.remove(); locked = false;
    } catch { /* stays locked; the button tries again */ }
  };
  const overlay = h('div', { class: 'applock', role: 'dialog', 'aria-modal': 'true' },
    h('img', { src: '/mark.png', alt: '', width: 72, height: 72 }), h('h2', {}, 'A R A L'), h('p', {}, t('The app is locked.')),
    h('button', { class: 'btn cu', type: 'button', onclick: go }, t('Unlock')));
  document.body.append(overlay);
  go();
}

// ---------- remember me ----------
// The email and password are kept in the phone's secure storage (iPhone Keychain / Android Keystore), never in the
// web page storage. Signing in again takes Face ID / fingerprint when the phone has it.
const REMEMBER_KEY = 'aral.remember';
const credServer = () => location.host;
export const canRemember = () => has('NativeBiometric');
export const rememberOn = () => store.get(REMEMBER_KEY) === 'on';
export async function rememberLogin(username, password) {
  if (!canRemember()) return;
  try { await call('NativeBiometric', 'setCredentials', { username, password, server: credServer() }); store.set(REMEMBER_KEY, 'on'); } catch (e) { console.warn('remember', e); }
}
export async function forgetLogin() {
  store.set(REMEMBER_KEY, 'off');
  if (canRemember()) await call('NativeBiometric', 'deleteCredentials', { server: credServer() }).catch(() => {});
}
/** Asks for Face ID / fingerprint (when the phone has it) and gives back the saved email and password, or null. */
export async function savedLogin() {
  if (!canRemember() || !rememberOn()) return null;
  try {
    if (await lockAvailable()) await call('NativeBiometric', 'verifyIdentity', { reason: t('Sign in to A R A L'), title: 'A R A L', subtitle: t('Sign in to A R A L'), useFallback: true, maxAttempts: 3 });
    const c = await call('NativeBiometric', 'getCredentials', { server: credServer() });
    return c?.username && c?.password ? { email: c.username, password: c.password } : null;
  } catch { return null; }
}

// ---------- notifications ----------
const PUSH_KEY = 'aral.pushToken';
async function setupPush(enabled) {
  if (!has('PushNotifications') || !enabled[platform]) return;
  // Android needs Firebase in the app; builds without it say so in the user agent
  if (platform === 'android' && !/ARALApp\/[\d.]+ push/.test(navigator.userAgent)) return;
  on('PushNotifications', 'registration', async ({ value }) => {
    store.set(PUSH_KEY, value);
    await api('POST', '/api/app/devices', { token: value, platform, name: platform === 'ios' ? 'iPhone' : 'Android', app_version: appVersion }).catch(() => {});
  });
  on('PushNotifications', 'registrationError', (e) => console.warn('push registration', e));
  on('PushNotifications', 'pushNotificationReceived', (n) => toast([n.title, n.body].filter(Boolean).join(': '), 6000));
  on('PushNotifications', 'pushNotificationActionPerformed', ({ notification }) => {
    const url = notification?.data?.url || '';
    const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
    if (hash) location.hash = hash;
  });
  let perm = await call('PushNotifications', 'checkPermissions');
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await call('PushNotifications', 'requestPermissions');
  if (perm.receive === 'granted') await call('PushNotifications', 'register');
}
/** Before signing out: this phone stops getting that user's notifications. */
export async function forgetDevice() {
  const tok = store.get(PUSH_KEY);
  if (isApp && tok) await api('DELETE', '/api/app/devices', { token: tok }).catch(() => {});
}
export const sendTestPush = () => api('POST', '/api/app/devices/test', {});
