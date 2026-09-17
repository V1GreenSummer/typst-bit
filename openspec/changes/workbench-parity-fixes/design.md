# 设计：工作台 P0/P1 修复

## Context

见 `proposal.md` 与 `docs/review-workbench-2026-09-16.md`。现状关键点：预览是 `<embed>` PDF（`workbench.js` requestPdf/updatePreviewView），无应用级翻页；`session.js` 的 `update/subscribe` 仅单测使用；命令目录的 `undo/redo`、`引用` 语义与 `clearMarks` 均与预期不符；`e2e_turn_page/current_page` 是空壳。

## Goals / Non-Goals

**Goals**：恢复栅格分页与导航、预览就绪真实、会话真单源、命令同源、面板/菜单交互修复、分享协议与预算口径修正。

**Non-Goals**：大纲面板化、「未保存」脏状态、插入光标位置优化、自动补全 source、弹窗拦截反馈（评估报告 P1 其余项，另行处理）；PNG-first 打字期实时刷新（属后续 `png-first-live-preview`，本变更先提供稳定栅格基线）。

## Decisions

### D19 栅格分页预览

- 预览面板从 `<embed type=application/pdf>` 改为 `<img class="pdf-view">`，内容来自 `typst_abi_render_page_png(page, scaleMilli)`（复用 `workbench.js:55-59` 已有封装；legacy loader 曾用同路径）。
- 预览头新增「上一页 / 第 X / N 页 / 下一页」，`page` 越界钳制；编译成功重置到第 1 页。
- `state.scale` 保持 `1500`（1.5x，验收 19ms/页），CSS `object-fit: contain` 适配面板。
- PDF blob 继续生成（`pdf()` + `Blob`），仅用于导出与「在新标签页打开」；`currentSource` 仍返回 PDF blob，e2e 契约不变。

### D20 预览就绪语义

- `previewReady` 仅在页面图像 `onload` 后置真；新渲染开始时置假。删除 1500ms 盲兜底。
- `previewFailed` 由 `img.onerror` 置真；失败保留上一张图（不换 src）直到下一次成功。

### D21 会话真单源

- `workbench.js` 将编译/诊断/预览/页码/scale 等状态统一通过 `session.update({...})` 写入；编辑回调同步 `source`，编辑器选区回调同步 `selection`。
- `__typstbit` 的 `e2e_*` 改为从 `session.getState()` 读取；UI 渲染函数同样读同一快照。
- `session.state` 只作为兼容别名保留（避免一次性大改），但所有写入走 `update()`。

### D22 撤销/重做同源

- `workbench-entry.js` facade 增加 `undo()` / `redo()`（调用 `@codemirror/commands` 的 `undo`/`redo`，并 `focus()`）。
- 命令目录 `undo`/`redo` 改为 `ctx.editor.undo()/redo()`；键盘 `Mod-z` 仍走 `historyKeymap`，两者底层同一实现。

### D23 面板与菜单交互

- 命令面板：`open` 时监听 document 捕获点击，点击面板外关闭；面板 `pointer-events` 仅在 open 时启用，不再拦截编辑器。
- 菜单：全局记录已打开菜单节点，打开新菜单时关闭其它菜单；`Escape` 关闭当前菜单；document 点击关闭（菜单按钮不再阻止冒泡到关闭逻辑）。

### D24 命令语义与 disabled

- `引用` 命令改为 `ctx.editor.insertBlock("#quote[\n\n]")`；interactions 断言同步更新。
- `clearMarks` 改为：选区内成对的 `*…*` / `_…_` / `#underline[…]` 解包；无选区时仅去除行首块标记（`= +`、`- `、`+ `、`1. `），不再全局删除 `[*_]`。
- 命令目录新增可选 `enabled(ctx)`；格式类命令在没有选区且非切换场景时 disabled，工具栏按钮同步 `disabled` 属性与样式。

### D25 分享与存储

- 启动时若通过 `#c=` 还原文档，解码后调用 `history.replaceState` 清除 hash（保留 localStorage 为后续刷新来源）。
- localStorage 读写包 try/catch；分享 URL 超过阈值（如 8000 字符）时改为仅写入 localStorage 并 toast 提示。
- 剪贴板失败仍回退显示链接（现有行为保留）。

### D26 服务产物与预算校验

- `index.html` 优先把 `typst_abi.opt.wasm` 传给 workbench；workbench 启动 fetch 失败时回退 `typst_abi.wasm`。
- acceptance 记录「实际服务产物」并以其校验 raw/brotli/首载预算；`docs/acceptance.md` 数字与内存值按实测更新。

## Risks / Trade-offs

- [栅格预览丢失 PDF 文本选择] → 导出/新标签页保留 PDF；预览聚焦排版结果，与旧壳一致。
- [渲染耗时 14-31ms/页] → 仅在编译成功与翻页时渲染，不在打字期逐键触发；后续 PNG-first 变更继续优化。
- [e2e 断言迁移] → loader 恢复翻页断言、drive-gui 预览就绪断言改为图像 onload；以全量套件为门槛。
- [hash 清除改变分享刷新行为] → 刷新改用 localStorage（编辑已持久化），分享链接首次打开仍生效。

## Migration Plan

栅格预览与导航 → 就绪语义 → 会话单源 → 撤销同源 → 面板/菜单 → 命令语义与 disabled → 分享/预算 → 测试与回归。回退：预览切回 `<embed>` 并移除导航控件即可（改动限于 `web_wasm` 与测试）。

## Open Questions

（无）
