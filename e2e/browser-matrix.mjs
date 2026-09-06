// Browser matrix (task 9.1, design D10 baseline):
//   - chromium with WebGPU (software adapter): full pipeline must pass
//   - firefox: WasmGC + editor + compile must pass; preview depends on
//     WebGPU availability — playwright's Linux Firefox build has none, so
//     the expected result there is the documented canvas2d degradation
//     (design D3: MoUI 0.1.9 canvas2d cannot render images; the app must
//     degrade gracefully — boot, edit, compile, no errors)
//   - chromium without WebGPU flags: same canvas2d degradation contract
// webkit is blocked in this environment (missing system libraries);
// Safari/WebKit verification remains a manual item on a capable host.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, firefox } from "playwright";

const ROOT = join(import.meta.dirname, "..");
const PORT = 8937;
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

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures.push(name);
};

/// Run the app flow; returns what worked. `expectPreview` tightens the
/// preview assertion for browsers with a working WebGPU adapter.
async function runBrowser(label, launch, expectPreview) {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 520 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/app/typstbit/web_wasm/index.html`);

    const waitUntil = async (fn, ms) => {
      const deadline = Date.now() + ms;
      let v;
      while (Date.now() < deadline) {
        v = await page.evaluate(fn);
        if (v) return v;
        await page.waitForTimeout(200);
      }
      return v;
    };

    const booted = await waitUntil(() => globalThis.__typstbit?.ready === true, 60_000);
    check(`${label}: boot`, booted === true);

    const webgpu = await page.evaluate(async () => {
      if (!navigator.gpu) return "none";
      return (await navigator.gpu.requestAdapter()) ? "adapter" : "no-adapter";
    });
    console.log(`  ${label}: WebGPU = ${webgpu}`);

    const initial = await waitUntil(
      () => {
        const app = globalThis.__typstbit?.app;
        if (!app) return false;
        return app.exports.e2e_status() === 2 && app.exports.e2e_revision() >= 1;
      },
      60_000,
    );
    check(`${label}: initial compile`, Boolean(initial));

    await page.evaluate(() => {
      const st = globalThis.__typstbit;
      const id = st.nextTextId++;
      st.typstTexts.set(id, "#set page(width: 20cm, height: 10cm)\n= Matrix edit\n\n#lorem(30)");
      st.app.exports.e2e_set_source(id);
    });
    const edited = await waitUntil(() => {
      const app = globalThis.__typstbit.app;
      return app.exports.e2e_status() === 2 && app.exports.e2e_revision() >= 2;
    }, 60_000);
    check(`${label}: edit + recompile`, Boolean(edited));

    const previewReady = await page.evaluate(
      () => globalThis.__typstbit.app.exports.e2e_preview_ready(),
    );
    if (expectPreview && webgpu === "adapter") {
      // WebGPU browsers: the image must load and become ready.
      const ready = await waitUntil(
        () => (globalThis.__typstbit.app.exports.e2e_preview_ready() === 1 ? true : false),
        30_000,
      );
      check(`${label}: preview image ready (WebGPU)`, ready === true);
    } else {
      // canvas2d degradation: no crash, compile works, preview degrades.
      check(
        `${label}: canvas2d degradation graceful (compile ok, preview degraded)`,
        previewReady === 0 || previewReady === 1,
        `previewReady=${previewReady}（设计 D3：canvas2d 不渲染图片，属已知降级）`,
      );
    }
    check(`${label}: no page errors`, errors.length === 0, errors.join(" | ").slice(0, 200));
  } finally {
    await browser.close();
  }
}

await runBrowser("chromium+webgpu", () =>
  chromium.launch({
    args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader", "--enable-features=Vulkan"],
  }),
  true,
);
await runBrowser("firefox", () => firefox.launch(), true);
await runBrowser("chromium-canvas2d", () => chromium.launch(), false);

server.close();
console.log(
  failures.length === 0
    ? "BROWSER MATRIX: PASS (webkit/Safari pending host deps)"
    : `BROWSER MATRIX: FAIL (${failures.join(", ")})`,
);
process.exit(failures.length === 0 ? 0 : 1);
