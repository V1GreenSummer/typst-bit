# CodeMoonBit 接入（已替代 CodeMirror）

[CodeMoonBit](https://github.com/V1GreenSummer/CodeMoonBit) 是用 MoonBit 实现、编译到 wasm-gc 的 CodeMirror 风格编辑器（MIT）。本仓库已把它 vendor 进来作为**唯一编辑器后端**，推进“MoonBit 为核心”。

## 已完成（P0 + P1 + P2）

- **vendor**：源码在 `vendor/codemoonbit/`（含 LICENSE、测试与 CI 配置）
- **构建脚本**：`tools/build-codemoonbit.sh` — `moon build --target wasm-gc --release` 后把 `main.wasm`（约 201KB）与 `browser.js`/`dom_runtime.js`/`codemoonbit.css` 复制到 `app/typstbit/web_wasm/vendor/codemoonbit/`
- **上游补丁**：
  - `cm_set_selection` 导出（`editor.set_selection` + 导出注册 + JS handle 的 `setSelection`），这是实现“包裹选区/插入块/光标定位”的必要能力
  - **Typst 语言**：`highlight/lang_typst.mbt`（标题/列表/标签/引用/命令/关键字/字符串/原文/数学/粗斜体/可嵌套块注释，跨行状态），注册为 `typst`/`typ`
  - **词级移动**：`Ctrl+←/→` 与 `Ctrl+Shift+←/→`（`cursor_word_left/right`、`select_word_left/right`）
  - **诊断标记**：`cm_set_diagnostics(id, json)` → `Diagnostic` 装饰（`cm-diagnostic-error/warning` 波浪下划线），JSON 解析用 core 的 `@json`
  - 补丁后上游单测 137 项全绿（含新增 Typst/词移动用例）
- **适配器**：`app/typstbit/web_wasm/editor-adapter-cmb.js`，实现与 CodeMirror 相同的编辑器 facade：`getDoc/setDoc/getSelection/setSelection/cursorPos/cursorLine/setCursorToLine/wrapSelection/prefixLines/insertBlock/clearMarks/openSearch/focus/undo/redo/onChange/onSelectionChange/setDiagnostics`
  - 主题跟随 `body[data-theme]`（MutationObserver 同步 `theme` 选项）
  - 自动闭合 `()[]{}""` 与反引号，闭合符可“越过”；组合输入（IME）期间不拦截
  - 命令执行后自动 `focus()`，与 CodeMirror 路径行为一致
- **唯一编辑器**：`workbench.js` 直接加载 `editor-adapter-cmb.js`；CodeMirror 依赖、`editor-bundle.js`/`workbench-entry.js` 与 `e2e/build-workbench.mjs` 已移除
- **工作台解耦**：`workbench.js` 不访问编辑器内部，定位/跳转/光标都走 facade；诊断同步按当前文件过滤后交给编辑器
- **测试**：
  - `e2e/editor-cmb.test.mjs`：启动/挂载/set_source 编译/包裹选区/光标助手/Typst 高亮/自动闭合/主题/诊断标记/无报错
  - `e2e/interactions.mjs`：72 项断言全绿（当前唯一的整体交互回归）
  - 10 套 e2e 全绿

## 体验方式

```sh
node tools/build-codemoonbit.sh          # 需要 moon（本机 wayland shim 不影响它）
# 打开 app/typstbit/web_wasm/index.html（CodeMoonBit）
```

## 与 CodeMirror 的能力对照（替换后仍然存在的差距）

| 能力 | 现状 |
|---|---|
| Typst 语法高亮 | ✅ P1 已补（`highlight/lang_typst.mbt`） |
| 诊断标记 | ✅ P1 已补（编辑器内波浪标记 + 底部列表） |
| 自动闭合括号/引号 | ✅ P1 已在适配器层补（IME 安全） |
| 搜索面板 | ✅ 有（`.cm-panel.cm-search` 兼容类名），快捷键 `Ctrl-f` |
| 主题 | ✅ 跟随 `body[data-theme]`（含暗色），诊断色也定义了明暗变量 |
| 词级移动（Ctrl/⌘+方向键） | ✅ P1 已补 |
| 折叠 gutter | ✅ 已有（`cm-fold-foldable`/`cm-fold-folded`，gutter 点击折叠） |
| 未对齐项 | lint gutter 图标、多光标部分快捷键、无障碍（视口 HTML 重建）弱于 CodeMirror（后续按需补） |

## 迁移路线

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 ✅ | vendor + 构建 + 适配器 + `?editor=cmb` | CMB 冒烟 + 默认路径 10 套全绿 |
| P1 ✅ | Typst 高亮、诊断标记、自动闭合、词级移动、主题同步；interactions 参数化双跑对拍 | 两条编辑器路径同一套 72 项断言全绿 |
| P2 ✅ | 默认切 CodeMoonBit，移除 `@codemirror/*`、`editor-bundle.js`/`workbench-entry.js` 与打包脚本 | 单编辑器路径全绿；依赖/体积下降 |
| P3 | 与 MoonBit 应用核心（session/commands）合并模块边界（编辑器与命令同源） | 见 `docs/moonbit-core.md` |

## 性能优化（2026-09-21）

- **行级 HTML 缓存**：`EditorView` 按行缓存 `(签名, JsAny)`，签名含 tokenizer 状态/active/fold/装饰/文本；未变化的行以 `sb_push_js` 单次 FFI 推入（此前每帧整视口逐字符跨边界，约 4–6k 次/帧）。实测每帧仅重建改动行（命中 ≈21/22），内容帧聚合为 22 个字符串推入。
- **持久光标 overlay**：光标由 JS scaffold 创建一次（`.cm-cursor`），`set_cursor` 仅在变化时写样式；不再随 innerHTML 重建，闪烁动画不重置（修复删除时乱闪）。
- **渲染去重**：`ensure_cursor_visible` 仅在可见行范围变化时重渲染；滚动跟随不再触发整稿重渲染。
- **转义批量化**：`push_escaped` 按普通文本段推送，仅对 `& < > "` 逐字符。
- 基准：`e2e/editor-perf.mjs`（200 行文档、100 键输入/删除；mutation 预算与 p95 20ms 阈值），`npm run editor-perf`。

## 说明

- CodeMoonBit 是单例 wasm（页面内共享实例），与 `typst_abi` 相互独立；两者由 JS 宿主分别加载。
- 版本同步：vendor 目录记录上游源码；我们的补丁需要在下次同步上游时重放（`cm_set_selection`）。
