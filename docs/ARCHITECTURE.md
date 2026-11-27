# Architecture overview

## Layers (dependencies point downwards only)
```
ui/            screens, sheets, router, design system         (DOM)
services/      use cases: programme, sessions, library, tracking, data I/O   (no DOM)
platform/      Android/WebView adapters: files, voice, notifications, Health Connect, media
domain/        pure rules: schedule-engine, programme, progression, insights, nutrition   (no I/O)
data/          IndexedDB adapter + repositories, migration, backup, spreadsheet mapping
core/          ids, ISO-date maths, result helpers
```
`domain/` and `data/` have no DOM and run in Node (that is how the 44 unit tests work). `services/` runs in Node with the in-memory adapter and fake platform objects.
There is no bundler: the browser loads native ES modules from `www/src`. Third-party code: Capacitor (native shell) and SheetJS (loaded on demand for spreadsheets).

## Domain model
- **ProgrammeTemplate** `{id, version, status draft|published|archived, phases[], sessions[]}`; session = `{id, week, dayOfWeek, name, kind, sections{warmup,main,flow,breathing,cooldown}}`; main blocks are `straight`, `superset`, `triset` or `dropset` with items `{exercise, sets, reps|secs, rest, load, side, breath}`. Published versions are immutable (enforced in the repository).
- **ProgrammeInstance** `{templateId, templateVersion, startDate, trainingDays, status active|paused|completed|cancelled, cursor{seq}, pause}`.
- **ScheduledSession** `{id, seq, run, ref, week, date, status planned|completed|skipped, performedOn, logId}`. `seq` is the programme position and never changes when a session moves. `run` increases when a week is repeated; older runs stay as history.
- **SessionLog** `{id, scheduledId?, date, performances[{exercise, side, sets[{reps,kg,secs,restSec,done}]}], feedback, durationSec}` is append-only; corrections keep the previous version in `revisions`.
- **Exercise** (master record), **Workout** (saved standalone), **Measurement**, **HealthRecord** (with `extKey` = source + external id), **ProteinEntry**, **Reminder**, **ScheduleChange**.
- Cursor = lowest `seq` whose latest run is not completed or skipped. It is derived, not trusted: `reconcile` repairs a stored cursor that disagrees.

## Schedule engine (`domain/schedule-engine.js`)
Pure functions over `{instance, sessions}`: `generateSchedule`, `preview`, `apply`, `undo`, `status`.
Operations: `move`, `swap`, `moveWeek`, `shift`, `pause`, `resume`, `resolveMissed(shift|skip|repeatWeek|jump)`, `restartFromWeek`, `jump`, `reconcile`.
Invariants (all covered by tests): sessions keep identity when moved; one session per day; weeks stay in order (reordering only inside a week); no moves into the past; completed sessions are never changed; a missed session never advances the cursor; every change is previewed, needs explicit confirmation, is recorded and can be undone while nothing has changed since.

## Persistence (`data/db.js`)
IndexedDB `befyn` v1, stores: meta, prefs, templates, exercises, workouts, instances, scheduled, changes, logs, measurements, health, nutrition, reminders. All multi-record writes use one atomic transaction (`repos.write`). A memory adapter with the same interface is used in tests and as a visible-degraded fallback if IndexedDB is unavailable. Media blobs that V5.0 stored in IndexedDB `wk3` are still read from there.
Schema changes: bump `SCHEMA_VERSION`, add stores/indexes in `onupgradeneeded`, add a migration function; the backup format records the schema version and refuses files from a newer one.

## Migration V5.0 to V6.0 (`data/migration.js`)
detect legacy data (`localStorage['myWorkouts.v3']`) > save a recoverable backup (inside the database, and as a file when possible) > parse and validate > map (preferences, exercises, programme, instance and schedule, history, saved workouts) > verify (set counts, references, dates) > commit everything and the success flag in one transaction. Deterministic ids make a retry idempotent. The V5.0 keys are never modified or removed. A stock V5.0 plan is recognised by a signature and mapped to the seed template; an edited plan becomes its own personal template.
V5.0 completes a programme session only if main-section sets were logged that day; warm-up-only days stay "waiting". The encrypted health vault is imported only when the person enters their own password.

## Platform adapters
- Voice: existing native `GifFolder` plugin (`speak`, `stopSpeak`), browser speech, then tones.
- Folder media: existing `GifFolder` plugin (`pickFolder`, `listGifs`, `requestAccess`).
- Health Connect: `FiT85Health` Kotlin plugin (`getStatus`, `requestPermissions`, `readRecords`, `openSettings`), read-only.
- Reminders: `@capacitor/local-notifications` (weekly repeating, allowed while idle).
- Files: `@capacitor/filesystem` (Documents/FiT85) and `@capacitor/share`.

## Routing and UI
Hash routes (`#/today`, `#/train`, `#/calendar`, `#/progress`, `#/more/...`, full-screen `#/workout`). Sheets push a history entry so Android Back closes the top sheet first; navigation waits for a closing sheet to settle. Colour comes only from semantic tokens in `styles/tokens.css` (light and dark), checked by `tools/check.mjs`.
