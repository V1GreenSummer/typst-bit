"use strict";

/**
 * Maps ABI diagnostics (1-based line/column, optional `file` VFS path) onto
 * editor URIs. Kept free of `vscode` imports so it can be unit tested on
 * plain Node.
 */
function mapDiagnostics(diagnostics, vfsToUri, fallbackUri = null) {
  const byUri = new Map();
  const lookup = path => {
    if (vfsToUri instanceof Map) return vfsToUri.get(path);
    if (vfsToUri && typeof vfsToUri === "object") return vfsToUri[path];
    return undefined;
  };
  for (const d of diagnostics ?? []) {
    const uri = lookup(d.file) ?? fallbackUri;
    if (!uri) continue;
    const startLine = Math.max(0, (d.start?.line ?? 1) - 1);
    const startColumn = Math.max(0, (d.start?.column ?? 1) - 1);
    const endLine = Math.max(startLine, (d.end?.line ?? d.start?.line ?? 1) - 1);
    const rawEndColumn = Math.max(0, (d.end?.column ?? (d.start?.column ?? 1) + 1) - 1);
    const endColumn = endLine === startLine ? Math.max(startColumn + 1, rawEndColumn) : rawEndColumn;
    const list = byUri.get(uri) ?? [];
    list.push({
      line: startLine,
      column: startColumn,
      endLine,
      endColumn,
      severity: d.severity === "warning" ? "warning" : "error",
      message: d.message ?? "",
    });
    byUri.set(uri, list);
  }
  return byUri;
}

module.exports = { mapDiagnostics };
