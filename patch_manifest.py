# Adds permissions, queries and Health Connect declarations to the generated Android manifest.
# Usage: python3 patch_manifest.py [--no-health]
import re, sys
no_health = "--no-health" in sys.argv
p = "android/app/src/main/AndroidManifest.xml"
s = open(p, encoding="utf-8").read()

perms = [
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.MANAGE_EXTERNAL_STORAGE",  # only used if the person chooses an exercise-media folder
    "android.permission.VIBRATE",
    "android.permission.POST_NOTIFICATIONS",        # only requested when the person adds reminders
]
if not no_health:
    perms += ["android.permission.health." + x for x in ("READ_STEPS", "READ_ACTIVE_CALORIES_BURNED", "READ_HEART_RATE", "READ_SLEEP", "READ_EXERCISE", "READ_WEIGHT", "READ_BODY_FAT", "READ_HEIGHT", "READ_OXYGEN_SATURATION")]
add = "".join(f'    <uses-permission android:name="{x}" />\n' for x in perms if x not in s)
if add:
    assert "<application" in s
    s = s.replace("<application", add + "    <application", 1)

# Android 11+ only lets an app see the voice engine (and Health Connect) if the manifest says so.
queries = ""
if "android.intent.action.TTS_SERVICE" not in s:
    queries += '        <intent>\n            <action android:name="android.intent.action.TTS_SERVICE" />\n        </intent>\n'
if not no_health and "com.google.android.apps.healthdata" not in s:
    queries += '        <package android:name="com.google.android.apps.healthdata" />\n'
if queries:
    if "<queries>" in s:
        s = s.replace("<queries>", "<queries>\n" + queries, 1)
    else:
        s, n = re.subn(r"(<manifest[^>]*>)", lambda m: m.group(1) + "\n    <queries>\n" + queries + "    </queries>\n", s, count=1)
        assert n == 1

if not no_health:
    # Health Connect shows this when the person taps "privacy policy" / permission rationale (required for the permission screen).
    if "ACTION_SHOW_PERMISSIONS_RATIONALE" not in s:
        s, n = re.subn(r"(<activity[^>]*android:name=\"[^\"]*MainActivity\"[^>]*>)", r'\1\n            <intent-filter>\n                <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />\n            </intent-filter>', s, count=1)
        assert n == 1, "MainActivity entry not found"
    if "VIEW_PERMISSION_USAGE" not in s:
        alias = ('    <activity-alias android:name="ViewPermissionUsageActivity" android:exported="true" android:targetActivity=".MainActivity" android:permission="android.permission.START_VIEW_PERMISSION_USAGE">\n'
                 '        <intent-filter>\n            <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />\n            <category android:name="android.intent.category.HEALTH_PERMISSIONS" />\n        </intent-filter>\n    </activity-alias>\n')
        s = s.replace("</application>", alias + "    </application>", 1)

# BeFyn keeps health data on the phone: do not let Android upload app data to cloud backups, never allow cleartext traffic.
s = s.replace('android:allowBackup="true"', 'android:allowBackup="false"')
if 'usesCleartextTraffic' not in s:
    s = s.replace('<application', '<application android:usesCleartextTraffic="false" android:networkSecurityConfig="@xml/network_security_config"', 1)
assert 'android:debuggable="true"' not in s, 'the manifest must not mark the app debuggable'
open(p, "w", encoding="utf-8").write(s)
print("Manifest patched" + (" (without Health Connect)" if no_health else ""))
