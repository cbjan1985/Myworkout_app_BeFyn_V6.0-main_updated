#!/usr/bin/env bash
# Finds the APK Gradle really produced, checks it, and copies it to dist/ with the release file name.
# Usage: tools/verify-apk.sh [--suffix _no-health]   Fails clearly (exit 1) if no APK exists or it is not FiT85.
set -euo pipefail
cd "$(dirname "$0")/.."
SUFFIX=""; [ "${1:-}" = "--suffix" ] && SUFFIX="${2:-}"
VERSION_NAME=$(node -p "require('./package.json').fit85.versionName")
APP_ID=$(node -p "require('./capacitor.config.json').appId")
echo "APK files under android/ build outputs:"
mapfile -t APKS < <(find android -path '*build/outputs/apk*' -name '*.apk' 2>/dev/null | sort)
if [ "${#APKS[@]}" -eq 0 ]; then
  echo "::error::No .apk file exists anywhere under android/**/build/outputs/apk. Gradle did not produce an APK. See the build log artifact."
  find android -name build -maxdepth 3 -type d 2>/dev/null | head -5
  exit 1
fi
printf '  %s\n' "${APKS[@]}"
SRC=""; for a in "${APKS[@]}"; do case "$a" in */apk/debug/*) SRC="$a";; esac; done
[ -n "$SRC" ] || SRC="${APKS[0]}"
BT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}/build-tools"
if [ -d "$BT" ]; then
  TOOLS="$BT/$(ls "$BT" | sort -V | tail -1)"
  if [ -x "$TOOLS/aapt" ]; then
    BADGE=$("$TOOLS/aapt" dump badging "$SRC" 2>/dev/null | head -1 || true); echo "$BADGE"
    echo "$BADGE" | grep -q "name='$APP_ID'" || { echo "::error::The APK package is not $APP_ID: $BADGE"; exit 1; }
    echo "$BADGE" | grep -q "versionName='$VERSION_NAME'" || { echo "::error::The APK versionName is not $VERSION_NAME: $BADGE"; exit 1; }
    if "$TOOLS/aapt" dump badging "$SRC" 2>/dev/null | grep -q "application-debuggable"; then echo "::error::The APK is debuggable (private data readable over adb)."; exit 1; fi
    PERMS=$("$TOOLS/aapt" dump permissions "$SRC" 2>/dev/null | sed -n "s/^uses-permission: name='\(.*\)'.*/\1/p" | sort -u); echo "Permissions in the final APK:"; echo "$PERMS" | sed 's/^/  /'
    DENY='READ_SMS|SEND_SMS|CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|READ_CONTACTS|READ_CALL_LOG|READ_PHONE_STATE|SYSTEM_ALERT_WINDOW|REQUEST_INSTALL_PACKAGES|WRITE_EXTERNAL_STORAGE|BIND_ACCESSIBILITY_SERVICE'
    if echo "$PERMS" | grep -Eq "$DENY"; then echo "::error::The APK requests a permission FiT85 must never have: $(echo "$PERMS" | grep -E "$DENY" | tr '\n' ' ')"; exit 1; fi
    ALLOWED='INTERNET|ACCESS_NETWORK_STATE|VIBRATE|WAKE_LOCK|POST_NOTIFICATIONS|RECEIVE_BOOT_COMPLETED|SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM|READ_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE|health\.READ_[A-Z_]+|DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
    echo "$PERMS" | grep -Ev "($ALLOWED)$" | sed "s/^/::warning::Unreviewed permission in the APK: /" || true
    if "$TOOLS/aapt" dump xmltree "$SRC" AndroidManifest.xml 2>/dev/null | grep -q 'allowBackup.*=(type 0x12)0xffffffff'; then echo "::error::Android cloud backup is enabled in the APK."; exit 1; fi
  else echo "::warning::aapt not found: package, version and debuggable checks skipped"; fi
  if [ -x "$TOOLS/apksigner" ]; then
    CERTS=$("$TOOLS/apksigner" verify --print-certs "$SRC"); echo "$CERTS" | grep -E "Signer #1 certificate (DN|SHA-256)"
    GOT=$(echo "$CERTS" | grep -m1 "SHA-256 digest" | sed 's/.*: *//' | tr -d ': ' | tr 'A-F' 'a-f')
    WANT=$(tr -d ': \n' < signing/V5_CERT_SHA256.txt | tr 'A-F' 'a-f')
    if [ "$GOT" != "$WANT" ]; then echo "::error::The APK is NOT signed with the V5.0 identity (got $GOT, expected $WANT). It would not install over V5.0."; exit 1; fi
    echo "Signing identity matches V5.0 ($WANT): install-over-V5.0 is allowed by Android."
  else echo "::warning::apksigner not available: signature not verified"; fi
fi
SIZE=$(stat -c %s "$SRC"); [ "$SIZE" -gt 1000000 ] || { echo "::error::The APK is suspiciously small ($SIZE bytes)."; exit 1; }
mkdir -p dist; OUT="dist/FiT85.apk"; cp "$SRC" "$OUT"
echo "Verified APK: $SRC -> $OUT ($SIZE bytes)"
echo "apk_path=$OUT" >> "${GITHUB_OUTPUT:-/dev/null}"
{ echo "### FiT85 APK"; echo "- File: \`$(basename "$OUT")\` ($((SIZE / 1024)) KB)"; echo "- Built from: \`$SRC\`"; echo "- Health Connect: $([ -z "$SUFFIX" ] && echo included || echo 'NOT included (fallback build)')"; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
