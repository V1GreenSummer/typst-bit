// Interaction e2e: exercises every visible UI function with real browser
// input events (clipboard paste, toolbar buttons, menus, downloads, popups).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const ROOT = join(import.meta.dirname, "..");
const PORT = 8936;
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
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise(r => server.listen(PORT, "127.0.0.1", r));

const browser = await chromium.launch({
  args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader", "--enable-features=Vulkan"],
});
const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, acceptDownloads: true });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
const page = await context.newPage();
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
const exports = (fn) => page.evaluate(fn);
const setSrc = text => page.evaluate(({ text }) => {
  const st = globalThis.__typstbit;
  const id = st.nextTextId++;
  st.typstTexts.set(id, text);
  st.app.exports.e2e_set_source(id);
}, { text });
const doc = () => exports(() => globalThis.__typstbit.app.exports.e2e_doc());
const cursorLine = () => exports(() => globalThis.__typstbit.app.exports.e2e_cursor_line());
const status = () => exports(() => globalThis.__typstbit.app.exports.e2e_status());
const fmtBtn = text => page.locator(`.formatbar button:text-is("${text}")`);
const focusEditor = async () => { await page.click(".cm-content"); await page.waitForTimeout(120); };

await page.goto(`${ORIGIN}/app/typstbit/web_wasm/index.html`);
await waitFor(() => globalThis.__typstbit?.app?.exports?.e2e_status?.() === 2, "boot + first compile");

// --- 1. paste from an external application (browser clipboard -> editor) ------
await focusEditor();
await exports(() => navigator.clipboard.writeText("外部粘贴的第一行。\n第二行内容。"));
await page.keyboard.press("Control+End");
await page.keyboard.press("Control+v");
await page.waitForTimeout(250);
const pasted = await doc();
check("paste plain text from external clipboard", pasted.includes("外部粘贴的第一行。"), pasted.slice(-30));
await waitFor(() => globalThis.__typstbit.app.exports.e2e_status() === 2, "recompile after paste");

await exports(() => navigator.clipboard.write([new ClipboardItem({
  "text/html": new Blob(["<p><b>富文本</b>粘贴内容</p>"], { type: "text/html" }),
  "text/plain": new Blob(["富文本粘贴内容"], { type: "text/plain" }),
})]));
await page.keyboard.press("Enter");
await page.keyboard.press("Control+v");
await page.waitForTimeout(250);
check("paste rich text from external clipboard", (await doc()).includes("富文本粘贴内容"));

// --- 2. internal copy -> paste -------------------------------------------------
await setSrc("复制这行内容\n第二行");
await page.waitForTimeout(400);
await focusEditor();
await page.keyboard.press("Control+Home");
await page.keyboard.press("Home");
await page.keyboard.press("Shift+End");
await page.keyboard.press("Control+c");
await page.keyboard.press("End");
await page.keyboard.press("Enter");
await page.keyboard.press("Control+v");
await page.waitForTimeout(250);
const copied = await doc();
check("internal copy -> paste duplicates line", copied.startsWith("复制这行内容\n复制这行内容"), copied.replace(/\n/g, "\\n"));

// --- 3. formatting toolbar ------------------------------------------------------
await setSrc("hello world");
await page.waitForTimeout(400);
await focusEditor();
await page.keyboard.press("Control+a");
await fmtBtn("加粗").click();
check("加粗 wraps selection", (await doc()) === "*hello world*", await doc());

await page.keyboard.press("Control+a");
await fmtBtn("下划线").click();
check("下划线 wraps with #underline[]", (await doc()) === "#underline[*hello world*]", await doc());

await setSrc("标题测试");
await page.waitForTimeout(400);
await focusEditor();
await fmtBtn("标题").click();
check("标题 prefixes heading", (await doc()) === "= 标题测试", await doc());
await fmtBtn("标题").click();
check("标题 toggles off", (await doc()) === "标题测试", await doc());

await setSrc("*粗* _斜_ `码`\n= 标题");
await page.waitForTimeout(400);
await focusEditor();
await page.keyboard.press("Control+a");
await fmtBtn("清除标记").click();
check("清除标记 keeps inline marks and strips heading", (await doc()) === "*粗* _斜_ `码`\n标题", JSON.stringify(await doc()));

await setSrc("*粗* snake_case");
await page.waitForTimeout(400);
await focusEditor();
await page.keyboard.press("Control+Home");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("Shift+ArrowRight");
await fmtBtn("清除标记").click();
check("清除标记 unwraps selection and keeps identifiers", (await doc()) === "粗 snake_case", JSON.stringify(await doc()));

await setSrc("项目一");
await page.waitForTimeout(400);
await focusEditor();
await fmtBtn("列表").click();
check("列表 prefixes bullet", (await doc()) === "- 项目一", await doc());

await setSrc("#lorem(3)");
await page.waitForTimeout(400);
await focusEditor();
await fmtBtn("数学").click();
check("数学 inserts math block", (await doc()).includes("$ x + y = z $"));
await setSrc("#lorem(3)");
await page.waitForTimeout(400);
await fmtBtn("代码块").click();
check("代码块 inserts code fence", (await doc()).includes("```typ"));
await fmtBtn("引用").click();
check("引用 inserts a quote block", (await doc()).includes("#quote["), await doc());

// --- 4. search -------------------------------------------------------------------
await setSrc("搜索测试文本 hello");
await page.waitForTimeout(400);
await fmtBtn("⌕ 搜索").click();
check("search panel opens", await page.locator(".cm-panel.cm-search").isVisible());
await page.keyboard.type("hello");
await page.keyboard.press("Escape");
check("search panel closes on Escape", !(await page.locator(".cm-panel.cm-search").count()));

// --- 4b. command palette ---------------------------------------------------------
await setSrc("= 面板测试\n\nhello");
await page.waitForTimeout(400);
await focusEditor();
await page.keyboard.press("Control+End");
await page.keyboard.press("Control+Shift+ArrowLeft");
await page.keyboard.press("Control+k");
await page.waitForTimeout(150);
check("Ctrl+K opens the command palette", await page.locator(".command-palette.open").isVisible());
await page.keyboard.type("加粗");
await page.waitForTimeout(100);
const paletteFirst = await page.locator(".command-item.selected").first().textContent();
check("palette filters commands", paletteFirst.includes("加粗"), paletteFirst);
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
check("palette executes the selected command", (await doc()).includes("*hello*") && (await page.locator(".command-palette.open").count()) === 0, await doc());
await page.keyboard.press("Control+k");
await page.waitForTimeout(150);
await page.keyboard.type("数学");
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
check("Escape closes the palette without executing", (await page.locator(".command-palette.open").count()) === 0 && !(await doc()).includes("$ x + y = z $"));
await page.keyboard.press("Control+k");
await page.waitForTimeout(150);
await page.mouse.click(20, 400);
await page.waitForTimeout(150);
check("palette closes on outside click", (await page.locator(".command-palette.open").count()) === 0);

// --- 5. compile controls + diagnostics jump --------------------------------------
await setSrc("#set page(width: 20cm, height: 10cm)\n#let x = 1\n#badfn()");
await waitFor(() => globalThis.__typstbit.app.exports.e2e_status() === 3, "error compile");
check("status pill shows error state", (await page.locator(".status-pill").textContent()) === "有问题");
check("error badge counts one error", (await page.locator(".count.error").textContent()).includes("1"));
check("diagnostics list shows the message", (await page.locator(".diagnostics").textContent()).includes("badfn"));
await page.locator(".diagnostics .diagnostic button").first().click();
check("diagnostic click jumps cursor to line 3", (await cursorLine()) === 3, String(await cursorLine()));
await setSrc("#set page(width: 20cm, height: 10cm)\n#let x = 1\n#text(fill: blue)[修好了]");
await waitFor(() => globalThis.__typstbit.app.exports.e2e_status() === 2, "fixed compile");
check("recovers to 就绪", (await page.locator(".status-pill").textContent()) === "就绪");

// --- 6. undo / redo ---------------------------------------------------------------
await focusEditor();
await page.keyboard.press("Control+End");
await page.keyboard.type(" 追加文本XYZ");
await waitFor(async () => globalThis.__typstbit.app.exports.e2e_doc().includes("追加文本XYZ"), "typed text");
await page.keyboard.press("Control+z");
await page.waitForTimeout(250);
check("undo removes typed text", !(await doc()).includes("追加文本XYZ"));
await page.keyboard.press("Control+y");
await page.waitForTimeout(250);
if (!(await doc()).includes("追加文本XYZ")) {
  await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(250);
}
check("redo restores typed text", (await doc()).includes("追加文本XYZ"));

await setSrc("菜单撤销测试");
await page.waitForTimeout(400);
await focusEditor();
await page.keyboard.type(" 追加");
await page.waitForTimeout(200);
await page.locator('.menubar button:text-is("Edit")').click();
await page.locator("text=撤销 ⌘Z").first().click();
await page.waitForTimeout(250);
check("Edit menu undo reverts typing", !(await doc()).includes(" 追加"), await doc());

// --- 7. share link round trip -------------------------------------------------------
await setSrc("#set page(width: 20cm, height: 10cm)\n= 分享测试\n\n#lorem(3)");
await page.waitForTimeout(400);
await page.locator(".topbar button:text-is(\"分享\")").click();
await page.waitForTimeout(400);
const clip = await exports(() => navigator.clipboard.readText());
check("share copies a hash-encoded link", clip.startsWith(ORIGIN) && clip.includes("#c="), clip.slice(0, 60));

// --- 8. export PDF + open in new tab --------------------------------------------------
await setSrc("#set text(font: (\"Liberation Serif\", \"Noto Serif CJK SC\"))\n#set page(width: 20cm, height: 10cm)\n= 导出字形\n\n中文与 English 混排——标点。");
const revBeforeFont = await exports(() => globalThis.__typstbit.app.exports.e2e_revision());
await page.waitForFunction(
  rev => {
    const app = globalThis.__typstbit.app;
    return app.exports.e2e_revision() > rev && app.exports.e2e_status() === 2;
  },
  revBeforeFont,
  { timeout: 60000 },
);
const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
await page.locator(".topbar button:text-is(\"导出 PDF\")").click();
const download = await downloadPromise;
check("export downloads typstbit.pdf", download.suggestedFilename() === "typstbit.pdf", download.suggestedFilename());
const dlPath = await download.path();
const dlBuffer = await readFile(dlPath);
check("downloaded file is a real PDF", dlBuffer.subarray(0, 5).toString("latin1") === "%PDF-", dlBuffer.subarray(0, 5).toString("latin1"));
check("exported PDF embeds the CJK subset font", dlBuffer.includes("NotoSerifCJKsc"));
check("exported PDF embeds the Times-compatible font", dlBuffer.includes("LiberationSerif"));
let extracted = null;
try {
  extracted = execFileSync("pdftotext", [dlPath, "-"], { encoding: "utf8" });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.log("[interactions] pdftotext unavailable; skipping text extraction check");
}
if (extracted !== null) {
  check(
    "pdftotext extracts the Chinese source text",
    extracted.includes("导出字形") && extracted.includes("中文与") && extracted.includes("标点"),
    extracted.replace(/\s+/g, " ").slice(0, 60),
  );
}

const previewUrl = await page.evaluate(() => globalThis.__typstbit.currentSource);
await page.evaluate(() => {
  window.__openedUrls = [];
  window.open = (u) => { window.__openedUrls.push(String(u)); return null; };
});
await page.locator(".pane-head button:text-is(\"在新标签页打开\")").click();
const opened = await page.evaluate(() => window.__openedUrls);
check("open PDF in new tab yields blob URL", opened.length === 1 && opened[0] === previewUrl, `${opened.length} call(s): ${opened[0]?.slice(0, 40) ?? ""}`);

// --- 9. menus -----------------------------------------------------------------------
await page.locator('.menubar button:text-is("File")').click();
await page.locator('.menubar button:text-is("View")').click();
check("opening a menu closes the previous one", !(await page.locator("text=恢复示例").first().isVisible()) && (await page.locator("text=新标签页打开 PDF").first().isVisible()));
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
check("Escape closes menus", !(await page.locator("text=新标签页打开 PDF").first().isVisible()));

await page.locator(".menubar button:text-is(\"Help\")").click();
await page.locator("text=快捷键").first().click();
check("Help menu shows shortcuts toast", (await page.locator(".toast").last().textContent()).includes("⌘Enter"));

await page.locator(".menubar button:text-is(\"File\")").click();
await page.locator("text=恢复示例").first().click();
await waitFor(() => globalThis.__typstbit.app.exports.e2e_status() === 2, "reset example compile");
check("File > 恢复示例 resets document", (await doc()).startsWith("#set text"), (await doc()).slice(0, 20));

await page.locator(".menubar button:text-is(\"Edit\")").click();
await page.locator("text=查找替换").first().click();
check("Edit > 查找替换 opens search", await page.locator(".cm-panel.cm-search").isVisible());
await page.keyboard.press("Escape");

// --- 10. sidebar tools ---------------------------------------------------------------
await page.locator(".sidebar-tools button:text-is(\"☷ 文档大纲\")").click();
check("大纲 lists headings", (await page.locator(".toast").last().textContent()).includes("大纲"));

// --- 11. IME commit -------------------------------------------------------------------
await focusEditor();
await page.keyboard.insertText("中文输入法测试——段落文本。");
await waitFor(() => globalThis.__typstbit.app.exports.e2e_doc().includes("中文输入法测试"), "IME text");
check("IME commit text arrives complete", true);

// --- 12. multi-page status --------------------------------------------------------------
await setSrc("#set page(width: 20cm, height: 10cm)\nA\n\n#pagebreak()\n\nB");
await waitFor(() => globalThis.__typstbit.app.exports.e2e_status() === 2 && globalThis.__typstbit.app.exports.e2e_page_count() === 2, "2-page compile");
check("statusbar reports page count", (await page.locator(".statusbar .right").textContent()).includes("共 2 页"), await page.locator(".statusbar .right").textContent());

// --- 13. share restore --------------------------------------------------------------------
await page.goto("about:blank");
await page.goto(clip.replace(/^http:\/\/127\.0\.0\.1:\d+/, ORIGIN));
await waitFor(() => globalThis.__typstbit?.app?.exports?.e2e_status?.() === 2, "shared doc compile");
check("shared link restores the document", (await doc()).includes("分享测试"), (await doc()).slice(0, 30));
check("shared hash cleared after load", await page.evaluate(() => location.hash === ""));

check("no page errors during interactions", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

console.log(failures.length === 0 ? "INTERACTIONS: PASS" : `INTERACTIONS: FAIL (${failures.join(", ")})`);
await browser.close();
server.close();
process.exit(failures.length === 0 ? 0 : 1);
