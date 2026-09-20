# Typst.bit Preview（VSCode 最小扩展 PoC）

在 VSCode 里用**同一份** `typst_abi.opt.wasm`（离线、无网络）预览与导出当前 `.typ` 文件。

## 运行

1. 准备扩展资源（wasm 与可选的预置包）：

```sh
mkdir -p editors/vscode/assets
cp rust/target/wasm32-unknown-unknown/release/typst_abi.opt.wasm editors/vscode/assets/
cp -r app/typstbit/web_wasm/packages editors/vscode/assets/packages
```

2. 用 VSCode 打开 `editors/vscode/`，按 `F5` 启动扩展开发宿主（Extension Development Host）。
3. 在宿主里打开任意 `.typ` 文件，运行命令面板：
   - `Typst.bit: 预览当前文件`（编辑器标题栏也有按钮，编辑/保存/工作区文件变化后 300ms 自动刷新）
   - `Typst.bit: 导出 PDF` / `Typst.bit: 导出 SVG`（输出到同目录同名文件）
   - `Typst.bit: 复制 MCP 配置`

## 配置

| 设置 | 说明 |
|---|---|
| `typstbit.abiPath` | wasm 路径；默认 `<extension>/assets/typst_abi.opt.wasm` |
| `typstbit.packagesPath` | 预置包目录（`manifest.json` + 包文件）；默认 `assets/packages`，用于 `@preview/...` 导入 |

## 说明

- 预览为 PNG（1.5x），支持编译诊断列表；大文档刷新有 300ms 防抖。
- 工作区中的 `.typ`/图片/`.bib` 会同步进 ABI VFS（打开的未保存文档优先），因此 `#import "lib.typ"` 等多文件项目可用。
- 编译诊断会写入 VSCode **Problems** 面板（`typstbit` 集合，按文件映射，行/列已转 0-based），点击可跨文件跳转。
- 编辑、保存以及工作区文件增删改都会触发重编译；`typstbit.exportSvg` 导出当前页。
- 尚未实现：完整工作台 Webview（形态 B）与真实 FS 双向同步，见 `docs/vscode.md` 的路线图。
- 打包发布（vsce）时把 wasm 放进 `assets/` 并随扩展分发（约 4.5MB brotli / 38MB 原始）。
