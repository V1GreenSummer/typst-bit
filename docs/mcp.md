# Typst.bit MCP 服务器

`tools/typstbit-mcp.mjs` 把与网页端**同一份** `typst_abi.opt.wasm` 暴露为本地 MCP（Model Context Protocol）工具，让大模型可以直接编译、渲染与导出 Typst 文档，无需网络与额外依赖。

## 运行要求

- Node.js 18+
- 已构建的 ABI wasm（仓库默认路径 `rust/target/wasm32-unknown-unknown/release/typst_abi.opt.wasm`，可用环境变量 `TYPSTBIT_ABI` 覆盖）

```sh
cd rust && cargo build -p typst-abi --target wasm32-unknown-unknown --release
```

## 接入 MCP 客户端

Claude Desktop / Cursor 等客户端的配置（路径按本机调整）：

```json
{
  "mcpServers": {
    "typstbit": {
      "command": "node",
      "args": ["/home/wyx/workplace/moonbit/Typst.bit/tools/typstbit-mcp.mjs"],
      "env": {
        "TYPSTBIT_ABI": "/home/wyx/workplace/moonbit/Typst.bit/rust/target/wasm32-unknown-unknown/release/typst_abi.opt.wasm"
      }
    }
  }
}
```

## 工具

| 工具 | 参数 | 返回 |
|---|---|---|
| `typst_compile` | `source` | `{ status, pages, diagnostics[] }`（含错误/警告行号） |
| `typst_export_pdf` | `source`，可选 `path` | 写出 PDF（默认 `/tmp/typstbit-output.pdf`），返回路径与字节数 |
| `typst_export_svg` | `source`，可选 `page` | 指定页的 SVG 文本（可直接给模型读排版结构） |
| `typst_render_png` | `source`，可选 `page`、`scale` | MCP `image` 内容块（PNG base64） |
| `typst_outline` | `source` | 大纲 JSON（标题、层级、行号，已去标签与代码围栏） |

## 测试

```sh
cd e2e && node mcp.test.mjs
```

覆盖 initialize 握手、tools/list、编译/PDF/SVG/PNG/大纲与未知工具错误路径。

## 说明

- 服务器为 stdio JSON-RPC，单实例、无网络请求；`stdout` 仅输出协议消息，日志请走 `stderr`。
- 与浏览器端共用 ABI，因此编译行为（字体、内置包）一致：启动时自动按 `packages/manifest.json` 注册预置包，`@preview/tiaoma` 等导入可直接编译；新增包用 `tools/vendor-typst-package.py` 后自动生效。
