import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const ROOT = "/home/wyx/workplace/moonbit/Typst.bit";
const PORT = 8958;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css" };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, ORIGIN);
    let path = join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith("/")) path = join(path, "index.html");
    if (!normalize(path).startsWith(normalize(ROOT))) throw new Error("out of root");
    const body = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404); res.end("nope"); }
});
await new Promise(r => server.listen(PORT, "127.0.0.1", r));
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader", "--enable-features=Vulkan"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
await page.goto(`${ORIGIN}/app/typstbit/web_wasm/index.html`);
await page.waitForFunction(() => globalThis.__typstbit?.ready, null, { timeout: 60000 });
await page.waitForTimeout(400);
await page.evaluate(() => {
  globalThis.__mutations = 0;
  const content = document.querySelector(".cm-content");
  new MutationObserver(records => { globalThis.__mutations += records.length; }).observe(content, { childList: true, subtree: true, characterData: true, attributes: true });
});
await page.click(".cm-input");
await page.keyboard.press("Control+a");
await page.keyboard.press("Delete");
await page.evaluate(() => {
  const lines = [];
  for (let i = 0; i < 200; i++) lines.push(`line ${i}: 一些中文内容 with English ${i}`);
  const text = "#set page(width: 20cm, height: 10cm)\n" + lines.join("\n") + "\n";
  globalThis.__typstbit.editor.setDoc(text);
  globalThis.__typstbit.editor.setSelection(text.length, text.length);
  globalThis.__typstbit.editor.focus();
});
await page.waitForTimeout(500);
await page.waitForTimeout(600);
const baseline = await page.evaluate(() => ({ mutations: globalThis.__mutations }));
await page.evaluate(() => { globalThis.__mutations = 0;  });
const typed = [];
for (let i = 0; i < 100; i++) {
  const t0 = performance.now();
  await page.keyboard.type("a");
  typed.push(performance.now() - t0);
}
const afterType = await page.evaluate(() => ({ mutations: globalThis.__mutations }));
await page.evaluate(() => { globalThis.__mutations = 0; });
const deleted = [];
for (let i = 0; i < 100; i++) {
  const t0 = performance.now();
  await page.keyboard.press("Backspace");
  deleted.push(performance.now() - t0);
}
const afterDelete = await page.evaluate(() => ({ mutations: globalThis.__mutations }));
const p95 = arr => [...arr].sort((a, b) => a - b)[Math.floor(arr.length * 0.95)];
const failures = [];
const report = (name, condition, detail) => {
  if (!condition) failures.push(name);
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}  (${detail})`);
};
report("typing mutations per 100 keys <= 400", afterType.mutations <= 400, `${afterType.mutations}`);
report("deleting mutations per 100 keys <= 400", afterDelete.mutations <= 400, `${afterDelete.mutations}`);
report("typing p95 <= 20ms", parseFloat(p95(typed)) <= 20, `${p95(typed).toFixed(2)}ms`);
report("deleting p95 <= 20ms", parseFloat(p95(deleted)) <= 20, `${p95(deleted).toFixed(2)}ms`);

console.log(`typing: ${afterType.mutations} mutations / 100 keys, p95 ${p95(typed).toFixed(2)}ms, total ${typed.reduce((a, b) => a + b, 0).toFixed(1)}ms`);
console.log(`deleting: ${afterDelete.mutations} mutations / 100 keys, p95 ${p95(deleted).toFixed(2)}ms, total ${deleted.reduce((a, b) => a + b, 0).toFixed(1)}ms`);
await browser.close(); server.close();

console.log(failures.length === 0 ? "EDITOR PERF: PASS" : `EDITOR PERF: FAIL (${failures.join(", ")})`);
process.exit(failures.length ? 1 : 0);
