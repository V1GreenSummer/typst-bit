import { createSession, STATUS } from "./session.js";
import { loadPackageManifest, packageSpecsInSource, registerPackage } from "./packages.js";
import { parseOutline } from "./outline.js";
import {
  definePlugin,
  getPlugins,
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
  sidebar.append(
    Object.assign(el("div", "panel-title"), { textContent: "PROJECT" }),
    Object.assign(el("div", "file active"), { textContent: "▣ main.typ" }),
    Object.assign(el("div", "file"), { textContent: "○ images" }),
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
  editorPane.append(
    (() => {
      const head = el("div", "pane-head");
      const tab = el("div", "tab", "main.typ");
      tab.style.paddingRight = "12px";
      head.append(tab, el("span", "dirty", "自动保存"), el("span", "grow"), el("span", "dirty", "Typst"));
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
    const doc = editor.view.state.doc;
    const target = Math.min(Math.max(line, 1), doc.lines);
    editor.view.dispatch({ selection: { anchor: doc.line(target).from }, scrollIntoView: true });
    editor.focus();
  }

  const exporters = new Map();
  const pluginMenuItems = [];
  let pluginMenuButton = null;

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

  function refreshPluginMenu() {
    if (pluginMenuButton) pluginMenuButton.remove();
    pluginMenuButton = menuButton("插件", [...pluginMenuItems]);
    menubar.insertBefore(pluginMenuButton, menubarGrow);
  }

  function registerExporter(exporter) {
    if (!exporter?.id || exporters.has(exporter.id)) return;
    exporters.set(exporter.id, exporter);
    const commandId = `plugin.export.${exporter.id}`;
    registerCommands([{
      id: commandId,
      label: `导出 ${exporter.label}`,
      category: "插件",
      run: () => runExporter(exporter.id),
    }]);
    pluginMenuItems.push({ id: commandId });
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
  }

  settingsSave.onclick = () => {
    saveSettings();
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
    plugin.setup(createPluginHost({
      plugin,
      registerCommands,
      addMenu,
      registerExporter,
      openSettings,
      toast,
      editor,
      session,
      typst: typstApi,
    }));
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
    pluginMenuItems.push({ id: "plugin.settings" });
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
    });
    for (const item of items) {
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

  function startCompile(source) {
    if (sourceNeedsPackages(source)) {
      session.update({ status: STATUS.COMPILING, compilingCount: state.compilingCount + 1 });
      setStatusUI();
      ensurePackages(source)
        .then(() => startCompile(editor.getDoc()))
        .catch(error => {
          session.update({ status: STATUS.FAILED, diagnostics: [{ severity: "error", message: `包加载失败: ${error}` }] });
          syncEditorDiagnostics();
          setStatusUI();
        });
      return;
    }
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
    const opened = window.open(state.previewUrl, "_blank");
    if (!opened) toast("浏览器拦截了新标签页，请允许弹出窗口或使用「导出 PDF」");
  }

  function resetExample() {
    editor.setDoc(DEFAULT_SOURCE);
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
      e2e_cursor_pos: () => editor.view.state.selection.main.head,
      e2e_cursor_line: () => editor.view.state.doc.lineAt(editor.view.state.selection.main.head).number,
    },
  };
  compat.plugins = () => getPlugins().map(plugin => plugin.id);
  await setupPlugins();
  compat.ready = true;
  setStatusUI();
  scheduleCompile(editor.getDoc());
  return { state, editor, bridge, compat };
}
