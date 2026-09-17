// Acceptance measurements (tasks 9.1/9.2, design D10):
//   A. offline editing: after load, cut the network, edit + recompile
//      succeeds with zero outgoing requests (spec offline scenario)
//   B. init time to editable (boot -> editor interactive)
//   C. short-doc and 10-page compile P50/P95 through the production ABI
//   D. single-page render (1x) P50/P95
//   E. wasm memory growth over a 100-edit loop (typst_abi instance)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { brotliCompressSync, constants as zc } from "node:zlib";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const ROOT = join(import.meta.dirname, "..");
const PORT = 8936;
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
    res.writeHead(200, {
      "content-type": MIME[extname(path)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const browser = await chromium.launch({
  args: [
    "--enable-unsafe-webgpu",
    "--use-angle=swiftshader",
    "--enable-features=Vulkan",
  ],
});
const context = await browser.newContext({ viewport: { width: 1000, height: 520 } });
const page = await context.newPage();
let requestedAbiPath = null;
page.on("request", (req) => {
  if (req.url().includes("typst_abi") && req.url().endsWith(".wasm")) {
    requestedAbiPath = new URL(req.url()).pathname;
  }
});
const consoleLines = [];
page.on("console", (m) => consoleLines.push(`[c:${m.type()}] ${m.text().slice(0, 150)}`));
page.on("pageerror", (e) => consoleLines.push(`[pageerror] ${e.message}`));

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures.push(name);
};

const waitFor = async (fn, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await page.evaluate(fn);
    if (value) return value;
    await page.waitForTimeout(50);
  }
  throw new Error(`timeout waiting for ${label}: ${JSON.stringify(value)}`);
};

// Track outgoing network requests after boot.
let networkQuiet = true;
const requestsAfterBoot = [];
page.on("request", (req) => {
  if (!networkQuiet) requestsAfterBoot.push(req.url());
});

// ---- B. init time (boot -> editable) ----------------------------------------
const bootStart = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/app/typstbit/web_wasm/index.html`);
await waitFor(() => globalThis.__typstbit?.ready, 60_000, "boot");
// Editable = the first compile finished and the editor is interactive
// (the app rendered its first frame at boot; we count until first Success).
await waitFor(() => globalThis.__typstbit?.app?.exports?.e2e_status?.() === 2, 60_000, "first compile");
const initMs = Date.now() - bootStart;
console.log(`[init] boot -> editable: ${initMs} ms (desktop CPU, software WebGPU)`);

networkQuiet = false;

const setSource = (text) =>
  page.evaluate(({ text }) => {
    const st = globalThis.__typstbit;
    const id = st.nextTextId++;
    st.typstTexts.set(id, text);
    st.app.exports.e2e_set_source(id);
  }, { text });

// ---- A. offline editing after load (spec scenario) ---------------------------
// Warm the fonts/library first, then cut the network and recompile.
{
  await setSource("#set page(width: 20cm, height: 10cm)\n= Online warmup\n\n#lorem(20)");
  await waitFor(() => {
    const app = globalThis.__typstbit.app;
    return app.exports.e2e_status() === 2 && app.exports.e2e_revision() >= 2;
  }, 60_000, "warmup compile");
  await context.setOffline(true);
  requestsAfterBoot.length = 0;
  const offlineDoc = "#set page(width: 20cm, height: 10cm)\n= Offline edit\n\n#lorem(20) 完全离线编辑。";
  await setSource(offlineDoc);
  const ok = await waitFor(() => {
    const app = globalThis.__typstbit.app;
    return app.exports.e2e_status() === 2 && app.exports.e2e_revision() >= 3;
  }, 60_000, "offline compile");
  // blob: URLs load locally, but the texture load still takes frames.
  const preview = await waitFor(
    () => (globalThis.__typstbit.app.exports.e2e_preview_ready() === 1 ? 1 : false),
    30_000,
    "offline preview ready",
  );
  check(
    "offline edit + recompile succeeds after load",
    Boolean(ok) && preview === 1,
    `rev ok, previewReady=${preview}`,
  );
  await page.waitForTimeout(1500);
  const attempted = requestsAfterBoot.filter(
    (u) => !u.startsWith("data:") && !u.startsWith("blob:"),
  );
  check("no network requests during offline editing", attempted.length === 0, JSON.stringify(attempted));
  await context.setOffline(false);
}

// ---- C/D/E. production-ABI timings through the real page ---------------------
const measurements = await page.evaluate(async () => {
  const st = globalThis.__typstbit;
  const abi = st.abi.exports;
  const mem = () => st.abi.exports.memory.buffer.byteLength;
  const utf8 = new TextEncoder();
  const put = (bytes) => {
    const ptr = abi.typst_abi_alloc(bytes.length);
    new Uint8Array(st.abi.exports.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  };
  const setFile = (path, data) => {
    const [p, plen] = put(utf8.encode(path));
    const [d, dlen] = put(utf8.encode(data));
    return abi.typst_abi_set_file(p, plen, d, dlen);
  };
  const setMain = (path) => {
    const [p, plen] = put(utf8.encode(path));
    return abi.typst_abi_set_main(p, plen);
  };
  const time = async (fn, repeats) => {
    const times = [];
    for (let i = 0; i < repeats; i++) {
      const t0 = performance.now();
      const value = await fn(i);
      times.push({ ms: performance.now() - t0, value });
    }
    return times;
  };

  const shortDoc = `#set page(width: 16cm, height: auto, margin: 1.5cm)
= Introduction

Typst is a markup-based typesetting system.
${"\n== Section\n\n#lorem(40)\n".repeat(6)}`;

  let tenPages = "#set page(margin: 2cm)\n";
  for (let i = 0; i < 20; i++) tenPages += `= Section ${i}\n\n#lorem(120)\n\n#lorem(80)\n\n`;

  // Compile timings (mutating a revision marker per iteration).
  const compileDoc = (base, rev) => base.replace(/revision-marker/, `rev-${rev}`);
  const shortTimings = await time((i) => {
    setFile("/main.typ", compileDoc(shortDoc + "\n% revision-marker", i));
    setMain("/main.typ");
    return abi.typst_abi_compile();
  }, 30);
  const tenTimings = await time((i) => {
    setFile("/main.typ", compileDoc(tenPages + "\n% revision-marker", i));
    setMain("/main.typ");
    return abi.typst_abi_compile();
  }, 20);

  // Single-page render at 1x (scale_milli 1000), on the 10-page doc.
  const renderTimings = await time(() => abi.typst_abi_render_page_png(0, 1000) !== 0, 30);

  // Memory: compile the short doc, then 100 edited compiles.
  setFile("/main.typ", shortDoc);
  setMain("/main.typ");
  abi.typst_abi_compile();
  const afterFirst = mem();
  for (let i = 0; i < 100; i++) {
    setFile("/main.typ", compileDoc(shortDoc + "\n% revision-marker", i));
    abi.typst_abi_compile();
  }
  const after100 = mem();

  const pct = (xs, p) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
  };
  const stat = (xs) => {
    const vals = xs.map((t) => t.ms);
    return `p50=${pct(vals, 50).toFixed(1)}ms p95=${pct(vals, 95).toFixed(1)}ms`;
  };
  return {
    shortCompile: stat(shortTimings),
    shortAllOk: shortTimings.every((t) => t.value === 0),
    tenCompile: stat(tenTimings),
    tenAllOk: tenTimings.every((t) => t.value === 0),
    render: stat(renderTimings),
    renderAllOk: renderTimings.every((t) => t.value === true),
    memory: {
      afterFirst,
      after100,
      growthPct: (((after100 - afterFirst) / afterFirst) * 100).toFixed(1),
    },
  };
});
console.log("[budget] short compile :", measurements.shortCompile, measurements.shortAllOk ? "OK" : "ERRORS");
console.log("[budget] 10page compile:", measurements.tenCompile, measurements.tenAllOk ? "OK" : "ERRORS");
console.log("[budget] page render 1x:", measurements.render, measurements.renderAllOk ? "OK" : "ERRORS");
console.log("[budget] memory 100 edits:", JSON.stringify(measurements.memory));

// ---- sizes (raw + brotli) -----------------------------------------------------
const sizes = (() => {
  const br = (buf) =>
    brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }).length;
  const readSize = (path) => {
    const buf = readFileSync(path);
    return { raw: buf.length, brotli: br(buf) };
  };
  const base = join(ROOT, "rust/target/wasm32-unknown-unknown/release");
  const served = requestedAbiPath
    ? readSize(join(ROOT, requestedAbiPath))
    : readSize(join(base, "typst_abi.wasm"));
  let optimized = null;
  try {
    optimized = readSize(join(base, "typst_abi.opt.wasm"));
  } catch {}
  const app = readSize(join(ROOT, "app/typstbit/_build/wasm-gc/release/build/web_wasm/web_wasm.wasm"));
  return { served, optimized, app, firstLoad: served.brotli + app.brotli, requested: requestedAbiPath };
})();
console.log(
  `[budget] typst_abi.wasm served: raw=${(sizes.served.raw / 1048576).toFixed(2)}MiB brotli=${(sizes.served.brotli / 1048576).toFixed(2)}MiB (${sizes.requested ?? "fallback"})`,
);
if (sizes.optimized) {
  console.log(
    `[budget] typst_abi.opt.wasm: raw=${(sizes.optimized.raw / 1048576).toFixed(2)}MiB brotli=${(sizes.optimized.brotli / 1048576).toFixed(2)}MiB`,
  );
}
console.log(
  `[budget] app.wasm: raw=${(sizes.app.raw / 1048576).toFixed(2)}MiB brotli=${(sizes.app.brotli / 1048576).toFixed(2)}MiB`,
);
console.log(
  `[budget] 首载总传输（brotli）: ${(sizes.firstLoad / 1048576).toFixed(2)}MiB`,
);

await browser.close();
server.close();

// ---- budget verdicts (design D10) ---------------------------------------------
const num = (s) => parseFloat(s.match(/p95=([0-9.]+)ms/)[1]);
check("短文档编译 P95 ≤ 500ms", num(measurements.shortCompile) <= 500 && measurements.shortAllOk);
check("10 页编译 P95 ≤ 3s", num(measurements.tenCompile) <= 3000 && measurements.tenAllOk);
check("单页 1x 渲染 P95 ≤ 200ms", num(measurements.render) <= 200 && measurements.renderAllOk);
check("100 次编辑内存增长 ≤ 20%", parseFloat(measurements.memory.growthPct) <= 20, measurements.memory.growthPct + "%");
check("初始化（到可编辑）≤ 5s", initMs <= 5000, `${initMs}ms（桌面级，中端折算待 9.1 矩阵）`);
check(
  "served artifact is the optimized wasm",
  sizes.requested?.includes("typst_abi.opt.wasm") === true,
  sizes.requested ?? "fallback",
);
check(
  "typst_abi raw ≤ 39MiB（served）",
  sizes.served.raw <= 39 * 1048576,
  `${(sizes.served.raw / 1048576).toFixed(2)}MiB`,
);
check(
  "typst_abi brotli ≤ 14MiB（served）",
  sizes.served.brotli <= 14 * 1048576,
  `${(sizes.served.brotli / 1048576).toFixed(2)}MiB`,
);
check(
  "首载总传输 ≤ 14.5MiB",
  sizes.firstLoad <= 14.5 * 1048576,
  `${(sizes.firstLoad / 1048576).toFixed(2)}MiB`,
);

console.log(failures.length === 0 ? "ACCEPTANCE: PASS" : `ACCEPTANCE: FAIL (${failures.join(", ")})`);
process.exit(failures.length === 0 ? 0 : 1);
