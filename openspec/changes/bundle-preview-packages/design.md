# 设计：预置 Typst 包（离线 `@preview` 支持）

## Context

见 `proposal.md`。Typst 0.15.1 的包解析（`typst-eval/src/import.rs:258-280`）：以 `VirtualRoot::Package(spec)` 为根请求 `typst.toml`，校验清单后用入口相对路径 `PathOrStr::resolve`（`typst-library/src/foundations/path.rs:193-207`，以清单所在目录 join）得到入口 FileId；`plugin("./x.wasm")` 同样按相对路径解析。宿主只需让 `World::file/source` 能按相同 FileId 返回字节。`wasmi` 已是 `typst-library` 的常规依赖（非 feature 门控），插件可在浏览器内执行。

## Goals / Non-Goals

**Goals**：预置包可被 `#import "@preview/..."` 解析；首次使用时同源装载、之后编译离线；vendor 流程可复现；插件（tiaoma 的 zint wasm）可用。

**Non-Goals**：任意包的在线下载/解析（只支持预置清单内的包）；包版本区间解析（`@preview/foo` 无版本形式暂不支持）；模板（`typst init`）能力。

## Decisions

### D27 包文件注册与 FileId 对齐

- `VfsWorld::set_package_file(spec: &PackageSpec, path: &str, data: &[u8])`：把 `path` 规范为带前导斜杠的 `VirtualPath`，以 `RootedPath::new(VirtualRoot::Package(spec.clone()), vpath).intern()` 为键写入现有 `sources`（`.typ`）或 `blobs`（其余）映射。
- ABI：`typst_abi_set_package_file(spec_ptr, spec_len, path_ptr, path_len, data_ptr, data_len) -> u32`；spec 为 `"@preview/tiaoma:0.3.0"` 形式（`PackageSpec::from_str`），错误复用 `E_INVALID_ARG`/`OK`。
- 与 Typst 请求对齐依据：清单 `typst.toml`（vpath `/typst.toml`）、入口与插件按清单目录 join（`/lib.typ`、`/zint_typst_plugin.wasm`）——注册路径统一加前导斜杠即可命中。

### D28 懒加载与离线语义

- 前端 `packages.js`：`loadManifest()` 读取 `./packages/manifest.json`；`registerPackage(bridge, entry)` 并行抓取包文件并调用 ABI 注册。
- `workbench.js` 在 `startCompile(source)` 前用正则扫描 `@ns/name:ver`：已预置且未装载 → 置“编译中”、并行装载、完成后用当前编辑器内容重新编译；装载集合常驻内存，二次编译不再抓取。
- 未预置包不做特殊处理（Typst 原有 `file not found` 诊断保留 last-good）；不改变首载（不使用包则不产生请求）。
- 并发去重：按 spec 记录进行中的 Promise，避免连续编辑重复抓取。

### D29 vendor 工具与许可

- `tools/vendor-typst-package.py`：输入 `@ns/name:ver`，从 `https://packages.typst.org/<ns>/<name>-<ver>.tar.gz` 下载，打印并校验 sha256，解包到 `app/typstbit/web_wasm/packages/<ns>/<name>/<ver>/`，并汇总生成 `packages/manifest.json`（含 spec、目录、文件列表）。
- 包内 `LICENSE`（tiaoma 为 MIT）随资产保留；`docs/acceptance.md` 记录 vendor 命令与首批包版本、sha256。

### D30 插件运行时

- tiaoma 依赖 `plugin("./zint_typst_plugin.wasm")`（879 KB）；`typst-library` 已链接 wasmi，浏览器内解释执行，无新增依赖与体积。
- 验证路径：native 测试（插件在本机 wasmi 运行）→ interactions 浏览器用例（真实打包 wasm）。

## Risks / Trade-offs

- [浏览器内 wasmi 插件执行差异] → native + 浏览器双测；若浏览器失败，回退为“仅支持非插件包”，并保留可读诊断（记录为后续）。
- [首次使用抓取约 0.9 MB] → 懒加载不计入首载；同源、可缓存（当前静态服务 no-store，生产可加缓存头）。
- [包资产与 rust 测试耦合] → native 测试读取仓库内 `app/typstbit/web_wasm/packages/...`，路径在测试中显式声明；vendor 缺失时测试失败并提示先运行工具。
- [包版本硬编码] → manifest 化，新增包仅需 vendor + 清单更新，不改代码。

## Migration Plan

vendor tiaoma → Rust ABI/World + native 测试 → 前端清单/懒加载 → 重建 wasm → e2e/回归 → 文档。回退：删除 `packages/` 资产与 `packages.js` 接入即可恢复原行为（ABI 导出保留无害）。

## Open Questions

（无）
