# 以 MoonBit 为核心：现状、边界与路线

## 现状（诚实盘点）

| 层 | 现状 | 语言 |
|---|---|---|
| 编译器后端 | `typst_abi.wasm`：编译/诊断/PNG/PDF/SVG/包注册，纯 wasm32 零导入 | **Rust**（Typst 本体，无法迁移） |
| 应用核心（旧路径） | `app/typstbit/app/state.mbt` 纯状态机（12 项单测）、`typst_binding` 通过 `extern "wasm"` 对接 `typst` 宿主模块、`web_wasm` MoUI 外壳（`?legacy=1`） | **MoonBit** |
| 应用核心（当前默认） | 会话/命令目录/项目模型/插件/主题/包清单 | **JS**（`web_wasm/*.js`） |
| 宿主与 UI | DOM 工作台（CodeMirror 6、菜单、面板、设置） | **JS/HTML** |
| 对外复用 | MCP、CLI、VSCode PoC、Node 桥 | **JS/Node** |

结论：MoonBit 已经有核心的骨架（状态机 + 编译器绑定），但最近默认路径换成了 DOM/JS 工作台，核心逻辑被 JS 接管。

## 目标架构与边界

```
┌──────────────────────────────────────────────────────────────┐
│ 宿主（薄）：DOM、CodeMirror、fetch/clipboard/download、        │
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
- JS 只保留三件事：DOM/CodeMirror 绑定、宿主服务（剪贴板/下载/localStorage/fetch）、以及把 Rust ABI 代理给 MoonBit 的 `typst` 宿主模块。
- 若最终要“连 UI 也是 MoonBit”，走 MoUI 画布外壳（`?legacy=1` 那条路径）作为可选形态，而不是牺牲 CodeMirror 编辑体验。

## 已完成的第一步（本次）

- `app/typstbit/app/outline.mbt`：大纲解析（去 `<label>`、跳过代码围栏、层级/行号）——从 `outline.js` 移植
- `app/typstbit/app/commands.mbt`：命令目录（19 条）+ 菜单/工具栏/顶栏结构 + `filter/active/enabled` 判定（纯函数，宿主只负责按 id 执行副作用）
- 单测 `outline_test.mbt` / `commands_test.mbt`：与 JS 版行为对齐；`moon test app` 共 **22/22 通过**，0 警告，`pkg.generated.mbti` 已生成

## 分阶段路线

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P1 核心扩展** | 把会话/项目模型从 JS 迁到 MoonBit：在 `state.mbt` 上加入多文件项目、预览页码、诊断映射、包清单、主题模型；模型保持无宿主依赖 | `moon test app` 覆盖新场景；JS 侧保留旧实现做对拍 |
| **P2 浏览器接入** | 编译 `typstbit_core.wasm`（wasm-gc，导出 `core_init/update/exports…`）；DOM 工作台通过 JS 宿主调用核心决定 UI 结构与状态，CodeMirror 仍负责文本；插件注册进 MoonBit 注册表 | 9 套 e2e 全绿（先用 `?core=mbt` 开关，再切默认）；命令/大纲/筛选与 JS 版逐项一致 |
| **P3 默认切换** | 删除 JS 侧重复实现（commands/session/outline/packages 逻辑），JS 仅剩宿主；插件执行映射保留在 JS | 套件全绿；boot 体积/时间在预算内 |
| **P4 原生核心** | Rust `typst-abi` 增加 native staticlib；MoonBit 原生 CLI/MCP 直接链接，`tools/typstbit-cli.mjs`、`tools/typstbit-mcp.mjs` 由 MoonBit 版替代或薄包装 | CLI/MCP 回归与现有一致；VSCode 可复用同一原生核心 |
| **P5 可选 UI** | 复活 MoUI 画布外壳作为“全 MoonBit UI”形态（复用现有 `web_wasm` 与 `?legacy=1`），与 DOM 工作台二选一 | 独立 e2e 冒烟；不回归 DOM 路径 |

## 风险与对策

- **wasm-gc ↔ JS 互操作**：项目已有成熟先例（MoUI/window 全是 `extern "wasm"` 导入模式），风险低；文本跨边界用 UTF-16 或 text-id 协议（已有实现可复用）。
- **插件生态是 JS**：外部插件仍以 JS 模块加载，宿主把注册映射进 MoonBit 注册表；MoonBit 侧只存语义，不执行 JS。
- **双实现维护成本**：P1→P2 期间 JS 版作为对拍 oracle，P3 一次性删除，不做长期双轨。
- **包体积/启动**：`core.wasm`（wasm-gc）预计百 KB 级；与 38MB 编译器 wasm 相比可忽略（待 P2 实测入预算）。
- **开发体验**：MoonBit 侧需要 `moon check/test` 与 wayland stub（本机已记录：`PATH=/tmp/opencode/wayland-build-shim/bin:$PATH`）。

## 一句话

MoonBit 不是、也不需要是 Typst 编译器的实现语言；**“以 MoonBit 为核心”= 应用/领域核心全部在 MoonBit（浏览器与原生同一套），Rust 只做编译器后端，JS 只做宿主与 DOM 绑定。** 本次已把命令目录与大纲迁入核心并测试通过，后续按 P1→P4 推进即可。
