# 变更提案：预置 Typst 包（离线 `@preview` 支持）

## Why

用户使用 Typst 官方 Playground 示例时，`#import "@preview/tiaoma:0.3.0"` 报 `file not found (searched at /typst.toml)`：Typst 通过 `VirtualRoot::Package(spec)` 请求包清单与文件，而浏览器 WASM 世界只装载项目文件，也没有网络抓取。官方示例与大量真实文档依赖 `@preview` 包，需要**离线可用的预置包**能力。

## What Changes

- 新增包文件注册 ABI：`typst_abi_set_package_file(spec, path, data)`，按 Typst 的 `VirtualRoot::Package(spec)` + 前导斜杠虚拟路径注册包文件（清单、入口、插件等）。
- 新增 vendor 工具 `tools/vendor-typst-package.py`：从 `packages.typst.org` 下载指定包 tarball（记录 sha256），解包到 `app/typstbit/web_wasm/packages/<ns>/<name>/<version>/` 并生成 `manifest.json` 清单；随包保留 MIT/LICENSE。
- 首批预置 **`@preview/tiaoma:0.3.0`**（二维码/条码，含 wasm 插件；官方 Playground 示例所需）。
- 前端**懒加载**：编译前扫描源码中的 `@ns/name:ver` 导入，仅当包已预置且未装载时并行抓取同源文件并注册，随后自动重编译；装载一次后常驻内存，编译不依赖网络。未预置的包维持现有诊断。
- 测试：native（合成包 + tiaoma 端到端，含插件）；interactions 增加 tiaoma 导入编译用例；全量回归。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `typst-preview`: 新增「预置包解析」要求——系统 SHALL 解析随应用预置的 `@preview` 包，装载后编译 MUST NOT 依赖网络；未预置的包 SHALL 给出可读诊断并保留上次预览。

## Impact

- `rust/typst-abi`：`world.rs`（`set_package_file`）、`abi.rs`（新导出）、`tests/packages.rs`
- `app/typstbit/web_wasm`：新增 `packages.js`、`packages/` 资产；`workbench.js` 懒加载接入
- `tools/vendor-typst-package.py`；`docs/acceptance.md`
- 体积：`typst_abi.wasm` 不变（wasmi 已链接）；包资产首次使用时约 1 MB 同源传输，不计入首载
