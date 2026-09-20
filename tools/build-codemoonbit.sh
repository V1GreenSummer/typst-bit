#!/bin/sh
# Build the vendored CodeMoonBit editor and stage its runtime next to the workbench.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/vendor/codemoonbit"
OUT="$ROOT/app/typstbit/web_wasm/vendor/codemoonbit"
mkdir -p "$OUT"
(cd "$SRC" && moon build --target wasm-gc --release)
cp "$SRC/_build/wasm-gc/release/build/main/main.wasm" "$OUT/codemoonbit.wasm"
cp "$SRC/js/browser.js" "$SRC/js/dom_runtime.js" "$SRC/js/codemoonbit.css" "$OUT/"
echo "staged $OUT"
