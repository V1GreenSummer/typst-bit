// Plugin registry, settings store and host API tests (no browser).
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

console.log(failures.length === 0 ? "PLUGINS: PASS" : `PLUGINS: FAIL (${failures.join(", ")})`);
process.exit(failures.length === 0 ? 0 : 1);
