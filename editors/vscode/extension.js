"use strict";
const path = require("node:path");
const fs = require("node:fs");
const vscode = require("vscode");
const { TypstAbi } = require("./wasm-bridge");
const { mapDiagnostics } = require("./diagnostics");

let abiPromise = null;
let panel = null;
let debounce = null;
let currentPage = 0;
let diagnosticsCollection = null;

function abiPath(context) {
  const configured = vscode.workspace.getConfiguration("typstbit").get("abiPath");
  if (configured) return configured;
  return path.join(context.extensionPath, "assets", "typst_abi.opt.wasm");
}

function packagesRoot(context) {
  const configured = vscode.workspace.getConfiguration("typstbit").get("packagesPath");
  if (configured) return configured;
  return path.join(context.extensionPath, "assets", "packages");
}

function getAbi(context) {
  if (!abiPromise) {
    abiPromise = TypstAbi.load(abiPath(context)).then(abi => {
      abi.registerPackages(packagesRoot(context));
      return abi;
    });
  }
  return abiPromise;
}

function isTypst(document) {
  return document.fileName.endsWith(".typ");
}

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

function toVfsPath(root, fileName) {
  if (!root) return null;
  if (fileName === root) return "/";
  if (!fileName.startsWith(root + path.sep)) return null;
  return "/" + path.relative(root, fileName).split(path.sep).join("/");
}

function activeSource() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTypst(editor.document)) return null;
  return { text: editor.document.getText(), name: editor.document.fileName };
}

/**
 * Pushes the workspace files and every open Typst document into the ABI VFS.
 * Open (possibly unsaved) documents win over their on-disk copies. Returns the
 * VFS path used as the main file and a VFS-to-URI map for diagnostics.
 */
async function syncWorkspace(abi, mainDocument = null) {
  const root = workspaceRoot();
  const vfsToUri = new Map();
  const put = async (vfsPath, uri, bytes) => {
    if (abi.setFile(vfsPath, bytes) !== 0) return;
    vfsToUri.set(vfsPath, uri.toString());
  };

  if (root) {
    let files = [];
    try {
      files = await vscode.workspace.findFiles(
        "**/*.{typ,svg,png,jpg,jpeg,bib,toml}",
        "**/node_modules/**",
        500,
      );
    } catch {
      files = [];
    }
    for (const uri of files) {
      const vfsPath = toVfsPath(root, uri.fsPath);
      if (!vfsPath) continue;
      try {
        await put(vfsPath, uri, await vscode.workspace.fs.readFile(uri));
      } catch {
        /* unreadable file: skip */
      }
    }
  }

  const mainVfs = mainDocument ? toVfsPath(root, mainDocument.fileName) : null;
  for (const document of vscode.workspace.textDocuments) {
    if (!isTypst(document)) continue;
    const vfsPath = toVfsPath(root, document.fileName) ?? (document === mainDocument ? "/main.typ" : null);
    if (!vfsPath) continue;
    await put(vfsPath, document.uri, Buffer.from(document.getText(), "utf8"));
  }
  if (mainDocument && !mainVfs) {
    await put("/main.typ", mainDocument.uri, Buffer.from(mainDocument.getText(), "utf8"));
  }
  abi.setMain(mainVfs ?? "/main.typ");
  return { vfsToUri, mainVfs: mainVfs ?? "/main.typ" };
}

function publishDiagnostics(diagnostics, vfsToUri, fallbackUri) {
  if (!diagnosticsCollection) return;
  const grouped = mapDiagnostics(diagnostics, vfsToUri, fallbackUri?.toString() ?? null);
  diagnosticsCollection.clear();
  for (const [key, items] of grouped) {
    const uri = vscode.Uri.parse(key);
    diagnosticsCollection.set(uri, items.map(item => {
      const range = new vscode.Range(item.line, item.column, item.endLine, item.endColumn);
      const severity = item.severity === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
      const diagnostic = new vscode.Diagnostic(range, item.message, severity);
      diagnostic.source = "typstbit";
      return diagnostic;
    }));
  }
}

async function render(context, abi) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTypst(editor.document)) return null;
  const { vfsToUri } = await syncWorkspace(abi, editor.document);
  const status = abi.compile();
  const pages = abi.pageCount();
  const diagnostics = abi.diagnostics();
  publishDiagnostics(diagnostics, vfsToUri, editor.document.uri);
  const png = status === 0 ? abi.renderPagePng(Math.min(currentPage, Math.max(0, pages - 1)), 1.5) : null;
  return { status, pages, diagnostics, png };
}

async function refresh(context) {
  if (!panel) return;
  try {
    const abi = await getAbi(context);
    const result = await render(context, abi);
    if (!result) {
      panel.webview.html = pageHtml("<p>请在 .typ 文件中使用该命令。</p>", 0, 0, []);
      return;
    }
    const errors = result.diagnostics.filter(d => d.severity === "error");
    const body = result.png
      ? `<img src="data:image/png;base64,${Buffer.from(result.png).toString("base64")}" />`
      : `<p>编译失败（状态码 ${result.status}）。</p>`;
    const diag = result.diagnostics.slice(0, 8).map(d => `<li>[${d.severity}] ${d.file ? `${escapeHtml(d.file)} ` : ""}第 ${d.start?.line ?? "?"} 行 ${escapeHtml(d.message)}</li>`).join("");
    panel.webview.html = pageHtml(body, result.pages, currentPage, diag);
    panel.title = `Typst.bit 预览 · ${result.pages} 页 · ${errors.length} 错误`;
  } catch (error) {
    vscode.window.showErrorMessage(`Typst.bit: ${error.message}`);
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function pageHtml(body, pages, page, diagnostics) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { margin: 0; font: 13px system-ui, sans-serif; background: #e7e9ed; color: #20242b; }
  img { display: block; max-width: 100%; margin: 12px auto; background: white; box-shadow: 0 6px 24px #0002; }
  .bar { display: flex; gap: 8px; align-items: center; padding: 8px 12px; background: white; border-bottom: 1px solid #dfe3e8; position: sticky; top: 0; }
  button { font: inherit; padding: 3px 9px; border: 1px solid #cbd2da; border-radius: 4px; background: white; cursor: pointer; }
  ul { margin: 8px 12px; padding-left: 18px; color: #b42318; }
</style></head><body>
<div class="bar">
  <button onclick="const v=document.getElementById('v');v.scrollBy({top:-v.clientHeight*0.9,behavior:'smooth'})">上一屏</button>
  <button onclick="const v=document.getElementById('v');v.scrollBy({top:v.clientHeight*0.9,behavior:'smooth'})">下一屏</button>
  <span>第 ${pages ? page + 1 : 0} / ${pages} 页</span>
</div>
<div id="v">${body}</div>
${diagnostics ? `<ul>${diagnostics}</ul>` : ""}
</body></html>`;
}

async function exportWith(context, kind) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTypst(editor.document)) {
    vscode.window.showWarningMessage("Typst.bit: 请在 .typ 文件中使用该命令。");
    return;
  }
  try {
    const abi = await getAbi(context);
    const { vfsToUri } = await syncWorkspace(abi, editor.document);
    if (abi.compile() !== 0) {
      publishDiagnostics(abi.diagnostics(), vfsToUri, editor.document.uri);
      vscode.window.showErrorMessage("Typst.bit: 编译失败，未导出。");
      return;
    }
    publishDiagnostics(abi.diagnostics(), vfsToUri, editor.document.uri);
    const target = editor.document.fileName.replace(/\.typ$/, `.${kind}`);
    const bytes = kind === "pdf" ? abi.exportPdf() : abi.exportSvg(Math.min(currentPage, Math.max(0, abi.pageCount() - 1)));
    if (!bytes) return;
    fs.writeFileSync(target, bytes);
    vscode.window.showInformationMessage(`Typst.bit: 已导出 ${target}`);
  } catch (error) {
    vscode.window.showErrorMessage(`Typst.bit: ${error.message}`);
  }
}

function activate(context) {
  diagnosticsCollection = vscode.languages.createDiagnosticCollection("typstbit");
  context.subscriptions.push(diagnosticsCollection);

  context.subscriptions.push(vscode.commands.registerCommand("typstbit.preview", async () => {
    if (!panel) {
      panel = vscode.window.createWebviewPanel("typstbitPreview", "Typst.bit 预览", vscode.ViewColumn.Beside, { enableScripts: false });
      panel.onDidDispose(() => { panel = null; });
    }
    await refresh(context);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("typstbit.exportPdf", () => exportWith(context, "pdf")));
  context.subscriptions.push(vscode.commands.registerCommand("typstbit.exportSvg", () => exportWith(context, "svg")));

  context.subscriptions.push(vscode.commands.registerCommand("typstbit.copyMcpConfig", async () => {
    const abi = path.join(context.extensionPath, "wasm-bridge.js");
    const config = {
      mcpServers: {
        typstbit: {
          command: "node",
          args: [path.join(path.dirname(abi), "..", "..", "tools", "typstbit-mcp.mjs")],
          env: { TYPSTBIT_ABI: path.join(context.extensionPath, "assets", "typst_abi.opt.wasm") },
        },
      },
    };
    await vscode.env.clipboard.writeText(JSON.stringify(config, null, 2));
    vscode.window.showInformationMessage("Typst.bit: MCP 配置已复制。");
  }));

  const recompile = () => {
    if (!panel) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => refresh(context), 300);
  };

  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
    if (!isTypst(event.document)) return;
    recompile();
  }));

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
    if (!isTypst(document)) return;
    recompile();
  }));

  const watcher = vscode.workspace.createFileSystemWatcher("**/*.{typ,svg,png,jpg,jpeg,bib}");
  watcher.onDidChange(recompile);
  watcher.onDidCreate(recompile);
  watcher.onDidDelete(recompile);
  context.subscriptions.push(watcher);

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
    if (panel) refresh(context);
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };
