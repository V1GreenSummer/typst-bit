import { definePlugin } from "../plugins.js";

function applyAppearance(style, settings) {
  const size = Number(settings.editorFontSize);
  style.textContent = [
    Number.isFinite(size) && size >= 8 && size <= 32 ? `.cm-content { font-size: ${size}px; }` : "",
    settings.previewBackground ? `.pdf-frame { background: ${settings.previewBackground}; }` : "",
  ].join("\n");
}

export default definePlugin({
  id: "appearance",
  name: "外观设置",
  setup(api) {
    api.settings.define({
      title: "外观设置",
      fields: [
        { key: "editorFontSize", label: "编辑器字号（8-32 px）", type: "text", placeholder: "14" },
        { key: "previewBackground", label: "预览背景色", type: "text", placeholder: "#e7e9ed" },
      ],
    });

    const style = document.createElement("style");
    style.dataset.plugin = "appearance";
    document.head.append(style);
    applyAppearance(style, api.settings.all());

    api.commands.register([
      {
        id: "plugin.appearance.settings",
        label: "外观设置…",
        category: "插件",
        run: () => api.ui.openSettings(),
      },
      {
        id: "plugin.appearance.apply",
        label: "重新应用外观设置",
        category: "插件",
        run: () => {
          applyAppearance(style, api.settings.all());
          api.ui.toast("外观设置已应用");
        },
      },
    ]);
  },
  onSettingsChanged(api) {
    const style = document.querySelector('style[data-plugin="appearance"]');
    if (style) applyAppearance(style, api.settings.all());
  },
});
