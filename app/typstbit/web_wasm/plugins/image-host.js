import { definePlugin } from "../plugins.js";

export default definePlugin({
  id: "image-host",
  name: "图床设置",
  setup(api) {
    api.settings.define({
      title: "图床设置",
      fields: [
        { key: "endpoint", label: "上传地址（POST multipart，文件字段 file）", type: "text", placeholder: "https://example.com/upload" },
        { key: "token", label: "访问令牌（Authorization: Bearer）", type: "password" },
        { key: "autoUpload", label: "粘贴图片时自动上传（失败回退本地 images/）", type: "boolean" },
      ],
    });
    api.commands.register([
      {
        id: "plugin.image-host.insert",
        label: "插入图床模板",
        category: "插件",
        run: ctx => {
          const endpoint = api.settings.get("endpoint") || "https://example.com/upload";
          ctx.editor.insertBlock(`#image("${endpoint}/<id>.png")`);
        },
      },
    ]);
  },
});
