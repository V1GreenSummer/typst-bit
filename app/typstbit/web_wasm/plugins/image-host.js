import { definePlugin } from "../plugins.js";

export default definePlugin({
  id: "image-host",
  name: "图床设置",
  setup(api) {
    api.settings.define({
      title: "图床设置",
      fields: [
        {
          key: "pasteTarget",
          label: "粘贴图片默认保存位置",
          type: "select",
          hint: "云端需在上方完成配置；配置不完整或上传失败会自动回退本地，并在界面提示原因。",
          options: [
            { value: "cloud", label: "云端图床（阿里云 OSS / 自定义接口）" },
            { value: "local", label: "本地 images/ 目录" },
          ],
        },
        {
          key: "provider",
          label: "云端上传方式",
          type: "select",
          options: [
            { value: "aliyun-oss", label: "阿里云 OSS（推荐）" },
            { value: "multipart", label: "自定义 multipart 接口" },
          ],
        },
        { key: "endpoint", label: "Endpoint / 上传地址", type: "text", placeholder: "https://bucket.oss-cn-hangzhou.aliyuncs.com" },
        { key: "bucket", label: "OSS Bucket（阿里云）", type: "text", placeholder: "my-bucket" },
        { key: "accessKeyId", label: "AccessKeyId（阿里云）", type: "text" },
        { key: "accessKeySecret", label: "AccessKeySecret（阿里云，仅存本机）", type: "password" },
        { key: "prefix", label: "对象前缀", type: "text", placeholder: "typstbit/" },
        { key: "customDomain", label: "自定义域名 / CDN（可选）", type: "text", placeholder: "https://cdn.example.com" },
        { key: "token", label: "Bearer 令牌（自定义接口）", type: "password" },
      ],
    });
    api.commands.register([
      {
        id: "plugin.image-host.insert",
        label: "插入图床模板",
        category: "插件",
        run: ctx => {
          const values = api.settings.all();
          const prefix = (values.prefix || "typstbit/").replace(/^\/+/, "");
          if ((values.provider ?? "aliyun-oss") === "aliyun-oss") {
            const base = (values.customDomain || values.endpoint || "https://bucket.oss-cn-hangzhou.aliyuncs.com").replace(/\/+$/, "");
            ctx.editor.insertBlock(`#image("${base}/${prefix}<id>.png")`);
          } else {
            const base = (values.endpoint || "https://example.com/upload").replace(/\/+$/, "");
            ctx.editor.insertBlock(`#image("${base}/<id>.png")`);
          }
        },
      },
    ]);
  },
});
