import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = "/home/wyx/workplace/moonbit/Typst.bit";
const PORT = 8941;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css" };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, ORIGIN);
    let path = join(ROOT, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith("/")) path = join(path, "index.html");
    if (!normalize(path).startsWith(normalize(ROOT))) throw new Error("out of root");
    const body = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("nf"); }
});
await new Promise(r => server.listen(PORT, "127.0.0.1", r));
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader", "--enable-features=Vulkan"] });
const page = await browser.newPage();
page.on("console", m => console.log("[console." + m.type() + "]", m.text().slice(0, 300)));
page.on("pageerror", e => console.log("[pageerror]", e.message.slice(0, 500), "\n", (e.stack || "").split("\n").slice(0, 5).join("\n")));
await page.goto(`${ORIGIN}/app/typstbit/web_wasm/index.html`);
await page.waitForTimeout(8000);
const st = await page.evaluate(() => ({
  ready: !!globalThis.__typstbit?.ready,
  status: globalThis.__typstbit?.app?.exports?.e2e_status?.(),
}));
console.log("state:", JSON.stringify(st));
await browser.close(); server.close(); process.exit(0);
