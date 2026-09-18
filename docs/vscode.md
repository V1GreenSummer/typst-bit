# 作为 VSCode 扩展使用

**结论：可以，且已有可运行的最小 PoC**（`editors/vscode/`）。核心原因是 `typst_abi.opt.wasm` 是纯 `wasm32-unknown-unknown` 模块（无任何导入），Node 与 Webview 都能直接实例化；仓库里的 MCP 服务器已经证明 Node 侧可用，PoC 桥接测试进一步覆盖了完整链路。

## 三种形态

| 形态 | 说明 | 状态 |
|---|---|---|
| **A. Node 侧扩展** | 扩展主机里用 `wasm-bridge.js` 编译当前 `.typ`：PNG 预览（Webview 展示）、导出 PDF/SVG、编译诊断；编辑 300ms 防抖刷新 | ✅ PoC 已实现 |
| **B. Webview 内嵌完整工作台** | 把 `app/typstbit/web_wasm/` 作为 webview 资源，`index.html?abi=<asWebviewUri>` 覆盖 wasm 地址；多文件/插件/主题全部可用 | 需适配 CSP 与资源 URI（工作量中等） |
| **C. MCP 配套** | 扩展一键复制 MCP 配置（已内置 `Typst.bit: 复制 MCP 配置`），把编译器接给大模型/其他工具 | ✅ 命令已实现 |

## PoC 能力（`editors/vscode/`）

- `Typst.bit: 预览当前文件`：编辑器标题栏按钮 + 命令；Webview 显示 1.5x PNG 与诊断列表
- `Typst.bit: 导出 PDF`：输出同目录同名 PDF
- 预置包：自动注册 `assets/packages`（`@preview/tiaoma` 可用）
- 配置：`typstbit.abiPath`、`typstbit.packagesPath`

验证（无需 VSCode 宿主）：

```sh
cd e2e && node vscode-bridge.test.mjs
# PASS: 包注册 / 编译 / PNG / SVG / PDF / @preview 导入 / 诊断
```

运行方式见 [`editors/vscode/README.md`](../editors/vscode/README.md)：复制 wasm 到 `editors/vscode/assets/`，VSCode 打开该目录按 `F5`。

## 与浏览器版的关系

- **同一编译器与字体/包资产**：浏览器、MCP、VSCode 三端产物一致（同一 `typst_abi`）。
- **可复用模块**：`wasm-bridge.js`（Node）、`session/commands/outline/packages`（Webview 或纯逻辑）与浏览器工作台共用语义。
- **差异**：浏览器工作台的插件/主题系统在形态 A 不可用（无 DOM 工作台）；形态 B 可完整复用。

## 缺口与路线图（按优先级）

1. **工作区文件同步**：把 VSCode 工作区的 `.typ` 与图片同步进 VFS（ABI 已支持任意路径 `set_file`；PoC 目前只送当前文件）。
2. **Problems 面板集成**：诊断 JSON 已有文件/行/列，可写入 `DiagnosticCollection`；跨文件跳转直接可用。
3. **Webview 完整工作台（形态 B）**：
   - CSP：`default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'nonce-…' 'wasm-unsafe-eval'`；
   - 资源：`workbench.js/packages/` 经 `asWebviewUri` 提供，wasm URL 通过 `?abi=` 注入；
   - 外部插件动态 `import(url)` 需放宽 `script-src`（或只允许扩展内插件）。
4. **命令与任务**：`typstbit.preview/exportPdf` 已就绪，可加 `typstbit.watch`、`typstbit.exportSvg`、格式化/大纲命令，并映射到 VSCode 快捷键。
5. **打包体积**：wasm 38MB 原始 / 4.5MB brotli，建议随扩展以资源文件分发（不走 asar），或首次使用时下载缓存。

## 快速参考

- `editors/vscode/wasm-bridge.js`：Node/CJS 的 ABI 封装（编译、诊断、PNG、PDF、SVG、包注册），也能被任何 Node 项目直接 require。
- `tools/typstbit-mcp.mjs`：stdio MCP 服务器（5 工具）。
- `app/typstbit/web_wasm/`：浏览器工作台（形态 B 的素材）。
