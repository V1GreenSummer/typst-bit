# Typst.bit

离线优先的浏览器内 Typst 文档工作台，以 MoonBit 为应用核心，编辑器使用同作者项目 CodeMoonBit。

- 在线演示：https://v1greensummer.github.io/typst-bit/
- 编辑器仓库：https://github.com/V1GreenSummer/CodeMoonBit
- MoonBit 模块：`V1GreenSummer/typstbit`（mooncakes.io）、`V1GreenSummer/codemoonbit`

## 架构

- MoonBit 应用核心（`app/typstbit/app`、`app/typstbit/core`）：命令目录与 UI 结构、面板筛选、大纲、多文件项目、诊断映射、包清单、主题计划；编译为 `core.wasm`（约 76KB）供浏览器调用。
- 编译器后端（`rust/typst-abi`）：基于 Rust typst 编译器的零导入 wasm32 ABI，同时提供原生 staticlib。
- 编辑器：CodeMoonBit（MoonBit 编写，编译到 wasm-gc），通过 `editor-adapter-cmb.js` 接入。
- 宿主与工作台（`app/typstbit/web_wasm`）：DOM 界面、插件系统、图床、存储、CLI/MCP/VSCode 复用层。

## 功能

- 编辑：Typst 语法高亮、中文输入法、自动闭合、词级移动、撤销重做、搜索替换、折叠、诊断标记。
- 编译与预览：本地离线编译、分页栅格预览、诊断列表与跨文件跳转。
- 多文件项目：文件与文件夹管理、上传与拖拽、粘贴图片、import 多文件、本地持久化。
- 导出与分享：PDF、SVG、PNG、单文件 HTML、分享链接。
- 插件与主题：8 个内置插件、URL 外部插件、主题与布局；图床支持阿里云 OSS 直传（图片字节同步注册到本地编译器，源码保留云端链接且离线可编译）。
- 多端复用：网页工作台、离线 CLI、MCP 服务器、VSCode 扩展、网页嵌入示例。

## 快速开始

```sh
# 浏览器工作台（静态服务即可）
python3 -m http.server 8765
# 打开 http://127.0.0.1:8765/app/typstbit/web_wasm/index.html
```

```sh
# 测试
cd e2e && node interactions.mjs       # 浏览器端到端
node editor-cmb.test.mjs              # 编辑器
node acceptance.mjs                   # 性能与体积预算
node core.test.mjs                    # MoonBit 核心契约
```

```sh
# 离线 CLI 与 MCP
node tools/typstbit-cli.mjs compile doc.typ
node tools/typstbit-mcp.mjs
```

```sh
# 原生 CLI / MCP（MoonBit native + Rust staticlib）
tools/build-native-cli.sh
tools/typstbit-cli compile doc.typ
```

## 目录

- `app/typstbit/app`：MoonBit 应用模型与逻辑（含单测）
- `app/typstbit/core`：wasm-gc 核心导出
- `app/typstbit/native_cli`：原生 CLI 与 MCP 服务（含 `mcp` 子命令）
- `app/typstbit/web_wasm`：DOM 工作台、插件、样式、静态资源
- `rust/typst-abi`：编译器 ABI（wasm + staticlib）
- `tools`：CLI、MCP、资源与构建工具
- `e2e`：14 套端到端与性能/预算测试
- `docs`：架构、复用、嵌入、MCP、VSCode、插件、主题、验收与路线文档
- `editors/vscode`：VSCode 扩展
- `examples`：网页嵌入示例

## 开发状态

核心流程与四端复用已完成，测试共约 335 项（Rust 18、MoonBit 33、浏览器与集成断言 284），性能与体积预算纳入验收并达标（编译器 wasm 原始 38.40MiB、压缩 13.91MiB，首载 14.05MiB）。发布历史：MoonBit 模块已发布 V1GreenSummer/codemoonbit 0.1.2 与 V1GreenSummer/typstbit 0.1.1。

## 许可证与参考来源

本项目使用 MIT 许可证，见 `LICENSE`。

第三方依赖与参考：

- Rust typst 编译器（Apache-2.0）：作为编译后端依赖，位于 `rust/typst-abi`，本项目未修改其源码。
- wzzc-dev/moui 与 moui_web_renderer、moui_skia_renderer（Apache-2.0）：旧版 MoUI 画布外壳依赖。
- CodeMoonBit（MIT，同作者项目）：编辑器组件，vendor 于 `vendor/codemoonbit`，本仓库有上游补丁回馈。
- @preview/tiaoma（MIT）：预置的第三方 Typst 包，保留原包许可证并记录校验和。
- 字体 Noto Serif CJK SC 与 Liberation Serif：SIL OFL 1.1，子集资产随仓库附许可证。
