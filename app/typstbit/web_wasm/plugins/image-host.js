import { definePlugin } from "../plugins.js";
import { cloudUploadReady, uploadImage } from "../image-host.js";

const TEST_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function testUpload(api) {
  const settings = api.settings.all();
  const ready = cloudUploadReady(settings);
  if (!ready.ok) {
    api.ui.toast(`图床配置不完整：${ready.reason}`);
    return;
  }
  const bytes = Uint8Array.from(atob(TEST_PIXEL_PNG), c => c.charCodeAt(0));
  const file = new File([bytes], "typstbit-test.png", { type: "image/png" });
  const url = await uploadImage(settings, file);
  api.ui.toast(`图床上传成功：${url}`);
}

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
        {
          key: "uploadMethod",
          label: "OSS 传输方式",
          type: "select",
          hint: "PUT 返回 405/被跨域拦截时改用表单直传（POST）。",
          options: [
            { value: "put", label: "PUT 直传（默认）" },
            { value: "post", label: "表单直传（POST）" },
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
        id: "plugin.image-host.test",
        label: "测试图床上传",
        category: "插件",
        run: () => {
          testUpload(api).catch(error => api.ui.toast(`图床上传失败：${error.message}`));
        },
      },
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
