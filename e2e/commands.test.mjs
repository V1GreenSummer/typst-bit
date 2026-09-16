// Command-layer regression: catalog integrity, filtering, active state,
// command dispatch and session transitions, without a browser.
import {
  COMMANDS,
  MENUS,
  FORMAT_BUTTONS,
  TOPBAR_ACTIONS,
  filterCommands,
  commandActive,
  getCommand,
  runCommand,
} from "../app/typstbit/web_wasm/commands.js";
import { createSession, STATUS } from "../app/typstbit/web_wasm/session.js";

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures.push(name);
};

const ids = COMMANDS.map(command => command.id);
check("command ids are unique", new Set(ids).size === ids.length, `${ids.length} commands`);
check(
  "every command has label, category and run",
  COMMANDS.every(command => command.label && command.category && typeof command.run === "function"),
);
const referenced = [
  ...MENUS.flatMap(menu => menu.items.map(item => item.id)),
  ...FORMAT_BUTTONS.map(item => item.id),
  ...TOPBAR_ACTIONS.map(item => item.id),
];
check("all UI entries reference known commands", referenced.every(id => getCommand(id) !== null), `${referenced.length} entries`);
const shortcuts = COMMANDS.map(command => command.shortcut).filter(Boolean);
check("shortcuts are unique", new Set(shortcuts).size === shortcuts.length, shortcuts.join(", "));
check("format bar keeps canonical labels", FORMAT_BUTTONS.some(item => item.label === "加粗") && FORMAT_BUTTONS.some(item => item.label === "⌕ 搜索"));
check("menus keep canonical labels", MENUS.some(menu => menu.items.some(item => item.label === "恢复示例")) && MENUS.some(menu => menu.items.some(item => item.label === "查找替换 ⌘F")));

function makeEditor(doc, from = 0, to = from) {
  const state = { doc, from, to };
  return {
    getDoc: () => state.doc,
    getSelection: () => ({ from: state.from, to: state.to }),
    setSelection: (from, to) => { state.from = from; state.to = to; },
    wrapSelection(before, after = before) {
      const text = state.doc.slice(state.from, state.to);
      state.doc = state.doc.slice(0, state.from) + before + text + after + state.doc.slice(state.to);
      state.from += before.length;
      state.to = state.from + text.length;
    },
    prefixLines(prefix) {
      const start = state.doc.lastIndexOf("\n", state.from - 1) + 1;
      state.doc = state.doc.slice(0, start) + prefix + state.doc.slice(start);
    },
    insertBlock(text) { state.doc += text; },
    openSearch() {},
    clearMarks() {},
  };
}

const calls = [];
const makeCtx = editor => ({
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
});

check("filter by label", filterCommands("加粗").some(command => command.id === "bold"));
check("filter by id", filterCommands("bold").some(command => command.id === "bold"));
check("filter by category", filterCommands("格式").length >= FORMAT_BUTTONS.length - 1);
check("empty filter returns all", filterCommands("").length === COMMANDS.length);
check("no match returns empty", filterCommands("zzz-unknown").length === 0);

const boldCtx = makeCtx(makeEditor("*hi*", 1, 3));
check("bold active inside markers", commandActive("bold", boldCtx) === true);
boldCtx.editor.setSelection(0, 4);
check("bold inactive outside markers", commandActive("bold", boldCtx) === false);
const headingCtx = makeCtx(makeEditor("= title", 2, 2));
check("heading active on prefixed line", commandActive("heading", headingCtx) === true);
check("unknown command is inert", runCommand("nope", headingCtx) === false);

const wrapCtx = makeCtx(makeEditor("hello", 0, 5));
check("bold dispatch wraps selection", runCommand("bold", wrapCtx) === true && wrapCtx.editor.getDoc() === "*hello*", wrapCtx.editor.getDoc());
check("bold active after wrap", commandActive("bold", wrapCtx) === true);
const actionCtx = makeCtx(makeEditor(""));
runCommand("compile-now", actionCtx);
runCommand("reset-example", actionCtx);
check("dispatch routes through actions", calls.includes("compile") && calls.includes("reset"));

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
process.exit(failures.length === 0 ? 0 : 1);
