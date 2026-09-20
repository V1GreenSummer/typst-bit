# 主题、布局与背景自定义

工作台的全部视觉都走 CSS 变量，插件可通过 `api.theme` 修改，无需改应用代码。

## CSS 变量

| 分组 | 变量 |
|---|---|
| 基础 | `--ink` `--muted` `--line` `--bg` `--panel` `--chrome` `--editor` |
| 强调 | `--accent` `--accent-ink` `--accent-soft` `--accent-softer` `--hover` |
| 语义 | `--danger` `--danger-soft` `--warning` `--success` `--success-soft` `--busy` `--busy-soft` |
| 编辑器 | `--gutter` `--gutter-ink` `--active-line` `--active-gutter` `--preview-bg` `--font-size-editor` |
| 布局 | `--sidebar-width` `--editor-fr` `--preview-fr` `--radius` `--radius-lg` `--shadow` |
| 其他 | `--toast-bg` `--toast-ink` |

预设通过 `body[data-theme]` 切换：`dark`（暗色）、`sepia`（暖色）、无属性为明亮。紧凑布局为 `body.compact`。

## 插件示例

```js
import { definePlugin } from ".../plugins.js";

export default definePlugin({
  id: "nord-theme",
  name: "Nord 主题",
  setup(api) {
    api.theme.setBodyAttribute("data-theme", "dark");
    api.theme.setVariables({
      "--accent": "#88c0d0",
      "--bg": "#2e3440",
      "--panel": "#3b4252",
      "--chrome": "#343b49",
      "--editor": "#2e3440",
      "--ink": "#eceff4",
      "--line": "#4c566a",
      "--preview-bg": "#272c36",
    });
    api.theme.addStyle(`
      .brand { letter-spacing: .04em; }
      .preview-pane .pane-head { text-transform: uppercase; }
    `);
  },
});
```

- `setVariables({...})`：写入 `--*`，覆盖预设中同名值。
- `addStyle(css)`：注入任意 CSS（按插件隔离在独立 `<style>` 中）。
- `setBodyAttribute(name, value)`：如切换 `data-theme`；传 `null` 移除。
- `setBodyClass(name, enabled)`：如 `compact`。

## 布局定制

```js
api.theme.setVariables({
  "--sidebar-width": "240px",
  "--editor-fr": "2fr",
  "--preview-fr": "1fr",
});
api.theme.addStyle(`
  .sidebar { display: none; }        /* 隐藏工程栏 */
  .diagnostics { height: 64px; }     /* 诊断区高度 */
`);
```

## 稳定选择器（可安全用于主题 CSS）

`.app` `.topbar` `.menubar` `.formatbar` `.workspace-grid` `.sidebar` `.file-list` `.editor-pane` `.preview-pane` `.pdf-frame` `.diagnostics` `.statusbar` `.command-palette` `.outline-panel` `.settings-panel` `.toast`，以及 CodeMoonBit 的 `.cm-editor` `.cm-gutters` `.cm-activeLine`（`.cm-mark`/`.cm-panel` 等同类名）。

## 内置「主题与布局」插件

设置项：主题（明亮/暗色/暖色）、强调色、编辑器字号、预览背景色、侧栏宽度、紧凑布局；命令面板另提供「切换到暗色主题 / 切换到明亮主题 / 重新应用主题」。

> 插件的样式随页面加载注入；禁用/删除插件后刷新页面即恢复。主题想随分享保留，可在插件里把选择写入 `localStorage`（`api.settings` 已自动持久化）。
