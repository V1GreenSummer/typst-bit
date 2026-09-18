# 可被其他项目复用的产物

本项目除浏览器工作台外，已经沉淀出一批与 UI 解耦、可直接被其他项目消费的产物。按成熟度排列。

## 已可直接复用

| 产物 | 位置 | 说明与消费方式 |
|---|---|---|
| **编译器 ABI wasm** | `rust/typst-abi` → `typst_abi.opt.wasm` | 纯 `wasm32-unknown-unknown`、零导入；浏览器、Node、Webview 均可实例化。含字体与 `@preview` 包注册、PDF/PNG/SVG 导出、诊断 JSON |
| **Node 桥接** | `editors/vscode/wasm-bridge.js` | CJS 类 `TypstAbi`：`load/setFile/setMain/compile/diagnostics/renderPagePng/exportPdf/exportSvg/registerPackages`，任何 Node 项目可直接 require |
| **离线 CLI** | `tools/typstbit-cli.mjs` | `typstbit compile/pdf/png/svg/outline <file.typ>`；自动注册同目录多文件与图片、内置 `@preview` 包。适合 CI/脚本/其他应用调用 |
| **MCP 服务器** | `tools/typstbit-mcp.mjs` | stdio JSON-RPC，5 个工具，接 Claude/Cursor 等；与网页端同编译器 |
| **浏览器核心模块** | `app/typstbit/web_wasm/{session,commands,outline,packages,plugins}.js` | 无 DOM 依赖（有 localStorage 时用其存储，否则内存回退）；可重建自己的工具栏/面板或做无头逻辑 |
| **MoonBit 应用核心** | `app/typstbit/app/{state,commands,outline}.mbt` | 纯逻辑、`native + wasm-gc` 双目标；命令目录/大纲/状态机单测 22 项；迁移路线见 `docs/moonbit-core.md` |
| **字体与包工具链** | `tools/subset-cjk-fonts.py`、`tools/vendor-typst-package.py` | 生成 CJK 子集并记录源 hash；从 packages.typst.org 抓包、校验 sha256、生成 `manifest.json` |
| **VSCode 扩展 PoC** | `editors/vscode/` | Node 侧预览/导出/诊断，F5 即用；路线图见 `docs/vscode.md` |
| **部署与测试模板** | `.github/workflows/pages.yml`、`e2e/*.mjs` | 静态站构建发布；8 个套件覆盖编译/交互/渲染/导出/包/插件/MCP/CLI |
| **文档** | `docs/{embedding,theming,plugins,mcp,vscode,spike-typst-context}.md` | 嵌入、主题变量规范、插件 API、MCP 配置、上下文 ABI 评估 |

## 建议下一步打包成独立产品

1. **npm 包 `typst-abi-node`**：把 `wasm-bridge` + CLI + 类型声明（`wasm-bridge.d.ts`）+ 包清单一起发布，任何 Node/CI 可离线排版（当前 CLI 已是雏形）。
2. **C 头文件 `include/typst_abi.h` + ABI v1 冻结文档**：Python/Zig/C 通过 wasmtime/wasmer 复用，不依赖 JS。
3. **`typst-web-testkit`**：从 `e2e` 抽出「静态服务 + 等待编译 + PDF 字体/文本断言」的工具，供其他 Typst Web 项目复用。
4. **Composite GitHub Action**：一键构建 wasm + 字体子集 + 预置包并发布 Pages（复刻 `.github/workflows/pages.yml` 的组装逻辑）。
5. **上下文 ABI**（`docs/spike-typst-context.md` 已验证 p95 < 0.1ms）：暴露 `typst_abi_context_json`，供编辑器做上下文命令/精确高亮/大纲。
6. **主题规范**（`docs/theming.md`）：CSS 变量 + 稳定选择器已文档化，其他项目可把主题包原样移植。
7. **包镜像规范**：`manifest.json` 格式 + vendor 工具可复用于任何需要离线 `@preview` 的 Typst 集成。

## 速查

```sh
# CLI（离线，支持多文件与内置包）
node tools/typstbit-cli.mjs compile app.typ
node tools/typstbit-cli.mjs pdf app.typ -o out/app.pdf
node tools/typstbit-cli.mjs png app.typ --page 0 --scale 2
node tools/typstbit-cli.mjs svg app.typ --page 0
node tools/typstbit-cli.mjs outline app.typ

# MCP
cd e2e && node mcp.test.mjs          # 协议与工具回归
node tools/typstbit-mcp.mjs          # 作为 stdio MCP 服务器

# 回归
cd e2e && node commands.test.mjs && node plugins.test.mjs && node cli.test.mjs \
  && node mcp.test.mjs && node vscode-bridge.test.mjs
```

## 质量与许可

- 字体（Noto CJK / Liberation）均为 SIL OFL 1.1，子集资产随仓库附许可证。
- 预置包保留原包 LICENSE（tiaoma 为 MIT），vendor 工具记录 tarball sha256。
- ABI 为单实例、同步、无网络；版本变更需同步更新 `pkg.generated.mbti` 式的 ABI 文档（`docs/embedding.md` 的调用约定）。
- 体积：wasm 38.34 MiB raw / 13.89 MiB brotli；嵌入方需注意分发与缓存策略。
