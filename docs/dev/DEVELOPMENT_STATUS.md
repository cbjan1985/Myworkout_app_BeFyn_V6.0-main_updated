# BeFyn V6.5 development status

Last updated: 2026-11-22 (release-candidate checkpoint)

## Release
- Version: **BeFyn V6.5**, versionName 6.5, versionCode 10, application id `com.myworkout.v3` (unchanged), APK `BeFyn_V6.5.apk`, artifact `BeFyn_V6.5-APK`.
- Logo, launcher icons and flash-screen image: the original V5.0 files, unchanged; flash screen 3.5 s; only the name text is BeFyn.
- Recommendation: **Not Ready for Release** until the workflow builds and verifies the APK and the upgrade is tested on a phone. Then: Ready with Documented Limitations.

## Work completed (this session)
- Build: root cause of "green run, no APK" (pipe masked Gradle failure) proven and fixed; Kotlin override conflict fixed; build and APK-verification scripts; fallback build; signer-identity check; dry-run test (22 checks).
- Defects fixed: completed-programme state, early finish, instruction text, session history/detail/correction, schedule-aware reminders, timing preferences, superset rest, resume with no changes, sheet-close navigation race, others in `docs/dev/TEST_EVIDENCE.md`.
- Features: builder sections and supersets, duplicate programme, saved-workout editing, local exercise media, week view, Progress History/Activity/ranges/trends, SpO2, profile, other apps, protein edit, backup reminder, protected backups.
- Security: static scanner with self-test, import hardening, SheetJS upgrade, notification privacy, non-debuggable APK, WebView/cleartext hardening, register and assessment in `docs/security/`.

## Tests executed
56 unit/integration, 22 CI-logic, 16 browser flows, import graph/contrast/syntax, security scan, about 5,000 randomised UI actions (no application errors). Not executed: Gradle, APK, device, install over V5.0.

## Files changed (main)
New: `tools/android-build.sh`, `tools/verify-apk.sh`, `tools/security-scan.mjs`, `tools/audit-gate.mjs`, `tools/monkey.sh`, `tests/ci/*`, `tests/e2e/monkey.mjs`, `tests/reminders.test.js`, `tests/security-scan.test.js`, `www/src/domain/reminders.js`, `www/src/data/backup-crypto.js`, `www/src/ui/section-editor.js`, `www/src/version.js`, `www/styles/splash.css`, `signing/V5_CERT_SHA256.txt`, `docs/security/*`, reports. Rewritten: workflow, `patch_gradle.py`, `patch_manifest.py`, `builder.js`, `progress.js`. Many smaller edits across services and screens.

## Blockers
No Android SDK, Gradle, device or network in the development environment.

## Exact next actions
1. Run the workflow (see `docs/BUILD_INSTRUCTIONS.md`); if red, use the run summary and log artifact.
2. Install over V5.0 and run the upgrade checks in `docs/UPGRADE_COMPATIBILITY_REPORT.md`.
3. Move the keystore to the secret `BEFYN_V5_KEYSTORE_BASE64`.
4. Then the remaining gaps in `docs/dev/GAP_AUDIT.md` (P1 first).

## Resume instruction
Read this file and the source tree; the source is the truth. Continue from the next action above.
