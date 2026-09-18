import { definePlugin } from "../plugins.js";

const TEMPLATE = pages => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Typst.bit export</title>
    <style>
      body { margin: 0; padding: 24px; background: #e7e9ed; display: flex; flex-direction: column; align-items: center; gap: 16px; }
      .page { background: white; box-shadow: 0 6px 24px #0002; max-width: 100%; }
      .page svg { display: block; max-width: 100%; height: auto; }
    </style>
  </head>
  <body>
${pages.map(svg => `    <div class="page">\n${svg}\n    </div>`).join("\n")}
  </body>
</html>
`;

export default definePlugin({
  id: "export-html",
  name: "导出网页",
  setup(api) {
    api.export.register({
      id: "html-pages",
      label: "单文件 HTML（全部页面）",
      extension: "html",
      build: ({ typst, session }) => {
        const decoder = new TextDecoder();
        const pages = [];
        for (let page = 0; page < (session.pageCount ?? 0); page++) {
          const svg = typst.exportSvg(page);
          if (svg) pages.push(decoder.decode(svg));
        }
        if (pages.length === 0) return null;
        return new Blob([TEMPLATE(pages)], { type: "text/html;charset=utf-8" });
      },
    });
  },
});
