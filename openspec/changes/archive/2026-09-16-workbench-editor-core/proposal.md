# 变更提案：工作台命令层与编辑会话

## Why

`bundle-cjk-times-fonts` 修复中文渲染后，编辑体验的下一个短板是**一致性**：菜单（File/Edit/View/Help）、格式工具栏、顶栏按钮各自直接绑定回调，快捷键散落在 CodeMirror keymap 与菜单标签中，同一动作存在多条实现路径，行为容易分叉；顶栏提示「⌘K 搜索命令」没有实现（`workbench.js:137` 仅有文案）；编译状态、revision、诊断、预览 URL/revision 分散在闭包 `state` 与 `__typstbit` compat 镜像中，缺少命令层的可回归测试。MoMark 的核心经验是：命令与视图分离、单一编辑会话、命令级测试密度。

## What Changes

- 新增 `commands.js`：统一命令目录（稳定 id、label、category、shortcut、active/enabled 判定、run(ctx)）；菜单、工具栏、快捷键、命令面板全部由 catalog 派生，同一动作的行为只改一处。
- 新增 `session.js`：单一编辑会话模型（源码、选区、编译状态、revision、诊断、预览 url/revision），提供快照与订阅；`__typstbit` 的 `e2e_*` 全部映射到会话，保持现有测试契约。
- 实现 **⌘K / Ctrl+K 命令面板**：按名称或 id 过滤、键盘上下导航、Enter 执行、Esc 关闭，执行路径与菜单完全一致。
- 工具栏/菜单命令的 active/disabled 状态由 catalog 统一判定（基于当前选区/光标）。
- 新增命令层测试 `e2e/commands.test.mjs`（node 直跑 `commands.js`/`session.js`，无浏览器）；GUI 事件路径继续由 `interactions.mjs` / `drive-gui.mjs` 覆盖。
- 不修改编译/预览语义与 `typst_abi` ABI；无体积预算影响。

## Capabilities

### New Capabilities

- `workbench-editor`: 浏览器编辑工作台的统一命令分发、命令面板与编辑会话行为。

### Modified Capabilities

（无）

## Impact

- `app/typstbit/web_wasm/commands.js`、`session.js`（新增）；`workbench.js`（改为视图层，从 catalog/session 派生 UI 与状态）
- `e2e/commands.test.mjs`（新增）、`e2e/interactions.mjs`（命令面板与 active 断言）、`e2e/package.json`（scripts）
- `__typstbit` e2e compat 接口保持稳定，`interactions.mjs` / `loader.mjs` / `acceptance.mjs` / `drive-gui.mjs` 不降级
- 新增模块仅被 `workbench.js` 以原生 ES module 引用，无需重跑 esbuild 打包
