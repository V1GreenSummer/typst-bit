// MCP server round-trip over stdio (spawns tools/typstbit-mcp.mjs).
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn("node", [join(ROOT, "tools/typstbit-mcp.mjs")], { cwd: ROOT, stdio: ["pipe", "pipe", "inherit"] });

const pending = new Map();
let nextId = 1;
let buffer = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const resolveRequest = pending.get(message.id);
    if (resolveRequest) {
      pending.delete(message.id);
      resolveRequest(message);
    }
  }
});

const request = (method, params = {}) => new Promise(resolveRequest => {
  const id = nextId++;
  pending.set(id, resolveRequest);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures.push(name);
};

const init = await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } });
check("initialize handshake", init.result?.serverInfo?.name === "typstbit-mcp", JSON.stringify(init.result?.serverInfo));

const list = await request("tools/list");
const names = (list.result?.tools ?? []).map(tool => tool.name);
check(
  "tools are listed",
  ["typst_compile", "typst_export_pdf", "typst_export_svg", "typst_render_png", "typst_outline"].every(name => names.includes(name)),
  names.join(","),
);

const compiled = await request("tools/call", { name: "typst_compile", arguments: { source: "= Hello\n\n#lorem(5)" } });
const compilePayload = JSON.parse(compiled.result.content[0].text);
check("compile tool reports ok", compilePayload.status === "ok" && compilePayload.pages === 1, JSON.stringify(compilePayload));

const svg = await request("tools/call", { name: "typst_export_svg", arguments: { source: "= SVG" } });
check("svg tool returns markup", svg.result.content[0].text.startsWith("<svg"), svg.result.content[0].text.slice(0, 30));

const png = await request("tools/call", { name: "typst_render_png", arguments: { source: "= PNG", page: 0, scale: 0.75 } });
check("png tool returns an image block", png.result.content.some(block => block.type === "image" && block.mimeType === "image/png"));

const pdfPath = "/tmp/opencode/mcp-test.pdf";
const pdf = await request("tools/call", { name: "typst_export_pdf", arguments: { source: "= PDF", path: pdfPath } });
const pdfPayload = JSON.parse(pdf.result.content[0].text);
const pdfBytes = readFileSync(pdfPath);
check("pdf tool writes a real PDF", pdfPayload.bytes === pdfBytes.length && pdfBytes.subarray(0, 8).toString() === "%PDF-1.7", `${pdfBytes.length}B`);

const outline = await request("tools/call", { name: "typst_outline", arguments: { source: "= A <x>\n\n== B" } });
const entries = JSON.parse(outline.result.content[0].text);
check("outline tool strips labels", entries.length === 2 && entries[0].title === "A" && entries[1].level === 2, JSON.stringify(entries));

const bundled = await request("tools/call", {
  name: "typst_compile",
  arguments: { source: '#import "@preview/tiaoma:0.3.0": qrcode\n#qrcode("https://typst.app", width: 2em)' },
});
const bundledPayload = JSON.parse(bundled.result.content[0].text);
check("bundled @preview package compiles", bundledPayload.status === "ok" && bundledPayload.pages === 1, JSON.stringify(bundledPayload));

const missing = await request("tools/call", { name: "nope", arguments: {} });
check("unknown tool errors", Boolean(missing.error), JSON.stringify(missing.error));

child.kill();
console.log(failures.length === 0 ? "MCP: PASS" : `MCP: FAIL (${failures.join(", ")})`);
process.exit(failures.length === 0 ? 0 : 1);
