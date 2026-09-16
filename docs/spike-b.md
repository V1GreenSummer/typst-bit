# Spike B 实测记录：Typst World 编译到 wasm32-unknown-unknown

任务 3.2 留档（`openspec/changes/moui-typst-webapp/tasks.md`），对照 design D10 预算。
日期：2026-09-05。

## 环境

| 项 | 值 |
|---|---|
| CPU | Intel Core Ultra 9 285K（24 核，桌面级——中端设备需按比例折算） |
| 内存 | 96 GB |
| Rust | 1.98.1（rust-toolchain.toml 固定） |
| node / V8 | v22.22.3（Chrome 同源引擎，浏览器结果的最佳可用代理） |
| typst / typst-assets / typst-layout | 0.15.1 |
| binaryen (wasm-opt) | 132 |

## 被测构建

- profile：`panic=abort, opt-level="s", lto=true, codegen-units=1`（`opt-level="z"` 实测更差：39.48 MiB → 40.66 MiB，弃用）
- 发布管线：`cargo build --target wasm32-unknown-unknown --release` → `wasm-opt -Oz --strip-debug --strip-producers`
- `bundled-fonts` 特性（默认开）内嵌 typst-assets 字体；关闭即得 fonts-free 变体
- 生产 `VfsWorld` 另经 `cjk-fonts` 特性内嵌 Noto Serif CJK SC GB2312 子集与 Liberation Serif（Times 度量兼容，变更 `bundle-cjk-times-fonts`，体积与预算见 `docs/acceptance.md`）；本页 Spike 世界仅含 typst-assets 字体，数字不含该增量
- spike ABI：`spike_init / spike_alloc / spike_evict / spike_compile`（见 `rust/typst-abi/src/lib.rs`）
- 复现：`cd rust && cargo build --target wasm32-unknown-unknown --release && npx wasm-opt target/wasm32-unknown-unknown/release/typst_abi.wasm -Oz --strip-debug --strip-producers -o typst_abi.opt.wasm && node typst-abi/spike/measure.mjs typst_abi.opt.wasm bundled-opt`

typst-assets `fonts()`（0.15.1）收录 17 个字体文件（目录中 31 个文件并非全部入选；Foxit PDF 标准字体等被排除），共 9.6 MB，`Font::new` 17/17 全部解析成功，含 New Computer Modern Math ×3。

## 体积（D10 预算：raw ≤ 25 MB / brotli ≤ 8 MB，含内嵌字体）

| 变体 | raw | brotli(-q11) |
|---|---|---|
| bundled（cargo 直出） | 39.48 MiB | — |
| bundled（wasm-opt 后） | **29.26 MiB** | **9.75 MiB** |
| nofonts（cargo 直出） | 30.23 MiB | — |
| nofonts（wasm-opt 后） | **20.03 MiB** | **5.83 MiB** |

- wasm-opt 是必要发布步骤（-25.8%）；字体数据 9.6 MB 无法被 binaryen 压缩
- **bundled 超预算**：raw +17%、brotli +22%；nofonts 达标
- 首载总传输（D10 ≤ 10 MB）：bundled ≈ 9.75 + app.wasm(≤1) ≈ 10.75 MB（轻微超）；nofonts + 独立字体传输 ≈ 5.83 + ~3.4 + 1 ≈ 同量级（字体单独压缩与内嵌压缩率相当）

## 初始化（bundled，n=10）

| 阶段 | p50 | p95 |
|---|---|---|
| WebAssembly.compile（29.26 MiB 模块） | 19.1 ms | 33.2 ms |
| instantiate（含 ~19.7 MiB 数据段载入） | 13.1 ms | 13.8 ms |
| spike_init（字体解析 + FontBook + Library） | 1.5 ms | 4.9 ms |
| 合计 | ~34 ms | ~52 ms |

（桌面级 CPU；D10 预算 5 s 中端设备，typst_abi 份额余量巨大。）

## 编译（bundled；D10 预算：短文档 P95 ≤ 500 ms，10 页 P95 ≤ 3 s）

文档：`spike/short.typ`（~50 行）、`spike/tenpages.typ`（10 页）。每次采样改变正文中的 revision 标记（模拟真实编辑）。

| 场景 | p50 | p95 | 预算 |
|---|---|---|---|
| 短文档冷编译（新实例首次） | 6.2 ms | 19.1 ms | 500 ms ✓ |
| 短文档热编译 | 0.5 ms | 0.6 ms | ✓ |
| 短文档热编译 + evict(0)/compile | 2.1 ms | 2.2 ms | ✓ |
| 10 页冷编译 | 24.1 ms | 27.9 ms | 3 s ✓ |
| 10 页热编译 | 19.0 ms | 21.4 ms | ✓ |
| 10 页热编译 + evict(0)/compile | 19.2 ms | 19.7 ms | ✓ |

## 内存（D10 预算：100 次编辑循环后增长 ≤ 20%）

100 次编辑循环后的增长（vs 首次编译后）：

| 策略 | 短文档 | 10 页文档 |
|---|---|---|
| 不驱逐 | +87.1% | +1600.5%（466.6 MiB） |
| `comemo::evict(30)`/compile | +26.0% | +480.2%（159.2 MiB） |
| `comemo::evict(0)`/compile | **0.0%** | **0.0%** |

曲线（10 页文档）：no-evict 71→137→247→357→467 MiB（线性发散）；evict(0) 全程 27.44 MiB 恒定；evict(30) 收敛于 ~159 MiB。

bundled 实例基线：初始化后 19.69 MiB，首次编译后 20.88 MiB（短）/ 27.44 MiB（10 页）。

## 结论（回填 design）

1. **comemo 缓存无界增长是主要内存风险**：每个不同源码版本的求值/布局缓存永不释放。**编译入口必须执行 `comemo::evict(0)`**（回填 D9 编译入口语义与 D6）；其代价（热编译 0.5→2.1 ms / 19.0→19.2 ms）相对预算可忽略。evict(30) 不满足 ≤20% 预算，弃用。
2. **编译与初始化预算全部大幅达标**（含桌面→中端折算余量），D4 主线程编译假设成立，无 Worker 提前压力。
3. **体积预算超支**（raw 29.26 vs 25 / brotli 9.75 vs 8）触发字体策略复议；**决策（2026-09-05）：保持内嵌，D10 预算上调为 raw ≤ 30MB / brotli ≤ 10MB，首载总传输 ≤ 11MB**。字体按需获取备选弃用（总传输量相当、装载复杂度不值），spec 离线条款不变。
4. wasm-opt (-Oz) 纳入发布管线，binaryen 132 纳入版本基线。

## 附：fonts-free 变体数据

仅供体积对比；其编译计时不可用（零字体导致显式字体缺失报错/回退排版，页数与内容退化：10 页文档排版为 2 页，短文档编译失败），不作为性能数据引用。
