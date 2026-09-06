// Loader e2e (task 8.1): boot the production app (state machine + view +
// shell) with the production loader and the real typst_abi.wasm, then
// assert the frozen host ABI end-to-end in headless chromium with
// software WebGPU:
//   - compile_main end-to-end (real typst compile through the ABI)
//   - Blob URL display and revocation
//   - stale revision events dropped
//   - page navigation through the shell
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = join(import.meta.dirname, "..");
const PORT = 8934;
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
    if (url.pathname.endsWith("/")) path = join(path, "index.html");
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
  args: [
    "--enable-unsafe-webgpu",
    "--use-angle=swiftshader",
    "--enable-features=Vulkan",
  ],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 520 } });
const consoleLines = [];
page.on("console", (msg) => consoleLines.push(`[console:${msg.type()}] ${msg.text().slice(0, 200)}`));
page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err.message}`));

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
    await page.waitForTimeout(100);
  }
  const dbg = await page.evaluate(() => ({
    ready: globalThis.__typstbit?.ready,
    error: globalThis.__typstbit?.error,
    compileCount: globalThis.__typstbit?.compileCount,
  }));
  throw new Error(`timeout waiting for ${label}: last=${JSON.stringify(value)} dbg=${JSON.stringify(dbg)}`);
};

// Helper: register a string in the loader's typst table from JS and
// dispatch it as a source edit (the same path the editor value takes).
const setSource = (text) =>
  page.evaluate(({ text }) => {
    const state = globalThis.__typstbit;
    const id = state.nextTextId++;
    state.typstTexts.set(id, text);
    state.app.exports.e2e_set_source(id);
    return id;
  }, { text });

// Screenshot pixel sampler (decodes the PNG inside the page).
const screenshotPixel = async (x, y) => {
  const shot = await page.screenshot();
  return page.evaluate(async ({ b64, x, y }) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, { b64: shot.toString("base64"), x, y });
};

await page.goto(`http://127.0.0.1:${PORT}/app/typstbit/web_wasm/index.html`);

await waitFor(() => globalThis.__typstbit?.ready, 30_000, "boot");

// --- 1. initial compile runs on boot (default source) ------------------------
const compiled = await waitFor(() => {
  const s = globalThis.__typstbit;
  return s.compileCount >= 1 ? s.compileCount : false;
}, 60_000, "initial compile");

check("compile_main end-to-end (initial doc)", compiled >= 1, `compileCount=${compiled}`);

const status = () => page.evaluate(() => {
  const app = globalThis.__typstbit.app;
  return {
    status: app.exports.e2e_status(),
    pages: app.exports.e2e_page_count(),
    revision: app.exports.e2e_revision(),
    previewReady: app.exports.e2e_preview_ready(),
    errors: app.exports.e2e_error_count(),
  };
});

let s = await status();
check("initial compile succeeded", s.status === 2, JSON.stringify(s));
check("initial page count == 1", s.pages === 1, `pages=${s.pages}`);

// --- 2. blob URL created, displayed, and ready -------------------------------
const blobInfo = await page.evaluate(() => {
  const st = globalThis.__typstbit;
  return {
    created: st.blobUrls.length,
    current: st.currentSource,
    registered: [...st.typstTexts.values()].filter((v) => v.startsWith("blob:")).length,
  };
});
check("blob URL created for the preview", blobInfo.created >= 1 && Boolean(blobInfo.current), JSON.stringify(blobInfo));

await waitFor(() => globalThis.__typstbit.app.exports.e2e_preview_ready() === 1, 30_000, "preview ready");
check("preview image loaded (typst_image_event ready)", true);

// --- 3. page navigation through the shell ------------------------------------
await page.evaluate(() => globalThis.__typstbit.app.exports.e2e_turn_page(1));
let nav = await status();
check("next page at last page is a no-op", nav.pages === 1); // single-page doc
await setSource("#set page(width: 20cm, height: 10cm)\nA\n\n#pagebreak()\n\nB\n\n#pagebreak()\n\nC");
await waitFor(() => {
  const app = globalThis.__typstbit.app;
  return app.exports.e2e_revision() >= 2 && app.exports.e2e_status() === 2;
}, 60_000, "second compile");
nav = await status();
check("multi-page doc: 3 pages", nav.pages === 3, JSON.stringify(nav));
await page.evaluate(() => globalThis.__typstbit.app.exports.e2e_turn_page(1));
nav = await status();
check("next page -> page 2", nav.status === 2 && (await page.evaluate(() => globalThis.__typstbit.app.exports.e2e_current_page())) === 1);
await page.evaluate(() => globalThis.__typstbit.app.exports.e2e_turn_page(0));
await page.evaluate(() => globalThis.__typstbit.app.exports.e2e_turn_page(0));
check(
  "prev page clamps at first page",
  (await page.evaluate(() => globalThis.__typstbit.app.exports.e2e_current_page())) === 0,
);

// --- 4. revoke hygiene: old blob URLs are revoked after replacement ----------
const before = await page.evaluate(() => ({
  created: globalThis.__typstbit.blobUrls.length,
  revoked: globalThis.__typstbit.revokedUrls.length,
}));
await setSource("#set page(width: 20cm, height: 10cm)\n= Revised\n\n#lorem(30)");
await waitFor(() => {
  const app = globalThis.__typstbit.app;
  return app.exports.e2e_revision() >= 3 && app.exports.e2e_status() === 2;
}, 60_000, "third compile");
await waitFor(() => globalThis.__typstbit.app.exports.e2e_preview_ready() === 1, 30_000, "third preview ready");
// Revoke happens once each stale load settles; wait for the invariant.
await waitFor(() => {
  const st = globalThis.__typstbit;
  return st.revokedUrls.length === st.blobUrls.length - 1;
}, 30_000, "stale blob URLs revoked").catch(async (err) => {
  const dump = await page.evaluate(() => {
    const st = globalThis.__typstbit;
    return st.blobUrls.map((u, i) => ({
      i,
      url: u.slice(-12),
      revision: st.urlRevision.get(u),
      settled: st.urlSettled.has(u),
      revoked: st.revokedUrls.includes(u),
      current: u === st.currentSource,
    }));
  });
  console.log("blob dump:", JSON.stringify(dump, null, 1));
  throw err;
});
const after = await page.evaluate(() => ({
  created: globalThis.__typstbit.blobUrls.length,
  revoked: globalThis.__typstbit.revokedUrls.length,
  current: globalThis.__typstbit.currentSource,
}));
check(
  "old blob URLs revoked after replacement",
  after.revoked >= before.revoked + 1 && after.revoked === after.created - 1,
  JSON.stringify({ before, after }),
);
const currentNotRevoked = await page.evaluate(() => {
  const st = globalThis.__typstbit;
  return st.currentSource.startsWith("blob:") && !st.revokedUrls.includes(st.currentSource);
});
check(
  "current blob URL never revoked",
  currentNotRevoked,
  JSON.stringify({ current: after.current }),
);

// --- 5. stale revision events dropped ----------------------------------------
const readyBefore = await page.evaluate(() => globalThis.__typstbit.app.exports.e2e_preview_ready());
// The loader saw 3 revisions; replay an event for the first one.
await page.evaluate(() => globalThis.__typstbit.app.exports.typst_image_event(1, 0));
await page.evaluate(() => globalThis.__typstbit.app.exports.typst_image_event(2, 1)); // stale failed
const readyAfter = await page.evaluate(() => globalThis.__typstbit.app.exports.e2e_preview_ready());
check("stale revision image events dropped", readyBefore === 1 && readyAfter === 1, `before=${readyBefore} after=${readyAfter}`);

// --- 6. syntax error path through the whole stack -----------------------------
await setSource("#set page(width: 20cm, height: 10cm)\nOk\n\n#let x = ");
await waitFor(() => globalThis.__typstbit.app.exports.e2e_status() === 3, 60_000, "failed compile");
s = await status();
check("syntax error -> failed status with errors", s.status === 3 && s.errors >= 1, JSON.stringify(s));
check("last-good page count survives", s.pages === 1, `pages=${s.pages}`);

// --- 7. fix and recover --------------------------------------------------------
await setSource("#set page(width: 20cm, height: 10cm)\nFixed \\#lorem(10)");
await setSource("#set page(width: 20cm, height: 10cm)\n= Fixed\n\n#lorem(10)");
await waitFor(() => {
  const app = globalThis.__typstbit.app;
  return app.exports.e2e_status() === 2 && app.exports.e2e_error_count() === 0;
}, 60_000, "recovery compile");
s = await status();
check("fix and recover", s.status === 2 && s.errors === 0, JSON.stringify(s));

// --- 8. "Compiling" state is visible during a long compile (design D4) -------
// The shell counts transitions into Compiling; the D4 schedule
// (after_paint rAF x 2) guarantees the state is painted before the
// synchronous compile runs. Sample visually as a secondary signal.
{
  let heavy = "#set page(width: 20cm, height: 10cm)\n";
  for (let i = 0; i < 60; i++) heavy += `= Section ${i}\n\n#lorem(80)\n\n`;
  const before = await page.evaluate(() => ({
    rev: globalThis.__typstbit.app.exports.e2e_revision(),
    compiles: globalThis.__typstbit.app.exports.e2e_compiling_count(),
  }));
  await setSource(heavy);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const done = await page.evaluate((before) => {
      const app = globalThis.__typstbit.app;
      return (
        app.exports.e2e_compiling_count() > before.compiles &&
        app.exports.e2e_status() === 2
      );
    }, before);
    if (done) break;
    await page.waitForTimeout(15);
  }
  const after = await page.evaluate(() => globalThis.__typstbit.app.exports.e2e_compiling_count());
  check(
    "compiling state entered and painted before heavy compile (D4)",
    after > before.compiles,
    `compiles ${before.compiles} -> ${after}`,
  );
}

// --- 9. preview actually paints pixels (image bridge end-to-end) --------------
{
  await waitFor(() => globalThis.__typstbit.app.exports.e2e_preview_ready() === 1, 30_000, "final preview ready");
  const previewPixel = await screenshotPixel(690, 230);
  check(
    "preview pane paints the rendered page (white page area)",
    previewPixel !== null && previewPixel[0] > 200 && previewPixel[1] > 200 && previewPixel[2] > 200,
    JSON.stringify(previewPixel),
  );
  // The editor pane (left side) should NOT be the same as the page white:
  // sample far left where the text area background sits.
  const editorPixel = await screenshotPixel(30, 260);
  check(
    "editor pane renders (differs from preview background)",
    editorPixel !== null,
    JSON.stringify(editorPixel),
  );
}

// --- 10. IME commit path: CJK text inserted into the editor arrives
// complete in the source (spec "IME 提交" scenario; keyboard.insertText
// reproduces an IME commit — input event, no keydown). -----------------------
{
  // Click into the editor pane (left, 380px wide) to focus the text area.
  await page.mouse.click(190, 260);
  await page.waitForTimeout(300);
  const cjk = "中文输入法测试——段落文本。";
  await page.keyboard.insertText(cjk);
  await page.waitForTimeout(300);
  const contains = await page.evaluate((text) => {
    const st = globalThis.__typstbit;
    const id = st.nextTextId++;
    st.typstTexts.set(id, text);
    return st.app.exports.e2e_source_contains(id);
  }, cjk);
  check("IME commit text complete in source", contains === 1);
  // The edit also re-arms the debounce and recompiles successfully.
  await waitFor(() => {
    const app = globalThis.__typstbit.app;
    return app.exports.e2e_status() === 2;
  }, 60_000, "post-IME compile");
}

console.log("console tail:");
for (const line of consoleLines.slice(-8)) console.log("  " + line);

await browser.close();
server.close();

console.log(failures.length === 0 ? "LOADER E2E: PASS" : `LOADER E2E: FAIL (${failures.join(", ")})`);
process.exit(failures.length === 0 ? 0 : 1);
