# Known limitations and outstanding items (read this first)

**Start with `docs/dev/GAP_AUDIT.md`.** It lists every required feature and sub-feature that is missing or only partly done (75 of 203 audited items, 14 of them core). This file covers environment limits and design decisions.

## Not verified in the development environment
The environment had no network, Android SDK, Gradle or device. Therefore:
- **No APK was built.** Source and reproducible build instructions are provided. The GitHub workflow has been checked as valid YAML only.
- **The Kotlin Health Connect plugin has never been compiled or run.** It uses `androidx.health.connect:connect-client:1.1.0-alpha07`. If the Gradle build fails, the workflow uploads the log and builds a working APK without Health Connect; send me the log and I will fix it. The JavaScript side of Health Connect (permission flow, sync, de-duplication, summaries) is tested against a simulated plugin.
- Native voice, the folder picker, notifications and the Filesystem/Share plugins are not exercised here (the JS side is; the native calls are unchanged from V5.0 except notifications and sharing, which are new).
- The web layer was run in headless desktop Chromium (real IndexedDB, real DOM): 44 unit tests and 8 browser flows pass. Android WebView is the same engine family but was not used. No screen-reader test on a device was done.

## Decisions and trade-offs
- IndexedDB, not SQLite: no way to validate a SQLite plugin offline. All access goes through `data/db.js`, so SQLite can replace it later without touching other layers.
- Plain ES modules and JavaScript (JSDoc), not TypeScript/Vite: nothing could be installed. Modules use JSDoc comments only; no type checker is run (the project is checked by its tests, syntax check and the browser flows).
- Debug keystore and app id `com.myworkout.v3` are kept so V5.0 upgrades in place. This is a debug-signed, sideloaded app, not a Play Store release. `MANAGE_EXTERNAL_STORAGE` (media folder) would be rejected by Play.
- Cloud backup is disabled (`allowBackup=false`) so health data does not leave the phone. Use the in-app backup file instead.

## Functional limits
- The Programme Builder creates straight-set sessions in the UI. Supersets, tri-sets and drop sets come from the seed programme and from spreadsheet imports (Block and Rounds columns).
- V5.0 "saved plans" are kept as view-only items (their structure could not be inspected). Malformed per-day overrides are skipped in the mapped data but remain in the pre-upgrade backup.
- The V5.0 programme start date (2 Nov 2026) is a V5.0 constant and is used for the migrated schedule.
- Reminders use general wording (repeating notifications cannot hold per-day text). Delivery timing is subject to Android battery optimisation.
- Estimated one-rep max, load ratio and readiness are simple, explainable heuristics, not clinically validated. They are labelled as such and never change a programme.
- Direct Google Fit and Fastrack integrations are not provided; Health Connect is the route.
- English and kilograms only. Local-time dates.
- Spreadsheet features need `xlsx.full.min.js`, which the workflow copies in; in plain browser development they show a clear message instead.

## Deferred by agreement
Formal QA and regression catalogue, quality reports, full user guide and PDF manual.
