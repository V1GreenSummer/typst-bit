import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo as cmUndo, redo as cmRedo } from "@codemirror/commands";
import { openSearchPanel, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle, indentOnInput } from "@codemirror/language";
import { autocompletion, closeBrackets, completionKeymap, closeBracketsKeymap } from "@codemirror/autocomplete";
import { setDiagnostics as cmSetDiagnostics, lintGutter, lintKeymap } from "@codemirror/lint";

function typstToken(stream, state) {
  if (state.blockDepth > 0) {
    while (!stream.eol()) {
      if (stream.match("*/", false)) { stream.next(); stream.next(); state.blockDepth--; }
      else if (stream.match("/*", false)) { stream.next(); stream.next(); state.blockDepth++; }
      else stream.next();
    }
    return "comment";
  }
  if (state.inString) {
    while (!stream.eol()) {
      const ch = stream.next();
      if (ch === "\\") { stream.next(); continue; }
      if (ch === '"') { state.inString = false; break; }
    }
    return "string";
  }
  if (state.inRaw) {
    while (!stream.eol()) { if (stream.next() === "`") { state.inRaw = false; break; } }
    return "monospace";
  }
  if (state.inMath) {
    while (!stream.eol()) { if (stream.next() === "$") { state.inMath = false; break; } }
    return "atom";
  }
  if (state.inStrong) {
    if (stream.eat("*")) { state.inStrong = false; return "strong"; }
    if (stream.eatWhile(/[^\s*]+/)) return "strong";
    state.inStrong = false;
    return null;
  }
  if (state.inEm) {
    if (stream.eat("_")) { state.inEm = false; return "emphasis"; }
    if (stream.eatWhile(/[^\s_]+/)) return "emphasis";
    state.inEm = false;
    return null;
  }
  if (stream.eatSpace()) return null;
  if (stream.sol()) {
    if (stream.match(/^={1,6}\s/)) { stream.skipToEnd(); return "heading"; }
    if (stream.match(/^[-+]\s/)) return "list";
    if (stream.match(/^\d+\.\s/)) return "list";
  }
  if (stream.match("//", false)) { stream.skipToEnd(); return "comment"; }
  if (stream.match("/*")) { state.blockDepth = 1; return "comment"; }
  if (stream.match(/<[^>\s]+>/)) return "label";
  if (stream.match(/@[A-Za-z][\w.-]*/)) return "link";
  if (stream.eat("#")) { stream.eatWhile(/[\w.-]/); return "keyword"; }
  if (stream.eat("$")) { state.inMath = true; return "atom"; }
  if (stream.eat('"')) { state.inString = true; return "string"; }
  if (stream.eat("`")) { state.inRaw = true; return "monospace"; }
  if (stream.eat("*")) { state.inStrong = true; return "strong"; }
  if (stream.eat("_")) { state.inEm = true; return "emphasis"; }
  if (stream.eatWhile(/[A-Za-z_][\w.-]*/)) {
    const word = stream.current();
    if (/^(let|set|show|rule|import|include|context|if|else|for|while|return|none|auto|true|false)$/.test(word)) return "keyword";
    return null;
  }
  if (stream.match(/\d+(\.\d+)?(pt|em|fr|%)?/)) return "number";
  stream.next();
  return null;
}

const typstStream = StreamLanguage.define({
  name: "typst",
  startState() {
    return { blockDepth: 0, inString: false, inMath: false, inStrong: false, inEm: false, inRaw: false };
  },
  token(stream, state) {
    const start = stream.pos;
    const style = typstToken(stream, state);
    // A token function that returns a style without consuming input makes
    // CodeMirror abort the view update and freeze the editor.
    if (style && stream.pos === start) return null;
    return style;
  },
});

const editorTheme = EditorView.baseTheme({
  ".tok-heading": { color: "#1d4ed8", fontWeight: "700" },
  ".tok-keyword": { color: "#c026d3" },
  ".tok-comment": { color: "#8a919e", fontStyle: "italic" },
  ".tok-string": { color: "#15803d" },
  ".tok-strong": { fontWeight: "700" },
  ".tok-emphasis": { fontStyle: "italic" },
  ".tok-monospace": { color: "#b45309" },
  ".tok-atom": { color: "#7c3aed" },
  ".tok-list": { color: "#0f766e", fontWeight: "600" },
  ".tok-link": { color: "#0369a1", textDecoration: "underline" },
  ".tok-label": { color: "#b45309" },
  ".tok-number": { color: "#b45309" },
});

export function createEditor(parent, { doc = "", onChange = () => {}, onRun = () => {}, onCommand = () => {}, onSelectionChange = () => {} } = {}) {
  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(),
      drawSelection(), dropCursor(), rectangularSelection(), crosshairCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorView.lineWrapping,
      typstStream,
      editorTheme,
      closeBrackets(),
      autocompletion(),
      lintGutter(),
      keymap.of([
        { key: "Mod-Enter", run: () => { onRun(); return true; } },
        { key: "Mod-b", run: () => { onCommand("bold"); return true; } },
        { key: "Mod-i", run: () => { onCommand("italic"); return true; } },
        { key: "Mod-u", run: () => { onCommand("underline"); return true; } },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) onChange(update.state.doc.toString());
        if (update.docChanged || update.selectionSet) onSelectionChange(update.state.selection.main);
      }),
    ],
  });
  const view = new EditorView({ state, parent });

  function wrapSelection(before, after = before) {
    const { state } = view;
    const changes = state.changeByRange(range => {
      const text = state.sliceDoc(range.from, range.to);
      if (!text && before === after && after === "") return { range };
      const insert = text ? before + text + after : before + after;
      const from = range.from + before.length;
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(from, from + (text ? text.length : 0)) };
    });
    view.dispatch(changes, { userEvent: "input.typst" });
    view.focus();
  }

  function prefixLines(prefix) {
    const { state } = view;
    const lineStart = state.doc.lineAt(state.selection.main.from).number;
    const lineEnd = state.doc.lineAt(state.selection.main.to).number;
    const changes = [];
    for (let n = lineStart; n <= lineEnd; n++) {
      const line = state.doc.line(n);
      const has = line.text.startsWith(prefix);
      changes.push(has
        ? { from: line.from, to: line.from + prefix.length, insert: "" }
        : { from: line.from, insert: prefix });
    }
    view.dispatch({ changes, userEvent: "input.typst" });
    view.focus();
  }

  function insertBlock(text) {
    const { state } = view;
    const range = state.selection.main;
    const insert = (range.empty ? "" : "\n") + text + "\n";
    view.dispatch(state.replaceSelection(insert), { userEvent: "input.typst", scrollIntoView: true });
    view.focus();
  }

  function clearMarks() {
    const { state } = view;
    const range = state.selection.main;
    if (!range.empty) {
      for (const [open, close] of [["#underline[", "]"], ["*", "*"], ["_", "_"]]) {
        const before = state.sliceDoc(Math.max(0, range.from - open.length), range.from);
        const after = state.sliceDoc(range.to, range.to + close.length);
        if (before === open && after === close) {
          view.dispatch({
            changes: [
              { from: range.from - open.length, to: range.from, insert: "" },
              { from: range.to, to: range.to + close.length, insert: "" },
            ],
            userEvent: "input.typst",
          });
          view.focus();
          return;
        }
      }
    }
    const lineStart = state.doc.lineAt(range.from).number;
    const lineEnd = state.doc.lineAt(range.to).number;
    const changes = [];
    for (let n = lineStart; n <= lineEnd; n++) {
      const line = state.doc.line(n);
      const stripped = line.text
        .replace(/^={1,6}\s+/, "")
        .replace(/^([-+]|\d+\.)\s+/, "");
      if (stripped !== line.text) changes.push({ from: line.from, to: line.to, insert: stripped });
    }
    if (changes.length) view.dispatch({ changes, userEvent: "input.typst" });
    view.focus();
  }

  function setDiagnostics(list) {
    const { state } = view;
    const total = state.doc.lines;
    const lints = list.map(d => {
      const lineNo = Math.min(Math.max(1, d.line ?? 1), total);
      const line = state.doc.line(lineNo);
      const col = Math.min(Math.max(0, (d.column ?? 1) - 1), line.length);
      const endLineNo = Math.min(Math.max(lineNo, d.endLine ?? lineNo), total);
      const endLine = state.doc.line(endLineNo);
      const endCol = Math.min(Math.max(col + 1, (d.endColumn ?? col + 2) - 1), endLine.length);
      const from = line.from + col;
      const to = endLine.from + Math.max(col + 1, endCol);
      return { from, to: Math.max(from + 1, Math.min(to, line.to)), severity: d.severity === "warning" ? "warning" : "error", message: d.message };
    });
    view.dispatch(cmSetDiagnostics(state, lints));
  }

  return {
    view,
    wrapSelection,
    prefixLines,
    insertBlock,
    clearMarks,
    undo: () => { cmUndo(view); view.focus(); },
    redo: () => { cmRedo(view); view.focus(); },
    setDiagnostics,
    openSearch: () => openSearchPanel(view),
    focus: () => view.focus(),
    getDoc: () => view.state.doc.toString(),
    getSelection: () => ({ from: view.state.selection.main.from, to: view.state.selection.main.to }),
    setDoc: text => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: "setValue" }),
  };
}
