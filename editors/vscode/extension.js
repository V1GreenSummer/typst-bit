"use strict";
const path = require("node:path");
const vscode = require("vscode");
const { TypstAbi } = require("./wasm-bridge");

let abiPromise = null;
let panel = null;
let debounce = null;
let currentPage = 0;

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

function activeSource() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTypst(editor.document)) return null;
  return { text: editor.document.getText(), name: editor.document.fileName };
}

async function render(context, abi) {
  const source = activeSource();
  if (!source) return null;
  if (abi.setFile("/main.typ", source.text) !== 0) return null;
  abi.setMain("/main.typ");
  const status = abi.compile();
  const pages = abi.pageCount();
  const diagnostics = abi.diagnostics();
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
    const diag = result.diagnostics.slice(0, 8).map(d => `<li>[${d.severity}] 第 ${d.start?.line ?? "?"} 行 ${escapeHtml(d.message)}</li>`).join("");
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

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand("typstbit.preview", async () => {
    if (!panel) {
      panel = vscode.window.createWebviewPanel("typstbitPreview", "Typst.bit 预览", vscode.ViewColumn.Beside, { enableScripts: false });
      panel.onDidDispose(() => { panel = null; });
    }
    await refresh(context);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("typstbit.exportPdf", async () => {
    const source = activeSource();
    if (!source) {
      vscode.window.showWarningMessage("Typst.bit: 请在 .typ 文件中使用该命令。");
      return;
    }
    const abi = await getAbi(context);
    abi.setFile("/main.typ", source.text);
    abi.setMain("/main.typ");
    if (abi.compile() !== 0) {
      vscode.window.showErrorMessage("Typst.bit: 编译失败，未导出。");
      return;
    }
    const bytes = abi.exportPdf();
    if (!bytes) return;
    const target = source.name.replace(/\.typ$/, "") + ".pdf";
    require("node:fs").writeFileSync(target, bytes);
    vscode.window.showInformationMessage(`Typst.bit: 已导出 ${target}`);
  }));

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

  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
    if (!panel) return;
    if (!isTypst(event.document)) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => refresh(context), 300);
  }));

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
    if (panel) refresh(context);
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };
