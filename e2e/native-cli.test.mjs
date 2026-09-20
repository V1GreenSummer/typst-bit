// Native CLI (P4) smoke test: MoonBit binary linked against the Rust
// typst-abi static library. Skips when the binary is not built.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "app/typstbit/_build/native/release/build/native_cli/native_cli.exe");
const REQUIRE = process.env.REQUIRE_NATIVE === "1";

if (!existsSync(BIN)) {
  const message = "native-cli: SKIP (build with tools/build-native-cli.sh)";
  console.log(message);
  process.exit(REQUIRE ? 1 : 0);
}

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures.push(name);
};
const run = (args, options = {}) =>
  spawnSync(BIN, args, {
    encoding: "utf8",
    env: { ...process.env, TYPSTBIT_PACKAGES: join(ROOT, "app/typstbit/web_wasm/packages") },
    ...options,
  });

const dir = mkdtempSync(join(tmpdir(), "typstbit-native-"));
try {
  writeFileSync(join(dir, "lib.typ"), "#let greet(name) = [你好，#name！]\n");
  writeFileSync(
    join(dir, "main.typ"),
    '= Native CLI\n#import "lib.typ": greet\n\n#set text(font: ("Liberation Serif", "Noto Serif CJK SC"))\n中文与 English。\n\n#greet("MoonBit")\n',
  );
  writeFileSync(join(dir, "bad.typ"), "#let broken = ");

  const outline = run(["outline", join(dir, "main.typ")]);
  const parsedOutline = outline.status === 0 ? JSON.parse(outline.stdout) : null;
  check("outline succeeds", parsedOutline?.[0]?.title === "Native CLI", outline.stdout.trim().slice(0, 60));

  const compile = run(["compile", join(dir, "main.typ")]);
  const summary = compile.status === 0 ? JSON.parse(compile.stdout) : null;
  check("multi-file compile succeeds", summary?.status === "ok" && summary.pages === 1, compile.stdout.trim());

  for (const [kind, magic] of [["pdf", "%PDF-1.7"], ["svg", "<svg"], ["png", "\u0089PNG"]]) {
    const target = join(dir, `out.${kind}`);
    const result = run([kind, join(dir, "main.typ"), "-o", target]);
    const head = existsSync(target) ? readFileSync(target).subarray(0, 8).toString("latin1") : "";
    check(`${kind} export writes a valid file`, result.status === 0 && head.startsWith(magic), `${head.slice(0, 8)} ${result.stdout.trim()}`);
  }

  const broken = run(["compile", join(dir, "bad.typ")]);
  check(
    "invalid source reports diagnostics and exits non-zero",
    broken.status === 1 && broken.stdout.includes("[error]") && broken.stdout.includes("status-3"),
    broken.stdout.trim().replace(/\n/g, " | "),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures.length === 0 ? "NATIVE CLI: PASS" : `NATIVE CLI: FAIL (${failures.join(", ")})`);
process.exit(failures.length ? 1 : 0);
