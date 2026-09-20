// Host-side command execution and plugin registration.
//
// Command metadata (catalog, menus, buttons, palette filtering, active and
// enabled rules) lives in the MoonBit application core (core.wasm). This
// module only owns the side effects: a runner per default command id plus
// plugin commands registered at runtime.

export const HELP_TEXT = "⌘Enter 编译 · ⌘F 搜索 · 括号/引号自动闭合 · Tab 缩进";

const RUNNERS = new Map([
  ["reset-example", ctx => ctx.actions.resetExample()],
  ["export-pdf", ctx => ctx.actions.exportPdf()],
  ["share", ctx => ctx.actions.shareDoc()],
  ["open-search", ctx => ctx.editor.openSearch()],
  ["undo", ctx => ctx.editor.undo()],
  ["redo", ctx => ctx.editor.redo()],
  ["open-pdf-tab", ctx => ctx.actions.openPdfTab()],
  ["command-palette", ctx => ctx.ui.openPalette()],
  ["shortcuts", ctx => ctx.ui.toast(HELP_TEXT)],
  ["clear-marks", ctx => ctx.editor.clearMarks()],
  ["bold", ctx => ctx.editor.wrapSelection("*")],
  ["italic", ctx => ctx.editor.wrapSelection("_")],
  ["underline", ctx => ctx.editor.wrapSelection("#underline[", "]")],
  ["heading", ctx => ctx.editor.prefixLines("= ")],
  ["list", ctx => ctx.editor.prefixLines("- ")],
  ["math", ctx => ctx.editor.insertBlock("$ x + y = z $", 2)],
  ["codeblock", ctx => ctx.editor.insertBlock("```typ\n\n```", 7)],
  ["quote", ctx => ctx.editor.insertBlock("#quote[\n\n]", 8)],
  ["compile-now", ctx => ctx.actions.compileNow()],
]);

const pluginCommands = [];

export function registerCommands(commands) {
  for (const command of commands ?? []) {
    if (!command || typeof command.id !== "string" || typeof command.run !== "function") continue;
    if (RUNNERS.has(command.id) || pluginCommands.some(item => item.id === command.id)) continue;
    pluginCommands.push(command);
  }
}

export function hasRunner(id) {
  return RUNNERS.has(id) || pluginCommands.some(item => item.id === id);
}

export function pluginCommandsList() {
  return pluginCommands;
}

export function runCommand(id, ctx) {
  const runner = RUNNERS.get(id) ?? pluginCommands.find(item => item.id === id)?.run;
  if (!runner) return false;
  runner(ctx);
  return true;
}

export function pluginCommandEnabled(id, ctx) {
  const command = pluginCommands.find(item => item.id === id);
  if (!command?.enabled) return true;
  try {
    return Boolean(command.enabled(ctx));
  } catch {
    return true;
  }
}
