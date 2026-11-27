# FiT85 V6.5 Android resource merge fix

## Root cause
The Android resource merger found `color/befyn_splash` in three generated resources: `fit85_colors.xml`, `befyn_colors.xml`, and `ic_launcher_background.xml`.

## Files to replace in the existing repository
1. `android-res/values/fit85_colors.xml`
2. `tools/android-build.sh`
3. `tools/make-icons.mjs`
4. `tests/ci/dry-run.sh` (test expectation updated to the FiT85 splash resource name)

Do not replace the rest of the application source for this fix. Preserve `.git`, repository settings, and GitHub secrets.

## What changed
- The FiT85 launch screen uses its own unique `fit85_splash` resource.
- The launcher background generator no longer adds a second splash colour.
- During Android project assembly, the build script removes the duplicate legacy `befyn_splash` entry from the generated launcher-background resource while preserving the canonical legacy resource in `befyn_colors.xml`.
- The build script validates that Android `values/*.xml` resources do not contain duplicate `(resource type, name)` entries before invoking Gradle.

## Local validation performed
- `npm test`: 56/56 passed.
- `node tools/check.mjs`: passed (contrast, syntax, import graph).
- `node tools/security-scan.mjs`: passed with no blocking findings.
- `bash -n tools/android-build.sh`: passed.
- Synthetic reproduction of the three-way duplicate resource collision: passed after the fix.

A full Android Gradle build was not run in this environment. The next GitHub Actions run must confirm the actual APK build and artifact upload.
