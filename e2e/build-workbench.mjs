import { build } from "esbuild";
import { join } from "node:path";

const result = await build({
  entryPoints: ["../app/typstbit/web_wasm/workbench-entry.js"],
  outfile: "../app/typstbit/web_wasm/editor-bundle.js",
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  legalComments: "none",
  nodePaths: [join(import.meta.dirname, "node_modules")],
  logLevel: "info",
});
console.log("[build-workbench]", result.errors.length, "errors");
