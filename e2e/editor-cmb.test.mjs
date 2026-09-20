// CodeMoonBit editor path smoke test (?editor=cmb).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = join(import.meta.dirname, "..");
const PORT = 8942;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, ORIGIN);
    let path = join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith("/")) path = join(path, "index.html");
    if (!normalize(path).startsWith(normalize(ROOT))) throw new Error("out of root");
    const body = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise(r => server.listen(PORT, "127.0.0.1", r));

const browser = await chromium.launch({
  args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader", "--enable-features=Vulkan"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures.push(name);
};
const waitFor = async (fn, label, ms = 60000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await page.evaluate(fn)) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`timeout waiting for ${label}`);
};
const doc = () => page.evaluate(() => globalThis.__typstbit.app.exports.e2e_doc());

await page.goto(`${ORIGIN}/app/typstbit/web_wasm/index.html?editor=cmb`);
await waitFor(() => globalThis.__typstbit?.ready, "boot");
await waitFor(() => globalThis.__typstbit.app.exports.e2e_status() === 2, "first compile");
check("boots with the CodeMoonBit adapter", true);
check("project overlay finished", await page.evaluate(() => {
  const overlay = document.getElementById("boot-overlay");
  return !overlay || overlay.classList.contains("done");
}));
check("CodeMoonBit DOM is mounted", await page.evaluate(() => Boolean(document.querySelector(".cm-editor"))));
check("preview is ready", (await page.evaluate(() => globalThis.__typstbit.app.exports.e2e_preview_ready())) === 1);

await page.evaluate(() => {
  const st = globalThis.__typstbit;
  const id = st.nextTextId++;
  st.typstTexts.set(id, "= Hi\n\nbody");
  st.app.exports.e2e_set_source(id);
});
await waitFor(() => globalThis.__typstbit.app.exports.e2e_status() === 2, "second compile");
check("set source compiles", (await page.evaluate(() => globalThis.__typstbit.app.exports.e2e_page_count())) === 1);

const wrapped = await page.evaluate(() => {
  const editor = globalThis.__typstbit.editor;
  editor.setSelection(2, 4);
  editor.wrapSelection("*");
  return editor.getDoc();
});
check("facade wrapSelection works on CodeMoonBit", wrapped === "= *Hi*\n\nbody", JSON.stringify(wrapped));

const cursor = await page.evaluate(() => {
  const editor = globalThis.__typstbit.editor;
  editor.setCursorToLine(3, 2);
  return { line: editor.cursorLine(), pos: editor.cursorPos() };
});
check("facade cursor helpers work", cursor.line === 3 && cursor.pos > 0, JSON.stringify(cursor));

await page.evaluate(() => {
  const editor = globalThis.__typstbit.editor;
  editor.setDoc("#let x = 1\n= Title\nSee @intro\n`raw`\n");
  editor.setSelection(0, 0);
});
await page.waitForTimeout(300);
const tokens = await page.evaluate(() => ({
  keyword: document.querySelectorAll(".tok-keyword").length,
  type: document.querySelectorAll(".tok-type").length,
  tag: document.querySelectorAll(".tok-tag").length,
  string: document.querySelectorAll(".tok-string").length,
}));
check(
  "typst highlighting renders in CodeMoonBit",
  tokens.keyword > 0 && tokens.type > 0 && tokens.tag > 0 && tokens.string > 0,
  JSON.stringify(tokens),
);

await page.evaluate(() => {
  const editor = globalThis.__typstbit.editor;
  editor.setDoc("= A");
  editor.setSelection(3, 3);
  editor.focus();
});
await page.waitForTimeout(200);
await page.keyboard.type("(");
await page.waitForTimeout(200);
const paired = await page.evaluate(() => {
  const editor = globalThis.__typstbit.editor;
  return { doc: editor.getDoc(), selection: editor.getSelection() };
});
check("auto-closes brackets", paired.doc === "= A()" && paired.selection.from === 4, JSON.stringify(paired));
await page.keyboard.type(")");
await page.waitForTimeout(200);
const overtyped = await page.evaluate(() => {
  const editor = globalThis.__typstbit.editor;
  return { doc: editor.getDoc(), selection: editor.getSelection() };
});
check("overtypes closing brackets", overtyped.doc === "= A()" && overtyped.selection.from === 5, JSON.stringify(overtyped));

await page.evaluate(() => {
  document.body.dataset.theme = "dark";
});
await page.waitForTimeout(200);
check("dark theme propagates to CodeMoonBit", await page.evaluate(() => Boolean(document.querySelector(".cm-theme-dark"))));
await page.evaluate(() => {
  document.body.dataset.theme = "light";
});
await page.waitForTimeout(200);
check("light theme propagates to CodeMoonBit", await page.evaluate(() => !document.querySelector(".cm-theme-dark")));

await page.evaluate(() => {
  const st = globalThis.__typstbit;
  const id = st.nextTextId++;
  st.typstTexts.set(id, "= Broken\n\n#let x =");
  st.app.exports.e2e_set_source(id);
});
await waitFor(() => globalThis.__typstbit.app.exports.e2e_status() === 3, "failed compile");
await page.waitForTimeout(400);
const marks = await page.evaluate(() => ({
  error: document.querySelectorAll(".cm-diagnostic-error").length,
  warning: document.querySelectorAll(".cm-diagnostic-warning").length,
}));
check("diagnostics render as editor marks", marks.error + marks.warning > 0, JSON.stringify(marks));

check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();
server.close();
console.log(failures.length === 0 ? "CMB SMOKE: PASS" : `CMB SMOKE: FAIL (${failures.join(", ")})`);
process.exit(failures.length ? 1 : 0);
