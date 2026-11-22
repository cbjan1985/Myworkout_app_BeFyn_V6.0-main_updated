# Adds an environment-driven release signing config to the generated Android project.
# Used only when the workflow is run with signing = release-secrets. No secret is ever written to a file here:
# Gradle reads BEFYN_KEYSTORE (a temp path), ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD from the environment.
import re, sys
p = "android/app/build.gradle"
s = open(p, encoding="utf-8").read()
if "signingConfigs" in s and "BEFYN_KEYSTORE" in s:
    print("Signing already configured"); sys.exit(0)

block = '''signingConfigs {
        release {
            storeFile file(System.getenv("BEFYN_KEYSTORE") ?: "missing.jks")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
    '''
s, n = re.subn(r"(\n\s*)buildTypes\s*\{", lambda m: m.group(1) + block + "buildTypes {", s, count=1)
assert n == 1, "could not find buildTypes in android/app/build.gradle"
s, n = re.subn(r"(buildTypes\s*\{\s*release\s*\{)", r"\1\n            signingConfig signingConfigs.release", s, count=1)
assert n == 1, "could not find the release build type"
open(p, "w", encoding="utf-8").write(s)
print("Release signing configured (reads the environment; nothing secret is stored in the project)")
