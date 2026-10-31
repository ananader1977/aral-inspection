# A R A L mobile app (Android and iPhone)

The staff app (inspectors, office, technical manager, accounts). It opens the live A R A L system
(`https://www.araluae.com/app/`) inside a real phone app and adds:

- **Native camera** for inspection photos (sharper, stays inside the app); gallery, video and thermal as before
- **Notifications**: new or rescheduled job → the inspector; report returned → the inspector;
  report ready for review → technical manager; new website enquiry, quote accepted, payment, access failed → office
- **Face ID / fingerprint lock** after 5 minutes away (on/off under *My account → This phone*)
- **Stays signed in for 7 days** (browsers: 12 hours). The Super Admin still signs in every 12 hours.
- PDFs, Excel exports and attachments open in the phone's viewer (one-time 5-minute link)
- Android back button, works offline after the first open (the same offline queue as the web app)

Every screen change made on the server shows in the app straight away. A new app build is only needed when
something in `mobile/` changes (name, icon, permissions, plugins).

## Builds (automatic, in GitHub Actions)

Every push that changes `mobile/` runs **Actions → Mobile app**. You can also run it by hand there.

| | Without store accounts (now) | With the secrets below |
|---|---|---|
| Android | Test APK on the **mobile-latest** release page: open it on the phone, tap the `.apk` | Signed APK + `.aab` for Google Play |
| iPhone | Checks that the app compiles | Signed and uploaded to **TestFlight** |

Download page: https://github.com/ananader1977/aral-inspection/releases/tag/mobile-latest

Installing the test APK: Android asks to allow "Install unknown apps" for the browser once. Test builds are
signed with a temporary key, so before installing a newer test build uninstall the old one.

## Step by step to the stores

### 1. Accounts (you)
- **Apple Developer Program**: developer.apple.com/programs, USD 99 per year. Enrol as an organisation
  (needs a D-U-N-S number for the company, free, about a week) or as an individual (faster; your name shows as seller).
- **Google Play Console**: play.google.com/console, USD 25 once. New personal accounts must run a closed test with
  12 testers for 14 days before going public; organisation accounts do not.

### 2. Android signing key (once, keep it forever)
```
keytool -genkeypair -v -keystore aral-upload.jks -alias aral -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 aral-upload.jks   # copy the output
```
GitHub → repository → Settings → Secrets and variables → Actions → New repository secret:
`ANDROID_KEYSTORE_BASE64` (the base64 text), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`aral`),
`ANDROID_KEY_PASSWORD` (if different). Keep the `.jks` file and passwords in a password manager.

### 3. Notifications
- **Android**: console.firebase.google.com → new project "A R A L" → add an Android app with package
  `com.aralinspection.app` → download `google-services.json` → GitHub secret `GOOGLE_SERVICES_JSON` (paste the file).
  Then Project settings → Service accounts → Generate new private key → on Render add `FCM_SERVICE_ACCOUNT`
  (paste the JSON).
- **iPhone**: developer.apple.com → Certificates, Identifiers & Profiles → Keys → **+** → Apple Push Notifications
  service → download the `.p8` file. On Render add `APNS_KEY` (the file content), `APNS_KEY_ID`, `APNS_TEAM_ID`.
- Check: *My account → This phone → Send a test notification*.

### 4. iPhone uploads (TestFlight)
- App Store Connect → Apps → **+** → New app, bundle ID `com.aralinspection.app`, name "A R A L Inspection".
- Users and Access → Integrations → App Store Connect API → generate a key with **App Manager** access.
- GitHub secrets: `APPSTORE_API_KEY_P8` (the `.p8` content), `APPSTORE_API_KEY_ID`, `APPSTORE_ISSUER_ID`,
  `APPLE_TEAM_ID` (Membership page).
- Run **Actions → Mobile app**. The build appears in TestFlight in 10–30 minutes; add staff as testers.

### 5. Publishing a staff-only app
Store reviewers must be able to sign in: create a reviewer account (role Inspector, demo data) and give it in the
review notes. For staff only, the usual routes are:
- **iPhone**: TestFlight for the team (builds last 90 days), or App Store **unlisted** distribution
  (request at developer.apple.com/contact/request/unlisted-app), or Apple Business Manager custom app.
- **Android**: Play Console internal testing (up to 100 people, no review wait) or a private app in managed Google Play,
  or the signed APK directly.

## Working on the app locally (optional)
Node 22+, Android Studio (Android) or a Mac with Xcode 26+ (iPhone):
```
cd mobile
npm install
npm run android      # or: npm run ios   (creates android/ or ios/, patches permissions, icons, version)
npx cap open android # or: npx cap open ios
```
`android/` and `ios/` are generated: put changes in `scripts/prepare.mjs` so every build gets them.
To point a build at another server: `APP_URL=https://staging.example.com npm run android`
(in Actions: Run workflow → app_url, or the repository variable `APP_URL`).
Version: `version` in `package.json` (shown in the stores); the build number goes up by itself.
