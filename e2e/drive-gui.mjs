// Direct GUI drive with per-step assertions: operate the browser like a real
// user (mouse + keyboard) and verify each visible effect programmatically.
import { createServer } from "node:http";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = join(import.meta.dirname, "..");
const PORT = 8940;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SHOT_DIR = "/tmp/opencode/gui-drive";
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
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise(r => server.listen(PORT, "127.0.0.1", r));

await rm(SHOT_DIR, { recursive: true, force: true });
await mkdir(SHOT_DIR, { recursive: true });
const browser = await chromium.launch({
  args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader", "--enable-features=Vulkan"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures.push(name);
};
let n = 0;
async function shot(label) {
  n += 1;
  await page.screenshot({ path: join(SHOT_DIR, `${String(n).padStart(2, "0")}-${label}.png`) });
}
const status = () => page.evaluate(() => document.querySelector(".status-pill")?.textContent ?? "?");
const source = () => page.evaluate(() => localStorage.getItem("typstbit.source") ?? "");
const revision = () => page.evaluate(() => globalThis.__typstbit.app.exports.e2e_revision());
const pageCount = () => page.evaluate(() => globalThis.__typstbit.app.exports.e2e_page_count());
const previewReady = () => page.evaluate(() => globalThis.__typstbit.app.exports.e2e_preview_ready());
const waitSettled = () => page.waitForFunction(() => {
  const t = document.querySelector(".status-pill")?.textContent ?? "";
  return t.includes("就绪") || t.includes("有问题");
}, null, { timeout: 60000 });
const waitToast = text => page.waitForFunction(
  t => [...document.querySelectorAll(".toast")].some(x => x.textContent.includes(t)),
  text, { timeout: 5000 },
);

// ---- 1. boot -------------------------------------------------------------
await page.goto(ORIGIN + "/app/typstbit/web_wasm/index.html");
await page.waitForFunction(() => globalThis.__typstbit != null, null, { timeout: 30000 });
await page.evaluate(() => globalThis.__typstbit.ready);
await waitSettled();
await page.waitForFunction(() => globalThis.__typstbit.app.exports.e2e_preview_ready() === 1, null, { timeout: 30000 });
check("boot status 就绪", (await status()).includes("就绪"), await status());
check("boot preview ready", (await previewReady()) === 1);
check("boot page count >= 1", (await pageCount()) >= 1, `pages=${await pageCount()}`);
const bootDoc = await page.evaluate(() => document.querySelector(".cm-content")?.textContent ?? "");
check("boot editor shows default doc", bootDoc.includes("The Typst Playground"), bootDoc.slice(0, 60));
check("boot default template sets bundled fonts", bootDoc.includes('font: ("Liberation Serif", "Noto Serif CJK SC")'), bootDoc.slice(0, 60));
await shot("boot");

// ---- 2. type a new document with real keystrokes -------------------------
await page.click(".editor-host .cm-content");
await page.keyboard.press("Control+a");
await page.keyboard.press("Delete");
const typed = "= 直接 GUI 驱动测试\n\n#set text(font: (\"Liberation Serif\", \"Noto Serif CJK SC\"))\n第二段由浏览器键盘事件逐字输入，Mixed English text。";
await page.keyboard.type(typed, { delay: 15 });
const revBefore = await revision();
await page.waitForFunction(rev => globalThis.__typstbit.app.exports.e2e_revision() > rev, revBefore, { timeout: 60000 });
await waitSettled();
await page.waitForFunction(() => globalThis.__typstbit.app.exports.e2e_preview_ready() === 1, null, { timeout: 60000 });
const typedSource = await source();
check("typed source persisted", typedSource.includes("直接 GUI 驱动测试") && typedSource.includes("Mixed English text。"));
check("auto-compile revision bumped", (await revision()) > revBefore, `${revBefore} -> ${await revision()}`);
const preview = await page.evaluate(async () => {
  const r = await fetch(globalThis.__typstbit.currentSource);
  const b = new Uint8Array(await r.arrayBuffer());
  return { ok: r.ok, head: String.fromCharCode(...b.slice(0, 8)), size: b.length };
});
check("preview blob is live PDF", preview.ok && preview.head === "%PDF-1.7", `${preview.head}, ${preview.size}B`);
await shot("typed-compiled");

// ---- 3. double-click word -> toolbar 加粗 --------------------------------
const box = await page.locator(".cm-content").boundingBox();
await page.mouse.dblclick(box.x + 60, box.y + 12);
await page.click('.formatbar button:has-text("加粗")');
const boldActive = await page.locator('.formatbar button:has-text("加粗")').evaluate(button => button.classList.contains("active"));
check("bold toolbar button reports active", boldActive);
await page.keyboard.press("Escape");
const boldSource = await source();
const boldMatch = boldSource.match(/\*[^*\n]+\*/)?.[0] ?? "";
check("bold wrapped selection", boldMatch.length > 2, boldMatch);
await shot("bold");

// ---- 4. keyboard undo ----------------------------------------------------
await page.click(".editor-host .cm-content");
await page.keyboard.press("Control+z");
const undone = await source();
check("Ctrl+Z restored source", undone === typedSource, undone.includes("*") ? "asterisk still present" : "");
await shot("undo");

// ---- 5. Edit menu -> search panel ---------------------------------------
await page.click('.menubar button:has-text("Edit")');
await page.click('text=查找替换');
await page.waitForSelector(".cm-search", { state: "visible", timeout: 5000 });
await page.keyboard.type("GUI");
const searchValue = await page.evaluate(() => {
  const input = document.querySelector(".cm-search input[name=search]") || document.querySelector(".cm-search-input");
  return input ? input.value : "";
});
check("search panel open with query", searchValue === "GUI", searchValue);
await shot("search");
await page.keyboard.press("Escape");

// ---- 6. sidebar outline --------------------------------------------------
await page.click('.sidebar button:has-text("文档大纲")');
await page.waitForSelector(".outline-panel.open", { state: "visible", timeout: 5000 });
const outlineTitles = await page.locator(".outline-item .outline-title").allTextContents();
check("outline panel lists headings", outlineTitles.includes("直接 GUI 驱动测试"), outlineTitles.join("|"));
await page.locator('.outline-item:has-text("直接 GUI 驱动测试")').click();
await page.waitForTimeout(150);
check("outline click focuses the heading", (await page.evaluate(() => globalThis.__typstbit.app.exports.e2e_cursor_line())) >= 1);
await shot("outline");

// ---- 7. 清除标记 strips heading marker ----------------------------------
await page.click(".editor-host .cm-content");
await page.keyboard.press("Control+Home");
await page.click('.formatbar button:has-text("清除标记")');
const cleared = await source();
check("clear marks stripped '= '", cleared.startsWith("直接 GUI 驱动测试"), JSON.stringify(cleared.split("\n")[0]));
await page.keyboard.press("Control+z");
check("undo clear marks", (await source()).startsWith("= 直接 GUI 驱动测试"));
await shot("clear-marks");

// ---- 8. topbar 立即编译 --------------------------------------------------
const revBeforeCompile = await revision();
await page.click('.topbar button:has-text("立即编译")');
await waitSettled();
await page.waitForFunction(() => globalThis.__typstbit.app.exports.e2e_preview_ready() === 1, null, { timeout: 60000 });
check("compile-now bumped revision", (await revision()) > revBeforeCompile, `${revBeforeCompile} -> ${await revision()}`);
await shot("compile-now");

// ---- 9. export PDF via real button --------------------------------------
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 60000 }),
  page.click('.topbar button:has-text("导出 PDF")'),
]);
const pdfPath = join(SHOT_DIR, "exported.pdf");
await download.saveAs(pdfPath);
const pdf = await readFile(pdfPath);
check("download name typstbit.pdf", download.suggestedFilename() === "typstbit.pdf", download.suggestedFilename());
check("exported PDF header", pdf.subarray(0, 8).toString() === "%PDF-1.7");
check("exported PDF complete", pdf.subarray(-32).toString().includes("%%EOF"), `${pdf.length}B`);
check("exported PDF embeds CJK subset", pdf.includes("NotoSerifCJKsc"));
check("exported PDF embeds Times-compatible font", pdf.includes("LiberationSerif"));
await shot("exported");

// ---- 10. Help menu -> toast ----------------------------------------------
await page.click('.menubar button:has-text("Help")');
await page.click('text=快捷键');
await waitToast("⌘Enter 编译");
check("help toast shown", true);
await shot("help-toast");

// ---- 11. error-free run --------------------------------------------------
check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
check("compat error null", await page.evaluate(() => globalThis.__typstbit.error == null));
await page.waitForTimeout(400);
await shot("final");

await browser.close();
server.close();
console.log(failures.length ? `FAILED: ${failures.join(", ")}` : "ALL PASS");
process.exit(failures.length ? 1 : 0);
