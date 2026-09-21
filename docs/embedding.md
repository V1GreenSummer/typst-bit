# 在其他项目中复用 Typst.bit

Typst.bit 按“编译器 → 核心模块 → 工作台 → 插件”分层，除工作台 UI 外都可以被其他 Web 项目直接复用。

## 分层

| 层 | 位置 | 可复用点 |
|---|---|---|
| 编译器 ABI | `rust/typst-abi` → `typst_abi.opt.wasm` | 纯 wasm32 无导入模块：编译、诊断 JSON、分页 PNG、PDF、SVG、包文件注册；Node 与浏览器均可实例化 |
| 核心模块 | `app/typstbit/web_wasm/{session,commands,outline,packages,plugins}.js` | 无 DOM 依赖（plugins 仅在无 localStorage 时退回内存）；ES module 直接 import |
| 远程资源 | `typst_abi_set_remote_file(url, bytes)`：把 `https://…` 图片/资源字节注册进 VFS，源码保留 URL、编译离线可解析 | `editor-adapter-cmb.js` | CodeMoonBit（wasm-gc）封装：选区变换、诊断、搜索、自动闭合、主题、撤销重做 |
| 工作台 UI | `workbench.js` + `workbench.css` | 菜单/工具栏/命令面板/大纲/设置等完整参考实现 |
| 插件系统 | `plugins.js` + `docs/plugins.md` | 命令、菜单、导出格式、设置表单的宿主 API |

## 最小嵌入（约 80 行）

见 [`examples/embed.html`](../examples/embed.html)：加载 `typst_abi.opt.wasm`，`set_file` + `set_main` + `compile`，用 `render_page_png` 预览、`export_pdf` 导出。核心调用：

```js
const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl), {});
const abi = instance.exports;
const ptr = abi.typst_abi_alloc(bytes.length);
new Uint8Array(abi.memory.buffer, ptr, bytes.length).set(bytes);
abi.typst_abi_set_file(pathPtr, pathLen, dataPtr, dataLen);
abi.typst_abi_set_main(pathPtr, pathLen);
const status = abi.typst_abi_compile();      // 0 = 成功
const pages = abi.typst_abi_page_count();
const png = abi.typst_abi_render_page_png(0, 1500);
```

在线示例：`https://v1greensummer.github.io/typst-bit/examples/embed.html`（部署后可用）。

## 构建与部署

```sh
cd rust && cargo build -p typst-abi --target wasm32-unknown-unknown --release
npx wasm-opt target/wasm32-unknown-unknown/release/typst_abi.wasm -Oz --strip-debug --strip-producers \
  -o target/wasm32-unknown-unknown/release/typst_abi.opt.wasm
```

- 服务器需以 `application/wasm` 提供 `.wasm`（否则 `instantiateStreaming` 失败，示例内含 `arrayBuffer` 回退）。
- 字体与 `@preview` 预置包已内置于 default 构建与 `app/typstbit/web_wasm/packages/`；独立项目若只需要编译器，可直接复制 `.opt.wasm`（离线、无网络）。
- 包支持：`typst_abi_set_package_file(spec, path, data)` 按 `@namespace/name:version` 注册；`tools/vendor-typst-package.py` 可下载并生成清单。

## 复用核心模块

```js
import { createSession } from ".../web_wasm/session.js";
import { loadCore } from ".../web_wasm/core-adapter.js";
const core = await loadCore(new URL(".../web_wasm/core.wasm", import.meta.url));
const outline = core.outline(source);
import { registerCommands, filterCommands } from ".../web_wasm/commands.js";
import { definePlugin, createPluginHost } from ".../web_wasm/plugins.js";
```

这些模块的语义与工作台一致，可在自己的 UI 中重建工具栏/面板，或作为无头逻辑在 Node 中运行（`e2e/commands.test.mjs`、`plugins.test.mjs` 即无浏览器用例）。

## MCP / 大模型接入

`tools/typstbit-mcp.mjs` 用同一份 wasm 暴露 stdio MCP 工具（编译、PDF、SVG、PNG、大纲、内置包），配置见 [`docs/mcp.md`](mcp.md)。
