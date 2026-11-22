# BeFyn V6.0 — Android APK build corrections

## Confirmed source defects in the supplied repository

1. `android-overrides/BeFynHealthPlugin.kt` declared a custom `requestPermissions(PluginCall)` method. This name collides with the inherited Capacitor `Plugin` API and caused Kotlin compilation to fail at `:app:compileDebugKotlin`.
2. `www/src/platform/health.js` called the old native method name `requestPermissions`, so the native and JavaScript bridge must be updated together.
3. `.github/workflows/build-apk.yml` piped Gradle output through `tee` without enabling Bash `pipefail`. A Gradle failure could be masked by the successful `tee` process, preventing the fallback build from running.
4. The old workflow uploaded the expected APK path without first verifying that an APK existed.

## Corrections in this source package

- Renamed the custom Kotlin bridge method to `requestHealthPermissions`.
- Updated the JavaScript Health Connect bridge to invoke `requestHealthPermissions`.
- Updated the Kotlin source contract comment.
- Reworked the GitHub Actions workflow to use `set -euo pipefail` for critical shell steps and Gradle output pipelines.
- Uses an explicit `:app:assembleDebug` Gradle task with stack traces.
- Preserves the Health Connect build and no-Health-Connect fallback.
- Makes the fallback recreate the Android project, apply no-health patches, synchronise assets, restore the V5-compatible debug signing key and run Gradle.
- Searches the Gradle output directory for a non-empty debug APK.
- Copies the verified APK to `artifacts/BeFyn_V6.0-debug.apk`.
- Uploads that verified file as `BeFyn_V6.0-APK`.
- Fails the workflow if the expected APK is absent.
- Uploads Gradle diagnostics if both or either build path fails.

## Signing

The workflow retains the repository's existing `signing/debug.keystore` for the debug build. This is not a release-signing setup. Do not substitute another product's keystore. The key must be the same key used for the installed V5.0 application if Android is expected to accept this debug APK as an in-place update.

## Validation boundary

The source-level bridge references and workflow configuration have been corrected. This environment has not run GitHub-hosted Android Gradle, so APK generation, Kotlin dependency resolution and install-over-V5.0 remain unverified until the workflow is run in GitHub Actions on the target repository.
