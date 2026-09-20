# 以 MoonBit 为核心：现状、边界与路线

## 现状（诚实盘点）

| 层 | 现状 | 语言 |
|---|---|---|
| 编译器后端 | `typst_abi.wasm`：编译/诊断/PNG/PDF/SVG/包注册，纯 wasm32 零导入 | **Rust**（Typst 本体，无法迁移） |
| 应用核心（旧路径） | `app/typstbit/app/state.mbt` 纯状态机（12 项单测）、`typst_binding` 通过 `extern "wasm"` 对接 `typst` 宿主模块、`web_wasm` MoUI 外壳（`?legacy=1`） | **MoonBit** |
| 应用核心（当前默认） | 大纲/命令目录与 UI 结构/命令筛选/项目模型/诊断映射/包清单/主题计划 → **MoonBit `core.wasm`**；会话状态、插件注册与执行仍在 JS 宿主 | **MoonBit + JS 宿主** |
| 宿主与 UI | DOM 工作台（CodeMoonBit、菜单、面板、设置） | **JS/HTML** |
| 对外复用 | MCP、CLI、VSCode PoC、Node 桥 | **JS/Node** |

结论：MoonBit 已经有核心的骨架（状态机 + 编译器绑定），但最近默认路径换成了 DOM/JS 工作台，核心逻辑被 JS 接管。

## 目标架构与边界

```
┌──────────────────────────────────────────────────────────────┐
│ 宿主（薄）：DOM、CodeMoonBit 绑定、fetch/clipboard/download、  │
│            typst 宿主模块（把 Rust ABI 暴露给 MoonBit 导入）    │
└───────────────▲──────────────────────────────┬───────────────┘
                │ wasm-gc 导出                   │ extern "wasm"
┌───────────────┴──────────────────────────────▼───────────────┐
│ MoonBit 应用核心（app/typstbit/app，native + wasm-gc）         │
│  会话/状态机 · 命令目录与菜单/工具栏结构 · 项目文件模型          │
│  大纲解析 · 包清单 · 主题模型 · 插件注册表 · 导出编排            │
└───────────────────────────────┬──────────────────────────────┘
                                │ Rust typst-abi（wasm / staticlib）
                        Typst 编译器（Rust，不可迁移）
```

**边界原则**
- Typst 编译器（Rust，数十万行）保持在 Rust；这是“不可迁移”的硬边界。
- **所有不碰 DOM/网络/文件系统的应用逻辑归 MoonBit**：状态迁移、命令与 UI 结构、项目/会话模型、大纲、包清单、主题与插件注册语义、导出编排。
- JS 只保留三件事：DOM/编辑器绑定、宿主服务（剪贴板/下载/localStorage/fetch）、以及把 Rust ABI 代理给 MoonBit 的 `typst` 宿主模块。
- 若最终要“连 UI 也是 MoonBit”，走 MoUI 画布外壳（`?legacy=1` 那条路径）作为可选形态，而不是牺牲编辑器体验。

## 已完成（P0–P3）

- **P0（骨架）**：`outline.mbt`、`commands.mbt`（19 条命令 + 菜单/工具栏/顶栏 + filter/active/enabled），`moon test` 22/22
- **P1（模型扩展）**：`project.mbt`（多文件项目：增删/重命名路径校验/活跃文件回退/JSON 往返）、`diagnostics_map.mbt`（ABI 宽诊断 → 编辑器诊断，按文件过滤、hints 合并）、`packages.mbt`（`@ns/name:ver` 解析与源码扫描、缺失包判定）、`theme.mbt`（主题/布局设置 → body 属性/类 + CSS 变量计划）；新增 11 项单测，`moon test app` 33/33
- **P2（浏览器接入）**：`app/typstbit/core` 编译为 wasm-gc（`core.wasm`，约 76KB），导出 `core_outline/core_commands/core_filter_commands/core_package_specs/core_map_diagnostics/core_theme_plan/core_project_op`；`web_wasm/core-adapter.js` 是零 DOM 依赖的 JS 宿主；`e2e/core.test.mjs` 用冻结的 JS 目录/筛选/大纲/包对拍（全部一致）
- **P3（默认切换）**：DOM 工作台默认且唯一使用核心——菜单/格式栏/顶栏结构、命令面板筛选与按钮 active/enabled、大纲、包检测、诊断映射全部来自 `core.wasm`；JS 侧删除 `outline.js` 与 `packageSpecsInSource`，`commands.js` 仅保留 19 个命令的执行映射与插件命令注册（元数据在核心）

## 分阶段路线

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P1 核心扩展** ✅ | 多文件项目、诊断映射、包清单、主题模型（无宿主依赖） | `moon test app` 33/33 |
| **P2 浏览器接入** ✅ | `core.wasm`（wasm-gc）+ `core-adapter.js`；工作台经核心决定 UI 结构与筛选 | `e2e/core.test.mjs` 对拍一致；interactions 全绿 |
| **P3 默认切换** ✅ | 核心为默认且唯一；删除 JS 重复实现（outline/包扫描/目录元数据），JS 仅剩执行映射与宿主 | 全部套件在核心路径复跑通过 |
| **P4 原生核心** | Rust `typst-abi` 增加 native staticlib；MoonBit 原生 CLI/MCP 直接链接，`tools/typstbit-cli.mjs`、`tools/typstbit-mcp.mjs` 由 MoonBit 版替代或薄包装 | CLI/MCP 回归与现有一致；VSCode 可复用同一原生核心 |
| **P5 可选 UI** | 复活 MoUI 画布外壳作为“全 MoonBit UI”形态（复用现有 `web_wasm` 与 `?legacy=1`），与 DOM 工作台二选一 | 独立 e2e 冒烟；不回归 DOM 路径 |

## 风险与对策

- **wasm-gc ↔ JS 互操作**：`core-adapter.js` 用 `extern "wasm"` + JS 字符串桥（`sb_new/sb_push/sb_finish/js_len/js_char`），零 DOM 依赖，Node 与浏览器同一套。
- **插件生态是 JS**：外部插件仍以 JS 模块加载；命令元数据（id/label/category/shortcut）可由宿主在插件注册时同步进核心，执行函数始终留在 JS（P4 可补 `core_register_command`）。
- **双实现维护成本**：P1→P2 期间 JS 版作为对拍 oracle，P3 一次性删除；`e2e/core.test.mjs` 保留冻结的黄金样例。
- **包体积/启动**：`core.wasm` 76KB（wasm-gc），与 38MB 编译器 wasm 相比可忽略；构建脚本 `tools/build-core.sh`。
- **开发体验**：MoonBit 侧需要 `moon check/test` 与 wayland stub（本机已记录：`PATH=/tmp/opencode/wayland-build-shim/bin:$PATH`）；核心改动后跑 `tools/build-core.sh` 重新 stage `core.wasm`，再跑 `e2e/core.test.mjs` 与浏览器套件。

## 一句话

MoonBit 不是、也不需要是 Typst 编译器的实现语言；**“以 MoonBit 为核心”= 应用/领域核心全部在 MoonBit（浏览器与原生同一套），Rust 只做编译器后端，JS 只做宿主与 DOM 绑定。** P0–P3 已完成：应用/领域核心（命令与 UI 结构、筛选、大纲、项目模型、诊断映射、包清单、主题计划）都在 MoonBit，浏览器与 Node 共用同一 `core.wasm`；JS 只剩宿主与副作用。P4（native staticlib + MoonBit CLI/MCP）与 P5（可选 MoUI UI）为后续路线。
