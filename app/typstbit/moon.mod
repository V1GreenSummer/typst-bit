name = "V1GreenSummer/typstbit"

version = "0.1.1"

license = "MIT"

repository = "https://github.com/V1GreenSummer/typst-bit"

readme = "README.md"

keywords = [ "typst", "moonbit", "wasm", "editor", "workbench" ]

description = "MoonBit application core of Typst.bit: commands, outline, multi-file projects, diagnostics, packages and theme models, plus a native CLI/MCP"

// moui@0.1.9 still pins moon_accesskit@0.3.0 and mizchi/svg@0.2.1, which ship
// a `moon.mod.json` manifest that the current toolchain rejects. Pin the
// moon.mod-based releases directly; both keep the APIs moui@0.1.9 uses.
import {
  "wzzc-dev/moui@0.1.9",
  "wzzc-dev/moui_web_renderer@0.1.9",
  "wzzc-dev/moui_skia_renderer@0.1.9",
  "Milky2018/moon_accesskit@0.4.3",
  "mizchi/svg@0.2.3",
  "moonbitlang/x@0.5.7",
}
