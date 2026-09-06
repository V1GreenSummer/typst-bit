#!/bin/sh
# Restore the pre-generated wayland stubs required by wzzc-dev/window's
# prebuild on this sudo-less machine (see docs/versions.md).
set -e
GEN="$(dirname "$0")/../app/typstbit/.mooncakes/wzzc-dev/window/linux/generated"
mkdir -p "$GEN"
for f in xdg-shell-client-protocol.h xdg-shell-protocol.c \
         xdg-decoration-client-protocol.h xdg-decoration-protocol.c; do
  printf '/* stub: not used by wasm-gc builds */\n' > "$GEN/$f"
done
echo "wayland stubs restored in $GEN"
