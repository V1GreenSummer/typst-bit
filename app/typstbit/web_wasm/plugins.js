const registry = new Map();
const schemas = new Map();
const memory = new Map();

function storageGet(key) {
  try {
    if (typeof localStorage === "undefined") return memory.get(key) ?? null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    if (typeof localStorage === "undefined") memory.set(key, value);
    else localStorage.setItem(key, value);
  } catch {}
}

export function definePlugin(descriptor) {
  if (!descriptor || typeof descriptor.id !== "string" || typeof descriptor.setup !== "function") {
    throw new Error("invalid plugin descriptor");
  }
  const registered = { enabled: true, ...descriptor };
  registry.set(descriptor.id, registered);
  return registered;
}

export function getPlugins() {
  return [...registry.values()];
}

export function getPlugin(id) {
  return registry.get(id) ?? null;
}

export function settingsKey(pluginId) {
  return `typstbit.plugin.${pluginId}`;
}

export function readSettings(pluginId) {
  try {
    return JSON.parse(storageGet(settingsKey(pluginId)) ?? "{}");
  } catch {
    return {};
  }
}

export function writeSettings(pluginId, values) {
  storageSet(settingsKey(pluginId), JSON.stringify(values));
}

export function defineSettings(pluginId, schema) {
  schemas.set(pluginId, schema);
}

export function getSettingsSchemas() {
  return [...schemas.entries()].map(([pluginId, schema]) => ({ pluginId, schema }));
}

export function createPluginHost({
  plugin,
  registerCommands,
  addMenu,
  registerExporter,
  openSettings,
  toast,
  editor,
  session,
  typst,
}) {
  return {
    id: plugin.id,
    commands: { register: commands => registerCommands(commands) },
    menus: { register: menu => addMenu(menu.label, menu.items) },
    export: { register: exporter => registerExporter(exporter) },
    settings: {
      get: key => readSettings(plugin.id)[key],
      set: (key, value) => writeSettings(plugin.id, { ...readSettings(plugin.id), [key]: value }),
      all: () => readSettings(plugin.id),
      define: schema => defineSettings(plugin.id, schema),
    },
    ui: {
      toast,
      openSettings: () => openSettings(plugin.id),
    },
    editor,
    session,
    typst,
  };
}
