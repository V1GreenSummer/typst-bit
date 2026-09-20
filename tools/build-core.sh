#!/bin/sh
# Build the MoonBit application core (wasm-gc) and stage it next to the workbench.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/app/typstbit"
OUT="$ROOT/app/typstbit/web_wasm"
(cd "$SRC" && moon build --target wasm-gc --release core)
cp "$SRC/_build/wasm-gc/release/build/core/core.wasm" "$OUT/core.wasm"
echo "staged $OUT/core.wasm"
