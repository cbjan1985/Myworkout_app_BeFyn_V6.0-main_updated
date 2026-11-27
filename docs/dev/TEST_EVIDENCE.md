# Test evidence: BeFyn V6.5 (executed in the development environment)

| Suite | Command | Result |
|---|---|---|
| Unit and integration (Node, in-memory database, fake platform) | `npm test` | **56 passed, 0 failed** (schedule engine 18, migration 8, backup/crypto/spreadsheet/health 11, application services 10, reminders 7, security scanner 2) |
| Project checks | `node tools/check.mjs` | contrast OK (56 pairs, light and dark), syntax OK, import graph OK (47 modules) |
| Static security scan | `node tools/security-scan.mjs` | no blocking findings (P2 x1, P3 x2 accepted) |
| CI logic with stub Gradle | `bash tests/ci/dry-run.sh` | **22 passed, 0 failed** |
| Browser flows (headless Chromium 157, real IndexedDB) | `sh tools/e2e.sh` | **16 flows passed** in about 3 minutes |
| Randomised UI test | `sh tools/monkey.sh` | about 5,000 random actions over 12 seeds (6 of them on near-final code): **0 application script errors**. Some early runs were cut short by my own time-out wrapper, not by the app; the wrapper is fixed. |

Browser flows: fresh install and first workout; V5 upgrade with missed weeks; real V5.0 page to V6.5 migration; layout, names and overflow at 320, 390, 412 and 768 px in light and dark (4 flows); schedule tools; builder and exercise catalogue; backup, restore, nutrition, measurements, reminders; Health Connect with a simulated plugin; player mechanics and resume; flash screen timing and brand row; programme completion, history, correction and early finish; get-ready countdown, protected backup, local media, superset builder, saved-workout edit, week view; Progress > Activity with SpO2.

## Defects found by testing and fixed in V6.5 (beyond the audit list)
| Defect | Found by |
|---|---|
| Supersets: the rest after the round was applied after every exercise in the round, not only the last | review of the step builder, then test |
| Default rest between sets of a straight exercise never applied (the code path was unreachable) | review, then E2E |
| Sheet close followed by navigation lost the navigation (asynchronous `history.back`) | E2E (builder flow) |
| A finished programme was never reloaded, so "Programme complete" could not appear | audit, then E2E |
| Resuming a paused programme was impossible when no session needed to move (Apply stayed disabled) | E2E (date-dependent) |
| Warm-up, stretching and yoga text from V5.0 was stored but never shown | audit |
| Reminders fired at fixed times regardless of the schedule | audit |
| Three Preferences timing controls did nothing | audit |
| The debug handle was set too late in start-up (race) | E2E |

## Not executed (needs an APK or device)
Gradle/Kotlin compilation, the real APK checks, install over V5.0, native voice, folder picker, notifications delivery, Health Connect on a phone, Android WebView behaviour, screen reader and large-text checks.
