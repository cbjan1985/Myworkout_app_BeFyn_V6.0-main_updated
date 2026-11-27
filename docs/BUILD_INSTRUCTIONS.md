# Build instructions (FiT85 V6.5)

## Requirements
A GitHub account and a private repository. Nothing to install on your computer for the GitHub build.

## Steps
1. Upload the contents of this folder to the repository root (keep `.github/workflows/`, `signing/`, `legacy/`). Delete any older files, including the stray `*.jss` files and `tests/app.test`.
2. Recommended once: add the repository secret **`BEFYN_V5_KEYSTORE_BASE64`** (Settings > Secrets and variables > Actions). Its value is `base64 -w0 signing/debug.keystore`. Then delete `signing/debug.keystore` from the repository. Without the secret the workflow uses the committed file and prints a warning.
3. Actions > **Build FiT85 APK** > Run workflow (also runs on every push to `main`/`master`).
4. When it finishes, open the run: the summary shows the APK details (or the failing stage and key error lines). Download **`FiT85_V6.5-APK`** (it contains `FiT85_V6.5.apk`) and **`FiT85_V6.5-build-logs`**.
5. Copy the APK to the phone and install over V5.0 (do not uninstall V5.0 first).

## What can fail, and what it means
| Message in the run | Meaning |
|---|---|
| "The keystore is not the V5.0 signing identity" | The key does not match `signing/V5_CERT_SHA256.txt`; FiT85 would not install over V5.0. Fix the secret or file. |
| "The build with Health Connect FAILED" (warning) | The Kotlin/Health Connect build failed; a build without Health Connect follows. Send me `FiT85_V6.5-build-logs`. The APK is then `FiT85_V6.5_no-health.apk`. |
| "No .apk file exists" | Gradle finished but produced nothing. See the log artifact. |
| "NOT signed with the V5.0 identity" / "is debuggable" / "permission FiT85 must never have" | The final APK check failed; the APK is not published. |
| npm audit high/critical | A production dependency has a serious advisory; the message names it. |

## Scripts
`tools/android-build.sh [--no-health]` (Capacitor project, patches, sync, Gradle), `tools/verify-apk.sh` (find, check, rename, summary), `patch_gradle.py`, `patch_manifest.py`. `bash tests/ci/dry-run.sh` tests them against stub Gradle.

## Run in a browser (development)
`node tools/serve.mjs` then open `http://localhost:8099/?debug=1&splash=0`. Android-only features show plain "not available" messages. `sh tools/e2e.sh` and `sh tools/monkey.sh` run the browser tests (Playwright needed).

## Icons and name
The V5.0 logo and launcher icons in `android-res/` and `www/assets/` are the originals and must not be regenerated. Only the name text was changed.
