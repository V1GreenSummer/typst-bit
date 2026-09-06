#!/usr/bin/env node
// Spike B measurement harness (task 3.2, design D10).
//
// Usage:
//   node spike/measure.mjs <typst_abi.wasm> [label]
//
// Measures, for one wasm build variant:
//   1. raw / brotli(-q11) size
//   2. WebAssembly.compile time, instantiate time, spike_init time
//   3. short-doc / 10-page compile P50/P95:
//      cold = first compile on a fresh instance, warm = mutated re-edits
//   4. wasm memory growth over a 100-edit loop (per document)
//
// Node >= 18. Zero dependencies (zlib + WebAssembly built-ins).
// Node's V8 is the closest available proxy for the Chrome target engine.

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { brotliCompressSync, constants as zc } from 'node:zlib';

const wasmPath = process.argv[2];
if (!wasmPath) {
  console.error('usage: node spike/measure.mjs <typst_abi.wasm> [label]');
  process.exit(1);
}
const label = process.argv[3] ?? wasmPath;
const bytes = readFileSync(wasmPath);

const here = new URL('.', import.meta.url);
const shortDoc = readFileSync(new URL('short.typ', here), 'utf8');
const tenPagesDoc = readFileSync(new URL('tenpages.typ', here), 'utf8');

// --- helpers ---------------------------------------------------------------

const MiB = (n) => (n / 1024 / 1024).toFixed(2) + ' MiB';
const utf8 = new TextEncoder();

function percentile(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.max(0, Math.ceil((p / 100) * s.length) - 1);
  return s[i];
}

const stats = (xs) => ({
  n: xs.length,
  p50: percentile(xs, 50),
  p95: percentile(xs, 95),
  min: Math.min(...xs),
});

const fmt = (s) =>
  `n=${s.n} p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms min=${s.min.toFixed(1)}ms`;

/** Rewrite the `NNNN` revision marker, returning a same-length doc. */
function mutate(doc, n) {
  return doc.replace(/(\d{4})/g, () => String(n).padStart(4, '0'));
}

// --- 1. size ---------------------------------------------------------------

const brotli = brotliCompressSync(bytes, {
  params: { [zc.BROTLI_PARAM_QUALITY]: 11 },
});
console.log(`[${label}] raw=${MiB(bytes.length)} brotli=${MiB(brotli.length)}`);

// --- 2. init ---------------------------------------------------------------

const INIT_ROUNDS = 10;
{
  const compileTimes = [];
  const instantiateTimes = [];
  const initTimes = [];
  let fontCount = -1;
  for (let i = 0; i < INIT_ROUNDS; i++) {
    let t = performance.now();
    const module = await WebAssembly.compile(bytes);
    compileTimes.push(performance.now() - t);

    t = performance.now();
    const instance = new WebAssembly.Instance(module, {});
    instantiateTimes.push(performance.now() - t);

    t = performance.now();
    fontCount = instance.exports.spike_init();
    initTimes.push(performance.now() - t);
  }
  console.log(
    `[${label}] fonts=${fontCount} wasm.compile ${fmt(stats(compileTimes))} | ` +
      `instantiate ${fmt(stats(instantiateTimes))} | ` +
      `spike_init ${fmt(stats(initTimes))}`,
  );
}

// --- benchmark runner ------------------------------------------------------

const module = await WebAssembly.compile(bytes);

function freshInstance() {
  const inst = new WebAssembly.Instance(module, {});
  inst.exports.spike_init();
  return inst;
}

function makeScratch(instance, cap) {
  const ptr = instance.exports.spike_alloc(cap);
  if (ptr === 0) throw new Error('spike_alloc failed');
  return { ptr, cap };
}

/** Write `src` into the scratch buffer; returns its byte length. */
function putSrc(instance, scratch, src) {
  const enc = utf8.encode(src);
  if (enc.length > scratch.cap) throw new Error('scratch too small');
  // Re-create the view each time: memory growth detaches old buffers.
  new Uint8Array(instance.exports.memory.buffer, scratch.ptr, scratch.cap).set(
    enc,
  );
  return enc.length;
}

/**
 * Compile the `n`-th mutation of `doc` on `instance`; returns
 * { dt, pages } where dt times only the spike_compile call.
 * `evictAge` (when set) is applied before the compile, mirroring a
 * compile-entry eviction policy (comemo never evicts on its own).
 */
function compileOnce(instance, scratch, doc, n, evictAge) {
  if (evictAge !== undefined) instance.exports.spike_evict(evictAge);
  const len = putSrc(instance, scratch, mutate(doc, n));
  const t = performance.now();
  const pages = instance.exports.spike_compile(scratch.ptr, len);
  const dt = performance.now() - t;
  return { dt, pages };
}

// --- 3. sanity check -------------------------------------------------------
// Prove spike_compile really compiles: pagebreaks must map to page counts,
// and a syntax error must report the failure sentinel (u32::MAX).

{
  const inst = freshInstance();
  const scratch = makeScratch(inst, 4096);
  const put = (src) => {
    const len = putSrc(inst, scratch, src);
    return inst.exports.spike_compile(scratch.ptr, len);
  };
  for (const [doc, want] of [
    ['Ok', 1],
    ['Ok\n#pagebreak()', 2],
    ['Ok\n#pagebreak()\n#pagebreak()', 3],
  ]) {
    const got = put(doc);
    if (got !== want) {
      throw new Error(`sanity: ${JSON.stringify(doc)} -> ${got}, want ${want}`);
    }
  }
  // u32::MAX crosses the JS boundary as a signed i32, i.e. -1.
  if (put('#let x = ') !== -1) {
    throw new Error('sanity: syntax error not reported as u32::MAX (-1)');
  }
  console.log(
    `[${label}] sanity: real compiles confirmed (pagebreaks + error path)`,
  );
}

/** Cold compile: first compile on a fresh instance. */
function benchCold(doc, samples) {
  const times = [];
  let pages = -1;
  for (let i = 0; i < samples; i++) {
    const instance = freshInstance();
    const scratch = makeScratch(instance, utf8.encode(doc).length + 64);
    const r = compileOnce(instance, scratch, doc, i + 1);
    times.push(r.dt);
    pages = r.pages;
  }
  return { times, pages };
}

/** Warm edit-compile benchmark: mutate the doc before every sample. */
function benchWarm(doc, warmup, samples, evictAge, tag) {
  const instance = freshInstance();
  const scratch = makeScratch(instance, utf8.encode(doc).length + 64);
  let pages = -1;
  for (let i = 0; i < warmup; i++) {
    ({ pages } = compileOnce(instance, scratch, doc, i + 1, evictAge));
  }
  const times = [];
  for (let i = 0; i < samples; i++) {
    const r = compileOnce(instance, scratch, doc, warmup + i + 1, evictAge);
    times.push(r.dt);
    pages = r.pages;
  }
  console.log(
    `[${label}] ${tag} ${fmt(stats(times))} pages=${pages}` +
      (evictAge !== undefined ? ` evict(${evictAge})/compile` : ''),
  );
  return { times, pages };
}

// --- 4. compile benchmarks ---------------------------------------------------

{
  const cold = benchCold(shortDoc, 5);
  console.log(`[${label}] short cold  ${fmt(stats(cold.times))} pages=${cold.pages}`);
  benchWarm(shortDoc, 3, 30, undefined, 'short warm  ');
  benchWarm(shortDoc, 3, 30, 0, 'short warm  ');
  benchWarm(shortDoc, 3, 30, 30, 'short warm  ');
}
{
  const cold = benchCold(tenPagesDoc, 5);
  console.log(
    `[${label}] 10page cold ${fmt(stats(cold.times))} pages=${cold.pages}`,
  );
  benchWarm(tenPagesDoc, 2, 20, undefined, '10page warm ');
  benchWarm(tenPagesDoc, 2, 20, 0, '10page warm ');
  benchWarm(tenPagesDoc, 2, 20, 30, '10page warm ');
}

// --- 5. memory growth over a 100-edit loop (per document) -------------------

/**
 * 100-edit loop under one eviction policy; prints the memory curve at
 * checkpoints so plateaus are visible.
 */
function memoryLoop(doc, name, evictAge, policyTag) {
  const instance = freshInstance();
  const mem = () => instance.exports.memory.buffer.byteLength;
  const afterInit = mem();

  const scratch = makeScratch(instance, utf8.encode(doc).length + 64);
  compileOnce(instance, scratch, doc, 1, evictAge);
  const afterFirst = mem();

  let done = 0;
  const curve = [10, 25, 50, 75, 100].map((n) => {
    while (done < n) {
      compileOnce(instance, scratch, doc, done + 2, evictAge);
      done++;
    }
    return `${n}:${MiB(mem())}`;
  });
  const after100 = mem();
  const growthFromFirst = ((after100 - afterFirst) / afterFirst) * 100;
  console.log(
    `[${label}] mem[${name}] ${policyTag} init=${MiB(afterInit)} first=${MiB(afterFirst)} ` +
      `curve(100 edits)=${curve.join(' -> ')} growth(vs first)=${growthFromFirst.toFixed(1)}%`,
  );
}

memoryLoop(shortDoc, 'short ', undefined, 'no-evict');
memoryLoop(shortDoc, 'short ', 0, 'evict(0) ');
memoryLoop(shortDoc, 'short ', 30, 'evict(30)');
memoryLoop(tenPagesDoc, '10page', undefined, 'no-evict');
memoryLoop(tenPagesDoc, '10page', 0, 'evict(0) ');
memoryLoop(tenPagesDoc, '10page', 30, 'evict(30)');
