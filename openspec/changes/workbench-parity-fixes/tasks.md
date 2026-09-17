# 任务：工作台 P0/P1 修复

## 1. 栅格分页预览与就绪语义

- [x] 1.1 预览面板改为 `<img>` + `typst_abi_render_page_png`，新增「上一页 / 第 X / N 页 / 下一页」控件与状态（`page/pageCount/scale`），PDF blob 仅用于导出与新标签页，验证：`node drive-gui.mjs` 预览断言全过
- [x] 1.2 `e2e_turn_page` / `e2e_current_page` 返回真实状态；loader 恢复「下一页→第 2 页、上一页钳制」断言，验证：`node loader.mjs` 全绿
- [x] 1.3 预览就绪以图像 `onload` 为准，删除 1500ms 盲兜底；`previewFailed` 走 `onerror` 且保留上一张图，验证：interactions/acceptance 预览断言不依赖盲等

## 2. 编辑会话真单源

- [x] 2.1 workbench 状态写入统一走 `session.update()`，编辑/选区同步 `source/selection`，UI 与 `e2e_*` 读同一会话，验证：`node commands.test.mjs` + `node interactions.mjs` 全绿
- [x] 2.2 会话单源写入校验：编辑/选区写入会话、编译管线统一 `update()`；`typst_image_event`/`urlSettled/urlRevision` 作为 compat 契约保留，验证：套件全绿（loader 预览/blob 断言不回归）

## 3. 撤销重做与命令语义

- [x] 3.1 facade 增加 `undo()/redo()`，命令目录真实调用（菜单/面板/快捷键同源），验证：interactions 新增「Edit 菜单撤销」断言通过
- [x] 3.2 「引用」改为插入 `#quote[...]`；`clearMarks` 只处理选区成对标记与行首块标记（保留 `snake_case`），验证：interactions 更新断言并通过
- [x] 3.3 命令目录新增 `enabled(ctx)`，格式按钮同步 disabled 与样式，验证：commands 单测 + drive-gui 断言通过

## 4. 面板与菜单交互修复

- [x] 4.1 命令面板点击外部关闭且不拦截编辑器点击，验证：interactions 新增外部点击断言通过
- [x] 4.2 菜单互斥打开、Escape 与外部点击关闭，验证：interactions 新增菜单互斥断言通过

## 5. 分享与预算口径

- [x] 5.1 hash 还原后 `history.replaceState` 清除；localStorage 读写容错；超长链接本地提示，验证：interactions 分享往返 + 新增「hash 清除」断言通过
- [x] 5.2 `index.html` 优先加载 `typst_abi.opt.wasm`（fetch 失败回退非优化产物）；acceptance 校验实际服务产物；同步 `docs/acceptance.md` 数字，验证：`node acceptance.mjs` PASS 且文档与实测一致

## 6. 回归与收尾

- [x] 6.1 全量回归：`commands.test.mjs`、`interactions.mjs`、`loader.mjs`、`acceptance.mjs`、`drive-gui.mjs` 全 PASS
- [x] 6.2 fresh 构建回归（同步源码 + 重建 rust wasm + `fresh-build.mjs`）PASS；确认无 spec 漂移（`openspec validate --specs`）
