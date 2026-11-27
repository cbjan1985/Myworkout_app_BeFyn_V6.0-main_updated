# V5.0 to V6.5 upgrade compatibility report

## Identity and signing
| Item | V5.0 | V6.5 | Result |
|---|---|---|---|
| Application id | `com.myworkout.v3` | `com.myworkout.v3` | Same (unchanged on purpose) |
| Signing key | `signing/debug.keystore` in the V5.0 package | the same file (byte-identical, verified with `cmp`) | Same |
| Certificate SHA-256 | `63:21:01:46:A6:86:36:D1:2D:85:B0:D1:62:BC:C7:42:98:13:B4:EC:E4:36:39:F0:2A:72:9E:11:B2:8F:0B:B3` (alias `androiddebugkey`) | enforced by the workflow against `signing/V5_CERT_SHA256.txt`, both for the keystore and for the built APK | Enforced in CI |
| versionCode | 8 | **10** (the V6.0 repository used 9; never reused or lowered) | Higher |
| versionName | 5.0 | 6.5 | |
| minSdk | Capacitor default (22) | 26 in the Health Connect build (Android 8.0+); unchanged in the fallback build | Android 7 phones need the fallback build |
| TrekPo key | not used | not used | The key you uploaded belongs to another app and was deliberately not used |

I verified that the committed keystore is the one in the V5.0 package. I **cannot verify that the V5.0 APK installed on your phone was signed with it** (I do not have that APK or the phone). The V4.x to V5 build notes say it was, which is why the identity is enforced here. If Android answers "App not installed" or "signatures conflict", the phone's V5.0 was signed with a different key; do not uninstall V5.0 (that would delete the data). Tell me and we will use the migration backup route.

## Data migration (V5.0 localStorage and IndexedDB to BeFyn)
Steps: detect, in-database safety backup of the raw V5.0 data (plus a file copy when possible), parse and validate, map, verify counts and relationships, commit atomically with the success flag in the same transaction, never delete V5.0 data, idempotent by deterministic record ids. Covered: workout history (every set), programme (stock V5 plan recognised by fingerprint; an edited plan is kept as its own template), the programme instance and schedule (start 2 Nov 2026), exercises including your custom library and video links (web links only), hidden items (become archived), saved sessions and per-day overrides (as Saved workouts), settings, breathing timing, other-app links, and the encrypted health vault (imported only with your own password; no default password).

## Tests actually executed
| Test | Result |
|---|---|
| Node: stock V5-shaped state migrates (programme, logs, sets, exercises, preferences) | Pass |
| Node: idempotent re-run, failed first attempt then retry, corrupt data, failed commit, fresh install, verification catches a broken mapping | Pass |
| Node: edited V5 programme kept as its own template | Pass |
| Node: encrypted V5 health vault decrypts with the right password only and maps to measurements | Pass |
| **Browser, real V5.0 page**: the original V5.0 app runs in headless Chromium, builds its own state and logs sets with its own code, then BeFyn on the same origin migrates it. Result: stock plan recognised, 3 logs, every set migrated exactly once, 3 sessions completed, V5.0 data untouched, backup present, second launch does not duplicate | Pass |
| Browser: V5 upgrade with a missed-weeks state, "continue where I left off", undo | Pass |
| Browser: fresh V6.5 install, onboarding, start programme, run a workout | Pass |

## Not verified
Installing V6.5 over V5.0 on a phone, with your real data and the real signing identity of the installed app. The APK itself. WebView storage behaviour on Android (IndexedDB and localStorage persist across an in-place update when the app id and key are unchanged, which is standard Android behaviour but untested here). Run this on your phone after the build: install over V5.0, open BeFyn, confirm the welcome summary shows your workout and set counts, and open More > Backup to save the pre-upgrade backup copy.
