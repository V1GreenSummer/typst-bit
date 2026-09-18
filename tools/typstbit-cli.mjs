#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseOutline } from "../app/typstbit/web_wasm/outline.js";

const require = createRequire(import.meta.url);
const { TypstAbi } = require("../editors/vscode/wasm-bridge.js");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ABI = join(ROOT, "rust/target/wasm32-unknown-unknown/release/typst_abi.opt.wasm");
const DEFAULT_PACKAGES = join(ROOT, "app/typstbit/web_wasm/packages");
const TEXT_EXT = new Set([".typ", ".txt", ".md", ".csv", ".json"]);
const ASSET_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);

function usage() {
  console.log(`用法:
  typstbit compile <file.typ> [--abi <wasm>] [--packages <dir>]
  typstbit pdf     <file.typ> [-o out.pdf]
  typstbit svg     <file.typ> [-o out.svg] [--page N]
  typstbit png     <file.typ> [-o out.png] [--page N] [--scale 1.5]
  typstbit outline <file.typ>

项目内同目录的 .typ/图片会自动注册进 VFS，支持 #import "lib.typ"。`);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      flags[key] = value;
    } else if (arg === "-o") {
      flags.out = argv[++i];
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function walk(dir, base, files) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(path, base, files);
      continue;
    }
    const ext = extname(name).toLowerCase();
    if (!TEXT_EXT.has(ext) && !ASSET_EXT.has(ext)) continue;
    files.push({ path, vpath: "/" + relative(base, path).split("\\").join("/") });
  }
  return files;
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [command, file] = positional;
if (!command || !file) {
  usage();
  process.exit(1);
}

const abi = await TypstAbi.load(flags.abi ?? DEFAULT_ABI);
abi.registerPackages(flags.packages ?? DEFAULT_PACKAGES);

const root = dirname(resolve(file));
const files = walk(root, root, []);
let requested = files.find(entry => resolve(entry.path) === resolve(file));
if (!requested) {
  requested = { path: resolve(file), vpath: "/" + relative(root, resolve(file)).split("\\").join("/") };
  files.push(requested);
}

for (const entry of files) {
  const data = readFileSync(entry.path);
  const isText = TEXT_EXT.has(extname(entry.path).toLowerCase());
  const status = abi.setFile(entry.vpath, isText ? data.toString("utf8") : data);
  if (status !== 0) {
    console.error(`set_file ${entry.vpath} -> status ${status}`);
    process.exit(1);
  }
}
abi.setMain(requested.vpath);

if (command === "outline") {
  console.log(JSON.stringify(parseOutline(readFileSync(requested.path, "utf8")), null, 2));
  process.exit(0);
}

const status = abi.compile();
const pages = abi.pageCount();
const diagnostics = abi.diagnostics();

function report() {
  for (const item of diagnostics) {
    const location = item.start ? `第 ${item.start.line} 行` : "";
    console.error(`[${item.severity}] ${location} ${item.message}`);
  }
}

if (command === "compile") {
  console.log(JSON.stringify({ status: status === 0 ? "ok" : `status-${status}`, pages, diagnostics: diagnostics.length }, null, 2));
  report();
  process.exit(status === 0 ? 0 : 1);
}

if (status !== 0) {
  report();
  console.error(`编译失败（状态码 ${status}）`);
  process.exit(1);
}

let output = null;
let defaultName = null;
if (command === "pdf") {
  output = abi.exportPdf();
  defaultName = resolve(file).replace(/\.typ$/, ".pdf");
} else if (command === "svg") {
  output = abi.exportSvg(Number(flags.page ?? 0));
  defaultName = resolve(file).replace(/\.typ$/, ".svg");
} else if (command === "png") {
  output = abi.renderPagePng(Number(flags.page ?? 0), Number(flags.scale ?? 1.5));
  defaultName = resolve(file).replace(/\.typ$/, ".png");
} else {
  usage();
  process.exit(1);
}

if (!output) {
  console.error("导出失败（页面越界或文档为空）");
  process.exit(1);
}

const target = flags.out ? resolve(flags.out) : defaultName;
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, output);
console.log(`${command}: ${target} (${output.length} bytes, ${pages} 页)`);
