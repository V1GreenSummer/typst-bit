"use strict";
const fs = require("node:fs");

class TypstAbi {
  constructor(exports) {
    this.ex = exports;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
  }

  static async load(wasmPath) {
    const bytes = fs.readFileSync(wasmPath);
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new TypstAbi(instance.exports);
  }

  put(data) {
    const bytes = typeof data === "string" ? this.encoder.encode(data) : data;
    const ptr = this.ex.typst_abi_alloc(bytes.length);
    if (ptr === 0) throw new Error("typst_abi_alloc failed");
    new Uint8Array(this.ex.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  }

  out(ptr) {
    const len = new DataView(this.ex.memory.buffer).getUint32(this.ex.typst_abi_out_len_ptr(), true);
    return new Uint8Array(this.ex.memory.buffer, ptr, len).slice();
  }

  setFile(path, data) {
    const [pathPtr, pathLen] = this.put(path);
    const [dataPtr, dataLen] = this.put(data);
    return this.ex.typst_abi_set_file(pathPtr, pathLen, dataPtr, dataLen);
  }

  setPackageFile(spec, file, data) {
    const [specPtr, specLen] = this.put(spec);
    const [filePtr, fileLen] = this.put(file);
    const [dataPtr, dataLen] = this.put(data);
    return this.ex.typst_abi_set_package_file(specPtr, specLen, filePtr, fileLen, dataPtr, dataLen);
  }

  setMain(path) {
    const [pathPtr, pathLen] = this.put(path);
    return this.ex.typst_abi_set_main(pathPtr, pathLen);
  }

  compile() {
    return this.ex.typst_abi_compile();
  }

  pageCount() {
    return this.ex.typst_abi_page_count();
  }

  diagnostics() {
    const ptr = this.ex.typst_abi_error_json();
    if (ptr === 0) return [];
    try {
      return JSON.parse(this.decoder.decode(this.out(ptr))).diagnostics ?? [];
    } catch {
      return [];
    }
  }

  renderPagePng(page = 0, scale = 1.5) {
    const ptr = this.ex.typst_abi_render_page_png(page, Math.round(scale * 1000));
    return ptr === 0 ? null : this.out(ptr);
  }

  exportPdf() {
    const ptr = this.ex.typst_abi_export_pdf();
    return ptr === 0 ? null : this.out(ptr);
  }

  exportSvg(page = 0) {
    const ptr = this.ex.typst_abi_export_svg(page);
    return ptr === 0 ? null : this.out(ptr);
  }

  registerPackages(packagesRoot) {
    const manifestPath = `${packagesRoot}/manifest.json`;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      return 0;
    }
    let registered = 0;
    for (const entry of manifest.packages ?? []) {
      for (const file of entry.files ?? []) {
        const data = fs.readFileSync(`${packagesRoot}/${entry.root}/${file}`);
        if (this.setPackageFile(entry.spec, file, data) === 0) registered += 1;
      }
    }
    return registered;
  }
}

module.exports = { TypstAbi };
