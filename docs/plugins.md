# Typst.bit 插件开发指南

工作台内置一个轻量插件系统：插件是普通 ES module，通过宿主 API 注册命令、菜单、导出格式与设置项，无需修改应用代码。

## 快速开始

新建 `my-plugin.js`：

```js
import { definePlugin } from "https://v1greensummer.github.io/typst-bit/app/typstbit/web_wasm/plugins.js";

export default definePlugin({
  id: "hello-plugin",
  name: "示例插件",
  setup(api) {
    api.commands.register([
      {
        id: "hello-plugin.greet",
        label: "打个招呼",
        category: "插件",
        run: ctx => ctx.ui.toast(`你好，当前 ${ctx.editor.getDoc().length} 个字符`),
      },
    ]);
  },
});
```

在应用地址后追加 `?plugin=<你的插件 URL>` 即可加载（需 CORS 允许），例如：

```
https://v1greensummer.github.io/typst-bit/app/typstbit/web_wasm/index.html?plugin=https://example.com/my-plugin.js
```

也可把插件 URL 写入 `localStorage` 的 `typstbit.plugins` 数组（JSON），之后每次启动自动加载。

> 插件拥有页面完整权限，只加载你信任的来源。

## 宿主 API

`setup(api)` 的 `api` 提供：

| API | 说明 |
|---|---|
| `api.commands.register(list)` | 注册命令，进入 ⌘K 命令面板与「插件」菜单；字段：`id/label/category?/run(ctx)/active?(ctx)/enabled?(ctx)` |
| `api.menus.register({ label, items })` | 新增一个顶级菜单；`items` 为 `{ id, label? }` 列表（引用已注册命令） |
| `api.export.register({ id, label, extension, build({ typst, session, editor }) })` | 注册导出格式；`build` 返回 `Blob` 或 `null`，自动生成下载 |
| `api.settings.define(schema)` | 声明设置表单（见下），出现在「插件设置…」对话框 |
| `api.settings.get/set/all()` | 读写本插件命名空间下的设置（localStorage `typstbit.plugin.<id>`） |
| `api.ui.toast(message)` | 轻提示 |
| `api.ui.openSettings()` | 打开本插件的设置对话框 |
| 插件描述符 `onSettingsChanged(api)` | 用户在设置对话框保存后回调（用于即时应用外观等） |
| `api.editor` | 编辑器 facade：`getDoc/setDoc/getSelection/wrapSelection/prefixLines/insertBlock/clearMarks/openSearch/focus/undo/redo` |
| `api.session` | 编辑会话：`getState/subscribe`（源码、状态、revision、诊断、页码、预览） |
| `api.typst` | 编译产物：`exportPdf()`、`exportSvg(page)`、`renderPagePng(page, scaleMilli)`，返回 `Uint8Array` 或 `null` |

命令的 `run(ctx)` 收到工作台上下文：`{ editor, session, ui, actions }`。

### 设置表单 schema

```js
api.settings.define({
  title: "图床设置",
  fields: [
    { key: "endpoint", label: "上传地址", type: "text", placeholder: "https://..." },
    { key: "token", label: "访问令牌", type: "password" },
    { key: "autoUpload", label: "粘贴图片时自动上传", type: "boolean" },
    { key: "style", label: "样式", type: "select", options: [{ value: "a", label: "样式 A" }] },
  ],
});
```

字段类型：`text`（默认）、`password`、`boolean`、`select`。保存后可用 `api.settings.get("endpoint")` 读取。

### 导出格式示例

```js
api.export.register({
  id: "svg-current",
  label: "SVG（当前页）",
  extension: "svg",
  build: ({ typst, session }) => {
    const bytes = typst.exportSvg(session.page ?? 0);
    return bytes ? new Blob([bytes], { type: "image/svg+xml" }) : null;
  },
});
```

## 内置示例插件

- **字数统计**（`app/typstbit/web_wasm/plugins/word-count.js`）：注册命令，统计字数/字符/行数。
- **图床设置**（`plugins/image-host.js`）：设置表单 + 插入图床模板命令。
- **导出格式**（`plugins/export-formats.js`）：注册 SVG / PNG 导出。
- **文档模板**（`plugins/templates.js`）：插入封面、双栏文章、幻灯片（16:9）、代码报告模板。
- **二维码**（`plugins/qrcode.js`）：把选中文本（或默认链接）转成 `@preview/tiaoma` 二维码，自动补 `#import`。
- **导出网页**（`plugins/export-html.js`）：把全部页面按 SVG 内嵌导出为单文件 HTML。
- **源码工具**（`plugins/source-tools.js`）：复制源码、下载 `main.typ`。
- **外观设置**（`plugins/appearance.js`）：编辑器字号与预览背景色；演示 `onSettingsChanged` 回调即时生效。

外部插件可在「插件」菜单 →「插件设置…」的“外部插件”区域填入 URL 即时加载（也可用 `?plugin=` 或 `localStorage` 的 `typstbit.plugins`）。

## 可以用插件做什么

- **导出模板与格式**：SVG/PNG/HTML、自定义封面与页眉页脚、按页导出、打包 ZIP。
- **图床与资源**：设置上传端点与令牌，粘贴图片自动上传并插入 `#image(...)`。
- **写作辅助**：字数统计、术语检查、自动目录、参考文献格式化。
- **LLM/MCP 集成**：把源码、诊断、大纲导出给外部工具；仓库提供 `tools/typstbit-mcp.mjs`，可将同一 WASM 编译器作为 MCP 工具接入大模型（见 `docs/mcp.md`）。

## 架构与复用

- `commands.js`：命令目录（核心命令 + `registerCommands` 运行时扩展）。
- `session.js`：编辑会话单源状态。
- `packages.js` + `packages/`：离线 `@preview` 包懒加载。
- `outline.js`：大纲解析（去标签、跳过代码围栏）。
- `plugins.js`：插件注册表、设置存储与宿主工厂。
- `editor-bundle.js`：CodeMirror facade（`workbench-entry.js` 打包产物）。

以上模块均不依赖工作台 DOM，可被其他项目直接 import 复用。
