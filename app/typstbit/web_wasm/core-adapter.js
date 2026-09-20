// Thin JS host for the MoonBit application core (core.wasm).
//
// The core owns pure application logic (outline, command catalog and
// filtering, package references, diagnostics mapping, theme planning,
// project operations). This adapter only marshals JSON across the wasm-gc
// boundary; it has no DOM dependencies, so Node (tests, CLI) can load it.

const CORE_URL = new URL("./core.wasm", import.meta.url).href;

function makeStringBridge() {
  const builders = [];
  return {
    sb_new: () => {
      builders.push([]);
      return builders.length - 1;
    },
    sb_push: (handle, code) => {
      const builder = builders[handle];
      if (builder) builder.push(code & 0xffff);
    },
    sb_finish: handle => {
      const codes = builders[handle] ?? [];
      builders[handle] = null;
      let out = "";
      const chunk = 0x8000;
      for (let i = 0; i < codes.length; i += chunk) {
        out += String.fromCharCode.apply(null, codes.slice(i, i + chunk));
      }
      return out;
    },
    js_len: value => (value == null ? 0 : String(value).length),
    js_char: (value, index) => String(value).charCodeAt(index),
  };
}

async function instantiate(wasmUrl) {
  const imports = { core: makeStringBridge() };
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`core.wasm: HTTP ${response.status}`);
  try {
    const { instance } = await WebAssembly.instantiateStreaming(response, imports);
    return instance.exports;
  } catch {
    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, imports);
    return instance.exports;
  }
}

export async function loadCore(wasmUrl = CORE_URL) {
  let ex;
  if (wasmUrl instanceof WebAssembly.Instance) {
    ex = wasmUrl.exports;
  } else if (wasmUrl instanceof Uint8Array || wasmUrl instanceof ArrayBuffer) {
    const { instance } = await WebAssembly.instantiate(wasmUrl, { core: makeStringBridge() });
    ex = instance.exports;
  } else {
    ex = await instantiate(wasmUrl);
  }
  const call = (name, payload = "") => {
    const result = ex[name](payload);
    return result == null || result === "" ? null : JSON.parse(result);
  };
  return {
    outline: text => call("core_outline", String(text ?? "")) ?? [],
    commands: () => call("core_commands", "") ?? {},
    filterCommands: (query, doc, from, to) =>
      call("core_filter_commands", JSON.stringify({ query, doc, from, to })) ?? [],
    packageSpecs: source =>
      call("core_package_specs", JSON.stringify({ source: String(source ?? "") })) ?? [],
    mapDiagnostics: (json, activeFile) =>
      call("core_map_diagnostics", JSON.stringify({ json: String(json ?? ""), activeFile: String(activeFile ?? "") })) ?? [],
    themePlan: settings =>
      call("core_theme_plan", JSON.stringify(settings ?? {})) ?? { bodyTheme: null, bodyClasses: [], variables: [] },
    projectOp: (project, op, fallback = "") =>
      call("core_project_op", JSON.stringify({
        project: project ? JSON.stringify(project) : null,
        fallback,
        op: op ?? {},
      })) ?? { project: null, result: null },
  };
}
