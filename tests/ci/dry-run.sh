#!/usr/bin/env bash
# Exercises the CI scripts end to end with stub 'npx' and 'gradlew' (no network, no Android SDK).
# Proves: failures are NOT masked, the Health Connect fallback runs, patches land in the right files,
# the APK is verified, found at its real path and renamed, and a missing APK fails loudly.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; PASS=0; FAIL=0
ok() { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
fresh() {
  W=$(mktemp -d); mkdir -p "$W/www/src" "$W/www/assets/seed" "$W/tools"
  cp -r "$ROOT"/{android-overrides,android-res,signing,patch_gradle.py,patch_manifest.py,package.json,capacitor.config.json} "$W/"
  cp "$ROOT"/tools/android-build.sh "$ROOT"/tools/verify-apk.sh "$W/tools/"
  echo '<html></html>' > "$W/www/index.html"; echo '//' > "$W/www/src/main.js"; echo '{}' > "$W/www/assets/seed/programme-8wk-muscle-gain.json"; echo '[]' > "$W/www/assets/seed/exercises.json"; echo '//' > "$W/www/xlsx.full.min.js"
  export PATH="$ROOT/tests/ci/bin:$PATH" CI_SKELETON="$ROOT/tests/ci/skeleton"; unset FAKE_ALL_BREAK FAKE_HEALTH_BREAKS FAKE_NO_APK
}
echo "1. normal build with Health Connect"
fresh; cd "$W"; BUILD_LOG=a.log bash tools/android-build.sh >out.txt 2>&1; RC=$?
check "build script succeeds" "[ $RC = 0 ]"
check "version 6.5 / code 10 patched" "grep -q 'versionName \"6.5\"' android/app/build.gradle && grep -q 'versionCode 10' android/app/build.gradle"
check "release APK is not debuggable" "grep -q 'debuggable false' android/app/build.gradle"
check "Health Connect + Kotlin wired in" "grep -q 'connect-client' android/app/build.gradle && grep -q 'kotlin-android' android/app/build.gradle && grep -q 'kotlin-gradle-plugin' android/build.gradle && grep -q 'minSdkVersion = 26' android/variables.gradle"
check "Kotlin plugin file copied with the real package name" "grep -q '^package com.myworkout.v3' android/app/src/main/java/com/myworkout/v3/BeFynHealthPlugin.kt"
check "MainActivity registers both plugins" "grep -q 'BeFynHealthPlugin.class' android/app/src/main/java/com/myworkout/v3/MainActivity.java"
check "manifest: cleartext off, network security config, health permissions incl. SpO2, backup off" "grep -q 'usesCleartextTraffic=\"false\"' android/app/src/main/AndroidManifest.xml && grep -q 'network_security_config' android/app/src/main/AndroidManifest.xml && grep -q 'health.READ_OXYGEN_SATURATION' android/app/src/main/AndroidManifest.xml && grep -q 'health.READ_STEPS' android/app/src/main/AndroidManifest.xml && grep -q 'allowBackup=\"false\"' android/app/src/main/AndroidManifest.xml"
check "manifest: no debuggable flag" "! grep -q 'android:debuggable' android/app/src/main/AndroidManifest.xml"
check "web app + xlsx synced into Android assets" "[ -f android/app/src/main/assets/public/index.html ] && [ -f android/app/src/main/assets/public/xlsx.full.min.js ]"
check "launch screen colour patched" "grep -q '@color/befyn_splash' android/app/src/main/res/values/styles.xml"
check "icons copied" "[ -f android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png ]"
bash tools/verify-apk.sh >v.txt 2>&1; RC=$?
check "verify finds the real APK and names it BeFyn_V6.5.apk" "[ $RC = 0 ] && [ -f dist/BeFyn_V6.5.apk ]"
echo "2. Health Connect compile fails: failure is NOT masked, fallback works"
fresh; cd "$W"; export FAKE_HEALTH_BREAKS=1; BUILD_LOG=f.log bash tools/android-build.sh >out1.txt 2>&1; RC1=$?
check "first build reports FAILURE (exit non-zero through the pipe)" "[ $RC1 != 0 ]"
check "failure text is in the log file" "grep -q 'Unresolved reference' f.log"
BUILD_LOG=g.log bash tools/android-build.sh --no-health >out2.txt 2>&1; RC2=$?
check "fallback build succeeds" "[ $RC2 = 0 ]"
check "fallback has no Kotlin, no Health Connect, no health permission, no HEALTH_PLUGIN line" "! grep -q 'connect-client' android/app/build.gradle && ! grep -q 'health.READ' android/app/src/main/AndroidManifest.xml && ! grep -q 'BeFynHealthPlugin' android/app/src/main/java/com/myworkout/v3/MainActivity.java && [ ! -f android/app/src/main/java/com/myworkout/v3/BeFynHealthPlugin.kt ]"
check "fallback still non-debuggable and version 6.5" "grep -q 'debuggable false' android/app/build.gradle && grep -q 'versionName \"6.5\"' android/app/build.gradle"
bash tools/verify-apk.sh --suffix _no-health >v.txt 2>&1; RC=$?
check "fallback APK is named so you can tell" "[ $RC = 0 ] && [ -f dist/BeFyn_V6.5_no-health.apk ]"
echo "3. everything fails"
fresh; cd "$W"; export FAKE_ALL_BREAK=1; BUILD_LOG=h.log bash tools/android-build.sh >o1.txt 2>&1; R1=$?; BUILD_LOG=i.log bash tools/android-build.sh --no-health >o2.txt 2>&1; R2=$?
check "both builds fail loudly" "[ $R1 != 0 ] && [ $R2 != 0 ]"
echo "4. Gradle 'succeeds' but produces no APK"
fresh; cd "$W"; export FAKE_NO_APK=1; BUILD_LOG=j.log bash tools/android-build.sh >o.txt 2>&1; RC=$?
check "build step itself passes" "[ $RC = 0 ]"
bash tools/verify-apk.sh >v.txt 2>&1; RC=$?
check "verification FAILS with a clear message instead of a warning" "[ $RC = 1 ] && grep -q 'No .apk file exists' v.txt"
echo "5. a required web file is missing"
fresh; cd "$W"; rm www/xlsx.full.min.js; BUILD_LOG=k.log bash tools/android-build.sh >o.txt 2>&1; RC=$?
check "fails before Gradle and names the missing file" "[ $RC != 0 ] && grep -q 'xlsx.full.min.js' o.txt"

echo; echo "dry run: $PASS passed, $FAIL failed"; [ $FAIL = 0 ]
