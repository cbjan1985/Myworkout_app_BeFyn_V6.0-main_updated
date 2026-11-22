# Build instructions

## Requirements
- A GitHub account and a private repository (the same way V3 to V5 were built).
- Nothing to install on your computer for the GitHub build.

## Steps
1. Create or open your private repository and upload the contents of this folder (keep the folder structure, including `.github/workflows/`, `signing/` and `legacy/`).
2. Open **Actions** > **Build BeFyn APK** > **Run workflow** (it also runs on every push to `main`).
3. Wait for the run to finish (typically 6 to 10 minutes). Download the artifact **BeFyn_V6.0-APK** and unzip it to get `app-debug.apk`.
4. Copy the APK to the phone and install it over V5.0. Android keeps your data because the app id `com.myworkout.v3` and the signing key `signing/debug.keystore` are unchanged.

## What the workflow does
1. `npm install`, then `npm test` and `node tools/check.mjs` (the build stops if the logic tests, contrast checks or syntax checks fail).
2. Copies the SheetJS library next to the app, runs `npx cap add android`, sets version 6.0 (code 9).
3. Copies `android-overrides/` (voice/folder plugin, Health Connect plugin, MainActivity), applies `patch_manifest.py` and `patch_gradle.py` (Kotlin, Health Connect client, minSdk 26, permissions, Health Connect rationale entries, cloud backup off), syncs the web app, copies the icons from `android-res/`, uses the fixed signing key, runs `./gradlew assembleDebug`.
4. If that build fails, it uploads the build log (`BeFyn_V6.0-health-build-log`) and builds again **without** Health Connect so you still get a working APK. In that APK, More > Health shows "Health Connect is only available in the Android app" style messages. Send me the log and the native part can be fixed.

## Run in a browser (development)
```
node tools/serve.mjs      # http://localhost:8099/
```
Browser mode uses real IndexedDB. Android-only features (native voice, Health Connect, notifications, media folder) show plain "not available" messages.

## Changing the app icon
`node tools/make-icons.mjs` regenerates `android-res/` from the mark defined in that file (needs Playwright).

## Version and app id
- App id `com.myworkout.v3` is kept on purpose, so V5.0 upgrades in place. Do not change it or the keystore unless you accept that Android will treat BeFyn as a different app and V5.0 data will not carry over.
