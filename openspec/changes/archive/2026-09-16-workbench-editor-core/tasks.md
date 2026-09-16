# 任务：工作台命令层与编辑会话

## 1. 会话模型与命令目录

- [x] 1.1 新增 `app/typstbit/web_wasm/session.js`（`createSession`：`getState/update/subscribe`，字段按 D16），验证：会话状态迁移用例（防抖 revision、编译成功/失败、重置）通过
- [x] 1.2 新增 `app/typstbit/web_wasm/commands.js`（`COMMANDS`/`filterCommands`/`commandActive`/`runCommand` 约定，纯函数无 DOM），验证：目录完整性、过滤、active 判定用例通过
- [x] 1.3 新增 `e2e/commands.test.mjs`（node 直跑，无浏览器）并加入 `e2e/package.json` scripts，验证：`node commands.test.mjs` 退出码 0

## 2. workbench 视图派生

- [x] 2.1 菜单、工具栏、顶栏由 catalog 派生并统一走 `runCommand`，行为与现行一致，验证：`node interactions.mjs` 全绿
- [x] 2.2 编译/诊断/预览管线写入 session，`__typstbit` 的 `e2e_*` 改读 session，验证：`node loader.mjs`、`node drive-gui.mjs` 全绿且 compat 字段无缺
- [x] 2.3 工具栏与菜单的 active/disabled 反馈接入 `commandActive`，验证：`node drive-gui.mjs` 新增 active 断言通过

## 3. 命令面板

- [x] 3.1 实现 ⌘K / Ctrl+K 命令面板（过滤、键盘导航、Enter 执行、Esc 关闭、点击执行），验证：`node interactions.mjs` 面板用例通过
- [x] 3.2 `interactions.mjs` 增加命令面板与 ⌘K 快捷键用例（含 Escape 不执行），验证：`node interactions.mjs` 全绿

## 4. 回归与文档

- [x] 4.1 全量回归：`node interactions.mjs`、`node loader.mjs`、`node acceptance.mjs`、`node drive-gui.mjs`、`node fresh-build.mjs`（需同步源码到 fresh 并重建 rust wasm）全部 PASS
- [x] 4.2 补充 `docs/acceptance.md` 或 `web_wasm` 结构说明：命令目录/会话模块职责与 `commands.test.mjs` 入口，验证：文档与实现一致
