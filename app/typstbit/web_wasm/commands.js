export const HELP_TEXT = "⌘Enter 编译 · ⌘F 搜索 · 括号/引号自动闭合 · Tab 缩进";

function wrapActive(before, after) {
  return ctx => {
    const { from, to } = ctx.editor.getSelection();
    if (from === to) return false;
    const doc = ctx.editor.getDoc();
    return doc.slice(Math.max(0, from - before.length), from) === before &&
      doc.slice(to, to + after.length) === after;
  };
}

function lineActive(prefix) {
  return ctx => {
    const { from } = ctx.editor.getSelection();
    const doc = ctx.editor.getDoc();
    const lineStart = doc.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
    return doc.startsWith(prefix, lineStart);
  };
}

const hasSelection = ctx => {
  const { from, to } = ctx.editor.getSelection();
  return from !== to;
};

const lineHasBlockMarker = ctx => {
  const { from } = ctx.editor.getSelection();
  const doc = ctx.editor.getDoc();
  const lineStart = doc.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const lineEnd = doc.indexOf("\n", lineStart);
  const line = doc.slice(lineStart, lineEnd === -1 ? doc.length : lineEnd);
  return /^={1,6}\s+/.test(line) || /^([-+]|\d+\.)\s+/.test(line);
};

export const COMMANDS = [
  { id: "reset-example", label: "恢复示例", category: "文件", run: ctx => ctx.actions.resetExample() },
  { id: "export-pdf", label: "导出 PDF", category: "文件", run: ctx => ctx.actions.exportPdf() },
  { id: "share", label: "分享", category: "文件", run: ctx => ctx.actions.shareDoc() },
  { id: "open-search", label: "查找替换", category: "编辑", shortcut: "Mod-f", run: ctx => ctx.editor.openSearch() },
  { id: "undo", label: "撤销", category: "编辑", shortcut: "Mod-z", run: ctx => ctx.editor.undo() },
  { id: "redo", label: "重做", category: "编辑", shortcut: "Mod-Shift-z", run: ctx => ctx.editor.redo() },
  { id: "open-pdf-tab", label: "新标签页打开 PDF", category: "视图", run: ctx => ctx.actions.openPdfTab() },
  { id: "command-palette", label: "命令面板", category: "视图", shortcut: "Mod-k", run: ctx => ctx.ui.openPalette() },
  { id: "shortcuts", label: "快捷键", category: "帮助", run: ctx => ctx.ui.toast(HELP_TEXT) },
  { id: "clear-marks", label: "清除标记", category: "格式", run: ctx => ctx.editor.clearMarks(), enabled: ctx => hasSelection(ctx) || lineHasBlockMarker(ctx) },
  { id: "bold", label: "加粗", category: "格式", shortcut: "Mod-b", run: ctx => ctx.editor.wrapSelection("*"), active: wrapActive("*", "*"), enabled: hasSelection },
  { id: "italic", label: "斜体", category: "格式", shortcut: "Mod-i", run: ctx => ctx.editor.wrapSelection("_"), active: wrapActive("_", "_"), enabled: hasSelection },
  { id: "underline", label: "下划线", category: "格式", shortcut: "Mod-u", run: ctx => ctx.editor.wrapSelection("#underline[", "]"), active: wrapActive("#underline[", "]"), enabled: hasSelection },
  { id: "heading", label: "标题", category: "格式", run: ctx => ctx.editor.prefixLines("= "), active: lineActive("= ") },
  { id: "list", label: "列表", category: "格式", run: ctx => ctx.editor.prefixLines("- "), active: lineActive("- ") },
  { id: "math", label: "数学", category: "格式", run: ctx => ctx.editor.insertBlock("$ x + y = z $") },
  { id: "codeblock", label: "代码块", category: "格式", run: ctx => ctx.editor.insertBlock("```typ\n\n```") },
  { id: "quote", label: "引用", category: "格式", run: ctx => ctx.editor.insertBlock("#quote[\n\n]") },
  { id: "compile-now", label: "立即编译", category: "编译", shortcut: "Mod-Enter", run: ctx => ctx.actions.compileNow() },
];

export const MENUS = [
  {
    label: "File",
    items: [
      { id: "reset-example", label: "恢复示例" },
      { id: "export-pdf", label: "导出 PDF" },
      { id: "share", label: "复制分享链接" },
    ],
  },
  {
    label: "Edit",
    items: [
      { id: "open-search", label: "查找替换 ⌘F" },
      { id: "undo", label: "撤销 ⌘Z" },
      { id: "redo", label: "重做 ⇧⌘Z" },
    ],
  },
  {
    label: "View",
    items: [
      { id: "open-pdf-tab", label: "新标签页打开 PDF" },
      { id: "export-pdf", label: "下载 PDF" },
      { id: "reset-example", label: "重置示例" },
    ],
  },
  {
    label: "Help",
    items: [
      { id: "shortcuts", label: "快捷键" },
    ],
  },
];

export const FORMAT_BUTTONS = [
  { id: "clear-marks", label: "清除标记" },
  { id: "bold", label: "加粗" },
  { id: "italic", label: "斜体" },
  { id: "underline", label: "下划线" },
  { id: "heading", label: "标题" },
  { id: "list", label: "列表" },
  { id: "math", label: "数学" },
  { id: "codeblock", label: "代码块" },
  { id: "quote", label: "引用" },
  { id: "open-search", label: "⌕ 搜索" },
];

export const TOPBAR_ACTIONS = [
  { id: "share", label: "分享" },
  { id: "export-pdf", label: "导出 PDF" },
  { id: "compile-now", label: "立即编译", variant: "primary" },
];

export function getCommand(id) {
  return COMMANDS.find(command => command.id === id) ?? null;
}

export function filterCommands(query = "") {
  const needle = query.trim().toLowerCase();
  return COMMANDS.filter(command =>
    !needle ||
    command.label.toLowerCase().includes(needle) ||
    command.id.includes(needle) ||
    command.category.toLowerCase().includes(needle));
}

export function commandActive(id, ctx) {
  const command = getCommand(id);
  if (!command || !command.active) return false;
  try {
    return Boolean(command.active(ctx));
  } catch {
    return false;
  }
}

export function commandEnabled(id, ctx) {
  const command = getCommand(id);
  if (!command || !command.enabled) return true;
  try {
    return Boolean(command.enabled(ctx));
  } catch {
    return true;
  }
}

export function runCommand(id, ctx) {
  if (!commandEnabled(id, ctx)) return false;
  const command = getCommand(id);
  if (!command) return false;
  command.run(ctx);
  return true;
}
