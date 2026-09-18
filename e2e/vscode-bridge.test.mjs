// VSCode extension bridge smoke test (no VSCode host needed).
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { TypstAbi } = require(join(ROOT, "editors/vscode/wasm-bridge.js"));

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures.push(name);
};

const abi = await TypstAbi.load(join(ROOT, "rust/target/wasm32-unknown-unknown/release/typst_abi.opt.wasm"));
const registered = abi.registerPackages(join(ROOT, "app/typstbit/web_wasm/packages"));
check("bundled packages registered", registered > 0, `${registered} files`);

abi.setFile("/main.typ", "= Bridge\n\nHello from the VSCode bridge.");
abi.setMain("/main.typ");
const status = abi.compile();
check("compile succeeds", status === 0 && abi.pageCount() === 1, `status=${status} pages=${abi.pageCount()}`);

const png = abi.renderPagePng(0, 1.5);
check("png render", Boolean(png) && png[0] === 0x89 && String.fromCharCode(...png.subarray(1, 4)) === "PNG", `${png?.length ?? 0}B`);

const svg = abi.exportSvg(0);
check("svg export", Boolean(svg) && new TextDecoder().decode(svg).startsWith("<svg"));

const pdf = abi.exportPdf();
check("pdf export", Boolean(pdf) && new TextDecoder().decode(pdf.subarray(0, 8)) === "%PDF-1.7", `${pdf?.length ?? 0}B`);

abi.setFile("/main.typ", '#import "@preview/tiaoma:0.3.0": qrcode\n#qrcode("https://typst.app", width: 2em)');
abi.setMain("/main.typ");
check("bundled @preview package compiles", abi.compile() === 0 && abi.pageCount() === 1);

abi.setFile("/main.typ", "#let broken = ");
abi.setMain("/main.typ");
abi.compile();
const diagnostics = abi.diagnostics();
check("diagnostics surface errors", diagnostics.some(item => item.severity === "error"), `${diagnostics.length} item(s)`);

console.log(failures.length === 0 ? "VSCODE BRIDGE: PASS" : `VSCODE BRIDGE: FAIL (${failures.join(", ")})`);
process.exit(failures.length === 0 ? 0 : 1);
