// Plugin registry, settings store and host API tests (no browser).
import { extractImageUrl, uploadImage } from "../app/typstbit/web_wasm/image-host.js";
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

const uploads = [];
const uploadFetch = async (url, init) => {
  uploads.push({ url, method: init.method, auth: init.headers.Authorization, field: init.body.get("file")?.name });
  return { ok: true, status: 200, text: async () => JSON.stringify({ data: { url: "https://cdn.example.com/x.png" } }) };
};
class FakeFormData {
  constructor() { this.entries = new Map(); }
  append(key, value, name) { this.entries.set(key, { value, name }); }
  get(key) { return this.entries.get(key); }
}
const fakeFile = { name: "clip.png" };
const uploadedUrl = await uploadImage({
  endpoint: "https://img.example.com/upload",
  token: "tok",
  file: fakeFile,
  fetchImpl: uploadFetch,
  FormDataImpl: FakeFormData,
});
check(
  "image host uploads multipart with bearer token",
  uploadedUrl === "https://cdn.example.com/x.png" &&
    uploads[0].method === "POST" &&
    uploads[0].auth === "Bearer tok" &&
    uploads[0].field === "clip.png",
  JSON.stringify(uploads[0]),
);

let failed = false;
try {
  await uploadImage({
    endpoint: "https://img.example.com/upload",
    file: fakeFile,
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => "" }),
    FormDataImpl: FakeFormData,
  });
} catch {
  failed = true;
}
check("image host rejects HTTP errors", failed);

failed = false;
try {
  await uploadImage({
    endpoint: "https://img.example.com/upload",
    file: fakeFile,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" }),
    FormDataImpl: FakeFormData,
  });
} catch {
  failed = true;
}
check("image host rejects responses without a url", failed);

console.log(failures.length === 0 ? "PLUGINS: PASS" : `PLUGINS: FAIL (${failures.join(", ")})`);
process.exit(failures.length === 0 ? 0 : 1);
