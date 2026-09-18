// Offline CLI regression (tools/typstbit-cli.mjs).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "tools/typstbit-cli.mjs");
const dir = mkdtempSync(join(tmpdir(), "typstbit-cli-"));

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures.push(name);
};

writeFileSync(join(dir, "lib.typ"), "#let greet() = [hello from lib]");
writeFileSync(join(dir, "main.typ"), '= CLI\n\n#import "lib.typ": greet\n#greet()\n\n$ x^2 + y^2 = z^2 $\n');

const compile = JSON.parse(execFileSync("node", [CLI, "compile", join(dir, "main.typ")], { encoding: "utf8" }));
check("cli compile multi-file", compile.status === "ok" && compile.pages === 1 && compile.diagnostics === 0, JSON.stringify(compile));

const pdfPath = join(dir, "out.pdf");
execFileSync("node", [CLI, "pdf", join(dir, "main.typ"), "-o", pdfPath]);
const pdf = readFileSync(pdfPath);
check("cli pdf export", pdf.subarray(0, 8).toString() === "%PDF-1.7" && pdf.length > 1000, `${pdf.length}B`);

const pngPath = join(dir, "out.png");
execFileSync("node", [CLI, "png", join(dir, "main.typ"), "-o", pngPath, "--scale", "1"]);
const png = readFileSync(pngPath);
check("cli png export", png[0] === 0x89 && png.subarray(1, 4).toString() === "PNG", `${png.length}B`);

const svgPath = join(dir, "out.svg");
execFileSync("node", [CLI, "svg", join(dir, "main.typ"), "-o", svgPath]);
check("cli svg export", readFileSync(svgPath, "utf8").startsWith("<svg"));

const outline = JSON.parse(execFileSync("node", [CLI, "outline", join(dir, "main.typ")], { encoding: "utf8" }));
check("cli outline", outline.length === 1 && outline[0].title === "CLI", JSON.stringify(outline));

writeFileSync(join(dir, "bad.typ"), "#let broken = ");
let failed = false;
try {
  execFileSync("node", [CLI, "compile", join(dir, "bad.typ")], { stdio: "pipe" });
} catch {
  failed = true;
}
check("cli exits non-zero on errors", failed);

rmSync(dir, { recursive: true, force: true });
console.log(failures.length === 0 ? "CLI: PASS" : `CLI: FAIL (${failures.join(", ")})`);
process.exit(failures.length === 0 ? 0 : 1);
