import { createSession, STATUS } from "./session.js";
import {
  MENUS,
  FORMAT_BUTTONS,
  TOPBAR_ACTIONS,
  filterCommands,
  commandActive,
  commandEnabled,
  getCommand,
  runCommand as dispatchCommand,
} from "./commands.js";

const DEFAULT_SOURCE = "#set text(font: (\"Liberation Serif\", \"Noto Serif CJK SC\"))\n#set page(width: 20cm, height: 10cm)\n= Hello, Typst!\n\n#lorem(60)";
const DEBOUNCE_MS = 300;

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
  pdf() {
    const ptr = this.ex.typst_abi_export_pdf();
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
  let ctx = null;

  let abiUrl = String(abiWasmUrl);
  let response = await fetch(abiUrl);
  if (!response.ok && abiUrl.includes("typst_abi.opt.wasm")) {
    abiUrl = abiUrl.replace("typst_abi.opt.wasm", "typst_abi.wasm");
    response = await fetch(abiUrl);
  }
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
  const pageLabel = el("span", "", "共 0 页");
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
    ...TOPBAR_ACTIONS.map(action =>
      Object.assign(el("button", action.variant ? `button ${action.variant}` : "button"), {
        textContent: action.label,
        onclick: () => runCommand(action.id),
      })),
  );

  const menubar = el("div", "menubar");
  menubar.append(
    ...MENUS.map(menu => menuButton(menu.label, menu.items)),
    el("span", "grow"),
    el("span", "", "⌘K 搜索命令"),
  );

  const formatbar = el("div", "formatbar");
  const formatButtons = new Map();
  for (const item of FORMAT_BUTTONS) {
    if (item.id === "open-search") formatbar.append(el("span", "grow"));
    const button = el("button", "", item.label);
    button.onclick = () => runCommand(item.id);
    formatButtons.set(item.id, button);
    formatbar.append(button);
  }

  const sidebar = el("div", "sidebar");
  sidebar.append(
    Object.assign(el("div", "panel-title"), { textContent: "PROJECT" }),
    Object.assign(el("div", "file active"), { textContent: "▣ main.typ" }),
    Object.assign(el("div", "file"), { textContent: "○ images" }),
    (() => {
      const tools = el("div", "sidebar-tools");
      const search = el("button", "", "⌕ 搜索");
      search.onclick = () => runCommand("open-search");
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
  const pageImage = el("img", "pdf-view");
  pageImage.alt = "预览";
  pageImage.style.display = "none";
  const emptyPreview = el("div", "empty-preview", "编译后将在这里显示预览");
  const pdfFrame = el("div", "pdf-frame");
  pdfFrame.append(pageImage, emptyPreview);
  const prevButton = el("button", "button", "上一页");
  const nextButton = el("button", "button", "下一页");
  const pageIndicator = el("span", "page-indicator", "第 0 / 0 页");
  prevButton.onclick = () => turnPage(-1);
  nextButton.onclick = () => turnPage(1);
  const openTabButton = el("button", "button", "在新标签页打开");
  openTabButton.onclick = () => openPdfTab();
  const previewHead = el("div", "pane-head");
  previewHead.append(
    el("span", "", "预览"),
    el("span", "grow"),
    prevButton, pageIndicator, nextButton, openTabButton,
  );
  previewPane.append(previewHead, pdfFrame);

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
      right.append(pageLabel, el("span", "", "预览按页栅格渲染 · PDF 可导出分享"));
      return right;
    })(),
  );

  app.append(topbar, menubar, formatbar, grid, statusbar);

  const session = createSession({ scale: 1500 });
  const state = session.state;

  compat.blobUrls = state.blobUrls;
  compat.session = session;
  compat.abi = abi;
  compat.revokedUrls = [];
  compat.urlRevision = new Map();
  compat.urlSettled = new Map();
  Object.defineProperty(compat, "currentSource", { get: () => state.previewUrl ?? "" });

  const shared = decodeShare();
  let stored = null;
  try { stored = localStorage.getItem("typstbit.source"); } catch {}
  const initial = shared ?? stored ?? DEFAULT_SOURCE;
  if (shared !== null) history.replaceState(null, "", location.pathname + location.search);
  const editor = editorMod.createEditor(editorHost, {
    doc: initial,
    onChange: text => {
      session.update({ source: text });
      try { localStorage.setItem("typstbit.source", text); } catch {}
      scheduleCompile(text);
    },
    onRun: () => runCommand("compile-now"),
    onCommand: id => runCommand(id),
    onSelectionChange: selection => {
      session.update({ selection: { from: selection.from, to: selection.to } });
      refreshCommandStates();
    },
  });

  ctx = {
    editor,
    session,
    ui: { toast, openPalette: () => openPalette() },
    actions: {
      resetExample,
      exportPdf,
      shareDoc,
      openPdfTab,
      compileNow,
    },
  };

  const palette = el("div", "command-palette");
  const paletteInput = el("input", "command-input");
  paletteInput.placeholder = "输入命令名称…";
  const paletteList = el("div", "command-list");
  palette.append(paletteInput, paletteList);
  document.body.appendChild(palette);
  let paletteItems = [];
  let paletteIndex = 0;

  function runCommand(id) {
    if (!ctx) return false;
    const executed = dispatchCommand(id, ctx);
    refreshCommandStates();
    return executed;
  }

  function refreshCommandStates() {
    if (!ctx) return;
    for (const [id, button] of formatButtons) {
      button.classList.toggle("active", commandActive(id, ctx));
      button.disabled = !commandEnabled(id, ctx);
    }
  }

  function renderPalette(query) {
    paletteItems = filterCommands(query).filter(command => commandEnabled(command.id, ctx));
    paletteIndex = 0;
    paletteList.innerHTML = "";
    paletteItems.forEach((command, index) => {
      const row = el("div", index === 0 ? "command-item selected" : "command-item");
      row.append(el("span", "", command.label), el("span", "category", command.category));
      if (command.shortcut) row.append(el("span", "shortcut", command.shortcut));
      row.onclick = () => executePalette(index);
      paletteList.append(row);
    });
  }

  function selectPalette(index) {
    if (paletteItems.length === 0) return;
    paletteIndex = Math.max(0, Math.min(index, paletteItems.length - 1));
    [...paletteList.children].forEach((row, i) => row.classList.toggle("selected", i === paletteIndex));
  }

  function executePalette(index = paletteIndex) {
    const command = paletteItems[index];
    closePalette();
    if (command) runCommand(command.id);
  }

  function openPalette() {
    palette.classList.add("open");
    paletteInput.value = "";
    renderPalette("");
    paletteInput.focus();
  }

  function closePalette() {
    palette.classList.remove("open");
    editor.focus();
  }

  paletteInput.oninput = () => renderPalette(paletteInput.value);
  paletteInput.onkeydown = event => {
    if (event.key === "ArrowDown") { event.preventDefault(); selectPalette(paletteIndex + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); selectPalette(paletteIndex - 1); }
    else if (event.key === "Enter") { event.preventDefault(); executePalette(); }
    else if (event.key === "Escape") { event.preventDefault(); closePalette(); }
  };
  window.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (palette.classList.contains("open")) closePalette();
      else openPalette();
    }
  }, true);
  document.addEventListener("click", event => {
    if (palette.classList.contains("open") && !palette.contains(event.target)) closePalette();
    closeMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMenu();
  });

  function toast(message) {
    const node = el("div", "toast", message);
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2600);
  }

  let openMenu = null;

  function closeMenu() {
    if (openMenu) {
      openMenu.style.display = "none";
      openMenu = null;
    }
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
    for (const item of items) {
      const command = getCommand(item.id);
      const node = el("button", "button", item.label ?? command?.label ?? item.id);
      node.style.display = "block";
      node.style.width = "100%";
      node.style.textAlign = "left";
      node.onclick = () => { closeMenu(); runCommand(item.id); };
      menu.append(node);
    }
    btn.onclick = event => {
      event.stopPropagation();
      const wasOpen = openMenu === menu;
      closeMenu();
      if (!wasOpen) {
        menu.style.display = "block";
        openMenu = menu;
      }
    };
    wrap.append(btn, menu);
    return wrap;
  }

  function setStatusUI() {
    statusPill.className = "status-pill" + (state.status === STATUS.COMPILING ? " busy" : state.status === STATUS.FAILED ? " error" : "");
    statusPill.textContent = ["待编译", "编译中", "就绪", "有问题"][state.status];
    statusDetail.textContent =
      state.status === STATUS.IDLE ? "编辑源码后将自动编译" :
      state.status === STATUS.COMPILING ? "正在生成最新排版结果" :
      state.status === STATUS.SUCCESS ? `已生成 ${state.pageCount} 页 PDF · 预览为最新结果` :
      `发现 ${state.diagnostics.filter(d => d.severity === "error").length} 个错误 · 已保留上次预览`;
    errCount.textContent = `✕ ${state.diagnostics.filter(d => d.severity === "error").length} 错误`;
    warnCount.textContent = `⚠ ${state.diagnostics.filter(d => d.severity === "warning").length} 警告`;
    pageLabel.textContent = `共 ${state.pageCount} 页`;
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
    const timer = setTimeout(() => { session.update({ pendingTimer: null }); startCompile(source); }, DEBOUNCE_MS);
    session.update({ pendingTimer: timer });
  }

  function compileNow() {
    if (state.pendingTimer) { clearTimeout(state.pendingTimer); session.update({ pendingTimer: null }); }
    startCompile(editor.getDoc());
  }

  function startCompile(source) {
    const revision = state.revision + 1;
    session.update({ revision, status: STATUS.COMPILING, compilingCount: state.compilingCount + 1, source });
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
        session.update({ diagnostics: [{ severity: "error", message: `宿主错误: ${e}` }], status: STATUS.FAILED });
        syncEditorDiagnostics();
        setStatusUI();
        return;
      }
      if (revision !== state.revision) return;
      const diags = bridge.errorJson().diagnostics ?? [];
      if (status === 0) {
        session.update({
          diagnostics: diags,
          status: STATUS.SUCCESS,
          docRevision: revision,
          pageCount: bridge.pageCount(),
          page: 0,
          previewFailed: false,
        });
        requestPdf(revision);
        renderPreviewPage();
      } else if (status === 3) {
        session.update({ diagnostics: diags, status: STATUS.FAILED });
      } else {
        session.update({ diagnostics: [{ severity: "error", message: `ABI 状态码 ${status}` }], status: STATUS.FAILED });
      }
      syncEditorDiagnostics();
      setStatusUI();
    }));
  }

  function renderPreviewPage() {
    if (state.pageCount === 0) {
      updatePreviewView();
      return;
    }
    const page = Math.min(Math.max(state.page, 0), state.pageCount - 1);
    const png = bridge.renderPagePng(page, state.scale);
    if (!png) {
      session.update({ previewFailed: true, previewReady: false });
      updatePreviewView();
      setStatusUI();
      return;
    }
    const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
    const previousUrl = state.pageUrl;
    session.update({ pageUrl: url, page, previewReady: false, previewFailed: false });
    pageImage.onload = () => {
      if (state.pageUrl !== url) return;
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      session.update({ previewReady: true });
      compat.urlSettled.set(url, true);
      setStatusUI();
    };
    pageImage.onerror = () => {
      if (state.pageUrl !== url) return;
      session.update({ previewReady: false, previewFailed: true });
      setStatusUI();
    };
    pageImage.src = url;
    updatePreviewView();
    setStatusUI();
  }

  function turnPage(delta) {
    if (state.pageCount === 0) return;
    const next = Math.min(Math.max(state.page + delta, 0), state.pageCount - 1);
    if (next === state.page && state.pageUrl) return;
    session.update({ page: next });
    renderPreviewPage();
  }

  function requestPdf(revision) {
    const bytes = bridge.pdf();
    if (!bytes || revision !== state.docRevision) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    state.blobUrls.push(url);
    compat.urlRevision.set(url, revision);
    if (state.previewUrl) {
      URL.revokeObjectURL(state.previewUrl);
      compat.revokedUrls.push(state.previewUrl);
    }
    session.update({ previewUrl: url });
  }

  function updatePreviewView() {
    const hasPage = Boolean(state.pageUrl) && state.pageCount > 0;
    if (hasPage) {
      pageImage.style.display = "block";
      emptyPreview.style.display = "none";
    } else {
      pageImage.style.display = "none";
      emptyPreview.style.display = "block";
      emptyPreview.textContent = state.previewFailed ? "预览生成失败" : state.status === STATUS.COMPILING ? "正在排版…" : "编译后将在这里显示预览";
    }
    pageIndicator.textContent = `第 ${state.pageCount ? state.page + 1 : 0} / ${state.pageCount} 页`;
    prevButton.disabled = state.pageCount === 0 || state.page <= 0;
    nextButton.disabled = state.pageCount === 0 || state.page >= state.pageCount - 1;
  }

  function openPdfTab() {
    if (!state.previewUrl) { toast("还没有可打开的 PDF，请先编译"); return; }
    window.open(state.previewUrl, "_blank");
  }

  function resetExample() {
    editor.setDoc(DEFAULT_SOURCE);
    compileNow();
  }

  function showOutline() {
    const doc = editor.getDoc();
    const heads = [...doc.matchAll(/^={1,6}\s+(.*)$/gm)].map((m, i) => `${m[0].trimStart().split(" ")[0]} ${m[1]}`);
    toast(heads.length ? "大纲: " + heads.join(" · ") : "文档没有标题");
  }

  function exportPdf() {
    if (!state.previewUrl) { toast("还没有可导出的 PDF，请先编译"); return; }
    const a = el("a");
    a.href = state.previewUrl;
    a.download = "typstbit.pdf";
    a.click();
  }

  async function shareDoc() {
    const doc = editor.getDoc();
    const url = location.origin + location.pathname + encodeShare(doc);
    if (url.length > 8000) {
      try { localStorage.setItem("typstbit.source", doc); } catch {}
      toast("文档较长，分享链接过长，已保存在浏览器本地");
      return;
    }
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
        updatePreviewView();
      },
      e2e_set_source: textId => {
        const text = compat.typstTexts.get(Number(textId));
        if (typeof text === "string") { editor.setDoc(text); scheduleCompile(text); }
      },
      e2e_source_contains: textId => {
        const needle = compat.typstTexts.get(Number(textId));
        return typeof needle === "string" && editor.getDoc().includes(needle) ? 1 : 0;
      },
      e2e_turn_page: delta => turnPage(delta),
      e2e_doc: () => editor.getDoc(),
      e2e_cursor_line: () => editor.view.state.doc.lineAt(editor.view.state.selection.main.head).number,
    },
  };
  compat.ready = true;
  setStatusUI();
  scheduleCompile(editor.getDoc());
  return { state, editor, bridge, compat };
}
