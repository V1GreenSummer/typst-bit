// Task 6.4 wasm load smoke: instantiate typst_abi.wasm in node/V8 and
// assert the frozen ABI v1 exports are callable end-to-end (success path,
// every status code, per-category E_INVALID_ARG, output window basics).
//
// Usage: node spike/abi-smoke.mjs [path-to-typst_abi.wasm]
import { readFileSync } from "node:fs";
import { join } from "node:path";

const wasmPath =
  process.argv[2] ??
  join(import.meta.dirname, "..", "..", "target", "wasm32-unknown-unknown", "release", "typst_abi.wasm");

const OK = 0;
const E_INVALID_ARG = 1;
const E_MAIN_NOT_SET = 2;
const E_COMPILE_ERRORS = 3;

const bytes = readFileSync(wasmPath);
const { instance } = await WebAssembly.instantiate(bytes, {});
const e = instance.exports;

const required = [
  "memory",
  "typst_abi_out_len_ptr",
  "typst_abi_alloc",
  "typst_abi_reset",
  "typst_abi_set_file",
  "typst_abi_remove_file",
  "typst_abi_set_main",
  "typst_abi_compile",
  "typst_abi_page_count",
  "typst_abi_render_page_png",
  "typst_abi_error_json",
  // Spike B measurement exports (kept for docs/spike-b.md reproducibility).
  "spike_init",
  "spike_compile",
  "spike_alloc",
  "spike_evict",
];
for (const name of required) {
  if (!e[name]) throw new Error(`missing export: ${name}`);
}

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures.push(name);
};

/** Write bytes through the arena; returns [ptr, len] as Numbers. */
function put(data) {
  const ptr = e.typst_abi_alloc(data.length);
  if (ptr === 0) throw new Error("alloc failed");
  new Uint8Array(e.memory.buffer, ptr, data.length).set(data);
  return [ptr, data.length];
}

const putStr = (s) => put(new TextEncoder().encode(s));

function setFile(path, data) {
  const [p, plen] = putStr(path);
  const [d, dlen] = put(data);
  return e.typst_abi_set_file(p, plen, d, dlen);
}

const setMain = (path) => {
  const [p, plen] = putStr(path);
  return e.typst_abi_set_main(p, plen);
};

function outLen() {
  return new DataView(e.memory.buffer).getUint32(e.typst_abi_out_len_ptr(), true);
}

function readOut(ptr, len) {
  return new Uint8Array(e.memory.buffer, ptr, len).slice();
}

function renderPng(page, scale) {
  const ptr = e.typst_abi_render_page_png(page, scale);
  if (ptr === 0) return null;
  return readOut(ptr, outLen());
}

function errorJson() {
  const ptr = e.typst_abi_error_json();
  if (ptr === 0) return null;
  return new TextDecoder().decode(readOut(ptr, outLen()));
}

// --- success path -----------------------------------------------------------
check("reset", e.typst_abi_reset() === OK);
check("compile before set_main", e.typst_abi_compile() === E_MAIN_NOT_SET);
check("set_main missing file + compile", setMain("/main.typ") === OK && e.typst_abi_compile() === E_MAIN_NOT_SET);

check("set_file main.typ", setFile("/main.typ", new TextEncoder().encode("Hello, typst!\n#pagebreak()\nSecond page")) === OK);
check("set_main", setMain("/main.typ") === OK);
check("compile", e.typst_abi_compile() === OK);
check("page_count == 2", e.typst_abi_page_count() === 2);
check("no diagnostics on success", errorJson() === null);

const png = renderPng(0, 1000);
check("render page 0 png", png !== null, png ? `${png.length} bytes` : "");
const pngHeader = png ? Array.from(png.slice(0, 8)) : [];
check("png signature", pngHeader.every((v, i) => v === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][i]));
if (png) {
  const dv = new DataView(png.buffer, png.byteOffset);
  check("png is 595x842 (A4 @1x)", dv.getUint32(16) === 595 && dv.getUint32(20) === 842);
}

// --- failure paths ----------------------------------------------------------
check("out-of-range page -> 0", e.typst_abi_render_page_png(9, 1000) === 0);
check("zero scale -> 0", e.typst_abi_render_page_png(0, 0) === 0);

check("syntax error source", setFile("/main.typ", new TextEncoder().encode("Ok\n\n#let x = ")) === OK);
check("compile -> E_COMPILE_ERRORS", e.typst_abi_compile() === E_COMPILE_ERRORS);
const json = errorJson();
check("error_json has line numbers", json !== null && json.includes('"line":3'), json ? "" : "null");
check("last-good page_count survives", e.typst_abi_page_count() === 2);
check("last-good render survives", renderPng(1, 1000) !== null);

// --- invalid arguments (per category, no trap) -------------------------------
check("relative path", setFile("main.typ", new TextEncoder().encode("x")) === E_INVALID_ARG);
check("escaping path", setFile("/../x.typ", new TextEncoder().encode("x")) === E_INVALID_ARG);
check("backslash path", setFile("/a\\b.typ", new TextEncoder().encode("x")) === E_INVALID_ARG);
check("root path", setFile("/", new TextEncoder().encode("x")) === E_INVALID_ARG);
check("empty path", setFile("", new TextEncoder().encode("x")) === E_INVALID_ARG);
check("non-utf8 path", setFile(new Uint8Array([0xff, 0xfe]), new TextEncoder().encode("x")) === E_INVALID_ARG);
check("non-utf8 .typ data", setFile("/main.typ", new Uint8Array([0xff, 0xfe, 0xfd])) === E_INVALID_ARG);
check("wild pointer", e.typst_abi_set_file(0xdeadbeef, 4, 0xdeadbeef, 4) === E_INVALID_ARG);
check("ptr+len overflow", e.typst_abi_set_file(0xffffffff, 2, 0, 0) === E_INVALID_ARG);
check("len beyond arena top", setFileBeyondTop() === E_INVALID_ARG);
check("set_main wild pointer", e.typst_abi_set_main(0xdeadbeef, 8) === E_INVALID_ARG);

function setFileBeyondTop() {
  // Valid allocation, but a length that runs past the arena's used window.
  const [p, plen] = putStr("/main.typ");
  return e.typst_abi_set_file(p, plen + 4096, 0, 0);
}

// --- remove + recompile ------------------------------------------------------
check("remove main.typ", (() => {
  const [p, plen] = putStr("/main.typ");
  return e.typst_abi_remove_file(p, plen) === OK;
})());
check("compile after remove -> E_MAIN_NOT_SET", e.typst_abi_compile() === E_MAIN_NOT_SET);

// --- spike exports still alive (docs/spike-b.md reproducibility) -------------
check("spike_init", e.spike_init() === 17);

console.log(failures.length === 0 ? "ABI SMOKE: PASS" : `ABI SMOKE: FAIL (${failures.join(", ")})`);
process.exit(failures.length === 0 ? 0 : 1);
