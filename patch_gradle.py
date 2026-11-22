# Adds Kotlin + the Health Connect client to the generated Capacitor Android project.
# Usage: python3 patch_gradle.py [--no-health]   (--no-health leaves Kotlin and Health Connect out: used by the fallback build)
import re, sys
no_health = "--no-health" in sys.argv
root = "android/build.gradle"; app = "android/app/build.gradle"; var = "android/variables.gradle"

def rw(path, fn):
    s = open(path, encoding="utf-8").read(); t = fn(s)
    open(path, "w", encoding="utf-8").write(t); return s != t

# Health Connect needs minSdk 26 (Android 8.0).
def vars_fn(s):
    return re.sub(r"minSdkVersion\s*=\s*\d+", "minSdkVersion = 26", s)
rw(var, vars_fn)

if not no_health:
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
print("Gradle patched" + (" (without Health Connect)" if no_health else " (Kotlin + Health Connect)"))
