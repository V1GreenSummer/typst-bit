# 设计：工作台命令层与编辑会话

## Context

动机见 `proposal.md` 与 MoMark 分析。现状要点：

- `workbench.js`（约 500 行，无顶层 import）：`bootWorkbench` 内直接创建菜单/工具栏/侧栏/预览 DOM 并绑定回调；闭包 `state` 持有 status/revision/diagnostics/previewUrl/blobs；`__typstbit` compat 暴露 `e2e_*` 给 Playwright。
- `editor-bundle.js`（esbuild 打包 `workbench-entry.js`）：CodeMirror 6 编辑器 facade（`getDoc/setDoc/wrapSelection/prefixLines/insertBlock/clearMarks/openSearch/setDiagnostics/focus`），由 `workbench.js:91` 动态 import。
- 顶栏「⌘K 搜索命令」仅有文案（`workbench.js:137`），无实现。
- 测试：`interactions.mjs`（浏览器交互）、`drive-gui.mjs`（真实鼠标键盘 + 截图）、`loader.mjs`、`acceptance.mjs`、`fresh-build.mjs`；无命令层单测。
- 参考 MoMark：命令与视图分离、单一会话、命令级白盒测试；不照搬其 WYSIWYG 文档模型与 MoUI 视图层。

## Goals / Non-Goals

**Goals**：命令单源、⌘K 面板、会话单源、命令层测试；保持全部现有 e2e 契约与行为不变。

**Non-Goals**：Typst 源码的 WYSIWYG/富文本编辑；Typst AST 上下文 ABI 的实现（本轮只记录方向）；多文档/文件系统；修改 typst_abi 或编译/预览语义。

## Decisions

### D15 命令目录（commands.js）

- 纯数据 + 纯函数：`COMMANDS`（id/label/category/shortcut/run）与 `filterCommands(query)`、`commandActive(id, ctx)`；不触碰 DOM。
- `run(ctx)` 由 `workbench.js` 注入上下文（editor facade、session、toast、compile、preview、palette 等），目录本身可被 node 直接 import 测试。
- 菜单/工具栏/快捷键/命令面板由 catalog 派生：UI 定义只剩布局与分组，消除多路径行为分叉。

### D16 编辑会话（session.js）

- `createSession({ initialSource })` 返回 `getState/update/subscribe` 的 observable store；字段：`source、selection、status、revision、diagnostics、previewUrl、previewRevision、pageCount、page、previewReady`。
- CodeMirror 仍是文本编辑的事实来源；编辑回调把源码写入 session，编译管线读 session，compat `e2e_*` 读同一 session。
- 状态迁移保持现有语义：300ms 防抖 → `revision++` → 编译 → 诊断/预览；乱序编译以 revision 丢弃。
- 预览 URL 生命周期（创建/revoke、`urlRevision`/`urlSettled`）留在视图侧，但状态映射进 session 快照，测试读取不变。

### D17 命令面板

- ⌘K / Ctrl+K（编辑器内外均可用）打开；输入过滤 `label`/`id`；↑/↓ 选择、Enter 执行、Esc 关闭；点击命令亦可执行。
- 过滤与排序逻辑在 `commands.js`（可测）；面板 DOM 与键盘事件在 `workbench.js`。
- 执行与菜单共用 `runCommand(id)`，确保撤销栈与行为一致。

### D18 测试切分

- `e2e/commands.test.mjs`：node 直跑，覆盖目录完整性（id 唯一、快捷键无冲突、每命令有 label）、过滤、active 判定、session 状态迁移（模拟编译成功/失败/防抖 revision）。
- 浏览器路径由 `interactions.mjs` 增加命令面板用例（打开/过滤/执行/Esc）与工具栏 active 反馈断言；`drive-gui.mjs` 保持真实键鼠验证。
- `e2e/package.json` 增加 `commands` script；全量回归纳入验收。

## Risks / Trade-offs

- [重构回归] → compat `e2e_*` 契约冻结；先写命令层测试再改视图；全量 e2e 作为门槛（interactions/drive-gui/loader/acceptance/fresh-build）。
- [命令目录与 DOM 耦合] → run/active 通过注入上下文，不 import editor-bundle；目录可在 node 运行。
- [面板键位与 CodeMirror keymap 冲突] → 面板快捷键在 window 捕获阶段处理，编辑器聚焦时同样生效。
- [状态双写分叉] → session 单写入口 `update()`，compat 与 UI 都从快照读；编译管线只发布事件。

## Migration Plan

新增两个模块 → 命令目录与会话单测 → workbench 视图改为派生（保持 compat）→ 命令面板 → interactions 增断言 → 全量回归。回退：移除面板入口与新模块引用即可恢复旧视图（改动限于 `web_wasm`）。

## Open Questions

- Typst AST/光标上下文 ABI 的可行性（用于上下文感知面板与更精确的 active 判定）：需要评估 `typst_syntax` 在 wasm 侧的暴露成本，本轮不实现，记录为后续变更方向。
