# Patches the generated Capacitor Android project.
# Usage: python3 patch_gradle.py --version-name 6.1 --version-code 10 [--no-health]
#   always: app version, non-debuggable build (so the app's private data cannot be read over adb)
#   unless --no-health: Kotlin plugin, Health Connect client, minSdk 26
import re, sys
args = sys.argv[1:]
no_health = "--no-health" in args
def opt(name, default):
    return args[args.index(name) + 1] if name in args else default
version_name, version_code = opt("--version-name", "6.1"), opt("--version-code", "10")
root, app, var = "android/build.gradle", "android/app/build.gradle", "android/variables.gradle"

def rw(path, fn):
    s = open(path, encoding="utf-8").read(); t = fn(s)
    open(path, "w", encoding="utf-8").write(t); return s != t

def app_common(s):
    s, n1 = re.subn(r"versionCode\s+\d+", f"versionCode {version_code}", s, count=1)
    s, n2 = re.subn(r'versionName\s+"[^"]*"', f'versionName "{version_name}"', s, count=1)
    assert n1 == 1 and n2 == 1, "could not set versionCode/versionName in android/app/build.gradle"
    if "debuggable false" not in s:
        s, n = re.subn(r"(buildTypes\s*\{)", r"\1\n        debug {\n            debuggable false\n        }", s, count=1)
        assert n == 1, "could not find buildTypes in android/app/build.gradle"
    return s
rw(app, app_common)

if not no_health:
    rw(var, lambda s: re.sub(r"minSdkVersion\s*=\s*\d+", "minSdkVersion = 26", s))
    def root_fn(s):
        if "kotlin-gradle-plugin" in s: return s
        s2, n = re.subn(r"(classpath\s+['\"]com\.android\.tools\.build:gradle:[^'\"]+['\"])", r"\1\n        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.22'", s, count=1)
        assert n == 1, "could not find the Android Gradle plugin line in android/build.gradle"
        return s2
    rw(root, root_fn)
    def app_fn(s):
        if "kotlin-android" not in s:
            s = s.replace("apply plugin: 'com.android.application'", "apply plugin: 'com.android.application'\napply plugin: 'kotlin-android'", 1)
            assert "kotlin-android" in s, "could not apply the Kotlin plugin"
        if "connect-client" not in s:
            s, n = re.subn(r"dependencies\s*\{", "dependencies {\n    implementation 'androidx.health.connect:connect-client:1.1.0-alpha07'\n    implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3'", s, count=1)
            assert n == 1, "could not find dependencies block"
        if "kotlinOptions" not in s:
            s = re.sub(r"(android\s*\{)", r"\1\n    kotlinOptions { jvmTarget = '17' }", s, count=1)
        return s
    rw(app, app_fn)
print(f"Gradle patched: version {version_name} ({version_code}), non-debuggable" + ("" if not no_health else ", without Health Connect") + ("" if no_health else ", Kotlin + Health Connect"))
