import { definePlugin } from "../plugins.js";

const TEMPLATES = [
  {
    id: "cover",
    label: "封面模板",
    body: [
      "#set page(margin: (top: 3.5cm, bottom: 2.5cm))",
      "#align(center)[",
      "  #v(2cm)",
      "  #text(size: 28pt, weight: 700)[文档标题]",
      "  #v(0.6cm)",
      "  #text(size: 14pt)[作者 · 日期]",
      "]",
    ].join("\n"),
  },
  {
    id: "two-column",
    label: "双栏文章",
    body: "#set page(columns: 2, margin: 2cm)",
  },
  {
    id: "code-report",
    label: "代码报告",
    body: [
      "#set page(margin: 2cm)",
      "#set raw(theme: \"github\")",
      "= 代码报告",
      "",
      "#raw(\"fn main() { println!(\\\"hello\\\"); }\")",
    ].join("\n"),
  },
];

export default definePlugin({
  id: "templates",
  name: "文档模板",
  setup(api) {
    api.commands.register(TEMPLATES.map(template => ({
      id: `plugin.templates.${template.id}`,
      label: `插入${template.label}`,
      category: "插件",
      run: ctx => ctx.editor.insertBlock(template.body),
    })));
  },
});
