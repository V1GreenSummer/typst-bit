# 任务：内嵌 CJK 与 Times 风格西文字体

## 1. 字体资产与子集化脚本

- [x] 1.1 编写 `tools/subset-cjk-fonts.py`（ctypes 驱动系统 libharfbuzz-subset；字符集=GB2312 全集+标点/全角区段+ASCII；flags=`no-hinting|no-layout-closure`；Regular+Bold；脚本头记录源字体路径/hash/flags），运行生成 `rust/typst-abi/fonts/NotoSerifCJKsc-{Regular,Bold}-GB2312.otf`，验证：逐字符 nominal 覆盖检查缺字=0，且体积与设计基线一致（Regular ≈2.13 MiB / Bold ≈2.17 MiB raw）
- [x] 1.2 复制 Liberation Serif 四字重（Regular/Bold/Italic/BoldItalic）与两份 OFL 许可证（Noto CJK、Liberation）到 `rust/typst-abi/fonts/`，验证：`fc-query` 可解析四文件、许可文件含 SIL OFL 1.1 全文、Liberation 未被修改（sha256 与系统源文件一致）

## 2. Rust 内嵌与注册

- [x] 2.1 `rust/typst-abi/Cargo.toml` 增加默认开启的 `cjk-fonts` feature；`src/world.rs` 在 `typst_assets::fonts()` 之后 `include_bytes!` 追加 6 个字体，保持 FontBook 索引稳定，验证：`cargo test -p typst-abi` 全部通过且 `font_count()` 由 17 增至 23
- [x] 2.2 新增 native 测试覆盖 spec 场景：中文文档编译 0 警告、粗体中文、中西文混排、标点与 `——`；导出 PDF 断言嵌入 `NotoSerifCJKsc`，验证：`cargo test -p typst-abi` 新测试通过
- [x] 2.3 验证 fonts-free 变体仍可构建（`cargo build -p typst-abi --no-default-features`）且不带字体数据，用于体积对照回归

## 3. 前端默认字体与构建产物

- [x] 3.1 `app/typstbit/web_wasm/workbench.js` 的 `DEFAULT_SOURCE` 设置 `#set text(font: ("Liberation Serif", "Noto Serif CJK SC"))`；验证：GUI 驱动测试（`e2e/drive-gui.mjs`）默认文档导出 PDF 中西文均无缺字
- [x] 3.2 重新构建 release `typst_abi.wasm`（含 wasm-opt -Oz）并记录 raw/brotli 体积，验证：体积在复议预算内（raw ≤39 MiB、brotli ≤14 MiB）

## 4. 预算与文档

- [x] 4.1 更新 `e2e/acceptance.mjs` 预算阈值（raw ≤39 MiB、brotli ≤14 MiB、首载 ≤14.5 MiB）与体积报告，验证：`node acceptance.mjs` PASS
- [x] 4.2 更新 `docs/acceptance.md` D10 表与处理决定（记录字体增量与复议理由）；`docs/spike-b.md` 字体清单处补注 CJK/Times 字体内嵌，验证：文档数据与 acceptance 实测一致

## 5. e2e 断言与全量回归

- [x] 5.1 在 `e2e/interactions.mjs` 增加字体断言：导出 PDF 字节包含 `NotoSerifCJKsc`；若系统存在 `pdftotext`，进一步校验中文源文本完整提取（工具缺失时跳过并打印说明），验证：`node interactions.mjs` 全绿
- [x] 5.2 全量回归：`node interactions.mjs`、`node loader.mjs`、`node acceptance.mjs`、`node drive-gui.mjs`、`node fresh-build.mjs` 全部 PASS，且初始化/编译 P95/内存增长仍在 D10 预算内
