import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
const ROOT = "/home/wyx/workplace/moonbit/Typst.bit";
const PORT = 8959;
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
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const logs = [];
page.on("console", m => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", e => logs.push(`pageerror: ${e.message}`));
await page.goto(`${ORIGIN}/app/typstbit/web_wasm/index.html`);
await page.waitForTimeout(6000);
const state = await page.evaluate(() => ({
  ready: globalThis.__typstbit?.ready,
  overlay: document.getElementById("boot-overlay")?.className,
  step: document.querySelector("#boot-overlay .boot-step")?.textContent,
  cm: Boolean(document.querySelector(".cm-content")),
}));
console.log(JSON.stringify(state));
for (const line of logs.slice(-15)) console.log(line);
await browser.close(); server.close();
