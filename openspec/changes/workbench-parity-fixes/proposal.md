# 变更提案：工作台 P0/P1 修复（对齐现有 spec）

## Why

评估报告 `docs/review-workbench-2026-09-16.md` 发现工作台存在功能回退与规范违背：页面导航被移除却留下假 e2e 兼容（`e2e_turn_page` 为 no-op、`e2e_current_page` 恒 0）、编辑会话未真正单源（`session.update/subscribe` 生产路径无人调用）、撤销/重做菜单与命令面板是 toast 假动作、命令面板无法点击外部关闭且菜单可同时打开、`previewReady` 1500ms 盲置真。这些行为均与 `typst-preview` / `workbench-editor` 主 spec 冲突，属于实现缺陷而非需求变更。

## What Changes

- 恢复**栅格分页预览**：预览面板按页渲染 PNG（复用 `typst_abi_render_page_png`），提供上一页/下一页与页码显示；`e2e_turn_page` / `e2e_current_page` 返回真实状态；PDF 仅用于导出与「在新标签页打开」。
- 预览就绪语义真实化：以页面图像 `onload` 为准，删除 1500ms 盲兜底。
- 编辑会话**真单源**：workbench 状态写入 `session.update()`，源码/选区同步进会话，compat 与 UI 读同一会话。
- 撤销/重做**同源**：编辑器 facade 暴露 `undo/redo`，命令目录真实调用；菜单/命令面板路径与键盘一致。
- 面板与菜单交互修复：命令面板点击外部关闭且不拦截编辑器点击；菜单互斥打开、Escape 与外部点击关闭。
- 命令语义修复：「引用」插入 `#quote[...]`；「清除标记」只处理选区与行首标记，不破坏 `snake_case` 等标识符；格式按钮按可应用性置灰。
- 分享与存储：启动解码 hash 后 `history.replaceState` 清除，避免遮蔽后续编辑；localStorage 读写容错；超长分享链接给出提示。
- 预算口径：`index.html` 优先加载 `typst_abi.opt.wasm`（缺失时回退非优化产物），acceptance 校验实际被服务的产物；同步 `docs/acceptance.md` 实测数字。
- 测试：恢复 loader 翻页断言；interactions 更新引用/清除标记并新增面板外部点击、菜单互斥、撤销菜单断言；commands 单测补充；全量回归。

## Capabilities

无 spec 变更（`skip_specs: true`）：以上均为实现对齐既有 `typst-preview`（分页预览与页码导航、字体覆盖）与 `workbench-editor`（命令同源、命令面板、编辑会话单一状态、命令层测试）需求。

## Impact

- `app/typstbit/web_wasm/{workbench.js,workbench-entry.js,workbench.css,index.html}`；`editor-bundle.js` 重建
- `e2e/{loader.mjs,interactions.mjs,drive-gui.mjs,commands.test.mjs,acceptance.mjs}`；`docs/acceptance.md`
- 不涉及 `typst_abi` 与字体数据；体积预算不变（预览由 PDF embed 改栅格 PNG，导出 PDF 保留）
