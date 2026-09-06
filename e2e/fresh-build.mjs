// Fresh-build verification (task 9.1): boot the app built entirely from
// the fresh copy (no build artifacts carried over) against the freshly
// built typst_abi.wasm, and run the core flow.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = "/tmp/opencode/fresh";
const PORT = 8938;
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".css": "text/css",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = join(ROOT, decodeURIComponent(url.pathname));
    const safe = normalize(path).startsWith(normalize(ROOT));
    if (!safe) throw new Error("out of root");
    const body = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const browser = await chromium.launch({
  args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader", "--enable-features=Vulkan"],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 520 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.goto(`http://127.0.0.1:${PORT}/app/typstbit/web_wasm/index.html`);

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures.push(name);
};

const deadline = Date.now() + 90_000;
let booted = false;
while (Date.now() < deadline) {
  booted = await page.evaluate(() => globalThis.__typstbit?.ready === true);
  if (booted) break;
  await page.waitForTimeout(300);
}
check("fresh build: boot", booted);

let ok = false;
const deadline2 = Date.now() + 90_000;
while (Date.now() < deadline2) {
  ok = await page.evaluate(() => {
    const app = globalThis.__typstbit?.app;
    if (!app) return false;
    return app.exports.e2e_status() === 2 && app.exports.e2e_preview_ready() === 1;
  });
  if (ok) break;
  await page.waitForTimeout(300);
}
check("fresh build: initial compile + preview ready", ok);
check("fresh build: no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));

await browser.close();
server.close();
console.log(failures.length === 0 ? "FRESH BUILD: PASS" : `FRESH BUILD: FAIL (${failures.join(", ")})`);
process.exit(failures.length === 0 ? 0 : 1);
