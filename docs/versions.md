# 版本基线 (Version Baseline)

本文件是任务 1.2 留档的版本基线（见 `openspec/changes/moui-typst-webapp/tasks.md`）。升级任何一项前先在此登记。

## 工具链

| 项 | 版本 | 固定方式 |
|---|---|---|
| moon | 0.1.20260819 (fc2a4ee 2026-08-19) | 本机安装，CI/协作者按此对齐 |
| Rust | 1.98.1 | `rust/rust-toolchain.toml`（含 `wasm32-unknown-unknown` target，profile=minimal） |
| binaryen (wasm-opt) | 132 | 发布管线必需（`wasm-opt -Oz --strip-debug --strip-producers`，-25.8% 体积，见 `docs/spike-b.md`）；本机经 npm `binaryen` 包提供 |
| Node | 22.x（开发/构建脚本用） | 非产物依赖 |

## MoonBit 依赖（`app/typstbit/moon.mod`）

| 包 | 版本 |
|---|---|
| `wzzc-dev/moui` | 0.1.9 |
| `wzzc-dev/moui_web_renderer` | 0.1.9 |
| `wzzc-dev/moui_skia_renderer` | 0.1.9（native 入口用，不影响 wasm-gc 产物） |

MoUI CLI：`moon install wzzc-dev/moui_cli/cmd/moui`（脚手架 `moui new`，脚手架版本独立于依赖版本）。

## Rust 依赖（`rust/` workspace，Spike B 起加入）

| crate | 版本 |
|---|---|
| `typst` | 0.15.1 |
| `typst-render` | 0.15.1 |
| `typst-assets` | 0.15.1（同版本号配对，2026-09-05 查证于 crates.io） |

## 浏览器基线

| 浏览器 | 最低版本 | 说明 |
|---|---|---|
| Chrome / Edge | 119 | WasmGC 稳定线 |
| Firefox | 120 | WasmGC 稳定线 |
| Safari | 18 | WasmGC；无 WebGPU 时走 MoUI canvas2d 降级 |

## 构建命令速查

```sh
# Rust ABI 模块（产物：rust/target/wasm32-unknown-unknown/release/typst_abi.wasm）
cd rust && cargo build --target wasm32-unknown-unknown --release

# MoonBit 应用（注意必须显式 --target wasm-gc）
cd app/typstbit && moon check --target wasm-gc && moon build --target wasm-gc
```

## 本机构建注意事项（无 sudo 环境）

`wzzc-dev/window` 的 prebuild 脚本在 Linux 上要求 wayland-protocols 与 wayland-scanner（仅
native 构建需要，wasm-gc 产物不链接任何 native 代码）。本机无 sudo，采用桩方案：

- `~/.local/share/fake-wayland/`：放置真实协议 XML（仅作时间戳基准）
- `~/.local/lib/pkgconfig/wayland-protocols.pc`：`pkgdatadir` 指向上述目录（**必须含 `Version:` 字段**，否则 pkg-config 拒绝解析）
- `.mooncakes/wzzc-dev/window/linux/generated/` 下的 4 个生成文件为**预置 stub**（比 XML 新，跳过 wayland-scanner）

构建 wasm-gc 时需带环境变量：

```sh
PKG_CONFIG_PATH="$HOME/.local/lib/pkgconfig" moon build --target wasm-gc
```

`.mooncakes` 被重新物化后 stub 会丢失，重跑 `tools/restore-wayland-stubs.sh` 恢复。
