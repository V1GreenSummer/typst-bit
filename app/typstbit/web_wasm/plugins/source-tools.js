import { definePlugin } from "../plugins.js";

export default definePlugin({
  id: "source-tools",
  name: "源码工具",
  setup(api) {
    api.commands.register([
      {
        id: "plugin.source-tools.copy",
        label: "复制源码",
        category: "插件",
        run: async ctx => {
          try {
            await navigator.clipboard.writeText(ctx.editor.getDoc());
            ctx.ui.toast("源码已复制到剪贴板");
          } catch {
            ctx.ui.toast("复制失败：剪贴板不可用");
          }
        },
      },
      {
        id: "plugin.source-tools.download",
        label: "下载 .typ 源码",
        category: "插件",
        run: ctx => {
          const blob = new Blob([ctx.editor.getDoc()], { type: "text/plain;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const link = Object.assign(document.createElement("a"), { href: url, download: "main.typ" });
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          ctx.ui.toast("已下载 main.typ");
        },
      },
    ]);
  },
});
