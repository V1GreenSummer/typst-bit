import { definePlugin } from "../plugins.js";

export default definePlugin({
  id: "export-formats",
  name: "导出格式",
  setup(api) {
    api.export.register({
      id: "svg-current",
      label: "SVG（当前页）",
      extension: "svg",
      build: ({ typst, session }) => {
        const bytes = typst.exportSvg(session.page ?? 0);
        return bytes ? new Blob([bytes], { type: "image/svg+xml" }) : null;
      },
    });
    api.export.register({
      id: "png-current",
      label: "PNG（当前页 1.5x）",
      extension: "png",
      build: ({ typst, session }) => {
        const bytes = typst.renderPagePng(session.page ?? 0, 1500);
        return bytes ? new Blob([bytes], { type: "image/png" }) : null;
      },
    });
  },
});
