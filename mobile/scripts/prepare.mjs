// Builds the native Android / iOS projects for the ARAL app, ready to compile:
//   node scripts/prepare.mjs            (both; iOS only on a Mac or with --force-ios)
//   node scripts/prepare.mjs android
//   node scripts/prepare.mjs ios
// Settings (environment variables, all optional):
//   APP_URL               address of the ARAL system (default: capacitor.config.json server.url)
//   APP_VERSION           version shown in the stores (default: package.json version)
//   BUILD_NUMBER          whole number that goes up with every store upload (default: GITHUB_RUN_NUMBER or 1)
//   GOOGLE_SERVICES_JSON  Firebase google-services.json for Android notifications (JSON or base64)
// The android/ and ios/ folders are generated: change this script (not those folders) so every build gets the change.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const want = process.argv[2] || 'all';
const doAndroid = want === 'all' || want === 'android';
const doIos = want === 'ios' || (want === 'all' && (process.platform === 'darwin' || process.argv.includes('--force-ios')));
const sh = (cmd) => { console.log(`$ ${cmd}`); execSync(cmd, { stdio: 'inherit' }); };
const read = (f) => fs.readFileSync(f, 'utf8');
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const patch = (f, fn) => { if (!fs.existsSync(f)) { console.warn(`! missing ${f}`); return; } const a = read(f); const b = fn(a); if (b !== a) { write(f, b); console.log(`patched ${f}`); } };

// ---------- settings ----------
const pkg = JSON.parse(read('package.json'));
const cfgFile = 'capacitor.config.json';
const cfg = JSON.parse(read(cfgFile));
const appUrl = new URL(process.env.APP_URL || cfg.server.url);
if (!appUrl.pathname.startsWith('/app')) appUrl.pathname = '/app/';
const version = (process.env.APP_VERSION || pkg.version).replace(/^v/, '');
const build = Number(process.env.BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || 1);
const host = appUrl.hostname;
let gsj = (process.env.GOOGLE_SERVICES_JSON || '').trim();
if (gsj && !gsj.startsWith('{')) gsj = Buffer.from(gsj, 'base64').toString('utf8');
if (!gsj && fs.existsSync('google-services.json')) gsj = read('google-services.json');
const androidPush = !!gsj;
console.log(`ARAL app ${version} (${build}) → ${appUrl.href}${androidPush ? ' · Android notifications on' : ''}`);

cfg.server.url = appUrl.href;
// the web app reads this to know it runs inside the phone app (and whether Android has Firebase)
cfg.appendUserAgent = `ARALApp/${version}`;
cfg.android = { ...cfg.android, appendUserAgent: `ARALApp/${version}${androidPush ? ' push' : ''}` };
cfg.ios = { ...cfg.ios, appendUserAgent: ` ARALApp/${version}` };
write(cfgFile, `${JSON.stringify(cfg, null, 2)}\n`);

// ---------- local pages (shown before the first load / without signal) ----------
fs.rmSync('www', { recursive: true, force: true });
fs.mkdirSync('www');
for (const f of fs.readdirSync('web')) {
  const src = path.join('web', f);
  if (f.endsWith('.html')) write(path.join('www', f), read(src).replaceAll('__APP_URL__', appUrl.href));
  else fs.copyFileSync(src, path.join('www', f));
}

// ---------- icons and splash (from assets/) ----------
function icons(platform) {
  try {
    sh(`npx --no-install capacitor-assets generate --${platform} --iconBackgroundColor "#ffffff" --iconBackgroundColorDark "#ffffff" --splashBackgroundColor "#ffffff" --splashBackgroundColorDark "#0A1F4A"`);
  } catch { console.warn('! icons were not generated (the default Capacitor icon is used)'); }
}

// ---------- Android ----------
if (doAndroid) {
  if (!fs.existsSync('android')) sh('npx cap add android');
  const man = 'android/app/src/main/AndroidManifest.xml';
  patch(man, (s) => {
    const perms = ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS', 'android.permission.USE_BIOMETRIC', 'android.permission.RECORD_AUDIO'];
    for (const p of perms) if (!s.includes(`"${p}"`)) s = s.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
    if (!s.includes('android.hardware.camera')) s = s.replace('</manifest>', '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n</manifest>');
    // no WebView reload when the screen size or density changes (Capacitor 8 advice)
    s = s.replace(/android:configChanges="([^"]*)"/, (m, v) => (v.includes('density') ? m : `android:configChanges="${v}|density"`));
    return s;
  });
  patch('android/app/build.gradle', (s) => s
    .replace(/versionCode\s*=?\s*\d+/, `versionCode = ${build}`)
    .replace(/versionName\s*=?\s*"[^"]*"/, `versionName = "${version}"`));
  if (gsj) write('android/app/google-services.json', gsj);
  else fs.rmSync('android/app/google-services.json', { force: true });
  icons('android');
  sh('npx cap sync android');
}

// ---------- iOS ----------
if (doIos) {
  if (!fs.existsSync('ios')) sh('npx cap add ios');
  const plist = 'ios/App/App/Info.plist';
  const entries = {
    CFBundleDisplayName: '<string>A R A L</string>',
    NSCameraUsageDescription: '<string>A R A L uses the camera to take photos and videos of the property for the inspection report.</string>',
    NSPhotoLibraryUsageDescription: '<string>A R A L lets you choose photos from your library to add to the inspection report.</string>',
    NSPhotoLibraryAddUsageDescription: '<string>A R A L can save inspection photos to your library.</string>',
    NSMicrophoneUsageDescription: '<string>A R A L records sound with inspection videos.</string>',
    NSFaceIDUsageDescription: '<string>A R A L uses Face ID to unlock the app.</string>',
    ITSAppUsesNonExemptEncryption: '<false/>',
    // the system's own address: lets the app work offline (service worker) and keeps navigation inside it
    WKAppBoundDomains: `<array>\n\t\t<string>${host}</string>\n\t</array>`,
    UIBackgroundModes: '<array>\n\t\t<string>remote-notification</string>\n\t</array>',
  };
  patch(plist, (s) => {
    for (const [k, v] of Object.entries(entries)) {
      const re = new RegExp(`\\t<key>${k}</key>\\s*(<string>[^<]*</string>|<array>[\\s\\S]*?</array>|<true/>|<false/>)\\n`);
      s = re.test(s) ? s.replace(re, `\t<key>${k}</key>\n\t${v}\n`) : s.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${k}</key>\n\t${v}\n</dict>\n</plist>\n`);
    }
    return s;
  });
  write('ios/App/App/App.entitlements', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>aps-environment</key>
\t<string>production</string>
</dict>
</plist>
`);
  patch('ios/App/App.xcodeproj/project.pbxproj', (s) => s
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`)
    .replace(/IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;')
    .replace(/(\n(\s*)PRODUCT_BUNDLE_IDENTIFIER = [^;]+;)(?!\n\s*CODE_SIGN_ENTITLEMENTS)/g, '$1\n$2CODE_SIGN_ENTITLEMENTS = App/App.entitlements;'));
  // hand the Apple notification token to Capacitor (required by @capacitor/push-notifications)
  patch('ios/App/App/AppDelegate.swift', (s) => (s.includes('capacitorDidRegisterForRemoteNotifications') ? s : s.replace(/(var window: UIWindow\?\n)/, `$1
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
`)));
  icons('ios');
  sh('npx cap sync ios');
}
console.log('Ready.');
