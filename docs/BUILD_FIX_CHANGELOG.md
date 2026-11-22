# Build-fix changelog

- Fixed Health Connect Kotlin bridge method name collision with Capacitor Plugin API.
- Updated JavaScript native bridge method name to match Kotlin.
- Corrected Gradle pipeline error propagation using Bash pipefail.
- Hardened Android fallback build and restored configured debug signing key in fallback.
- Added APK discovery, non-empty verification, staging and strict artifact upload.
- Added Gradle diagnostics artifact on build failure.

No product feature or UI behavior was intentionally changed by this build-pipeline correction.
