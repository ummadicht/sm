#!/usr/bin/env bash
# Build a sideloadable, release-signed APK for one app:
#   bash scripts/build-apk.sh store     → dist/swapup-store.apk
#   bash scripts/build-apk.sh check     → dist/swapup-check.apk
#
# Builds in a throwaway copy so `expo prebuild` never touches the working tree.
# Uses the local toolchain in ~/android-toolchain (no Android Studio, no EAS) and
# the SwapUp release key in ~/.swapup-keys (NOT the public React Native debug
# key, which anyone could sign a look-alike update with).
set -euo pipefail
VARIANT=${1:?usage: build-apk.sh store|check}
[ "$VARIANT" = store ] || [ "$VARIANT" = check ] || { echo "store or check" >&2; exit 2; }
# EVERY step must see the variant, not just prebuild: gradle's JS-bundling step
# re-reads app.config.js to embed the app's config (assets/app.config), and
# without APP_VARIANT that file falls back to "check" — which shipped SwapUp
# Store APKs (right name and package) that opened the CUSTOMER app (fixed 2026-10-17).
export APP_VARIANT=$VARIANT
export EXPO_PUBLIC_APP_VARIANT=$VARIANT
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=${WORK:-/private/tmp/claude-501/swapup-apk-$VARIANT}
KEYPROPS=${KEYPROPS:-$HOME/.swapup-keys/keystore.properties}
export JAVA_HOME=$HOME/android-toolchain/jdk/Contents/Home
export ANDROID_HOME=$HOME/android-toolchain/sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
[ -f "$KEYPROPS" ] || { echo "missing $KEYPROPS" >&2; exit 1; }

echo "▸ copy → $WORK"
mkdir -p "$WORK"
rsync -a --delete --exclude /android --exclude /ios --exclude /.expo --exclude /.git --exclude /dist "$ROOT/" "$WORK/"
cd "$WORK"

echo "▸ expo prebuild ($VARIANT)"
APP_VARIANT=$VARIANT CI=1 npx expo prebuild --platform android --clean --no-install >/dev/null

echo "▸ gradle tuning"
GP=android/gradle.properties
# arm64 only: every phone a counter sees today is arm64; halves build time and size.
sed -i '' 's/^reactNativeArchitectures=.*/reactNativeArchitectures=arm64-v8a/' "$GP"
# gradle.properties may not end with a newline — an append would glue onto the
# last property (it did: "watchedDirectories=[]org.gradle.vfs.watch=false").
[ -z "$(tail -c1 "$GP")" ] || echo >> "$GP"
grep -q '^reactNativeArchitectures=' "$GP" || echo 'reactNativeArchitectures=arm64-v8a' >> "$GP"
# The default 512m Metaspace hangs the build — learned on youelectnow-mobile.
sed -i '' 's/^org.gradle.jvmargs=.*/org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1536m/' "$GP"
# File-system watching over node_modules stalls the daemon for tens of minutes
# in WatchableHierarchies bookkeeping (seen on this Mac) — a one-shot build
# gains nothing from it.
grep -q '^org.gradle.vfs.watch=' "$GP" || echo 'org.gradle.vfs.watch=false' >> "$GP"

echo "▸ release signing with the SwapUp key"
python3 - "$KEYPROPS" <<'PY'
import re, sys
props = dict(l.strip().split("=", 1) for l in open(sys.argv[1]) if "=" in l)
p = "android/app/build.gradle"
s = open(p).read()
release_cfg = (
    "        release {\n"
    f"            storeFile file('{props['storeFile']}')\n"
    f"            storePassword '{props['storePassword']}'\n"
    f"            keyAlias '{props['keyAlias']}'\n"
    f"            keyPassword '{props['keyPassword']}'\n"
    "        }\n"
)
s = s.replace("    signingConfigs {\n", "    signingConfigs {\n" + release_cfg, 1)
# In the release buildType, swap the debug signing config for ours.
i = s.index("buildTypes {")
j = s.index("release {", i)
k = s.index("signingConfig signingConfigs.debug", j)
s = s[:k] + "signingConfig signingConfigs.release" + s[k + len("signingConfig signingConfigs.debug"):]
open(p, "w").write(s)
PY

echo "▸ gradle assembleRelease (first run downloads dependencies; later runs are faster)"
(cd android && ./gradlew assembleRelease --console=plain -q --no-watch-fs)

OUT="$ROOT/dist/swapup-$VARIANT.apk"
mkdir -p "$ROOT/dist"
# Refuse to ship an APK whose embedded config is for the other app.
EMBEDDED=$(unzip -p android/app/build/outputs/apk/release/app-release.apk assets/app.config | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s);console.log((c.extra&&c.extra.variant)+'|'+c.name)})")
case "$EMBEDDED" in
  "$VARIANT|"*) echo "▸ embedded config: $EMBEDDED" ;;
  *) echo "✗ the APK's embedded config is '$EMBEDDED', not '$VARIANT' — not shipping it" >&2; exit 1 ;;
esac
cp android/app/build/outputs/apk/release/app-release.apk "$OUT"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs "$OUT" | grep -m1 "Signer #1 certificate DN" || true
# The version the APK was actually built with (app.config.js wins over app.json).
VERSION=$(APP_VARIANT=$VARIANT node -e "const c=require('./app.config.js'); console.log((typeof c==='function'?c({config:{}}):c).version)")
SIZE=$(stat -f%z "$OUT")
SHA=$(shasum -a 256 "$OUT" | cut -d' ' -f1)
echo "{\"app\":\"$VARIANT\",\"version\":\"$VERSION\",\"bytes\":$SIZE,\"sha256\":\"$SHA\",\"builtAt\":\"$(date -u +%FT%TZ)\"}" > "$ROOT/dist/swapup-$VARIANT.json"
echo "✓ $OUT ($((SIZE/1024/1024)) MB)"
