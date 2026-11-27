# BeFyn V6.5 release notes

**Recommendation: Not Ready for Release yet.** Everything that can be checked without an Android build has passed, but the release criteria require a generated, verified APK and an upgrade test over V5.0, and neither exists yet. After one successful run of the corrected workflow and an install-over-V5.0 on your phone, this becomes **Ready with Documented Limitations** (listed below).

| Item | Value |
|---|---|
| Product / release | BeFyn V6.5 |
| Android versionName / versionCode | 6.5 / 10 (V6.0 repo: 9, V5.0: 8) |
| Application id | `com.myworkout.v3` (unchanged, so it upgrades V5.0) |
| APK file / artifact | `BeFyn_V6.5.apk` / `BeFyn_V6.5-APK` (a no-Health-Connect fallback would be `BeFyn_V6.5_no-health.apk`) |
| Logo and flash screen | **Unchanged**: the original V5.0 logo and launcher icons (byte-identical) and the V5.0 flash screen, shown for 3.5 seconds. Only the name text now reads BeFyn. |

## What is new since V6.0
**Build and release**
- The cause of "green run, no APK" is fixed (a failed build was masked by a pipe). The workflow now fails on any build failure, verifies the APK, and publishes it with logs. A Health Connect build failure triggers a second build without it.
- The Kotlin compile error (`requestPermissions` hiding a Capacitor member) is fixed.
- The APK signer is checked against the V5.0 certificate, so an APK that could not upgrade V5.0 is never published.

**Training**
- Programme completion is shown (Today and Train) with Start again.
- Finish a workout early: save as partial, or count it as done.
- Session history with search, filters, full detail and audited corrections.
- Reminders follow your real schedule (workout, evening before, gentle nudge after a missed session, weekly check-in) and re-plan after changes. Notification text is generic unless you opt in.
- All workout timing settings now work (rest, break between exercises, get-ready countdown, breathing break, auto-rest). Superset rest is applied after the round, not after every exercise.
- Programme Builder: choose training days, edit warm-up, main, flow, breathing and stretching, create supersets and tri-sets, week-at-a-glance, duplicate a programme.
- Saved workouts can be edited. Blank Excel template download.
- Exercises: secondary muscles, starting position, variations, progressions, difficulty filter, your own photo/GIF/video stored in the app, and the V5.0 warm-up, stretching and yoga text carried over (71 exercises have no text in the original programme data).
- Programme guide and phases shown in programme details.
- Calendar week view; calendar markers differ by shape, not only colour.
- Progress: History, Activity (steps, calories, sleep, heart rate, exercise sessions, SpO2 from Health Connect), trends for every measurement, selectable time ranges, weekly training load.
- Profile (name, goal), other-app links, protein entries can be edited, backup reminder, tagline.

**Security** (full detail in `docs/security/`)
- Password-protected backups (AES-256-GCM). Hardened imports. SheetJS upgraded past two known CVEs. Non-debuggable APK, cleartext and WebView debugging off. Automated security scan with a self-test and CI gate.

## Verified here
56 unit/integration tests, 22 CI-logic checks, 16 browser flows (including the **real V5.0 page upgraded to V6.5**), layout at four widths in both themes, contrast, import graph, security scan, about 5,000 randomised UI actions with no application errors. Details: `docs/dev/TEST_EVIDENCE.md`.

## Not verified (no Android SDK, device or network here)
Gradle/Kotlin compilation and the APK itself; the Health Connect library API (alpha); install over V5.0 on a phone and the V5.0 signing identity of the installed app; native voice, folder picker and notification delivery; Android WebView behaviour; screen-reader and large-text checks; OWASP Dependency-Check, MobSF, Semgrep, Gitleaks and a local `npm audit`.

## Documented limitations
- Not yet done: substitute an exercise or add/remove a set during a workout, automatic (scheduled) backup files, a per-day workout override, bulk copy of programme weeks, load-progression and deload rules, resolving one missed session individually, converting V5.0 "saved plans" into runnable workouts, units other than kg, equipment preference in onboarding. See `docs/dev/GAP_AUDIT.md` (208 sub-features audited: 161 done, 14 built but device-only, 18 partial, 15 missing).
- 71 warm-up and yoga exercises have no instruction text in the source data.
- Android 8.0+ is needed for the Health Connect build; the fallback keeps the older minimum.
- The V5.0 signing file is still in the repository (move it to the secret `BEFYN_V5_KEYSTORE_BASE64`). `MANAGE_EXTERNAL_STORAGE` remains for the optional media folder. Data on the phone is not encrypted at rest beyond Android's app sandbox.
- No TypeScript, SQLite or component framework (nothing could be installed here); the data layer is isolated so SQLite can replace IndexedDB later.

## Next actions
1. Replace the repository contents with this package (delete the old `.jss` strays); commit.
2. Run **Actions > Build BeFyn APK**; confirm artifact `BeFyn_V6.5-APK`. If red, send the run summary and the log artifact.
3. Install over V5.0; check the welcome summary and save the pre-upgrade backup (More > Backup).
4. Move the keystore to the repository secret and delete the file.
