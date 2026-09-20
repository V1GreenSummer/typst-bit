# CodeMoonBit 接入（替代 CodeMirror）

[CodeMoonBit](https://github.com/V1GreenSummer/CodeMoonBit) 是用 MoonBit 实现、编译到 wasm-gc 的 CodeMirror 风格编辑器（Apache-2.0）。本仓库已把它 vendor 进来并接出可切换的编辑器后端，推进“MoonBit 为核心”。

## 已完成（P0）

- **vendor**：源码在 `vendor/codemoonbit/`（含 LICENSE、测试与 CI 配置）
- **构建脚本**：`tools/build-codemoonbit.sh` — `moon build --target wasm-gc --release` 后把 `main.wasm`（约 173KB）与 `browser.js`/`dom_runtime.js`/`codemoonbit.css` 复制到 `app/typstbit/web_wasm/vendor/codemoonbit/`
- **上游补丁**：新增 `cm_set_selection` 导出（`editor.set_selection` + 导出注册 + JS handle 的 `setSelection`），这是实现“包裹选区/插入块/光标定位”的必要能力；补丁后其 133 项单测全绿
- **适配器**：`app/typstbit/web_wasm/editor-adapter-cmb.js`，实现与 CodeMirror 相同的编辑器 facade：`getDoc/setDoc/getSelection/setSelection/cursorPos/cursorLine/setCursorToLine/wrapSelection/prefixLines/insertBlock/clearMarks/openSearch/focus/undo/redo/onChange/onSelectionChange`；`setDiagnostics` 暂为 no-op（诊断仍由底部列表呈现）
- **切换开关**：`index.html?editor=cmb` 使用 CodeMoonBit；默认仍是 CodeMirror
- **工作台解耦**：`workbench.js` 不再访问 CodeMirror 内部（`editor.view`），定位/跳转/光标都走 facade，因此两种编辑器可互换
- **测试**：`e2e/editor-cmb.test.mjs`（启动/挂载/set_source 编译/包裹选区/光标助手/无报错）；10 套 e2e 全绿

## 体验方式

```sh
node tools/build-codemoonbit.sh          # 需要 moon（本机 wayland shim 不影响它）
# 打开 app/typstbit/web_wasm/index.html?editor=cmb
```

## 与 CodeMirror 的差距（替换前需要补）

| 能力 | 现状 |
|---|---|
| Typst 语法高亮 | CodeMoonBit 有约 50 种语言与通用 tokenizer，**无 Typst** → 需按其 registry 加一个 tokenizer（我们的 StreamLanguage 规则可移植） |
| 诊断标记（lint gutter/下划线） | 无 → 先保留底部诊断列表（点击跳转已可用），后续加一个 diagnostics 扩展 |
| 自动闭合括号/引号 | 无 → 在 keymap/输入层补 |
| 搜索面板 | 有，但样式与快捷键和 CodeMirror 面板不同，e2e 断言需按编辑器分支 |
| 主题 | 其 CSS 同用 `.cm-*` 类名，可与我们的 CSS 变量共存；需逐项校准暗色主题 |
| 无障碍 | 弱于 CodeMirror（视口 HTML 重建） |

## 迁移路线

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 ✅ | vendor + 构建 + 适配器 + `?editor=cmb` | CMB 冒烟 + 默认路径 10 套全绿 |
| P1 | 补 Typst 高亮、诊断扩展、自动闭合；把 interactions 的编辑器断言参数化并双跑对拍 | 两条编辑器路径同一套断言全绿 |
| P2 | 切默认为 CodeMoonBit，移除 `@codemirror/*` 与 `editor-bundle.js` | 依赖/体积下降；回归全绿 |
| P3 | 与 MoonBit 应用核心（session/commands）合并模块边界（编辑器与命令同源） | 见 `docs/moonbit-core.md` |

## 说明

- CodeMoonBit 是单例 wasm（页面内共享实例），与 `typst_abi` 相互独立；两者由 JS 宿主分别加载。
- 版本同步：vendor 目录记录上游源码；我们的补丁需要在下次同步上游时重放（`cm_set_selection`）。
