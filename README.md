# BeFyn 6.5

A personal fitness and wellness companion for Android (Capacitor + plain ES modules). Everything is stored on the phone.
BeFyn 6.5 is the upgrade of "My Workouts" V5.0; it installs over V5.0 (same app id and signing key) and migrates its data.

## What is in this package
| Path | What |
|---|---|
| `www/` | The app (HTML, CSS, ES modules). No bundler is needed. |
| `www/src/domain/` | Pure business rules: schedule engine, programme model, progression, insights, nutrition |
| `www/src/data/` | IndexedDB schema and repositories, V5.0 migration, backup/restore, spreadsheet mapping |
| `www/src/services/` | Application layer (use cases) |
| `www/src/platform/` | Android/WebView adapters: files, voice, notifications, Health Connect, media |
| `www/src/ui/` | Design system, router, screens, sheets |
| `www/assets/seed/` | The 8-week programme template and exercise catalogue (generated from the V5.0 plan) |
| `android-overrides/`, `android-res/`, `patch_*.py`, `.github/workflows/` | Android project additions and the GitHub build |
| `tests/` | Unit tests (Node) and browser flows (Playwright) |
| `tools/` | Seed generator, checks, dev server, icon generator |
| `legacy/` | V5.0 plan data and page, kept for the seed generator, tests and reference |
| `docs/` | Handover documents (below) |

## Commands
```
npm install            # only needed to build the APK (Capacitor, SheetJS)
npm test               # 56 unit and integration tests (domain, data, migration, services, reminders, security scanner)
node tools/check.mjs   # colour-contrast (light and dark), syntax of every module, import graph
node tools/security-scan.mjs   # static security scan (secrets, APIs, CSP, Android settings, dependencies, CI)
bash tests/ci/dry-run.sh       # the build scripts against stub Gradle: failures not masked, fallback, APK verification
node tools/serve.mjs   # serve www/ on http://localhost:8099 (open /?debug=1 for the test handle)
sh tools/e2e.sh        # 16 browser flows in headless Chromium (needs Playwright installed)
sh tools/monkey.sh     # randomised UI test
npm run seed           # regenerate www/assets/seed from legacy/plan_v4.js
```

## Build the APK
See `docs/BUILD_INSTRUCTIONS.md`. In short: push this folder to your private GitHub repository; the workflow
`.github/workflows/build-apk.yml` runs the checks and builds the APK (artifact `BeFyn_V6.5-APK`, file `BeFyn_V6.5.apk`).

## Documents
- `BeFyn_V6.5_Release_Notes.md` what changed, what is verified, recommendation
- `docs/BUILD_REPORT.md` why no APK was produced and the permanent fix
- `docs/UPGRADE_COMPATIBILITY_REPORT.md` V5.0 to V6.5 identity, signing and migration
- `docs/security/` security assessment and vulnerability register
- `docs/dev/TEST_EVIDENCE.md` what was actually run
- `docs/CHANGELOG_V5_TO_V6.md` earlier V6.0 changes
- `docs/RETAINED_IMPROVED_REPLACED.md` what happened to each V5.0 capability
- `docs/ARCHITECTURE.md` modules, data model, schedule engine, migration
- `docs/BUILD_INSTRUCTIONS.md` reproducible build and install
- `docs/KNOWN_LIMITATIONS.md` what is unverified or outstanding (read this first)
- `docs/dev/GAP_AUDIT.md` what is missing or partial against the specification (counted)
- `docs/dev/DEVELOPMENT_STATUS.md` development status and resume instructions
