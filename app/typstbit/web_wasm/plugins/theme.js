import { definePlugin } from "../plugins.js";

const THEMES = ["default", "dark", "sepia"];

function isColor(value) {
  return /^#[0-9a-f]{3,8}$/i.test(value ?? "");
}

function applyTheme(api) {
  const values = api.settings.all();
  const theme = THEMES.includes(values.theme) ? values.theme : "default";
  api.theme.setBodyAttribute("data-theme", theme === "default" ? null : theme);
  api.theme.setBodyClass("compact", Boolean(values.compact));

  const variables = {};
  if (isColor(values.accent)) variables["--accent"] = values.accent;
  if (isColor(values.previewBackground)) variables["--preview-bg"] = values.previewBackground;
  const size = Number(values.editorFontSize);
  if (Number.isFinite(size) && size >= 8 && size <= 32) variables["--font-size-editor"] = `${size}px`;
  const width = Number(values.sidebarWidth);
  if (Number.isFinite(width) && width >= 120 && width <= 480) variables["--sidebar-width"] = `${width}px`;
  api.theme.setVariables(variables);
}

export default definePlugin({
  id: "theme",
  name: "主题与布局",
  setup(api) {
    api.settings.define({
      title: "主题与布局",
      fields: [
        {
          key: "theme",
          label: "主题",
          type: "select",
          options: [
            { value: "default", label: "明亮" },
            { value: "dark", label: "暗色" },
            { value: "sepia", label: "暖色" },
          ],
        },
        { key: "accent", label: "强调色（hex）", type: "text", placeholder: "#315fce" },
        { key: "editorFontSize", label: "编辑器字号（8-32 px）", type: "text", placeholder: "14" },
        { key: "previewBackground", label: "预览背景色", type: "text", placeholder: "#e7e9ed" },
        { key: "sidebarWidth", label: "侧栏宽度（120-480 px）", type: "text", placeholder: "190" },
        { key: "compact", label: "紧凑布局", type: "boolean" },
      ],
    });
    api.commands.register([
      {
        id: "plugin.theme.apply",
        label: "重新应用主题",
        category: "插件",
        run: () => {
          applyTheme(api);
          api.ui.toast("主题与布局已应用");
        },
      },
      { id: "plugin.theme.dark", label: "切换到暗色主题", category: "插件", run: () => { api.settings.set("theme", "dark"); applyTheme(api); api.ui.toast("已切换到暗色主题"); } },
      { id: "plugin.theme.light", label: "切换到明亮主题", category: "插件", run: () => { api.settings.set("theme", "default"); applyTheme(api); api.ui.toast("已切换到明亮主题"); } },
    ]);
    applyTheme(api);
  },
  onSettingsChanged(api) {
    applyTheme(api);
  },
});
