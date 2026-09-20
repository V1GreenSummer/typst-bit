import { createEditor as createCmbEditor } from "./vendor/codemoonbit/browser.js";

const WASM_URL = new URL("./vendor/codemoonbit/codemoonbit.wasm", import.meta.url).href;
const CSS_URL = new URL("./vendor/codemoonbit/codemoonbit.css", import.meta.url).href;

function ensureStyles() {
  if (document.querySelector("link[data-codemoonbit]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_URL;
  link.dataset.codemoonbit = "1";
  document.head.append(link);
}

function workbenchTheme() {
  return document.body?.dataset?.theme === "dark" ? "dark" : "light";
}

export async function createEditor(parent, options = {}) {
  ensureStyles();
  const {
    doc = "",
    onChange = () => {},
    onRun = () => {},
    onCommand = () => {},
    onSelectionChange = () => {},
  } = options;

  const handle = await createCmbEditor(parent, {
    doc,
    wasmUrl: WASM_URL,
    lineNumbers: true,
    tabSize: 2,
    language: "typst",
    theme: workbenchTheme(),
  });

  let applying = false;
  let lastSelection = "";

  const themeObserver = new MutationObserver(() => {
    handle.setOption("theme", workbenchTheme());
  });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });

  const selection = () => {
    let raw = null;
    try {
      raw = handle.getSelection();
    } catch {
      raw = null;
    }
    const range = raw?.ranges?.[raw.main ?? 0] ?? raw?.ranges?.[0];
    if (!range) return { from: 0, to: 0 };
    return { from: Math.min(range.anchor, range.head), to: Math.max(range.anchor, range.head) };
  };

  handle.onUpdate(() => {
    if (applying) return;
    const sel = selection();
    const key = `${sel.from}:${sel.to}`;
    if (key !== lastSelection) {
      lastSelection = key;
      onSelectionChange(sel);
    }
    onChange(handle.getDoc());
  });

  const lineStarts = () => {
    const text = handle.getDoc();
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) starts.push(i + 1);
    }
    return starts;
  };

  const replaceDoc = (text, from, to) => {
    applying = true;
    handle.setDoc(text);
    handle.setSelection(from, to);
    applying = false;
    handle.focus();
  };

  const facade = {
    getDoc: () => handle.getDoc(),
    setDoc: text => {
      applying = true;
      handle.setDoc(text);
      applying = false;
    },
    getSelection: selection,
    setSelection: (from, to = from) => handle.setSelection(from, to),
    cursorPos: () => selection().to,
    cursorLine: () => {
      const pos = facade.cursorPos();
      const text = handle.getDoc().slice(0, pos);
      return text.split("\n").length;
    },
    setCursorToLine: (line, column = 1) => {
      const starts = lineStarts();
      const index = Math.min(Math.max(line, 1), starts.length);
      const doc = handle.getDoc();
      const lineEnd = doc.indexOf("\n", starts[index - 1]);
      const length = (lineEnd === -1 ? doc.length : lineEnd) - starts[index - 1];
      const pos = starts[index - 1] + Math.min(Math.max(column - 1, 0), length);
      handle.setSelection(pos, pos);
      handle.focus();
    },
    wrapSelection(before, after = before) {
      const { from, to } = selection();
      const doc = handle.getDoc();
      const text = doc.slice(from, to);
      const insert = text ? before + text + after : before + after;
      replaceDoc(
        doc.slice(0, from) + insert + doc.slice(to),
        from + before.length,
        from + before.length + text.length,
      );
    },
    prefixLines(prefix) {
      const { from, to } = selection();
      const doc = handle.getDoc();
      const list = doc.split("\n");
      const startLine = doc.slice(0, from).split("\n").length;
      const endLine = doc.slice(0, to).split("\n").length;
      for (let n = startLine; n <= endLine; n++) {
        const line = list[n - 1] ?? "";
        list[n - 1] = line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line;
      }
      const next = list.join("\n");
      const delta = next.length - doc.length;
      replaceDoc(next, from, Math.max(from, to + delta));
    },
    insertBlock(text, cursorOffset = null) {
      const { from, to } = selection();
      const doc = handle.getDoc();
      const prefix = from === to ? "" : "\n";
      const insert = prefix + text + "\n";
      const caret = cursorOffset === null ? from + insert.length : from + prefix.length + cursorOffset;
      replaceDoc(doc.slice(0, from) + insert + doc.slice(to), caret, caret);
    },
    clearMarks() {
      const { from, to } = selection();
      const doc = handle.getDoc();
      if (from !== to) {
        for (const [open, close] of [["#underline[", "]"], ["*", "*"], ["_", "_"]]) {
          const before = doc.slice(Math.max(0, from - open.length), from);
          const after = doc.slice(to, to + close.length);
          if (before === open && after === close) {
            const next = doc.slice(0, from - open.length) + doc.slice(from, to) + doc.slice(to + close.length);
            replaceDoc(next, from - open.length, to - open.length);
            return;
          }
        }
      }
      const list = doc.split("\n");
      const startLine = doc.slice(0, from).split("\n").length;
      const endLine = doc.slice(0, to).split("\n").length;
      for (let n = startLine; n <= endLine; n++) {
        list[n - 1] = (list[n - 1] ?? "")
          .replace(/^={1,6}\s+/, "")
          .replace(/^([-+]|\d+\.)\s+/, "");
      }
      const next = list.join("\n");
      if (next !== doc) {
        const caret = Math.min(from, next.length);
        replaceDoc(next, caret, caret);
      }
    },
    setDiagnostics(list = []) {
      try {
        handle.setDiagnostics(JSON.stringify(list));
      } catch {
        /* diagnostics are best-effort */
      }
    },
    openSearch: () => handle.openSearch(),
    focus: () => handle.focus(),
    undo: () => handle.undo(),
    redo: () => handle.redo(),
    destroy: () => {
      themeObserver.disconnect();
      handle.destroy();
    },
  };

  const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "`": "`" };
  const CLOSERS = [")", "]", "}", '"', "`"];
  let composing = false;
  parent.addEventListener("compositionstart", () => {
    composing = true;
  }, true);
  parent.addEventListener("compositionend", () => {
    composing = false;
  }, true);

  parent.addEventListener("keydown", event => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod) {
      const key = event.key.toLowerCase();
      if (key === "enter") {
        event.preventDefault();
        onRun();
      } else if (key === "b") {
        event.preventDefault();
        onCommand("bold");
      } else if (key === "i") {
        event.preventDefault();
        onCommand("italic");
      } else if (key === "u") {
        event.preventDefault();
        onCommand("underline");
      }
      return;
    }
    if (event.altKey || event.isComposing || composing || event.key.length !== 1) return;
    const closer = PAIRS[event.key];
    if (closer) {
      event.preventDefault();
      event.stopPropagation();
      const { from, to } = selection();
      const doc = handle.getDoc();
      const selected = doc.slice(from, to);
      if (selected) {
        replaceDoc(
          doc.slice(0, from) + event.key + selected + closer + doc.slice(to),
          from + 1,
          to + 1,
        );
      } else {
        replaceDoc(doc.slice(0, from) + event.key + closer + doc.slice(to), from + 1, from + 1);
      }
      return;
    }
    if (CLOSERS.includes(event.key)) {
      const { from, to } = selection();
      if (from !== to) return;
      const doc = handle.getDoc();
      if (doc[from] !== event.key) return;
      event.preventDefault();
      event.stopPropagation();
      handle.setSelection(from + 1, from + 1);
      handle.focus();
    }
  }, true);

  onChange(handle.getDoc());
  return facade;
}
