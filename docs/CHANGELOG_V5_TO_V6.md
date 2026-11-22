# Changelog: V5.0 to BeFyn 6.0 (V6.0 + V6.1 + V6.2 delivered together)

## Product
- **New name, identity and design system**: BeFyn, deep teal/mint/ivory palette, one icon family, complete light and dark themes, 56 colour pairs checked for contrast.
- **New structure**: Today, Train, Calendar, Progress, More. Every journey has an empty, loading, error and permission state.

## The programme problem (the main V6.0 change)
- The 8-week programme is no longer hard-coded. It is a versioned **Programme Template**; your run of it is a **Programme Instance** with a **cursor**; what you did is the **Session Log**.
- Progression follows the cursor, not the calendar. Miss a week and nothing moves on without you: Week 3 (supersets) only starts once you reach Week 3.
- **Smart Schedule**: continue where you left off, repeat a week, skip, jump ahead; move or swap sessions; move a week; shift later sessions; pause and resume with a suggested easier restart after a long break; re-synchronise; every change is previewed, applied only after confirmation, listed in a change log and undoable.

## V6.1
- **Programme Builder**: build from a weekly pattern with rep progression, edit imported or copied programmes, publish immutable versions (editing a published programme makes version N+1; running programmes are not affected), Excel import and export.
- **Exercise Master**: single catalogue (277 exercises from your plan), search and filters, instructions, breathing, mistakes, safety notes, your own video links, duplicate prevention, archive and restore, usage shown before archiving.
- **Workout execution**: one focused screen per exercise, per-side steps, rest timer with next-up preview, timed exercises, guided breathing with voice, last-time and suggested load, skip/back, set-by-set autosave and resume after interruption, finish summary with effort rating and new records.
- **Progress**: workouts per week, estimated strength, records, muscle groups, body weight trend.

## V6.2
- **Health Connect** (read-only): steps, active calories, heart rate, sleep, exercise sessions, weight, body fat, height; per-type consent; de-duplicated; two apps reporting the same thing are never summed.
- **Protein tracking** with a daily target, estimates labelled, history chart.
- **Recovery guide**: explainable, lists what it used and what is missing, never changes a programme, not medical advice.
- **Reminders**: local, weekly, general wording, overload warning.
- **Backup and restore**: one JSON file with validation, merge or replace, safety snapshot; CSV and spreadsheet export.

## Platform and data
- Database: IndexedDB with schema version 1 (13 stores), atomic multi-record writes, append-only workout logs with audited corrections, immutable published templates.
- Migration from V5.0: backup first, validate, map, verify, commit atomically, success recorded in the same transaction; V5.0 data is never edited or deleted.
- Security: strict content-security policy, no inline script, cloud backup off, no default passwords (the V5.0 health vault is imported only with your own password).
- Android: Kotlin Health Connect plugin, manifest/Gradle patching, build workflow with a no-Health-Connect fallback.
