#!/usr/bin/env bash
# Build the BROWSER version of one app (Expo web / react-native-web), from the
# same code as the APKs:
#   bash scripts/export-web.sh store     → dist-web/store/  (served at /app/store/)
#   bash scripts/export-web.sh check     → dist-web/check/  (served at /app/check/)
#   bash scripts/export-web.sh all       → both
#
# Hosting contract (same origin as the SwapUp API — no CORS, and the desk
# hand-off cookie lands on the desk's own origin):
#   /app/<variant>/            → dist-web/<variant>/index.html
#   /app/<variant>/<file>      → that file (bundles under _expo/ are content-hashed: cache forever)
#   /app/<variant>/<anything else> → index.html (SPA fallback; e.g. /app/check/?code=K7M2QX)
#   /app/<variant>             → redirect to /app/<variant>/
# Locally: node scripts/web-dev-proxy.mjs (port 4620) does exactly that in front
# of the dev server on :4500. In Caddy, e.g.:
#   handle_path /app/check/* { root * /home/ammar/swapup-web/check; try_files {path} /index.html; file_server }
#   redir /app/check /app/check/ 308
#
# Why EXPO_PUBLIC_APP_VARIANT: on web the app manifest (Constants.expoConfig.extra)
# is not a reliable carrier of the variant — a store build rendered the check app.
# babel-preset-expo inlines EXPO_PUBLIC_* into the bundle at export time, and
# src/shared/config.ts reads it first on web (native keeps reading `extra`).
set -euo pipefail

usage() { echo "usage: bash scripts/export-web.sh store|check|all [--fast]" >&2; exit 2; }
TARGET=${1:-}
[ "$TARGET" = store ] || [ "$TARGET" = check ] || [ "$TARGET" = all ] || usage
CLEAR=--clear
[ "${2:-}" = --fast ] && CLEAR=""   # reuse the Metro cache (only when nothing env-related changed)

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
VERSION=$(node -p 'require("./app.json").expo.version')
# The versionCode the APKs are built with (app.config.js, as build-apk.sh reads it): the browser
# build sends it too, on every API call (X-SwapUp-App, src/shared/api.ts).
VERSION_CODE=$(node -e "const c=require('./app.config.js'); console.log((typeof c==='function'?c({config:{}}):c).android.versionCode)")
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
DIRTY=$([ -n "$(git status --porcelain 2>/dev/null)" ] && echo true || echo false)

build() {
  local VARIANT=$1
  local OUT="$ROOT/dist-web/$VARIANT"
  local BASE="/app/$VARIANT"
  local NAME; NAME=$([ "$VARIANT" = store ] && echo "SwapUp Store" || echo "SwapUp Check")
  echo "▸ $NAME → $OUT (base $BASE)"
  rm -rf "$OUT"
  mkdir -p "$ROOT/.expo/web-tmp/$VARIANT"
  # A Metro cache per variant (TMPDIR → os.tmpdir()), so the two builds — or a
  # native `expo start` elsewhere — never hand each other a stale transform
  # with the wrong variant inlined. --clear on top unless --fast.
  env -u EXPO_PUBLIC_SWAPUP_SERVER \
    TMPDIR="$ROOT/.expo/web-tmp/$VARIANT" \
    CI=1 \
    APP_VARIANT="$VARIANT" \
    EXPO_PUBLIC_APP_VARIANT="$VARIANT" \
    EXPO_PUBLIC_APP_VERSION="$VERSION" \
    EXPO_PUBLIC_APP_VERSION_CODE="$VERSION_CODE" \
    SWAPUP_WEB_BASE="$BASE" \
    npx expo export --platform web --output-dir "$OUT" $CLEAR

  # ── sanity: the right app, and every URL carries the base path
  local HTML="$OUT/index.html"
  grep -q "<title>$NAME</title>" "$HTML" || { echo "✗ $HTML: title is not $NAME" >&2; exit 1; }
  grep -q "src=\"$BASE/_expo/static/js/web/" "$HTML" || { echo "✗ $HTML: bundle URL lacks $BASE" >&2; exit 1; }
  if grep -Eo '(src|href)="/[^"]*"' "$HTML" | grep -v "=\"$BASE/" >/dev/null; then
    echo "✗ $HTML: a root-relative URL without $BASE:" >&2
    grep -Eo '(src|href)="/[^"]*"' "$HTML" | grep -v "=\"$BASE/" >&2
    exit 1
  fi
  local BUNDLE; BUNDLE=$(grep -Eo "$BASE/_expo/static/js/web/[^\"]+\.js" "$HTML" | head -1)
  [ -f "$OUT${BUNDLE#$BASE}" ] || { echo "✗ bundle $BUNDLE missing from $OUT" >&2; exit 1; }

  cat > "$OUT/version.json" <<JSON
{
  "app": "$NAME",
  "variant": "$VARIANT",
  "version": "$VERSION",
  "clientVersion": "web-$VERSION",
  "base": "$BASE/",
  "bundle": "$BUNDLE",
  "commit": "$COMMIT",
  "dirty": $DIRTY,
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
  # ── what ships: no partner name, no made-up-price or demo wording, app.json's version
  # (src/shared/buildScan.ts). A build that fails is removed, so deploy.sh can't upload it.
  if ! node --experimental-strip-types --no-warnings "$ROOT/scripts/check-builds.ts" web "$VARIANT"; then
    rm -rf "$OUT"
    echo "✗ $NAME: removed $OUT" >&2
    exit 1
  fi
  echo "✓ $NAME: $(du -sh "$OUT" | cut -f1) · $BUNDLE"
}

if [ "$TARGET" = all ]; then
  build store
  build check
else
  build "$TARGET"
fi
