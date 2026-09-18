import { definePlugin } from "../plugins.js";

export default definePlugin({
  id: "word-count",
  name: "字数统计",
  setup(api) {
    api.commands.register([
      {
        id: "plugin.word-count.count",
        label: "统计当前文档",
        category: "插件",
        run: ctx => {
          const text = ctx.editor.getDoc();
          const chars = [...text].length;
          const words = text.trim() ? text.trim().split(/\s+/).length : 0;
          const lines = text.split("\n").length;
          ctx.ui.toast(`字数：${words} · 字符：${chars} · 行数：${lines}`);
        },
      },
    ]);
  },
});
