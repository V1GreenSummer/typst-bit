// Command-layer regression: the core catalog/filter/enabled rules plus the
// host runners and session transitions, without a browser.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCore } from "../app/typstbit/web_wasm/core-adapter.js";
import { hasRunner, runCommand } from "../app/typstbit/web_wasm/commands.js";
import { createSession, STATUS } from "../app/typstbit/web_wasm/session.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = await loadCore(readFileSync(join(ROOT, "app/typstbit/web_wasm/core.wasm")));
const catalog = core.commands();

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures.push(name);
};

const ids = catalog.commands.map(command => command.id);
check("command ids are unique", new Set(ids).size === ids.length, `${ids.length} commands`);
check(
  "every command has label, category and a runner",
  catalog.commands.every(command => command.label && command.category) && ids.every(id => hasRunner(id)),
);
const referenced = [
  ...catalog.menus.flatMap(menu => menu.items.map(item => item.id)),
  ...catalog.formatButtons.map(item => item.id),
  ...catalog.topbar.map(item => item.id),
];
check("all UI entries reference known commands", referenced.every(id => ids.includes(id)), `${referenced.length} entries`);
const shortcuts = catalog.commands.map(command => command.shortcut).filter(Boolean);
check("shortcuts are unique", new Set(shortcuts).size === shortcuts.length, shortcuts.join(", "));
check(
  "format bar keeps canonical labels",
  catalog.formatButtons.some(item => item.label === "加粗") && catalog.formatButtons.some(item => item.label === "⌕ 搜索"),
);
check(
  "menus keep canonical labels",
  catalog.menus.some(menu => menu.items.some(item => item.label === "恢复示例")) &&
    catalog.menus.some(menu => menu.items.some(item => item.label === "查找替换 ⌘F")),
);

const enabledIds = (query, doc, from, to) => core.filterCommands(query, doc, from, to).map(row => row.id);
const stateOf = (query, doc, from, to) =>
  Object.fromEntries(core.filterCommands(query, doc, from, to).map(row => [row.id, row.active]));

check("filter by label", enabledIds("加粗", "hello", 0, 5).includes("bold"));
check("filter by id", enabledIds("bold", "hello", 0, 5).includes("bold"));
check("filter by category", enabledIds("格式", "", 0, 0).length === 5, `${enabledIds("格式", "", 0, 0).length}`);
check("empty filter returns enabled commands", enabledIds("", "", 0, 0).length === ids.length - 4, `${enabledIds("", "", 0, 0).length}/${ids.length}`);
check("no match returns empty", enabledIds("zzz-unknown", "", 0, 0).length === 0);
check("bold enabled with selection", enabledIds("加粗", "hello", 0, 2).includes("bold"));
check("bold disabled without selection", !enabledIds("加粗", "hello", 0, 0).includes("bold"));
check("clear marks disabled on a plain line", !enabledIds("清除", "plain", 0, 0).includes("clear-marks"));
check("clear marks enabled on a heading line", enabledIds("清除", "= title", 0, 0).includes("clear-marks"));
check("bold active inside markers", stateOf("加粗", "*hi*", 1, 3).bold === true);
check("bold inactive outside markers", stateOf("加粗", "*hi*", 0, 4).bold === false);
check("heading active on prefixed line", stateOf("标题", "= title", 2, 2).heading === true);
check("unknown command is inert", runCommand("nope", null) === false);

const calls = [];
const editor = {
  doc: "hello",
  from: 0,
  to: 5,
  getDoc() { return this.doc; },
  getSelection() { return { from: this.from, to: this.to }; },
  wrapSelection(before, after = before) {
    const text = this.doc.slice(this.from, this.to);
    this.doc = this.doc.slice(0, this.from) + before + text + after + this.doc.slice(this.to);
  },
  insertBlock(text) { this.doc += text; },
};
const ctx = {
  editor,
  session: createSession(),
  ui: { toast: message => calls.push(`toast:${message}`), openPalette: () => calls.push("palette") },
  actions: {
    resetExample: () => calls.push("reset"),
    exportPdf: () => calls.push("export"),
    shareDoc: () => calls.push("share"),
    openPdfTab: () => calls.push("open-pdf"),
    compileNow: () => calls.push("compile"),
    undo: () => calls.push("undo"),
    redo: () => calls.push("redo"),
  },
};
check("bold dispatch wraps selection", runCommand("bold", ctx) === true && editor.getDoc() === "*hello*", editor.getDoc());
runCommand("compile-now", ctx);
runCommand("reset-example", ctx);
check("dispatch routes through actions", calls.includes("compile") && calls.includes("reset"));
const quoteCtx = {
  ...ctx,
  editor: { ...editor, doc: "body", insertBlock(text) { this.doc += text; } },
};
runCommand("quote", quoteCtx);
check("quote inserts a #quote block", quoteCtx.editor.getDoc().includes("#quote["), quoteCtx.editor.getDoc());

const outline = core.outline("= A <one>\n\n== B\n\n```\n= NotHeading\n```\n\n=== C");
check(
  "outline strips labels and tracks levels",
  outline.map(entry => `${entry.level}:${entry.title}:${entry.line}`).join("|") === "1:A:1|2:B:3|3:C:9",
  JSON.stringify(outline),
);
check("outline ignores fenced code", !outline.some(entry => entry.title === "NotHeading"));
check("outline of plain text is empty", core.outline("just text").length === 0);

const session = createSession({ source: "hi" });
check("session defaults", session.getState().status === STATUS.IDLE && session.getState().revision === 0);
const seen = [];
const unsubscribe = session.subscribe(state => seen.push(state.revision));
session.update({ status: STATUS.COMPILING, revision: 1 });
session.update({ status: STATUS.SUCCESS, revision: 1, diagnostics: [] });
check("session notifies subscribers", seen.length === 2 && seen[1] === 1);
unsubscribe();
session.update({ revision: 2 });
check("unsubscribe stops notifications", seen.length === 2);
check("session state stays single-sourced", session.getState().revision === 2 && session.getState().source === "hi");

console.log(failures.length === 0 ? "COMMANDS: PASS" : `COMMANDS: FAIL (${failures.join(", ")})`);
process.exit(failures.length ? 1 : 0);
