#!/usr/bin/env bash
# Builds the Android APK from scratch: Capacitor project -> patches -> asset sync -> Gradle assemble.
# Usage: tools/android-build.sh [--no-health]     Log: $BUILD_LOG (default build.log). Exit code is non-zero if ANY stage fails.
set -euo pipefail
cd "$(dirname "$0")/.."
HEALTH=1; [ "${1:-}" = "--no-health" ] && HEALTH=0
LOG="${BUILD_LOG:-build.log}"; : > "$LOG"
say() { echo "::group::$*"; }
end() { echo "::endgroup::"; }
fail() { echo "::error::$*"; exit 1; }
need() { [ -e "$1" ] || fail "Expected file or folder is missing: $1 ($2)"; }

APP_ID=$(node -p "require('./capacitor.config.json').appId")
VERSION_NAME=$(node -p "require('./package.json').befyn.versionName")
VERSION_CODE=$(node -p "require('./package.json').befyn.versionCode")
DIR="android/app/src/main/java/$(echo "$APP_ID" | tr . /)"
echo "BeFyn $VERSION_NAME (code $VERSION_CODE), app id $APP_ID, Health Connect: $([ $HEALTH = 1 ] && echo yes || echo no)"

say "1. Web app is complete"
need www/index.html "web entry"; need www/src/main.js "app entry"; need www/assets/seed/programme-8wk-muscle-gain.json "seed programme"; need www/assets/seed/exercises.json "seed exercises"
need www/xlsx.full.min.js "SheetJS copy (the workflow copies it from node_modules)"
end

say "2. Create the Android project (Capacitor)"
rm -rf android
npx cap add android
need android/gradlew "Gradle wrapper"; need android/app/build.gradle "app module"; need android/build.gradle "root build file"; need android/variables.gradle "variables"
end

say "3. Patch version, Kotlin/Health Connect, manifest, launch screen"
FLAG=""; [ $HEALTH = 0 ] && FLAG="--no-health"
python3 patch_gradle.py --version-name "$VERSION_NAME" --version-code "$VERSION_CODE" $FLAG
STY=android/app/src/main/res/values/styles.xml
[ -f "$STY" ] && sed -i 's#@drawable/splash#@color/befyn_splash#g' "$STY" || echo "styles.xml not found: keeping the default launch screen"
mkdir -p "$DIR"
cp android-overrides/MainActivity.java android-overrides/GifFolderPlugin.java "$DIR/"
if [ $HEALTH = 1 ]; then cp android-overrides/BeFynHealthPlugin.kt "$DIR/"; else sed -i '/HEALTH_PLUGIN/d' "$DIR/MainActivity.java"; fi
sed -i "s/APP_PACKAGE/$APP_ID/" "$DIR"/*.java; ls "$DIR"/*.kt >/dev/null 2>&1 && sed -i "s/APP_PACKAGE/$APP_ID/" "$DIR"/*.kt || true
python3 patch_manifest.py $FLAG
end

say "4. Sync the web app into Android and verify it arrived"
npx cap sync android
PUB=android/app/src/main/assets/public
need "$PUB/index.html" "Capacitor did not copy index.html"; need "$PUB/src/main.js" "Capacitor did not copy the app code"
need "$PUB/assets/seed/exercises.json" "seed data was not copied"; need "$PUB/xlsx.full.min.js" "spreadsheet library was not copied"
need android/app/src/main/assets/capacitor.config.json "Capacitor config was not copied"
end

say "5. Icons, resources and signing key"
cp -r android-res/. android/app/src/main/res/
need signing/debug.keystore "the fixed signing key that lets BeFyn install over V5.0"
mkdir -p ~/.android && cp signing/debug.keystore ~/.android/debug.keystore
echo "Signing certificate fingerprint (must be the same for every build that should upgrade in place):"
keytool -list -v -keystore ~/.android/debug.keystore -storepass android -alias androiddebugkey 2>/dev/null | grep -E "SHA-?256|Owner" || echo "(could not read certificate; Gradle will report signing problems)"
end

say "6. Gradle: :app:assembleDebug"
( cd android && chmod +x gradlew && ./gradlew :app:assembleDebug --stacktrace --no-daemon ) 2>&1 | tee -a "$LOG"
end
echo "Gradle finished. APK files now present:"; find android -path '*build/outputs/apk*' -name '*.apk' -print
