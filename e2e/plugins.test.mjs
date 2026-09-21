// Plugin registry, settings store and host API tests (no browser).
import {
  extractImageUrl,
  uploadImage,
  uploadMultipart,
  uploadToAliyunOss,
  hmacSha1Base64,
  aliyunStringToSign,
  buildObjectKey,
  cloudUploadReady,
  pasteTargetOf,
  uploadToAliyunOssPost,
  describeOssError,
} from "../app/typstbit/web_wasm/image-host.js";
import {
  definePlugin,
  getPlugin,
  getPlugins,
  defineSettings,
  getSettingsSchemas,
  readSettings,
  writeSettings,
  createPluginHost,
  settingsKey,
} from "../app/typstbit/web_wasm/plugins.js";

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures.push(name);
};

let rejected = false;
try {
  definePlugin({ id: "broken" });
} catch {
  rejected = true;
}
check("invalid plugin descriptor rejected", rejected);

const demo = definePlugin({ id: "demo", name: "Demo", setup: () => {} });
check("plugin registered", getPlugin("demo") === demo && getPlugins().some(plugin => plugin.id === "demo"));
check("missing plugin returns null", getPlugin("missing") === null);

defineSettings("demo", { title: "Demo settings", fields: [{ key: "endpoint" }] });
check("settings schema registered", getSettingsSchemas().some(entry => entry.pluginId === "demo"));
writeSettings("demo", { endpoint: "https://example.com/upload" });
check("settings persist", readSettings("demo").endpoint === "https://example.com/upload");
check("settings key is namespaced", settingsKey("demo") === "typstbit.plugin.demo");

const calls = [];
const host = createPluginHost({
  plugin: demo,
  registerCommands: list => calls.push(["commands", list.length]),
  addMenu: (label, items) => calls.push(["menu", label, items.length]),
  registerExporter: exporter => calls.push(["export", exporter.id]),
  openSettings: id => calls.push(["settings", id]),
  toast: message => calls.push(["toast", message]),
  editor: {},
  session: {},
  typst: {},
});
host.commands.register([{ id: "a", run: () => {} }]);
host.menus.register({ label: "Demo", items: [] });
host.export.register({ id: "svg" });
host.settings.set("token", "secret");
host.ui.openSettings();
host.ui.toast("hi");
check("host delegates commands", calls.some(call => call[0] === "commands" && call[1] === 1));
check("host delegates menus", calls.some(call => call[0] === "menu" && call[1] === "Demo"));
check("host delegates exporters", calls.some(call => call[0] === "export" && call[1] === "svg"));
check("host delegates settings dialog", calls.some(call => call[0] === "settings" && call[1] === "demo"));
check("host settings set/get round trip", host.settings.get("token") === "secret");
check("host delegates toast", calls.some(call => call[0] === "toast" && call[1] === "hi"));

check("image host parses url fields", extractImageUrl({ url: "https://a/1.png" }) === "https://a/1.png");
check("image host parses nested data.url", extractImageUrl({ data: { url: "https://a/2.png" } }) === "https://a/2.png");
check("image host parses link and plain text", extractImageUrl({ data: { link: "https://a/3.png" } }) === "https://a/3.png" && extractImageUrl("https://a/4.png") === "https://a/4.png");
check("image host rejects unusable responses", extractImageUrl({ ok: true }) === null && extractImageUrl(42) === null && extractImageUrl("not a url") === null);

const multipartCalls = [];
const multipartFetch = async (url, init) => {
  multipartCalls.push({ url, method: init.method, auth: init.headers.Authorization, field: init.body.get("file")?.name });
  return { ok: true, status: 200, text: async () => JSON.stringify({ data: { url: "https://cdn.example.com/x.png" } }) };
};
class FakeFormData {
  constructor() { this.entries = new Map(); }
  append(key, value, name) { this.entries.set(key, { value, name }); }
  get(key) { return this.entries.get(key); }
}
const fakeFile = { name: "clip.png", type: "image/png" };
const multipartUrl = await uploadMultipart(
  { endpoint: "https://img.example.com/upload", token: "tok" },
  fakeFile,
  { fetchImpl: multipartFetch, FormDataImpl: FakeFormData },
);
check(
  "multipart provider posts the file with a bearer token",
  multipartUrl === "https://cdn.example.com/x.png" &&
    multipartCalls[0].method === "POST" &&
    multipartCalls[0].auth === "Bearer tok" &&
    multipartCalls[0].field === "clip.png",
  JSON.stringify(multipartCalls[0]),
);

let failed = false;
try {
  await uploadMultipart({ endpoint: "https://img.example.com/upload" }, fakeFile, {
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => "" }),
    FormDataImpl: FakeFormData,
  });
} catch {
  failed = true;
}
check("multipart provider rejects HTTP errors", failed);

failed = false;
try {
  await uploadMultipart({ endpoint: "https://img.example.com/upload" }, fakeFile, {
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" }),
    FormDataImpl: FakeFormData,
  });
} catch {
  failed = true;
}
check("multipart provider rejects responses without a url", failed);

check(
  "hmac-sha1 matches the RFC 2202 vector",
  (await hmacSha1Base64("key", "The quick brown fox jumps over the lazy dog")) === "3nybhbi3iqa8ino29wqQcBydtNk=",
);
check(
  "aliyun string-to-sign uses the OSS V1 layout",
  aliyunStringToSign({
    contentType: "image/png",
    date: "Tue, 21 Sep 2026 00:00:00 GMT",
    bucket: "demo-bucket",
    key: "typstbit/a.png",
  }) === "PUT\n\nimage/png\nTue, 21 Sep 2026 00:00:00 GMT\n/demo-bucket/typstbit/a.png",
);

const aliyunCalls = [];
const aliyunFetch = async (url, init) => {
  aliyunCalls.push({
    url,
    method: init.method,
    date: init.headers.Date,
    contentType: init.headers["Content-Type"],
    auth: init.headers.Authorization,
    body: init.body,
  });
  return { ok: true, status: 200, text: async () => "" };
};
const aliyunUrl = await uploadToAliyunOss(
  {
    endpoint: "https://demo-bucket.oss-cn-hangzhou.aliyuncs.com",
    bucket: "demo-bucket",
    accessKeyId: "ak-test",
    accessKeySecret: "sk-test",
    prefix: "typstbit/",
    customDomain: "https://cdn.example.com",
    objectKey: "typstbit/fixed.png",
  },
  fakeFile,
  { fetchImpl: aliyunFetch, now: new Date("2026-09-21T00:00:00Z") },
);
check(
  "aliyun provider signs a PUT and returns the custom domain url",
  aliyunUrl === "https://cdn.example.com/typstbit/fixed.png" &&
    aliyunCalls[0].method === "PUT" &&
    aliyunCalls[0].url === "https://demo-bucket.oss-cn-hangzhou.aliyuncs.com/typstbit/fixed.png" &&
    aliyunCalls[0].contentType === "image/png" &&
    /^OSS ak-test:.+=$/.test(aliyunCalls[0].auth) &&
    aliyunCalls[0].body === fakeFile,
  JSON.stringify({ ...aliyunCalls[0], body: "file" }),
);
check(
  "aliyun signature is hmac-sha1 of the string-to-sign",
  aliyunCalls[0].auth ===
    `OSS ak-test:${await hmacSha1Base64("sk-test", aliyunStringToSign({
      contentType: "image/png",
      date: aliyunCalls[0].date,
      bucket: "demo-bucket",
      key: "typstbit/fixed.png",
    }))}`,
);

check(
  "object keys keep the prefix and extension",
  /^typstbit\/\d{8}-[a-z0-9]+-[a-z0-9]+\.png$/.test(buildObjectKey("typstbit/", fakeFile, new Date(2026, 8, 21))),
  buildObjectKey("typstbit/", fakeFile, new Date(2026, 8, 21)),
);

check(
  "cloud readiness explains missing settings",
  cloudUploadReady({ endpoint: "https://x" }).ok === false &&
    cloudUploadReady({ provider: "aliyun-oss", endpoint: "https://x", bucket: "b" }).reason === "未配置 AccessKeyId/AccessKeySecret" &&
    cloudUploadReady({ provider: "aliyun-oss", endpoint: "https://x", bucket: "b", accessKeyId: "a", accessKeySecret: "s" }).ok === true &&
    cloudUploadReady({ provider: "multipart", endpoint: "https://x" }).ok === true,
);
check(
  "paste target defaults to the cloud and honours the local option",
  pasteTargetOf({}) === "cloud" &&
    pasteTargetOf({ pasteTarget: "cloud" }) === "cloud" &&
    pasteTargetOf({ pasteTarget: "local" }) === "local",
);

let dispatched = null;
await uploadImage(
  { provider: "multipart", endpoint: "https://img.example.com/upload" },
  fakeFile,
  { fetchImpl: async (url, init) => { dispatched = { url, auth: init.headers.Authorization }; return { ok: true, status: 200, text: async () => "https://cdn.example.com/y.png" }; }, FormDataImpl: FakeFormData },
);
check("uploadImage dispatches to the configured provider", dispatched?.url === "https://img.example.com/upload");

console.log(failures.length === 0 ? "PLUGINS: PASS" : `PLUGINS: FAIL (${failures.join(", ")})`);
process.exit(failures.length === 0 ? 0 : 1);
