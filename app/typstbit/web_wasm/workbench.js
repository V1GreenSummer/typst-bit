const DEFAULT_SOURCE = "#set page(width: 20cm, height: 10cm)\n= Hello, Typst!\n\n#lorem(60)";
const DEBOUNCE_MS = 300;
const SCALE_MIN = 600, SCALE_MAX = 3000;

const STATUS = { IDLE: 0, COMPILING: 1, SUCCESS: 2, FAILED: 3 };

function decodeShare() {
  const hash = location.hash;
  const m = hash.match(/^#c=(.+)$/);
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return null; }
}

export function encodeShare(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "#c=" + btoa(bin);
}

class Abi {
  constructor(instance) { this.ex = instance.exports; this.encoder = new TextEncoder(); }
  put(bytes) {
    const ptr = this.ex.typst_abi_alloc(bytes.length);
    if (ptr === 0) throw new Error("typst_abi_alloc failed");
    new Uint8Array(this.ex.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  }
  putStr(s) { return this.put(this.encoder.encode(s)); }
  outLen(ptr) {
    const slot = new DataView(this.ex.memory.buffer).getUint32(this.ex.typst_abi_out_len_ptr(), true);
    return new Uint8Array(this.ex.memory.buffer, ptr, slot).slice();
  }
  setFile(path, data) {
    const [pp, plen] = this.putStr(path);
    const bytes = typeof data === "string" ? this.encoder.encode(data) : data;
    const [dp, dlen] = this.put(bytes);
    return this.ex.typst_abi_set_file(pp, plen, dp, dlen);
  }
  setMain(path) { const [pp, plen] = this.putStr(path); return this.ex.typst_abi_set_main(pp, plen); }
  compile() { return this.ex.typst_abi_compile(); }
  pageCount() { return this.ex.typst_abi_page_count(); }
  renderPagePng(page, scaleMilli) {
    const ptr = this.ex.typst_abi_render_page_png(page, scaleMilli);
    if (ptr === 0) return null;
    return this.outLen(ptr);
  }
  errorJson() {
    const ptr = this.ex.typst_abi_error_json();
    if (ptr === 0) return { diagnostics: [] };
    try { return JSON.parse(new TextDecoder().decode(this.outLen(ptr))); }
    catch { return { diagnostics: [] }; }
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export async function bootWorkbench({ abiWasmUrl, host }) {
  const compat = {
    ready: false, error: null, compileCount: 0,
    typstTexts: new Map(), nextTextId: 1, app: null,
  };
  globalThis.__typstbit = compat;

  const response = await fetch(abiWasmUrl);
  if (!response.ok) throw new Error(`fetch typst_abi failed: ${response.status}`);
  let abi;
  try {
    const streamed = await WebAssembly.instantiateStreaming(response, {});
    abi = streamed.instance;
  } catch {
    const bytes = await response.arrayBuffer();
    abi = (await WebAssembly.instantiate(bytes, {})).instance;
  }
  const bridge = new Abi(abi);
  try { bridge.ex.spike_init?.(); } catch { /* fonts best-effort */ }

  const editorMod = await import("./editor-bundle.js");

  host.innerHTML = "";
  host.id = "app";
  const app = el("div", "app");
  host.appendChild(app);

  const statusPill = el("span", "status-pill", "待编译");
  const pageLabel = el("span", "", "第 1 / 0 页");
  const zoomLabel = el("span", "zoom", "100%");
  const statusDetail = el("span", "", "编辑源码后将自动编译");
  const errCount = el("span", "count error", "✕ 0 错误");
  const warnCount = el("span", "count warning", "⚠ 0 警告");
  const diagList = el("div", "");

  const topbar = el("div", "topbar");
  topbar.append(
    el("span", "brand", "Typstbit"),
    el("span", "workspace", "WORKSPACE / MAIN.TYP"),
    el("span", "grow"),
    statusPill,
    Object.assign(el("button", "button"), { textContent: "分享", onclick: shareDoc }),
    Object.assign(el("button", "button"), { textContent: "导出 PNG", onclick: exportPng }),
    Object.assign(el("button", "button primary"), { textContent: "立即编译", onclick: () => compileNow() }),
  );

  const menubar = el("div", "menubar");
  menubar.append(
    menuButton("File", [
      ["恢复示例", resetExample],
      ["导出当前页 PNG", exportPng],
      ["复制分享链接", shareDoc],
    ]),
    menuButton("Edit", [
      ["查找替换 ⌘F", () => editor.openSearch()],
      ["撤销 ⌘Z", () => undo(1)],
      ["重做 ⇧⌘Z", () => undo(-1)],
    ]),
    menuButton("View", [
      ["放大预览", () => stepScale(200)],
      ["缩小预览", () => stepScale(-200)],
      ["重置缩放", () => setScale(1500)],
    ]),
    menuButton("Help", [
      ["快捷键", () => toast("⌘Enter 编译 · ⌘F 搜索 · 括号/引号自动闭合 · Tab 缩进")],
    ]),
    el("span", "grow"),
    el("span", "", "⌘K 搜索命令"),
  );

  const formatbar = el("div", "formatbar");
  formatbar.append(
    formatBtn("正文", () => editor.prefixLines("")),
    formatBtn("B", () => editor.wrapSelection("*")),
    formatBtn("I", () => editor.wrapSelection("_")),
    formatBtn("下划线", () => toast("使用 #text(fill: blue)[选中文字] 设置颜色")),
    formatBtn("标题", () => editor.prefixLines("= ")),
    formatBtn("列表", () => editor.prefixLines("- ")),
    formatBtn("数学", () => editor.insertBlock("$ x + y = z $")),
    formatBtn("代码块", () => editor.insertBlock("```typ\n\n```")),
    formatBtn("引用", () => editor.insertBlock("@label")),
    el("span", "grow"),
    formatBtn("⌕ 搜索", () => editor.openSearch()),
  );

  const sidebar = el("div", "sidebar");
  sidebar.append(
    Object.assign(el("div", "panel-title"), { textContent: "PROJECT" }),
    Object.assign(el("div", "file active"), { textContent: "▣ main.typ" }),
    Object.assign(el("div", "file"), { textContent: "○ images" }),
    (() => {
      const tools = el("div", "sidebar-tools");
      const search = el("button", "", "⌕ 搜索");
      search.onclick = () => editor.openSearch();
      const outline = el("button", "", "☷ 文档大纲");
      outline.onclick = showOutline;
      tools.append(search, outline);
      return tools;
    })(),
  );

  const editorPane = el("div", "editor-pane");
  const editorHost = el("div", "editor-host");
  editorPane.append(
    (() => {
      const head = el("div", "pane-head");
      const tab = el("div", "tab", "main.typ");
      tab.style.paddingRight = "12px";
      head.append(tab, el("span", "dirty", "未保存"), el("span", "grow"), el("span", "dirty", "Typst"));
      return head;
    })(),
    editorHost,
  );

  const previewPane = el("div", "preview-pane");
  const paper = el("div", "paper");
  const previewImg = el("img", "");
  previewImg.style.display = "none";
  const emptyPreview = el("div", "empty-preview", "编译后将在这里显示页面");
  paper.append(previewImg, emptyPreview);
  const canvas = el("div", "preview-canvas", "");
  canvas.append(paper);
  const previewHead = el("div", "pane-head");
  previewHead.append(
    el("span", "", "预览"),
    el("span", "grow"),
    (() => {
      const tools = el("div", "preview-tools");
      tools.append(
        Object.assign(el("button", "button"), { textContent: "−", onclick: () => stepScale(-200) }),
        zoomLabel,
        Object.assign(el("button", "button"), { textContent: "+", onclick: () => stepScale(200) }),
      );
      return tools;
    })(),
  );
  previewPane.append(previewHead, canvas);

  const grid = el("div", "workspace-grid");
  grid.append(sidebar, editorPane, previewPane);

  const diagnostics = el("div", "diagnostics");
  const diagHead = el("div", "diagnostics-head");
  diagHead.append(el("span", "", "问题"), errCount, warnCount, el("span", "grow"), el("span", "", "来源: main.typ"));
  diagnostics.append(diagHead, diagList);
  previewPane.append(diagnostics);

  const statusbar = el("div", "statusbar");
  statusbar.append(
    statusDetail,
    el("span", "grow"),
    (() => {
      const right = el("span", "right");
      right.append(
        Object.assign(el("button", "button"), { textContent: "‹ 上一页", onclick: () => turnPage(-1) }),
        pageLabel,
        Object.assign(el("button", "button"), { textContent: "下一页 ›", onclick: () => turnPage(1) }),
      );
      return right;
    })(),
  );

  app.append(topbar, menubar, formatbar, grid, statusbar);

  const state = {
    status: STATUS.IDLE, revision: 0, docRevision: null,
    pageCount: 0, page: 0, scale: 1500,
    diagnostics: [], previewUrl: null, previewReady: false,
    previewFailed: false, blobUrls: [], pendingTimer: null,
    compilingCount: 0,
  };

  compat.blobUrls = state.blobUrls;
  compat.abi = abi;
  compat.revokedUrls = [];
  compat.urlRevision = new Map();
  compat.urlSettled = new Map();
  Object.defineProperty(compat, "currentSource", { get: () => state.previewUrl ?? "" });

  const initial = decodeShare() ?? localStorage.getItem("typstbit.source") ?? DEFAULT_SOURCE;
  const editor = editorMod.createEditor(editorHost, {
    doc: initial,
    onChange: text => {
      localStorage.setItem("typstbit.source", text);
      scheduleCompile(text);
    },
    onRun: () => compileNow(),
  });

  function toast(message) {
    const node = el("div", "toast", message);
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2600);
  }

  function formatBtn(label, fn) {
    const b = el("button", "", label);
    b.onclick = fn;
    return b;
  }

  function menuButton(label, items) {
    const wrap = el("div", "");
    wrap.style.position = "relative";
    const btn = el("button", "", label);
    const menu = el("div", "");
    Object.assign(menu.style, {
      position: "absolute", top: "28px", left: "0", zIndex: "30",
      background: "white", border: "1px solid var(--line)", borderRadius: "6px",
      boxShadow: "0 8px 24px #1d273326", padding: "4px", display: "none", minWidth: "180px",
    });
    for (const [text, fn] of items) {
      const item = el("button", "button", text);
      item.style.display = "block";
      item.style.width = "100%";
      item.style.textAlign = "left";
      item.onclick = () => { menu.style.display = "none"; fn(); };
      menu.append(item);
    }
    btn.onclick = e => {
      e.stopPropagation();
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    };
    document.addEventListener("click", () => { menu.style.display = "none"; });
    wrap.append(btn, menu);
    return wrap;
  }

  function setStatusUI() {
    statusPill.className = "status-pill" + (state.status === STATUS.COMPILING ? " busy" : state.status === STATUS.FAILED ? " error" : "");
    statusPill.textContent = ["待编译", "编译中", "就绪", "有问题"][state.status];
    statusDetail.textContent =
      state.status === STATUS.IDLE ? "编辑源码后将自动编译" :
      state.status === STATUS.COMPILING ? "正在生成最新排版结果" :
      state.status === STATUS.SUCCESS ? `已生成 ${state.pageCount} 页 · 预览为最新结果` :
      `发现 ${state.diagnostics.filter(d => d.severity === "error").length} 个错误 · 已保留上次预览`;
    errCount.textContent = `✕ ${state.diagnostics.filter(d => d.severity === "error").length} 错误`;
    warnCount.textContent = `⚠ ${state.diagnostics.filter(d => d.severity === "warning").length} 警告`;
    pageLabel.textContent = `第 ${state.pageCount > 0 ? state.page + 1 : 0} / ${state.pageCount} 页`;
    zoomLabel.textContent = `${Math.round(state.scale / 15)}%`;
    renderDiagList();
  }

  function renderDiagList() {
    diagList.innerHTML = "";
    if (state.diagnostics.length === 0) {
      diagList.append(el("div", "diagnostic", "没有问题 · 文档状态良好"));
      return;
    }
    for (const d of state.diagnostics) {
      const row = el("div", "diagnostic");
      const loc = el("span", "location", d.start ? `第 ${d.start.line} 行` : "");
      const btn = el("button", "", `[${d.severity === "error" ? "错误" : "警告"}] ${d.message}`);
      if (d.start) btn.onclick = () => jumpToDiagnostic(d);
      const hint = d.hints?.length ? el("span", "location", d.hints.join(" ")) : null;
      row.append(loc, btn);
      if (hint) row.append(hint);
      diagList.append(row);
    }
  }

  function jumpToDiagnostic(d) {
    const doc = editor.view.state.doc;
    const line = Math.min(d.start.line, doc.lines);
    editor.view.dispatch({
      selection: { anchor: doc.line(line).from + Math.min(d.start.column - 1, doc.line(line).length) },
      effects: [],
      scrollIntoView: true,
    });
    editor.focus();
  }

  function syncEditorDiagnostics() {
    editor.setDiagnostics(state.diagnostics.map(d => ({
      severity: d.severity, message: d.message + (d.hints?.length ? ` · ${d.hints.join(" ")}` : ""),
      line: d.start?.line ?? 1, column: d.start?.column ?? 1,
      endLine: d.end?.line ?? d.start?.line ?? 1, endColumn: d.end?.column ?? (d.start?.column ?? 1) + 1,
    })));
  }

  function scheduleCompile(source) {
    if (state.pendingTimer) clearTimeout(state.pendingTimer);
    state.pendingTimer = setTimeout(() => { state.pendingTimer = null; startCompile(source); }, DEBOUNCE_MS);
  }

  function compileNow() {
    if (state.pendingTimer) { clearTimeout(state.pendingTimer); state.pendingTimer = null; }
    startCompile(editor.getDoc());
  }

  function startCompile(source) {
    const revision = ++state.revision;
    state.status = STATUS.COMPILING;
    state.compilingCount += 1;
    setStatusUI();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      let status;
      try {
        const set = bridge.setFile("/main.typ", source);
        if (set !== 0) throw new Error(`set_file status ${set}`);
        bridge.setMain("/main.typ");
        status = bridge.compile();
        compat.compileCount += 1;
      } catch (e) {
        compat.error = String(e);
        state.diagnostics = [{ severity: "error", message: `宿主错误: ${e}` }];
        state.status = STATUS.FAILED;
        syncEditorDiagnostics();
        setStatusUI();
        return;
      }
      if (revision !== state.revision) return;
      const diags = bridge.errorJson().diagnostics ?? [];
      state.diagnostics = diags;
      if (status === 0) {
        state.status = STATUS.SUCCESS;
        state.docRevision = revision;
        state.pageCount = bridge.pageCount();
        state.page = 0;
        state.previewReady = false;
        state.previewFailed = false;
        requestPage(revision, 0);
      } else if (status === 3) {
        state.status = STATUS.FAILED;
      } else {
        state.status = STATUS.FAILED;
        state.diagnostics = [{ severity: "error", message: `ABI 状态码 ${status}` }];
      }
      syncEditorDiagnostics();
      setStatusUI();
    }));
  }

  function requestPage(revision, page) {
    const png = bridge.renderPagePng(page, state.scale);
    if (!png || revision !== state.docRevision) {
      if (revision === state.docRevision) { state.previewFailed = true; }
      updatePreviewImg();
      return;
    }
    const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
    state.blobUrls.push(url);
    compat.urlRevision.set(url, revision);
    if (state.previewUrl) {
      URL.revokeObjectURL(state.previewUrl);
      compat.revokedUrls.push(state.previewUrl);
    }
    state.previewUrl = url;
    state.previewReady = false;
    previewImg.onload = () => { state.previewReady = true; compat.urlSettled.set(url, true); setStatusUI(); };
    previewImg.onerror = () => { state.previewFailed = true; state.previewReady = false; setStatusUI(); };
    updatePreviewImg();
    setStatusUI();
  }

  function updatePreviewImg() {
    if (state.previewUrl) {
      previewImg.src = state.previewUrl;
      previewImg.style.display = "block";
      emptyPreview.style.display = "none";
    } else {
      previewImg.style.display = "none";
      emptyPreview.style.display = "block";
      emptyPreview.textContent = state.previewFailed ? "预览生成失败" : state.status === STATUS.COMPILING ? "正在排版…" : "编译后将在这里显示页面";
    }
  }

  function setScale(value) {
    state.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
    if (state.docRevision !== null) requestPage(state.docRevision, state.page);
    setStatusUI();
  }
  function stepScale(delta) { setScale(state.scale + delta); }

  function turnPage(delta) {
    const next = Math.min(Math.max(0, state.page + delta), Math.max(0, state.pageCount - 1));
    if (next === state.page || state.docRevision === null) return;
    state.page = next;
    state.previewReady = false;
    requestPage(state.docRevision, next);
    setStatusUI();
  }

  function resetExample() {
    editor.setDoc(DEFAULT_SOURCE);
    compileNow();
  }

  function undo(dir) {
    editor.focus();
    toast(dir > 0 ? "在编辑器中使用 ⌘Z 撤销" : "在编辑器中使用 ⇧⌘Z 重做");
  }

  function showOutline() {
    const doc = editor.getDoc();
    const heads = [...doc.matchAll(/^={1,6}\s+(.*)$/gm)].map((m, i) => `${m[0].trimStart().split(" ")[0]} ${m[1]}`);
    toast(heads.length ? "大纲: " + heads.join(" · ") : "文档没有标题");
  }

  function exportPng() {
    if (!state.previewUrl) { toast("还没有可导出的页面，请先编译"); return; }
    const a = el("a");
    a.href = state.previewUrl;
    a.download = `typstbit-page${state.page + 1}.png`;
    a.click();
  }

  async function shareDoc() {
    const url = location.origin + location.pathname + encodeShare(editor.getDoc());
    try { await navigator.clipboard.writeText(url); toast("分享链接已复制（文档编码在链接中）"); }
    catch { toast(url); }
  }

  compat.app = {
    exports: {
      e2e_status: () => state.status,
      e2e_revision: () => state.revision,
      e2e_page_count: () => state.pageCount,
      e2e_current_page: () => state.page,
      e2e_preview_ready: () => (state.previewReady ? 1 : 0),
      e2e_error_count: () => state.diagnostics.filter(d => d.severity === "error").length,
      e2e_compiling_count: () => state.compilingCount,
      typst_image_event: (rev, stt) => {
        if (rev !== state.docRevision) return;
        if (stt === 0) state.previewReady = true;
        else { state.previewFailed = true; state.previewReady = false; }
        updatePreviewImg();
      },
      e2e_set_source: textId => {
        const text = compat.typstTexts.get(Number(textId));
        if (typeof text === "string") { editor.setDoc(text); scheduleCompile(text); }
      },
      e2e_source_contains: textId => {
        const needle = compat.typstTexts.get(Number(textId));
        return typeof needle === "string" && editor.getDoc().includes(needle) ? 1 : 0;
      },
      e2e_turn_page: dir => turnPage(dir === 0 ? -1 : 1),
    },
  };
  compat.ready = true;
  setStatusUI();
  scheduleCompile(editor.getDoc());
  return { state, editor, bridge, compat };
}
