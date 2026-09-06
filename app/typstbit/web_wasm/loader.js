// Production loader for Typstbit (task 8.1, design D2/D3/D9).
//
// Responsibilities:
//   1. instantiate typst_abi.wasm (flat C ABI; imports nothing, owns its
//      linear memory) — this module is the single owner of Typst state
//   2. implement the `typst` host module for app.wasm: the frozen ABI v1
//      scalar functions plus the text-id protocol (persistent table,
//      mirroring wzzc-dev/window/web/ffi.mbt — Spike A)
//   3. ferry bytes across the two modules: source in via the input arena,
//      PNG/JSON out via the output buffers + out_len slot
//   4. Blob URL bridge with revoke hygiene and revision binding (D3):
//      each rendered page becomes an object URL registered in the text
//      table; stale URLs are revoked once their load settles
//   5. implement the `typstbit` host module: after_paint(tag) schedules
//      rAF x2 and then calls the app export typstbit_paint_ready(tag)
//      (the D4 compile schedule: the Compiling state must be painted
//      before the synchronous compile freezes the main thread)
//   6. forward image load completions into the app as
//      typst_image_event(revision, status) — MoUI 0.1.9 does not re-render
//      on image load by itself (Spike C)
//
// Everything runs on the main thread (design D4); the ABI keeps the
// Worker migration path open.

import { bootMouiWasmGcApp } from "../.mooncakes/wzzc-dev/moui_web_renderer/runtime.js";

const UTF8 = new TextEncoder();
const UTF8_DECODE = new TextDecoder();

/// u32::MAX-style failure sentinels from typst_abi cross as signed i32.
const statusOk = (s) => s === 0;

export async function bootTypstbit(options = {}) {
  const appWasmUrl = options.appWasmUrl;
  const typstAbiUrl = options.typstAbiUrl;
  if (!appWasmUrl || !typstAbiUrl) {
    throw new Error("bootTypstbit requires appWasmUrl and typstAbiUrl");
  }

  const state = {
    ready: false,
    error: null,
    app: null, // app.wasm instance
    abi: null, // typst_abi.wasm instance
    // text-id protocol tables (typst module's own persistent table)
    textHandles: new Map(), // push/pull accumulation handles
    typstTexts: new Map(), // text_id -> string (persistent)
    nextHandle: 1,
    nextTextId: 1,
    // Blob URL bridge bookkeeping (D3)
    blobUrls: [], // every object URL ever created
    revokedUrls: [],
    urlRevision: new Map(), // url -> compile revision
    urlSettled: new Set(), // urls whose load settled (ready or failed)
    urlLoadStarted: new Set(), // urls MoUI assigned to an Image
    currentSource: null, // latest requested image source
    compileCount: 0,
  };
  // Exposed for tests and debugging; not part of the app contract.
  globalThis.__typstbit = state;

  // Track which image sources MoUI actually started loading. The runtime
  // only assigns `src` when a source is drawn; a URL that was superseded
  // before being drawn never starts loading and can be revoked as soon as
  // it is replaced (design D3), while in-flight loads are revoked once
  // they settle.
  const OriginalImage = globalThis.Image;
  globalThis.Image = class extends OriginalImage {
    set src(value) {
      if (typeof value === "string") state.urlLoadStarted.add(value);
      super.src = value;
    }
    get src() {
      return super.src;
    }
  };

  // ---- 1. typst_abi.wasm --------------------------------------------------

  let abi;
  try {
    const response = await fetch(typstAbiUrl);
    if (!response.ok) {
      throw new Error(`fetch typst_abi failed: ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    const result = await WebAssembly.instantiate(bytes, {});
    abi = result.instance;
  } catch (error) {
    state.error = `typst_abi: ${error}`;
    throw error;
  }
  state.abi = abi;
  const abiExports = abi.exports;

  /// Write bytes into a fresh arena allocation; returns [ptr, len].
  const abiPut = (bytes) => {
    const ptr = abiExports.typst_abi_alloc(bytes.length);
    if (ptr === 0) throw new Error("typst_abi_alloc failed");
    new Uint8Array(abiExports.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  };

  const abiOutLen = () =>
    new DataView(abiExports.memory.buffer).getUint32(
      abiExports.typst_abi_out_len_ptr(),
      true,
    );

  const abiReadOutput = (ptr) =>
    new Uint8Array(abiExports.memory.buffer, ptr, abiOutLen()).slice();

  // ---- text-id protocol (typst module persistent table) -------------------

  const typstModule = {
    begin_create_string() {
      const handle = state.nextHandle++;
      state.textHandles.set(handle, { value: "", offset: 0 });
      return handle;
    },
    string_append_char(handle, ch) {
      const entry = state.textHandles.get(Number(handle));
      if (entry) entry.value += String.fromCodePoint(Number(ch));
    },
    finish_create_string(handle) {
      const entry = state.textHandles.get(Number(handle));
      state.textHandles.delete(Number(handle));
      const textId = state.nextTextId++;
      state.typstTexts.set(textId, entry ? entry.value : "");
      return textId;
    },
    begin_read_string(textId) {
      const handle = state.nextHandle++;
      state.textHandles.set(handle, {
        value: state.typstTexts.get(Number(textId)) ?? "",
        offset: 0,
      });
      return handle;
    },
    string_read_char(handle) {
      const entry = state.textHandles.get(Number(handle));
      if (!entry || entry.offset >= entry.value.length) return -1;
      const codePoint = entry.value.codePointAt(entry.offset);
      entry.offset += codePoint > 0xffff ? 2 : 1;
      return codePoint;
    },
    finish_read_string(handle) {
      state.textHandles.delete(Number(handle));
    },

    // ---- frozen ABI v1 (design D9) --------------------------------------

    compile_main(sourceTextId) {
      const source = state.typstTexts.get(Number(sourceTextId));
      if (typeof source !== "string") return 1; // E_INVALID_ARG
      try {
        const [pp, plen] = abiPut(UTF8.encode("/main.typ"));
        const [dp, dlen] = abiPut(UTF8.encode(source));
        const setStatus = abiExports.typst_abi_set_file(pp, plen, dp, dlen);
        if (!statusOk(setStatus)) return setStatus;
        const [mp, mlen] = abiPut(UTF8.encode("/main.typ"));
        const mainStatus = abiExports.typst_abi_set_main(mp, mlen);
        if (!statusOk(mainStatus)) return mainStatus;
        const status = abiExports.typst_abi_compile();
        state.compileCount += 1;
        return status;
      } catch (error) {
        console.error("[typstbit] compile_main failed", error);
        return 6; // E_INTERNAL
      }
    },

    page_count() {
      return abiExports.typst_abi_page_count();
    },

    page_image(page, scaleMilli, revision) {
      try {
        const ptr = abiExports.typst_abi_render_page_png(
          Number(page),
          Number(scaleMilli),
        );
        if (ptr === 0) return 0;
        const png = abiReadOutput(ptr);
        let url;
        try {
          const blob = new Blob([png], { type: "image/png" });
          url = URL.createObjectURL(blob);
          state.blobUrls.push(url);
        } catch {
          // data-URL fallback (design D3).
          let binary = "";
          for (const byte of png) binary += String.fromCharCode(byte);
          url = `data:image/png;base64,${btoa(binary)}`;
        }
        state.urlRevision.set(url, Number(revision));
        state.currentSource = url;
        revokeStaleUrls();
        const textId = state.nextTextId++;
        state.typstTexts.set(textId, url);
        return textId;
      } catch (error) {
        console.error("[typstbit] page_image failed", error);
        return 0;
      }
    },

    error_json() {
      try {
        const ptr = abiExports.typst_abi_error_json();
        if (ptr === 0) return 0;
        const json = UTF8_DECODE.decode(abiReadOutput(ptr));
        const textId = state.nextTextId++;
        state.typstTexts.set(textId, json);
        return textId;
      } catch (error) {
        console.error("[typstbit] error_json failed", error);
        return 0;
      }
    },
  };

  // ---- Blob URL revoke hygiene (design D3) ---------------------------------

  const revokeStaleUrls = () => {
    for (const url of state.blobUrls) {
      if (url === state.currentSource || state.revokedUrls.includes(url)) {
        continue;
      }
      // Revoke when replaced: loads that already settled, and URLs whose
      // load never started (never drawn). In-flight loads are revoked
      // when they settle (their failure event is dropped by the state
      // machine's revision gating).
      const settled = state.urlSettled.has(url);
      const started = state.urlLoadStarted.has(url);
      if (settled || !started) {
        URL.revokeObjectURL(url);
        state.revokedUrls.push(url);
      }
    }
  };

  const onImageResourceChange = (event) => {
    const url = event?.source;
    if (typeof url !== "string") return;
    if (event.status === "ready" || event.status === "failed") {
      state.urlSettled.add(url);
    }
    // Forward load completion to the app with the bound revision; the
    // state machine drops stale revisions (design D3).
    const revision = state.urlRevision.get(url);
    if (revision !== undefined && state.app?.exports?.typst_image_event) {
      const status = event.status === "ready" ? 0 : 1;
      try {
        state.app.exports.typst_image_event(revision, status);
      } catch (error) {
        console.error("[typstbit] typst_image_event failed", error);
      }
    }
    if (event.status === "ready" || event.status === "failed") {
      revokeStaleUrls();
    }
  };

  // ---- typstbit module (D4 paint schedule, host clock, debounce timers) ----

  const typstbitTimers = new Map(); // tag -> timeout id

  const typstbitModule = {
    now_ms() {
      return Math.round(performance.now());
    },
    after_paint(tag) {
      // Two animation frames guarantee the browser painted the Compiling
      // state before the synchronous compile freezes the main thread.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          state.app?.exports?.typstbit_paint_ready?.(Number(tag));
        });
      });
    },
    schedule_timeout(delayMs, tag) {
      // One outstanding timeout per tag: a new request replaces the old.
      const existing = typstbitTimers.get(Number(tag));
      if (existing !== undefined) clearTimeout(existing);
      const id = setTimeout(() => {
        typstbitTimers.delete(Number(tag));
        state.app?.exports?.typstbit_timer?.(
          Number(tag),
          Math.round(performance.now()),
        );
      }, Math.max(0, Number(delayMs)));
      typstbitTimers.set(Number(tag), id);
    },
  };

  // ---- 2. boot the app ------------------------------------------------------

  try {
    const app = await bootMouiWasmGcApp({
      wasmUrl: appWasmUrl,
      canvasHost: options.canvasHost ?? "#canvas-host",
      imports: { typst: typstModule, typstbit: typstbitModule },
      webgpu: { onImageResourceChange },
      onPrint: options.onPrint,
    });
    state.app = app;
    state.ready = true;
    return { app, abi, state };
  } catch (error) {
    state.error = `app: ${error}`;
    throw error;
  }
}
