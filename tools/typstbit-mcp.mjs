#!/usr/bin/env node
// MCP server entry point (P4): thin wrapper around the MoonBit native server,
// with the Node implementation as a fallback when the native binary has not
// been built (tools/build-native-cli.sh).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "app/typstbit/_build/native/release/build/native_cli/native_cli.exe");

if (existsSync(BIN)) {
  const child = spawn(BIN, ["mcp"], {
    stdio: "inherit",
    env: { ...process.env, TYPSTBIT_PACKAGES: join(ROOT, "app/typstbit/web_wasm/packages") },
  });
  child.on("exit", code => process.exit(code ?? 1));
  child.on("error", error => {
    console.error(`typstbit-mcp: native server failed: ${error.message}`);
    process.exit(1);
  });
} else {
  await import("./typstbit-mcp-node.mjs");
}
