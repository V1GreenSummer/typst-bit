# 设计：内嵌 CJK 与 Times 风格西文字体

## Context

动机见 `proposal.md`。现状与约束：

- `VfsWorld` 字体来自 `typst_assets::fonts()`（17 个文件，全西文）；WASM 无系统字体，缺失字形静默渲染为 `.notdef`。
- 本次已完成选型评估（脚本与产物见 `/tmp/opencode/font-eval/`）：HarfBuzz subset（系统 libharfbuzz 8.3）可产出 Typst 可加载的子集；Noto Serif CJK SC 与 Liberation Serif 均为 OFL 1.1。
- 约束：D10 体积/首载预算、离线语义（spec 字体预置条款）、字体授权可再分发。

## Goals / Non-Goals

**Goals**：GB2312 范围内中文零缺字（默认宋体）；默认西文为 Times New Roman 度量兼容字体；子集化可复现；预算复议入档。

**Non-Goals**：GB2312 之外的生僻字覆盖（后续可扩 GBK）；真实 Times New Roman/微软雅黑/宋体（专有授权）；CJK 斜体字形；用户自定义字体上传。

## Decisions

### D11 字体选型

- 中文：**Noto Serif CJK SC**（思源宋体）。OFL 1.1 且无 Reserved Font Name，允许子集化后保留字体名。
- 西文：**Liberation Serif**（Times New Roman 度量兼容，字宽与 TNR 一致）。OFL 1.1 含 RFN "Liberation"，因此**原样内嵌、不做子集化**以规避改名要求；四个字重共 1.45 MiB raw / 0.66 MiB br。
- 否决：微软雅黑/宋体/Times New Roman（专有，不可再分发）；思源黑体（用户指定宋体）；Droid Sans Fallback（无粗体、字形质量一般）。

### D12 子集化策略

- 字符集 = GB2312 全集（6,763 汉字）+ 字体 cmap 中以下区段的字符（U+00B0–00BF、U+2010–203B、U+2460–24FF、U+3000–303F、U+FF00–FFEF）+ ASCII 可打印，共 7,850 码点。含 `——`、`……`、全角标点。
- HarfBuzz flags = `no-hinting | no-layout-closure`，Regular + Bold。
- 实测（Noto Serif CJK SC）：Regular 2.13 MiB raw / 1.47 MiB br，Bold 2.17 / 1.54；逐字符 nominal 外框与原始 SC 面 **0 失配**；HarfBuzz 排版对比唯一差异是 `——` 连字丢失（1692 → 890+890 units，渲染几乎不可见）。
- 可复现：`tools/subset-cjk-fonts.py`（ctypes 驱动系统 libharfbuzz-subset），脚本头部记录源字体路径/版本/hash 与 flags；输出入库 `rust/typst-abi/fonts/`。

### D13 内嵌与注册

- 子集字体以 `include_bytes!` 内嵌 `typst_abi.wasm`，在 `typst_assets::fonts()` **之后**追加，保持 FontBook 索引稳定（沿用 D6 约定）。
- 新 Cargo feature `cjk-fonts`（默认开启）；关闭时得到 fonts-free 变体，仅用于体积对照与回归。
- 默认文档模板（`workbench.js` 的 `DEFAULT_SOURCE`）设置 `#set text(font: ("Liberation Serif", "Noto Serif CJK SC"))`：西文 Times 风格、中文回退宋体；用户删除该行后中文仍自动回退宋体（字体已注册）。
- 文件布局：`rust/typst-abi/fonts/NotoSerifCJKsc-{Regular,Bold}-GB2312.otf`、`LiberationSerif-{Regular,Bold,Italic,BoldItalic}.ttf`、`OFL-NotoSerifCJK.txt`、`OFL-Liberation.txt`。

### D14 预算复议（修订 D10）

| 指标 | 原预算 | 新预算 | 实测（wasm-opt -Oz 后） |
|---|---|---|---|
| typst_abi raw | ≤ 32 MB | ≤ 39 MB | 32.64（当前代码基线）+ 5.70（字体）= 38.34 MiB |
| typst_abi brotli | ≤ 10 MB | ≤ 14 MB | 10.37 + 3.52 = 13.89 MiB |
| 首载总传输（brotli） | ≤ 11 MB | ≤ 14.5 MB | 13.89 + 0.14（app.wasm）= 14.03 MiB |

其余 D10 指标不变。理由：字体数据为功能必要，wasm-opt 无法压缩字体段；评估过的独立资源/懒加载方案总传输量相当或更差（懒加载还需异步时序与 spec 离线条款修订）。2026-09-16 实测复核：文档旧基线 31.40（同配置当前 32.64，代码集继续增长）已过期，字体实际增量 5.70 MiB raw / 3.52 MiB br，raw 预算复议为 ≤ 39 MB。

## Risks / Trade-offs

- [`no-layout-closure` 丢 `——` 连字] → 实测渲染几乎不可见；如追求 1:1 保真，切回 default flags 增加约 3.5 MiB br，记录为可回退项。
- [Liberation Serif 含 RFN] → 原样内嵌不改名，随附 OFL 许可证。
- [wasm 内存增长约 6 MB（字体字节）] → acceptance 记录初始内存；编辑增长预算（≤20%）不受影响。
- [GB2312 之外生僻字仍缺字] → 明确 Non-Goal；子集脚本参数化，后续可扩 GBK。
- [初始化/编译耗时增加] → 字体解析增量待 acceptance 实测；初始化预算 5s 余量充足。

## Migration Plan

新增字体与脚本 → `world.rs` 注册 → 模板更新 → 预算表与文档修订 → e2e 断言（PDF 嵌入 CJK 字体、中文可提取、缺字为零）→ 全量回归。回退：关闭 `cjk-fonts` feature 即恢复原体积；模板字体列表在缺字体时自动回退 Libertinus，不会报错。
