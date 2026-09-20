import { createSession, STATUS } from "./session.js";
import { loadPackageManifest, packageSpecsInSource, registerPackage } from "./packages.js";
import { parseOutline } from "./outline.js";
import {
  definePlugin,
  getPlugins,
  getPlugin,
  createPluginHost,
  getSettingsSchemas,
  readSettings,
  writeSettings,
  readExternalPlugins,
  writeExternalPlugins,
} from "./plugins.js";
import wordCountPlugin from "./plugins/word-count.js";
import imageHostPlugin from "./plugins/image-host.js";
import exportFormatsPlugin from "./plugins/export-formats.js";
import templatesPlugin from "./plugins/templates.js";
import qrcodePlugin from "./plugins/qrcode.js";
import exportHtmlPlugin from "./plugins/export-html.js";
import sourceToolsPlugin from "./plugins/source-tools.js";
import themePlugin from "./plugins/theme.js";
import {
  MENUS,
  FORMAT_BUTTONS,
  TOPBAR_ACTIONS,
  filterCommands,
  commandActive,
  commandEnabled,
  getCommand,
  registerCommands,
  runCommand as dispatchCommand,
} from "./commands.js";

const DEFAULT_SOURCE = `#set text(font: ("Liberation Serif", "Noto Serif CJK SC"))
#set page(paper: "a5")
#set heading(numbering: "1.")

#show link: set text(fill: blue, weight: 700)
#show link: underline

= The Typst Playground

Welcome to the Typst Playground! This is a sandbox where you can experiment with Typst. You can type anywhere in the editor panel on the left. The preview panel to the right will update live.

= Basics <basics>

Typst is a _markup_ language. You use it to express not just the content, but also the structure and formatting of your document. For example, surrounding a word with underscores _emphasizes_ it with italics and starting a line with an equals sign creates a section heading.

Typst has lightweight syntax like this for the most common formatting needs. Among other things, you can use it to:

- *Strongly emphasize* some text
- Refer to @basics
- Typeset math: $a, b in { 1/2, sqrt(4 a b) }$

That's just the surface though! Typst has powerful systems for scripting, styling, introspection, and more. In the realm of a Typst document, there is nothing you can't automate.

= Next steps

To learn more about Typst, we recommend you to check out our tutorial at https://typst.app/docs/tutorial.

Once you've explored Typst a bit, why not set yourself up a proper editing environment?

#import "@preview/tiaoma:0.3.0"
#let next-step(url, body) = grid(
  columns: 2,
  gutter: 1em,
  tiaoma.qrcode(url, width: 3em),
  {
    show strong: link.with(url)
    body
  }
)

#next-step("https://typst.app/signup")[
  To get access to multi-file projects, live collaboration, and more, *sign up* to our web app for free.
]

#next-step("https://typst.app/open-source/#download")[
  You can also *download* our free and open-source command line tool to continue your journey locally.
]`;
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
  removeFile(path) { const [pp, plen] = this.putStr(path); return this.ex.typst_abi_remove_file(pp, plen); }
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
  setPackageFile(spec, path, bytes) {
    const [sp, slen] = this.putStr(spec);
    const [pp, plen] = this.putStr(path);
    const [dp, dlen] = this.put(bytes);
    return this.ex.typst_abi_set_package_file(sp, slen, pp, plen, dp, dlen);
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

function bootElement(selector) {
  const overlay = document.getElementById("boot-overlay");
  return overlay ? overlay.querySelector(selector) : null;
}

function bootStep(text, ratio) {
  const overlay = document.getElementById("boot-overlay");
  if (!overlay) return;
  const step = overlay.querySelector(".boot-step");
  if (step) step.textContent = text;
  const fill = overlay.querySelector(".boot-fill");
  if (!fill) return;
  if (typeof ratio === "number") {
    fill.classList.remove("indeterminate");
    fill.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  }
}

function bootFinish() {
  const overlay = document.getElementById("boot-overlay");
  if (!overlay || overlay.classList.contains("done")) return;
  overlay.classList.add("done");
  setTimeout(() => overlay.remove(), 350);
}

function bootFail(message) {
  const overlay = document.getElementById("boot-overlay");
  if (!overlay) return;
  overlay.classList.add("failed");
  const step = overlay.querySelector(".boot-step");
  if (step) step.textContent = `加载失败：${message}`;
}

async function fetchWasmWithProgress(url) {
  const response = await fetch(url);
  if (!response.ok || !response.body) return response;
  const total = Number(response.headers.get("content-length") ?? 0);
  const encoded = response.headers.get("content-encoding");
  const determinate = total > 0 && !encoded;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  const report = () => {
    if (determinate) {
      bootStep(`正在加载编译器 ${Math.round((received / total) * 100)}%（${(received / 1048576).toFixed(1)} MB）`, received / total);
    } else {
      bootStep(`正在加载编译器 ${(received / 1048576).toFixed(1)} MB`);
    }
  };
  report();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    report();
  }
  return new Response(new Blob(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
}

export async function bootWorkbench({ abiWasmUrl, host }) {
  const compat = {
    ready: false, error: null, compileCount: 0,
    typstTexts: new Map(), nextTextId: 1, app: null,
  };
  globalThis.__typstbit = compat;
  let ctx = null;
  let bootFinished = false;
  const finishBootOnce = () => {
    if (bootFinished) return;
    bootFinished = true;
    bootFinish();
  };

  let abiUrl = String(abiWasmUrl);
  let response = await fetchWasmWithProgress(abiUrl);
  if (!response.ok && abiUrl.includes("typst_abi.opt.wasm")) {
    abiUrl = abiUrl.replace("typst_abi.opt.wasm", "typst_abi.wasm");
    bootStep("正在加载编译器（回退产物）…");
    response = await fetchWasmWithProgress(abiUrl);
  }
  if (!response.ok) {
    bootFail(`HTTP ${response.status}`);
    throw new Error(`fetch typst_abi failed: ${response.status}`);
  }
  bootStep("初始化编译器…");
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

  bootStep("准备工作台…");
  const editorModule = new URLSearchParams(location.search).get("editor") === "cm"
    ? "./editor-bundle.js"
    : "./editor-adapter-cmb.js";
  const editorMod = await import(editorModule);
  bootStep("初始化编辑器…");

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
  const menubarGrow = el("span", "grow");
  menubar.append(
    ...MENUS.map(menu => menuButton(menu.label, menu.items)),
    menubarGrow,
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
  const fileList = el("div", "file-list");
  const uploadInput = el("input", "upload-input");
  uploadInput.type = "file";
  uploadInput.multiple = true;
  uploadInput.accept = ".typ,.txt,.md,.csv,.json,image/*";
  uploadInput.style.display = "none";
  sidebar.append(
    (() => {
      const head = el("div", "panel-title");
      const actions = el("span", "panel-actions");
      const newFile = el("button", "", "＋文件");
      const newFolder = el("button", "", "＋文件夹");
      const upload = el("button", "", "⬆上传");
      newFile.onclick = () => startNewEntry("file");
      newFolder.onclick = () => startNewEntry("folder");
      upload.onclick = () => uploadInput.click();
      actions.append(newFile, newFolder, upload);
      head.append(el("span", "", "PROJECT"), el("span", "grow"), actions);
      return head;
    })(),
    fileList,
    uploadInput,
    (() => {
      const tools = el("div", "sidebar-tools");
      const search = el("button", "", "⌕ 搜索");
      search.onclick = () => runCommand("open-search");
      const outline = el("button", "", "☷ 文档大纲");
      outline.onclick = event => {
        event.stopPropagation();
        toggleOutline();
      };
      tools.append(search, outline);
      return tools;
    })(),
  );

  const editorPane = el("div", "editor-pane");
  const editorHost = el("div", "editor-host");
  const editorTab = el("div", "tab", "main.typ");
  editorTab.style.paddingRight = "12px";
  editorPane.append(
    (() => {
      const head = el("div", "pane-head");
      head.append(editorTab, el("span", "dirty", "自动保存"), el("span", "grow"), el("span", "dirty", "Typst"));
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

  let packageManifest = null;
  let packageManifestPromise = null;
  const loadedPackages = new Set();
  const pendingPackages = new Map();

  compat.blobUrls = state.blobUrls;
  compat.session = session;
  compat.abi = abi;
  compat.revokedUrls = [];
  compat.urlRevision = new Map();
  compat.urlSettled = new Map();
  Object.defineProperty(compat, "currentSource", { get: () => state.previewUrl ?? "" });

  const project = new Map();
  const folders = new Set();
  let activePath = "/main.typ";
  let applyingFile = false;

  function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(data) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function loadProject() {
    try {
      const raw = JSON.parse(localStorage.getItem("typstbit.project") ?? "null");
      if (raw?.files) {
        for (const entry of Object.entries(raw.files)) {
          const path = entry[0];
          const value = entry[1];
          project.set(path, value.kind === "binary"
            ? { kind: "binary", bytes: base64ToBytes(value.data) }
            : { kind: "text", text: value.text ?? "" });
        }
        for (const folder of raw.folders ?? []) folders.add(folder);
        if (raw.active && project.has(raw.active)) activePath = raw.active;
      }
    } catch {}
    if (!project.has("/main.typ")) {
      let legacy = null;
      try { legacy = localStorage.getItem("typstbit.source"); } catch {}
      project.set("/main.typ", { kind: "text", text: legacy ?? DEFAULT_SOURCE });
    }
  }

  function saveProject() {
    try {
      const files = {};
      for (const entry of project.entries()) {
        const path = entry[0];
        const value = entry[1];
        files[path] = value.kind === "binary"
          ? { kind: "binary", data: bytesToBase64(value.bytes) }
          : { kind: "text", text: value.text };
      }
      localStorage.setItem("typstbit.project", JSON.stringify({ files, folders: [...folders], active: activePath }));
    } catch {}
  }

  loadProject();
  const shared = decodeShare();
  if (shared !== null) {
    project.set("/main.typ", { kind: "text", text: shared });
    activePath = "/main.typ";
    history.replaceState(null, "", location.pathname + location.search);
  }
  const initial = project.get(activePath)?.kind === "text" ? project.get(activePath).text : DEFAULT_SOURCE;
  const editor = await editorMod.createEditor(editorHost, {
    doc: initial,
    onChange: text => {
      if (applyingFile) return;
      const entry = project.get(activePath);
      if (entry && entry.kind === "text") entry.text = text;
      session.update({ source: text });
      try { localStorage.setItem("typstbit.source", text); } catch {}
      saveProject();
      scheduleCompile();
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

  editorHost.addEventListener("paste", event => {
    const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    addPastedImages(files);
  }, true);
  sidebar.addEventListener("dragover", event => event.preventDefault());
  sidebar.addEventListener("drop", event => {
    event.preventDefault();
    if (event.dataTransfer?.files?.length) addUploadedFiles([...event.dataTransfer.files]);
  });
  uploadInput.onchange = () => {
    addUploadedFiles([...uploadInput.files]);
    uploadInput.value = "";
  };

  const palette = el("div", "command-palette");
  const paletteInput = el("input", "command-input");
  paletteInput.placeholder = "输入命令名称…";
  const paletteList = el("div", "command-list");
  palette.append(paletteInput, paletteList);
  document.body.appendChild(palette);

  const outlinePanel = el("div", "outline-panel");
  outlinePanel.append(el("div", "outline-head", "文档大纲"), el("div", "outline-list"));
  const outlineList = outlinePanel.lastChild;
  document.body.appendChild(outlinePanel);
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

  function toggleOutline() {
    if (outlinePanel.classList.contains("open")) closeOutline();
    else openOutline();
  }

  function openOutline() {
    const entries = parseOutline(editor.getDoc());
    outlineList.innerHTML = "";
    if (entries.length === 0) {
      outlineList.append(el("div", "outline-empty", "文档没有标题"));
    } else {
      for (const entry of entries) {
        const item = el("div", "outline-item");
        item.style.paddingLeft = `${8 + (entry.level - 1) * 12}px`;
        item.append(el("span", "outline-title", entry.title));
        item.onclick = () => {
          closeOutline();
          jumpToLine(entry.line);
        };
        outlineList.append(item);
      }
    }
    outlinePanel.classList.add("open");
  }

  function closeOutline() {
    outlinePanel.classList.remove("open");
  }

  function jumpToLine(line) {
    editor.setCursorToLine(line);
  }

  const exporters = new Map();
  const pluginHosts = new Map();
  const pluginSections = new Map();
  let pluginMenuButton = null;

  function themedStyle(pluginId, attribute) {
    let tag = document.querySelector(`style[data-plugin-${attribute}="${pluginId}"]`);
    if (!tag) {
      tag = document.createElement("style");
      tag.dataset[`plugin${attribute[0].toUpperCase()}${attribute.slice(1)}`] = pluginId;
      document.head.append(tag);
    }
    return tag;
  }

  const themeApi = {
    setVariables: (pluginId, variables) => {
      const body = Object.entries(variables ?? {}).map(([key, value]) => `  ${key}: ${value};`).join("\n");
      const selectors = 'body:not([data-theme]), body[data-theme="dark"], body[data-theme="sepia"]';
      themedStyle(pluginId, "theme").textContent = body ? `${selectors} {\n${body}\n}` : "";
    },
    addStyle: (pluginId, css) => {
      themedStyle(pluginId, "style").textContent = css ?? "";
    },
    setBodyAttribute: (name, value) => {
      if (value === null || value === undefined) document.body.removeAttribute(name);
      else document.body.setAttribute(name, String(value));
    },
    setBodyClass: (name, enabled) => {
      document.body.classList.toggle(name, Boolean(enabled));
    },
  };

  const typstApi = {
    exportPdf: () => bridge.pdf(),
    exportSvg: page => {
      const ptr = bridge.ex.typst_abi_export_svg(page);
      if (!ptr) return null;
      return bridge.outLen(ptr);
    },
    renderPagePng: (page, scaleMilli) => bridge.renderPagePng(page, scaleMilli),
  };

  function addMenu(label, items) {
    const button = menuButton(label, items);
    menubar.insertBefore(button, menubarGrow);
    return button;
  }

  function pluginSection(plugin) {
    if (!pluginSections.has(plugin.id)) {
      pluginSections.set(plugin.id, { title: plugin.name ?? plugin.id, items: [] });
    }
    return pluginSections.get(plugin.id);
  }

  function refreshPluginMenu() {
    if (pluginMenuButton) pluginMenuButton.remove();
    const items = [];
    for (const section of pluginSections.values()) {
      items.push({ header: section.title });
      items.push(...section.items);
    }
    items.push({ separator: true });
    items.push({ id: "plugin.settings", label: "插件设置…" });
    pluginMenuButton = menuButton("插件", items);
    menubar.insertBefore(pluginMenuButton, menubarGrow);
  }

  function registerExporter(exporter, plugin) {
    if (!exporter?.id || exporters.has(exporter.id)) return;
    exporters.set(exporter.id, exporter);
    const commandId = `plugin.export.${exporter.id}`;
    registerCommands([{
      id: commandId,
      label: `导出 ${exporter.label}`,
      category: "插件",
      run: () => runExporter(exporter.id),
    }]);
    pluginSection(plugin).items.push({ id: commandId, label: `导出 ${exporter.label}` });
  }

  function runExporter(id) {
    const exporter = exporters.get(id);
    if (!exporter) return;
    try {
      const blob = exporter.build({ typst: typstApi, session: state, editor });
      if (!blob) {
        toast("导出失败：当前没有可导出的内容");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = el("a");
      link.href = url;
      link.download = `typstbit.${exporter.extension ?? "bin"}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      toast(`导出失败: ${error}`);
    }
  }

  const settingsPanel = el("div", "settings-panel");
  const settingsBody = el("div", "settings-body");
  const settingsSave = el("button", "button primary", "保存");
  const settingsClose = el("button", "button", "关闭");
  const settingsFooter = el("div", "settings-footer");
  settingsFooter.append(el("span", "grow"), settingsSave, settingsClose);
  settingsPanel.append(el("div", "settings-head", "插件设置"), settingsBody, settingsFooter);
  document.body.appendChild(settingsPanel);

  function openSettings(pluginId = null) {
    renderSettings(pluginId);
    settingsPanel.classList.add("open");
  }

  function closeSettings() {
    settingsPanel.classList.remove("open");
  }

  function renderSettings(pluginId) {
    settingsBody.innerHTML = "";
    if (!pluginId) {
      const external = el("div", "settings-section");
      external.append(el("div", "settings-title", "外部插件"));
      const urls = readExternalPlugins();
      for (const url of urls) {
        const row = el("div", "settings-row");
        row.append(el("span", "settings-label", url.length > 48 ? `${url.slice(0, 48)}…` : url));
        const remove = el("button", "button", "移除");
        remove.onclick = () => {
          writeExternalPlugins(urls.filter(item => item !== url));
          renderSettings(pluginId);
          toast("已移除，刷新后完全生效");
        };
        row.append(remove);
        external.append(row);
      }
      const addRow = el("div", "settings-row");
      const addInput = el("input", "plugin-url-input");
      addInput.type = "text";
      addInput.placeholder = "插件 URL（ES module，默认导出 definePlugin）";
      const addButton = el("button", "button", "添加");
      addButton.onclick = async () => {
        const url = addInput.value.trim();
        if (!url) return;
        addInput.value = "";
        await addExternalPlugin(url);
        renderSettings(pluginId);
      };
      addRow.append(el("span", "settings-label", "添加插件"), addInput, addButton);
      external.append(addRow);
      settingsBody.append(external);
    }
    const entries = getSettingsSchemas().filter(entry => !pluginId || entry.pluginId === pluginId);
    if (entries.length === 0) {
      if (pluginId) settingsBody.append(el("div", "outline-empty", "该插件没有设置项"));
      return;
    }
    for (const entry of entries) {
      const section = el("div", "settings-section");
      section.append(el("div", "settings-title", entry.schema.title ?? entry.pluginId));
      const values = readSettings(entry.pluginId);
      for (const field of entry.schema.fields ?? []) {
        const row = el("label", "settings-row");
        row.append(el("span", "settings-label", field.label ?? field.key));
        let input;
        if (field.type === "boolean") {
          input = el("input");
          input.type = "checkbox";
          input.checked = Boolean(values[field.key]);
        } else if (field.type === "select") {
          input = el("select");
          for (const option of field.options ?? []) {
            const value = option.value ?? option;
            const node = el("option", "", option.label ?? value);
            node.value = value;
            input.append(node);
          }
          input.value = values[field.key] ?? "";
        } else {
          input = el("input");
          input.type = field.type === "password" ? "password" : "text";
          input.placeholder = field.placeholder ?? "";
          input.value = values[field.key] ?? "";
        }
        input.dataset.plugin = entry.pluginId;
        input.dataset.key = field.key;
        input.dataset.type = field.type ?? "text";
        row.append(input);
        section.append(row);
      }
      settingsBody.append(section);
    }
  }

  function saveSettings() {
    const patches = new Map();
    for (const input of settingsBody.querySelectorAll("input, select")) {
      const pluginId = input.dataset.plugin;
      const key = input.dataset.key;
      if (!pluginId || !key) continue;
      const values = patches.get(pluginId) ?? { ...readSettings(pluginId) };
      values[key] = input.dataset.type === "boolean" ? input.checked : input.value;
      patches.set(pluginId, values);
    }
    for (const [pluginId, values] of patches) writeSettings(pluginId, values);
    return [...patches.keys()];
  }

  settingsSave.onclick = () => {
    const touched = saveSettings();
    for (const pluginId of touched) {
      const plugin = getPlugin(pluginId);
      const host = pluginHosts.get(pluginId);
      if (plugin?.onSettingsChanged && host) {
        try {
          plugin.onSettingsChanged(host);
        } catch (error) {
          console.warn(`plugin settings hook failed: ${pluginId}`, error);
        }
      }
    }
    closeSettings();
    toast("插件设置已保存");
  };
  settingsClose.onclick = closeSettings;

  async function loadPluginUrl(url) {
    const module = await Promise.race([
      import(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    if (typeof module.default?.setup !== "function") throw new Error("module has no plugin default export");
    return module.default;
  }

  function setupPlugin(plugin) {
    const host = createPluginHost({
      plugin,
      registerCommands: commands => {
        const list = commands ?? [];
        registerCommands(list);
        const section = pluginSection(plugin);
        for (const command of list) section.items.push({ id: command.id, label: command.label });
      },
      addMenu,
      registerExporter: exporter => registerExporter(exporter, plugin),
      openSettings,
      toast,
      editor,
      session,
      typst: typstApi,
      theme: themeApi,
    });
    pluginHosts.set(plugin.id, host);
    plugin.setup(host);
  }

  async function addExternalPlugin(url) {
    const urls = readExternalPlugins();
    if (!urls.includes(url)) writeExternalPlugins([...urls, url]);
    try {
      const plugin = definePlugin(await loadPluginUrl(url));
      setupPlugin(plugin);
      refreshPluginMenu();
      toast(`插件已加载: ${plugin.name ?? plugin.id}`);
      return true;
    } catch (error) {
      console.warn(`plugin load failed: ${url}`, error);
      toast("插件加载失败，已保存，刷新后可重试");
      return false;
    }
  }

  async function loadExternalPlugins() {
    const urls = new Set(new URLSearchParams(location.search).getAll("plugin"));
    for (const url of readExternalPlugins()) urls.add(url);
    for (const url of urls) {
      try {
        definePlugin(await loadPluginUrl(url));
      } catch (error) {
        console.warn(`plugin load failed: ${url}`, error);
        toast(`插件加载失败: ${url}`);
      }
    }
  }

  async function setupPlugins() {
    registerCommands([{ id: "plugin.settings", label: "插件设置…", category: "插件", run: () => openSettings() }]);
    await loadExternalPlugins();
    for (const plugin of getPlugins()) {
      try {
        setupPlugin(plugin);
      } catch (error) {
        console.warn(`plugin setup failed: ${plugin.id}`, error);
      }
    }
    refreshPluginMenu();
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
    if (outlinePanel.classList.contains("open") && !outlinePanel.contains(event.target)) closeOutline();
    if (settingsPanel.classList.contains("open") && !settingsPanel.contains(event.target)) closeSettings();
    closeMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeMenu();
      closeOutline();
      closeSettings();
    }
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
      maxHeight: "70vh", overflow: "auto",
    });
    for (const item of items) {
      if (item.separator) {
        menu.append(el("div", "menu-separator"));
        continue;
      }
      if (item.header) {
        menu.append(el("div", "menu-header", item.header));
        continue;
      }
      const command = getCommand(item.id);
      const node = el("button", "button", item.label ?? command?.label ?? item.id);
      node.style.display = "block";
      node.style.width = "100%";
      node.style.textAlign = "left";
      node.onclick = event => {
        event.stopPropagation();
        closeMenu();
        runCommand(item.id);
      };
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
      const where = d.file && d.file !== "/main.typ" ? `${d.file} ` : "";
      const loc = el("span", "location", d.start ? `${where}第 ${d.start.line} 行` : "");
      const btn = el("button", "", `[${d.severity === "error" ? "错误" : "警告"}] ${d.message}`);
      if (d.start) btn.onclick = () => jumpToDiagnostic(d);
      const hint = d.hints?.length ? el("span", "location", d.hints.join(" ")) : null;
      row.append(loc, btn);
      if (hint) row.append(hint);
      diagList.append(row);
    }
  }

  function jumpToDiagnostic(d) {
    if (d.file && d.file !== activePath && project.has(d.file)) {
      openFile(d.file);
    }
    editor.setCursorToLine(d.start.line, d.start.column);
  }

  function syncEditorDiagnostics() {
    editor.setDiagnostics(state.diagnostics
      .filter(d => !d.file || d.file === activePath)
      .map(d => ({
        severity: d.severity, message: d.message + (d.hints?.length ? ` · ${d.hints.join(" ")}` : ""),
        line: d.start?.line ?? 1, column: d.start?.column ?? 1,
        endLine: d.end?.line ?? d.start?.line ?? 1, endColumn: d.end?.column ?? (d.start?.column ?? 1) + 1,
      })));
  }

  function updateEditorTab() {
    editorTab.textContent = activePath.split("/").pop();
  }

  function renderFiles() {
    fileList.innerHTML = "";
    const entries = [];
    for (const folder of folders) entries.push({ kind: "folder", path: folder });
    for (const path of project.keys()) entries.push({ kind: "file", path });
    entries.sort((a, b) => a.path.localeCompare(b.path));
    for (const entry of entries) {
      const depth = entry.path.split("/").filter(Boolean).length - 1;
      const node = el("div", "file");
      node.style.paddingLeft = `${10 + depth * 12}px`;
      if (entry.kind === "folder") {
        node.classList.add("folder");
        node.textContent = `▸ ${entry.path.split("/").pop()}`;
      } else {
        const value = project.get(entry.path);
        if (entry.path === activePath) node.classList.add("active");
        node.append(el("span", "file-name", `${value.kind === "binary" ? "▩" : "▣"} ${entry.path.split("/").pop()}`));
        node.onclick = () => openFile(entry.path);
        if (entry.path !== "/main.typ") {
          const remove = el("button", "file-remove", "✕");
          remove.onclick = event => {
            event.stopPropagation();
            project.delete(entry.path);
            if (activePath === entry.path) {
              activePath = "/main.typ";
              const main = project.get("/main.typ");
              applyingFile = true;
              editor.setDoc(main?.kind === "text" ? main.text : "");
              applyingFile = false;
              updateEditorTab();
            }
            saveProject();
            renderFiles();
            scheduleCompile();
          };
          node.append(remove);
        }
      }
      fileList.append(node);
    }
  }

  function openFile(path) {
    const entry = project.get(path);
    if (!entry) return;
    if (path !== activePath) {
      activePath = path;
      applyingFile = true;
      editor.setDoc(entry.kind === "text" ? entry.text : "");
      applyingFile = false;
      saveProject();
      renderFiles();
      scheduleCompile();
    }
    updateEditorTab();
  }

  function startNewEntry(kind) {
    if (fileList.querySelector(".file-input-row")) return;
    const row = el("div", "file-input-row");
    const input = el("input");
    input.placeholder = kind === "folder" ? "文件夹名（如 assets）" : "文件名（如 chapter1.typ 或 assets/logo.png）";
    row.append(input);
    fileList.prepend(row);
    input.focus();
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const raw = input.value.trim().replace(/^\/+/, "");
      row.remove();
      if (!raw) return;
      if (kind === "folder") {
        folders.add(`/${raw}`);
        saveProject();
        renderFiles();
        return;
      }
      const path = `/${raw}`;
      if (project.has(path)) {
        toast("文件已存在");
        return;
      }
      const isImage = /\.(png|jpe?g|gif|svg|webp)$/i.test(raw);
      project.set(path, isImage ? { kind: "binary", bytes: new Uint8Array() } : { kind: "text", text: "" });
      saveProject();
      renderFiles();
      openFile(path);
      scheduleCompile();
      toast(`已创建 ${path}`);
    };
    input.onkeydown = event => {
      if (event.key === "Enter") commit();
      else if (event.key === "Escape") { done = true; row.remove(); }
    };
    input.onblur = commit;
  }

  async function addUploadedFiles(files) {
    let added = 0;
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isText = /\.(typ|txt|md|csv|json)$/i.test(file.name) || file.type.startsWith("text/");
      const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|gif|svg|webp)$/i.test(file.name);
      if (!isText && !isImage) continue;
      if (isText) {
        project.set(`/${file.name}`, { kind: "text", text: new TextDecoder().decode(bytes) });
      } else {
        project.set(`/images/${file.name}`, { kind: "binary", bytes });
        folders.add("/images");
      }
      added += 1;
    }
    if (added === 0) {
      toast("没有可添加的文件（支持 .typ/.txt/图片）");
      return;
    }
    saveProject();
    renderFiles();
    scheduleCompile();
    toast(`已添加 ${added} 个文件`);
  }

  async function addPastedImages(files) {
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = file.type === "image/jpeg" ? "jpg"
        : file.type === "image/svg+xml" ? "svg"
        : file.type === "image/gif" ? "gif" : "png";
      const name = `paste-${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;
      project.set(`/images/${name}`, { kind: "binary", bytes });
      folders.add("/images");
      editor.insertBlock(`#image("images/${name}")`);
    }
    saveProject();
    renderFiles();
    scheduleCompile();
    toast(`已粘贴 ${files.length} 张图片到 images/`);
  }

  function projectMainText() {
    const main = project.get("/main.typ");
    return main?.kind === "text" ? main.text : "";
  }

  const syncedFiles = new Set();

  function syncProjectToVfs() {
    for (const path of [...syncedFiles]) {
      if (!project.has(path)) {
        bridge.removeFile(path);
        syncedFiles.delete(path);
      }
    }
    for (const entry of project.entries()) {
      const path = entry[0];
      const value = entry[1];
      const status = value.kind === "binary" ? bridge.setFile(path, value.bytes) : bridge.setFile(path, value.text);
      if (status !== 0) throw new Error(`set_file ${path} status ${status}`);
      syncedFiles.add(path);
    }
  }

  function scheduleCompile() {
    if (state.pendingTimer) clearTimeout(state.pendingTimer);
    const timer = setTimeout(() => { session.update({ pendingTimer: null }); startCompile(); }, DEBOUNCE_MS);
    session.update({ pendingTimer: timer });
  }

  function compileNow() {
    if (state.pendingTimer) { clearTimeout(state.pendingTimer); session.update({ pendingTimer: null }); }
    startCompile();
  }

  function sourceNeedsPackages(source) {
    const specs = packageSpecsInSource(source);
    if (specs.length === 0) return false;
    if (!packageManifest) return true;
    return specs.some(spec => {
      const entry = packageManifest.find(item => item.spec === spec);
      return entry ? !loadedPackages.has(spec) : false;
    });
  }

  async function ensurePackages(source) {
    const specs = packageSpecsInSource(source);
    if (specs.length === 0) return;
    if (!packageManifest) {
      packageManifestPromise ??= loadPackageManifest().catch(() => []);
      packageManifest = await packageManifestPromise;
    }
    const needed = specs
      .map(spec => packageManifest.find(entry => entry.spec === spec))
      .filter(entry => entry && !loadedPackages.has(entry.spec));
    if (needed.length === 0) return;
    await Promise.all(
      needed.map(entry => {
        if (!pendingPackages.has(entry.spec)) {
          pendingPackages.set(
            entry.spec,
            registerPackage(bridge, entry)
              .then(() => loadedPackages.add(entry.spec))
              .finally(() => pendingPackages.delete(entry.spec)),
          );
        }
        return pendingPackages.get(entry.spec);
      }),
    );
  }

  function startCompile() {
    const source = projectMainText();
    if (sourceNeedsPackages(source)) {
      session.update({ status: STATUS.COMPILING, compilingCount: state.compilingCount + 1 });
      setStatusUI();
      ensurePackages(source)
        .then(() => startCompile())
        .catch(error => {
          session.update({ status: STATUS.FAILED, diagnostics: [{ severity: "error", message: `包加载失败: ${error}` }] });
          syncEditorDiagnostics();
          setStatusUI();
          finishBootOnce();
        });
      return;
    }
    const revision = state.revision + 1;
    session.update({ revision, status: STATUS.COMPILING, compilingCount: state.compilingCount + 1, source });
    setStatusUI();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      let status;
      try {
        syncProjectToVfs();
        bridge.setMain("/main.typ");
        status = bridge.compile();
        compat.compileCount += 1;
      } catch (e) {
        compat.error = String(e);
        session.update({ diagnostics: [{ severity: "error", message: `宿主错误: ${e}` }], status: STATUS.FAILED });
        syncEditorDiagnostics();
        setStatusUI();
        finishBootOnce();
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
      finishBootOnce();
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
    const opened = window.open(state.previewUrl, "_blank");
    if (!opened) toast("浏览器拦截了新标签页，请允许弹出窗口或使用「导出 PDF」");
  }

  function resetExample() {
    project.set("/main.typ", { kind: "text", text: DEFAULT_SOURCE });
    activePath = "/main.typ";
    applyingFile = true;
    editor.setDoc(DEFAULT_SOURCE);
    applyingFile = false;
    saveProject();
    renderFiles();
    updateEditorTab();
    compileNow();
  }

  function exportPdf() {
    if (!state.previewUrl) { toast("还没有可导出的 PDF，请先编译"); return; }
    const a = el("a");
    a.href = state.previewUrl;
    a.download = "typstbit.pdf";
    a.click();
  }

  async function shareDoc() {
    const doc = projectMainText();
    const url = location.origin + location.pathname + encodeShare(doc);
    if (url.length > 8000) {
      saveProject();
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
        if (typeof text !== "string") return;
        project.set("/main.typ", { kind: "text", text });
        activePath = "/main.typ";
        applyingFile = true;
        editor.setDoc(text);
        applyingFile = false;
        saveProject();
        renderFiles();
        updateEditorTab();
        scheduleCompile();
      },
      e2e_project_files: () => [...project.keys()],
      e2e_read_file: path => {
        const entry = project.get(path);
        return entry ? (entry.kind === "text" ? entry.text : "<binary>") : null;
      },
      e2e_add_file: (path, text) => {
        project.set(path, { kind: "text", text });
        saveProject();
        renderFiles();
        scheduleCompile();
      },
      e2e_open_file: path => openFile(path),
      e2e_active_file: () => activePath,
      e2e_source_contains: textId => {
        const needle = compat.typstTexts.get(Number(textId));
        return typeof needle === "string" && editor.getDoc().includes(needle) ? 1 : 0;
      },
      e2e_turn_page: delta => turnPage(delta),
      e2e_doc: () => editor.getDoc(),
      e2e_cursor_pos: () => editor.cursorPos(),
      e2e_cursor_line: () => editor.cursorLine(),
    },
  };
  compat.editor = editor;
  compat.plugins = () => getPlugins().map(plugin => plugin.id);
  await setupPlugins();
  compat.ready = true;
  renderFiles();
  updateEditorTab();
  setStatusUI();
  bootStep("首次编译…");
  scheduleCompile();
  return { state, editor, bridge, compat };
}
