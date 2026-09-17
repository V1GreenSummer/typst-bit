#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseOutline } from "../app/typstbit/web_wasm/outline.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WASM = process.env.TYPSTBIT_ABI ?? join(ROOT, "rust/target/wasm32-unknown-unknown/release/typst_abi.opt.wasm");

const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {});
const abi = instance.exports;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function put(data) {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const ptr = abi.typst_abi_alloc(bytes.length);
  if (ptr === 0) throw new Error("typst_abi_alloc failed");
  new Uint8Array(abi.memory.buffer, ptr, bytes.length).set(bytes);
  return [ptr, bytes.length];
}

function outBytes(ptr) {
  const len = new DataView(abi.memory.buffer).getUint32(abi.typst_abi_out_len_ptr(), true);
  return new Uint8Array(abi.memory.buffer, ptr, len).slice();
}

function compile(source) {
  const [pathPtr, pathLen] = put("/main.typ");
  const [dataPtr, dataLen] = put(source);
  const set = abi.typst_abi_set_file(pathPtr, pathLen, dataPtr, dataLen);
  if (set !== 0) throw new Error(`set_file status ${set}`);
  const [mainPtr, mainLen] = put("/main.typ");
  abi.typst_abi_set_main(mainPtr, mainLen);
  const status = abi.typst_abi_compile();
  const diagnostics = [];
  const jsonPtr = abi.typst_abi_error_json();
  if (jsonPtr !== 0) {
    try {
      for (const item of JSON.parse(decoder.decode(outBytes(jsonPtr))).diagnostics ?? []) diagnostics.push(item);
    } catch {}
  }
  return { status, pages: abi.typst_abi_page_count(), diagnostics };
}

function statusName(code) {
  return code === 0 ? "ok" : code === 3 ? "error" : `status-${code}`;
}

function registerBundledPackages() {
  const manifestPath = join(ROOT, "app/typstbit/web_wasm/packages/manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return;
  }
  for (const entry of manifest.packages ?? []) {
    for (const file of entry.files ?? []) {
      const data = readFileSync(join(ROOT, "app/typstbit/web_wasm/packages", entry.root, file));
      const [specPtr, specLen] = put(entry.spec);
      const [pathPtr, pathLen] = put(file);
      const [dataPtr, dataLen] = put(data);
      const status = abi.typst_abi_set_package_file(specPtr, specLen, pathPtr, pathLen, dataPtr, dataLen);
      if (status !== 0) console.error(`package ${entry.spec}/${file}: status ${status}`);
    }
  }
}

registerBundledPackages();

const tools = [
  {
    name: "typst_compile",
    description: "Compile Typst source and return page count plus diagnostics.",
    inputSchema: { type: "object", properties: { source: { type: "string" } }, required: ["source"] },
  },
  {
    name: "typst_export_pdf",
    description: "Compile Typst source and write a PDF to disk; returns the path and size.",
    inputSchema: {
      type: "object",
      properties: { source: { type: "string" }, path: { type: "string" } },
      required: ["source"],
    },
  },
  {
    name: "typst_export_svg",
    description: "Compile Typst source and return one page as SVG text.",
    inputSchema: {
      type: "object",
      properties: { source: { type: "string" }, page: { type: "number" } },
      required: ["source"],
    },
  },
  {
    name: "typst_render_png",
    description: "Compile Typst source and return one page as a PNG image.",
    inputSchema: {
      type: "object",
      properties: { source: { type: "string" }, page: { type: "number" }, scale: { type: "number" } },
      required: ["source"],
    },
  },
  {
    name: "typst_outline",
    description: "Return the heading outline of Typst source as JSON.",
    inputSchema: { type: "object", properties: { source: { type: "string" } }, required: ["source"] },
  },
];

function text(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

async function callTool(name, args) {
  if (name === "typst_outline") {
    return text(parseOutline(args.source ?? ""));
  }
  const result = compile(args.source ?? "");
  if (name === "typst_compile") {
    return text({
      status: statusName(result.status),
      pages: result.pages,
      diagnostics: result.diagnostics.map(item => ({ severity: item.severity, message: item.message, line: item.start?.line })),
    });
  }
  if (result.status !== 0) return text({ status: statusName(result.status), diagnostics: result.diagnostics });
  if (name === "typst_export_pdf") {
    const ptr = abi.typst_abi_export_pdf();
    if (ptr === 0) return text({ status: "error", message: "pdf export failed" });
    const bytes = outBytes(ptr);
    const target = args.path ?? "/tmp/typstbit-output.pdf";
    writeFileSync(target, bytes);
    return text({ path: target, bytes: bytes.length, pages: result.pages });
  }
  if (name === "typst_export_svg") {
    const page = Number(args.page ?? 0);
    const ptr = abi.typst_abi_export_svg(page);
    if (ptr === 0) return text({ status: "error", message: `page ${page} unavailable` });
    return { content: [{ type: "text", text: decoder.decode(outBytes(ptr)) }] };
  }
  if (name === "typst_render_png") {
    const page = Number(args.page ?? 0);
    const scale = Math.max(1, Math.round(Number(args.scale ?? 1.5) * 1000));
    const ptr = abi.typst_abi_render_page_png(page, scale);
    if (ptr === 0) return text({ status: "error", message: `page ${page} unavailable` });
    const bytes = outBytes(ptr);
    return {
      content: [
        { type: "text", text: `page ${page} · ${bytes.length} bytes` },
        { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType: "image/png" },
      ],
    };
  }
  throw new Error(`unknown tool: ${name}`);
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function dispatch(method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "typstbit-mcp", version: "0.1.0" },
    };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools };
  if (method === "tools/call") {
    return callTool(params.name, params.arguments ?? {});
  }
  throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === undefined) continue;
    dispatch(message.method, message.params)
      .then(result => send({ jsonrpc: "2.0", id: message.id, result }))
      .catch(error => send({ jsonrpc: "2.0", id: message.id, error: { code: error.code ?? -32000, message: String(error.message ?? error) } }));
  }
});
