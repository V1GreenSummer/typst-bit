# 变更提案：内嵌 CJK 与 Times 风格西文字体

## Why

WASM 版 Typst 目前只内嵌 `typst-assets` 的西文字体（Libertinus / New Computer Modern / DejaVu Mono），且 WASM 环境无系统字体可回退。实测中文源码编译**静默成功**但导出 PDF 中全部 CJK 字形为 `.notdef` 豆腐块（`pdffonts` 仅含 LibertinusSerif；GUI 驱动测试导出的 PDF 渲染确认）。产品 UI 与目标用户均以中文为主，中文渲染缺字属于阻断级缺陷。同时用户要求默认西文字体为 Times New Roman 风格。

## What Changes

- 内嵌**思源宋体**（Noto Serif CJK SC）GB2312 全集子集（7,850 码点，含标点；Regular + Bold；`no-hinting|no-layout-closure`）作为中文默认字体。
- 内嵌 **Liberation Serif**（Times New Roman 度量兼容、SIL OFL 1.1）Regular/Bold/Italic/BoldItalic 作为默认西文字体；原样内嵌不子集化（该字体含 Reserved Font Name）。
- 默认文档模板改为 `#set text(font: ("Liberation Serif", "Noto Serif CJK SC"))`，西文走 Times 风格、中文回退宋体。
- 新增可复现的字体子集化脚本与两份 OFL 许可证文件入库。
- **D10 预算复议**：wasm raw 31.40 → ≈37.2 MiB、brotli 10.09 → ≈13.8 MiB、首载总传输 10.23 → ≈13.9 MiB；预算上调为 raw ≤ 38 MiB / brotli ≤ 14 MiB / 首载 ≤ 14.5 MiB（字体数据不可被 wasm-opt 压缩，为功能必要增量）。
- e2e/acceptance 增加断言：导出 PDF 嵌入 CJK 子集字体、中文文本可提取、缺字为零。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `typst-preview`: 新增「字体覆盖」要求——系统 SHALL 渲染 CJK 与 Times 风格西文，MUST NOT 出现缺字（.notdef），离线语义不变。

## Impact

- `rust/typst-abi`：`src/world.rs`（字体注册）、`Cargo.toml`（新 feature）、`fonts/`（子集字体 + 许可证）、native 测试。
- `app/typstbit/web_wasm`：`workbench.js` 默认模板；`editor-bundle.js` 无需改动（字体在 wasm 侧）。
- `docs/acceptance.md`（D10 预算表与结论）、`docs/spike-b.md`（字体清单引用）。
- `e2e/`：`acceptance.mjs` 预算阈值；新增 PDF 字体内嵌/中文渲染断言（interactions 或 acceptance）。
- 交付物体积：`typst_abi.wasm` raw +5.75 MiB / brotli +3.67 MiB；首载总传输 +3.67 MiB。
- 许可：Noto CJK 与 Liberation Serif 均为 SIL OFL 1.1，随仓库分发许可证副本。
- 不含：GBK/生僻字覆盖（后续按需扩展）、真实 Times New Roman（商业授权，不可分发）。
