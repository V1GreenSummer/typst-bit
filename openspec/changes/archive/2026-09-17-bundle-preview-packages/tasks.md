# 任务：预置 Typst 包（离线 `@preview` 支持）

## 1. Vendor 工具与资产

- [x] 1.1 编写 `tools/vendor-typst-package.py`（下载 `@ns/name:ver` tarball、打印 sha256、解包到 `app/typstbit/web_wasm/packages/<ns>/<name>/<ver>/`、生成 `packages/manifest.json`），运行 vendor `@preview/tiaoma:0.3.0`，验证：目录含 `typst.toml`/`lib.typ`/插件/`LICENSE`，清单记录 spec/文件列表
- [x] 1.2 运行：`packages/manifest.json` 可被 `node -e` 解析，文件路径与实际一致，MIT LICENSE 保留

## 2. Rust 包注册

- [x] 2.1 `world.rs` 增加 `set_package_file(&PackageSpec, path, data)`（`VirtualRoot::Package` + 前导斜杠 vpath，`sources`/`blobs` 分流），验证：native 合成包导入编译通过
- [x] 2.2 `abi.rs` 增加 `typst_abi_set_package_file` 导出（参数校验、`&str`/UTF-8/路径错误映射），验证：native 测试与指针越界用例
- [x] 2.3 `tests/packages.rs`：合成包（清单+入口）导入 0 警告；未预置包报错；tiaoma（读仓库资产）导入 + 二维码编译，验证：`cargo test -p typst-abi` 全绿

## 3. 前端懒加载

- [x] 3.1 新增 `app/typstbit/web_wasm/packages.js`（清单加载、源码 spec 扫描、按 spec 去重并发抓取并注册），`Abi` 增加 `setPackageFile`
- [x] 3.2 `workbench.js` 编译前接入懒加载（置“编译中”→装载→重编译；失败给诊断），验证：interactions 用例

## 4. 构建与验证

- [x] 4.1 重建 release `typst_abi.wasm` + wasm-opt，记录体积（wasmi 已链接，预期无明显增长），验证：acceptance 体积预算仍达标
- [x] 4.2 `interactions.mjs` 增加 tiaoma 导入用例（官方 Playground 片段编译成功、无错误），验证：全绿
- [x] 4.3 全量回归：`commands.test.mjs`、`interactions.mjs`、`loader.mjs`、`acceptance.mjs`、`drive-gui.mjs`、`fresh-build.mjs` 全 PASS
- [x] 4.4 更新 `docs/acceptance.md`：预置包说明、vendor 命令、首批包版本与 sha256；验证：文档与实现一致
