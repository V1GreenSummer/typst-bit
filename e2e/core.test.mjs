// MoonBit application core (core.wasm) contract test.
//
// The JS catalog/outline/packages implementations were removed in P3;
// these golden fixtures were captured while they were still the oracle
// (and are unit-tested again in app/typstbit/app). Everything here runs
// in plain Node: core-adapter.js has no DOM dependencies.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCore } from "../app/typstbit/web_wasm/core-adapter.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = await loadCore(readFileSync(join(ROOT, "app/typstbit/web_wasm/core.wasm")));

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures.push(name);
};
const stable = value => JSON.stringify(value);
const equal = (a, b) => stable(a) === stable(b);

const EXPECTED_CATALOG = {
  "commands": [
    {
      "id": "reset-example",
      "label": "恢复示例",
      "category": "文件",
      "shortcut": null
    },
    {
      "id": "export-pdf",
      "label": "导出 PDF",
      "category": "文件",
      "shortcut": null
    },
    {
      "id": "share",
      "label": "分享",
      "category": "文件",
      "shortcut": null
    },
    {
      "id": "open-search",
      "label": "查找替换",
      "category": "编辑",
      "shortcut": "Mod-f"
    },
    {
      "id": "undo",
      "label": "撤销",
      "category": "编辑",
      "shortcut": "Mod-z"
    },
    {
      "id": "redo",
      "label": "重做",
      "category": "编辑",
      "shortcut": "Mod-Shift-z"
    },
    {
      "id": "open-pdf-tab",
      "label": "新标签页打开 PDF",
      "category": "视图",
      "shortcut": null
    },
    {
      "id": "command-palette",
      "label": "命令面板",
      "category": "视图",
      "shortcut": "Mod-k"
    },
    {
      "id": "shortcuts",
      "label": "快捷键",
      "category": "帮助",
      "shortcut": null
    },
    {
      "id": "clear-marks",
      "label": "清除标记",
      "category": "格式",
      "shortcut": null
    },
    {
      "id": "bold",
      "label": "加粗",
      "category": "格式",
      "shortcut": "Mod-b"
    },
    {
      "id": "italic",
      "label": "斜体",
      "category": "格式",
      "shortcut": "Mod-i"
    },
    {
      "id": "underline",
      "label": "下划线",
      "category": "格式",
      "shortcut": "Mod-u"
    },
    {
      "id": "heading",
      "label": "标题",
      "category": "格式",
      "shortcut": null
    },
    {
      "id": "list",
      "label": "列表",
      "category": "格式",
      "shortcut": null
    },
    {
      "id": "math",
      "label": "数学",
      "category": "格式",
      "shortcut": null
    },
    {
      "id": "codeblock",
      "label": "代码块",
      "category": "格式",
      "shortcut": null
    },
    {
      "id": "quote",
      "label": "引用",
      "category": "格式",
      "shortcut": null
    },
    {
      "id": "compile-now",
      "label": "立即编译",
      "category": "编译",
      "shortcut": "Mod-Enter"
    }
  ],
  "menus": [
    {
      "label": "File",
      "items": [
        {
          "id": "reset-example",
          "label": "恢复示例"
        },
        {
          "id": "export-pdf",
          "label": "导出 PDF"
        },
        {
          "id": "share",
          "label": "复制分享链接"
        }
      ]
    },
    {
      "label": "Edit",
      "items": [
        {
          "id": "open-search",
          "label": "查找替换 ⌘F"
        },
        {
          "id": "undo",
          "label": "撤销 ⌘Z"
        },
        {
          "id": "redo",
          "label": "重做 ⇧⌘Z"
        }
      ]
    },
    {
      "label": "View",
      "items": [
        {
          "id": "open-pdf-tab",
          "label": "新标签页打开 PDF"
        },
        {
          "id": "export-pdf",
          "label": "下载 PDF"
        },
        {
          "id": "reset-example",
          "label": "重置示例"
        }
      ]
    },
    {
      "label": "Help",
      "items": [
        {
          "id": "shortcuts",
          "label": "快捷键"
        }
      ]
    }
  ],
  "formatButtons": [
    {
      "id": "clear-marks",
      "label": "清除标记",
      "variant": null
    },
    {
      "id": "bold",
      "label": "加粗",
      "variant": null
    },
    {
      "id": "italic",
      "label": "斜体",
      "variant": null
    },
    {
      "id": "underline",
      "label": "下划线",
      "variant": null
    },
    {
      "id": "heading",
      "label": "标题",
      "variant": null
    },
    {
      "id": "list",
      "label": "列表",
      "variant": null
    },
    {
      "id": "math",
      "label": "数学",
      "variant": null
    },
    {
      "id": "codeblock",
      "label": "代码块",
      "variant": null
    },
    {
      "id": "quote",
      "label": "引用",
      "variant": null
    },
    {
      "id": "open-search",
      "label": "⌕ 搜索",
      "variant": null
    }
  ],
  "topbar": [
    {
      "id": "share",
      "label": "分享",
      "variant": null
    },
    {
      "id": "export-pdf",
      "label": "导出 PDF",
      "variant": null
    },
    {
      "id": "compile-now",
      "label": "立即编译",
      "variant": "primary"
    }
  ]
};

const catalog = core.commands();
check("command catalog matches the frozen JS catalog", equal(catalog.commands, EXPECTED_CATALOG.commands), stable(catalog.commands?.[0]));
check("menu structure matches", equal(catalog.menus, EXPECTED_CATALOG.menus));
check("format buttons match", equal(catalog.formatButtons, EXPECTED_CATALOG.formatButtons));
check("topbar actions match", equal(catalog.topbar, EXPECTED_CATALOG.topbar));

const filterCases = [
  { query: "", doc: "= A\n\nhello", from: 0, to: 0, expected: ["reset-example", "export-pdf", "share", "open-search", "undo", "redo", "open-pdf-tab", "command-palette", "shortcuts", "clear-marks", "heading", "list", "math", "codeblock", "quote", "compile-now"], active: { heading: true } },
  { query: "加粗", doc: "hello", from: 0, to: 5, expected: ["bold"], active: {} },
  { query: "加粗", doc: "hello", from: 0, to: 0, expected: [] },
  { query: "标题", doc: "= A", from: 0, to: 0, expected: ["heading"], active: { heading: true } },
  { query: "列表", doc: "plain", from: 0, to: 0, expected: ["list"], active: {} },
  { query: "格式", doc: "", from: 0, to: 0, expected: ["heading", "list", "math", "codeblock", "quote"], active: {} },
  { query: "undo", doc: "abc", from: 1, to: 2, expected: ["undo"], active: {} },
  { query: "不存在", doc: "abc", from: 0, to: 0, expected: [] },
];
for (const item of filterCases) {
  const rows = core.filterCommands(item.query, item.doc, item.from, item.to);
  check(`palette filter: ${item.query || "<all>"} @${item.from}-${item.to}`, equal(rows.map(row => row.id), item.expected), stable(rows.map(row => row.id)));
  const wantActive = item.active ?? {};
  const gotActive = {};
  for (const [id, active] of Object.entries(wantActive)) gotActive[id] = active;
  const actualActive = {};
  for (const row of rows) if (wantActive[row.id] !== undefined) actualActive[row.id] = row.active;
  check(`palette active: ${item.query || "<all>"} @${item.from}-${item.to}`, equal(actualActive, gotActive), stable(actualActive));
}

const outlineCases = [
  { source: "", expected: [] },
  { source: "= A\n\n== B <label>\n\n#lorem(3)", expected: [{ level: 1, title: "A", line: 1 }, { level: 2, title: "B", line: 3 }] },
  { source: "= A\n```\n= not a heading\n```\n== B", expected: [{ level: 1, title: "A", line: 1 }, { level: 2, title: "B", line: 5 }] },
  { source: "text\n= Title <intro>\n=== Deep\n", expected: [{ level: 1, title: "Title", line: 2 }, { level: 3, title: "Deep", line: 3 }] },
  { source: "= 中 文 <标签>\n", expected: [{ level: 1, title: "中 文", line: 1 }] },
];
for (const item of outlineCases) {
  check(`outline: ${stable(item.source).slice(0, 22)}`, equal(core.outline(item.source), item.expected), stable(core.outline(item.source)));
}

const sourceCases = [
  { source: "", expected: [] },
  { source: "plain text", expected: [] },
  { source: '#import "@preview/tiaoma:0.3.0": qrcode', expected: ["@preview/tiaoma:0.3.0"] },
  { source: "@preview/a:1.0.0 and @preview/a:1.0.0 and @preview/b:2.3.4", expected: ["@preview/a:1.0.0", "@preview/b:2.3.4"] },
  { source: "@preview/bad:1.2 and @A/b:1.0.0", expected: [] },
];
for (const item of sourceCases) {
  check(`package specs: ${item.source.slice(0, 28) || "<empty>"}`, equal(core.packageSpecs(item.source), item.expected), stable(core.packageSpecs(item.source)));
}

const diagJson = JSON.stringify({
  diagnostics: [
    { severity: "error", message: "expected expression", file: "/main.typ", start: { line: 2, column: 5 }, end: { line: 2, column: 6 }, hints: ["try a value", "check braces"] },
    { severity: "warning", message: "unused", file: "/lib.typ", start: { line: 3, column: 1 } },
    { severity: "error", message: "host boom" },
  ],
});
check(
  "diagnostics mapping matches the workbench contract",
  equal(core.mapDiagnostics(diagJson, "/main.typ"), [
    { severity: "error", message: "expected expression · try a value check braces", line: 2, column: 5, endLine: 2, endColumn: 6 },
    { severity: "error", message: "host boom", line: 1, column: 1, endLine: 1, endColumn: 2 },
  ]),
  stable(core.mapDiagnostics(diagJson, "/main.typ")),
);
check("diagnostics other file only", equal(core.mapDiagnostics(diagJson, "/lib.typ").map(d => d.severity), ["warning", "error"]));

check(
  "theme plan matches the plugin contract",
  equal(
    core.themePlan({ theme: "sepia", accent: "#315fce", editorFontSize: "15.5", previewBackground: "#eee", sidebarWidth: "240", compact: true }),
    {
      bodyTheme: "sepia",
      bodyClasses: [{ name: "compact", enabled: true }],
      variables: [
        { name: "--accent", value: "#315fce" },
        { name: "--preview-bg", value: "#eee" },
        { name: "--font-size-editor", value: "15.5px" },
        { name: "--sidebar-width", value: "240px" },
      ],
    },
  ),
);
check(
  "theme plan rejects invalid values",
  equal(core.themePlan({ theme: "neon", accent: "red", editorFontSize: "40", previewBackground: "x", sidebarWidth: "99", compact: false }), {
    bodyTheme: null,
    bodyClasses: [{ name: "compact", enabled: false }],
    variables: [],
  }),
);

const init = core.projectOp(null, { kind: "paths" }, "= Fallback");
let project = init.project;
const op = (kind, extra = {}) => {
  const next = core.projectOp(project, { kind, ...extra }, "= Fallback");
  project = next.project;
  return next.result;
};
check("project init", equal(project, { active: "/main.typ", files: [{ path: "/main.typ", kind: "text", text: "= Fallback" }], folders: [] }), stable(project));
check("project add file", op("add_file", { path: "/lib.typ", text: "#let x = 1" }) === "ok");
check("project duplicate rejected", op("add_file", { path: "/lib.typ", text: "" }) === "duplicate");
check("project invalid rejected", op("add_file", { path: "lib.typ", text: "" }) === "invalid");
check("project add binary", op("add_file", { path: "/images/a.png", text: "", fileKind: "binary" }) === "ok");
check("project add folder", op("add_folder", { path: "/images" }) === true);
check("project set text", op("set_text", { path: "/lib.typ", text: "#let y = 2" }) === true);
check("project set text missing", op("set_text", { path: "/nope.typ", text: "x" }) === false);
check("project set active", op("set_active", { path: "/lib.typ" }) === true);
check("project paths", equal(op("paths"), ["/images/a.png", "/lib.typ", "/main.typ"]), stable(op("paths")));
check("project remove", op("remove", { path: "/lib.typ" }) === true);
check("project active fallback", project.active === "/main.typ", project.active);

console.log(failures.length === 0 ? "CORE: PASS" : `CORE: FAIL (${failures.join(", ")})`);
process.exit(failures.length ? 1 : 0);
