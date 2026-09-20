#!/bin/sh
# Build the native Typst.bit CLI: rust typst-abi staticlib + MoonBit native.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
(cd "$ROOT/rust" && cargo build -p typst-abi --release)
(cd "$ROOT/app/typstbit" && moon build --target native --release native_cli)
BIN="$ROOT/app/typstbit/_build/native/release/build/native_cli/native_cli.exe"
echo "built $BIN"
