import { definePlugin } from "../plugins.js";

export default definePlugin({
  id: "qrcode",
  name: "二维码",
  setup(api) {
    api.commands.register([
      {
        id: "plugin.qrcode.insert",
        label: "插入二维码",
        category: "插件",
        run: ctx => {
          const { from, to } = ctx.editor.getSelection();
          const doc = ctx.editor.getDoc();
          const selected = doc.slice(from, to).trim();
          const text = selected || "https://typst.app";
          const importLine = '#import "@preview/tiaoma:0.3.0": qrcode';
          const hasImport = doc.includes("@preview/tiaoma");
          const call = `#qrcode("${text.replace(/"/g, '\\"')}", width: 3em)`;
          ctx.editor.setDoc(hasImport ? `${doc}\n${call}\n` : `${importLine}\n${doc}\n${call}\n`);
          ctx.ui.toast(selected ? `已插入二维码：${text}` : "已插入示例二维码（未选中文本时使用默认链接）");
        },
      },
    ]);
  },
});
