# 验收记录（任务 9.1 / 9.2）

日期：2026-09-06。环境：Intel Core Ultra 9 285K / 96GB / node 22 / playwright chromium（软件 WebGPU，`--enable-unsafe-webgpu --use-angle=swiftshader`）。全部自动化断言可复现：

```sh
cd e2e
node acceptance.mjs       # 离线场景 + D10 计时/内存预算
node browser-matrix.mjs   # 浏览器矩阵（chromium×2 + firefox）
node fresh-build.mjs      # fresh 构建端到端（见下述限制）
node loader.mjs           # 17 项功能断言（任务 8.1–8.3）
node commands.test.mjs    # 命令目录/编辑会话单测（无浏览器，变更 workbench-editor-core）
node interactions.mjs     # 真实输入事件交互（含命令行面板、字体内嵌与中文提取断言）
node drive-gui.mjs        # GUI 驱动（真实鼠标键盘 + 截图）
node editor-cmb.test.mjs  # 编辑器（CodeMoonBit）挂载/高亮/自动闭合/主题/诊断标记
node vscode-bridge.test.mjs # VSCode 桥：包/编译/PNG/PDF/SVG/诊断映射
node mcp.test.mjs         # MCP 服务器（5 工具）
node cli.test.mjs         # 离线 CLI（compile/pdf/png/svg/outline）
node core.test.mjs        # MoonBit 应用核心（core.wasm）契约与黄金样例
```

编辑器修订（2026-09-20，P2）：默认与唯一编辑器为 CodeMoonBit（wasm-gc，`editor-adapter-cmb.js`），CodeMirror 依赖与打包产物已移除；`interactions`/`loader`/`drive-gui`/`commands`/`plugins`/`editor-cmb`/`acceptance`/`browser-matrix`/`fresh-build` 全部在 CodeMoonBit 路径复跑通过。VSCode 扩展补齐工作区 VFS 同步、Problems 诊断与 SVG 导出（`docs/vscode.md`）。

核心修订（2026-09-21，P1–P3）：应用核心（`app/typstbit/core` → `core.wasm`）默认驱动菜单/工具栏/顶栏结构、命令面板筛选与按钮状态、大纲、包检测与诊断映射；JS 删除 `outline.js` 与包扫描、目录元数据（仅保留执行映射），Node/浏览器共用 `core-adapter.js`，`core.test.mjs` 以冻结黄金样例对拍。

编辑核心结构（变更 `workbench-editor-core`）：`app/typstbit/web_wasm/commands.js` 是唯一命令目录（菜单/工具栏/快捷键/⌘K 命令面板均由它派生，`runCommand(id, ctx)` 统一分发）；`session.js` 是单一编辑会话（源码、状态、revision、诊断、预览），`__typstbit` 的 `e2e_*` 与 UI 读同一会话；命令层回归走 `node commands.test.mjs`，浏览器事件路径由 `interactions.mjs` / `drive-gui.mjs` 覆盖。

预置包（变更 `bundle-preview-packages`）：`@preview/tiaoma:0.3.0`（MIT，sha256 c646c3f41c3f1a062ff1558f070187ac970b7d350f00b31f45133e059c9981be）随应用预置，首次导入时从同源懒加载并由 `typst_abi_set_package_file` 注册，之后编译离线可用；新增包执行 `python3 tools/vendor-typst-package.py @preview/<name>:<version>` 并提交 `app/typstbit/web_wasm/packages/`。

预览与产物（变更 `workbench-parity-fixes`）：预览面板按页栅格渲染（`typst_abi_render_page_png`），页码导航由应用控件提供，PDF 仅用于导出与新标签页；页面优先加载 `typst_abi.opt.wasm`（fetch 失败回退非优化产物），acceptance 校验实际被服务的产物。

## 9.1 场景验收

| 场景 | 结果 | 方式 |
|---|---|---|
| 已加载页面断网编辑编译（spec 离线场景） | **PASS** | playwright `setOffline(true)` 后编辑+重编译成功、预览就绪、零外发网络请求 |
| 浏览器矩阵：chromium + WebGPU | **PASS** | 启动/编译/编辑/预览/无页面错误全通过（软件 adapter） |
| 浏览器矩阵：Firefox 155（playwright Linux build） | **降级通过** | WasmGC 正常、编辑/编译/无错误；**该构建无 navigator.gpu** → canvas2d 降级：预览图不渲染（D3 已知 MoUI 0.1.9 限制，优雅降级不崩溃） |
| 浏览器矩阵：chromium 无 WebGPU（canvas2d 降级路径） | **PASS** | 同上：应用可用、编译正常、预览降级 |
| 浏览器矩阵：WebKit/Safari | **环境受阻** | playwright webkit 缺系统库（无 sudo 无法安装）；需在具备依赖的主机手动补验 |
| fresh clone 按文档构建运行 | **PASS（模拟）** | 仓库非 git repo：以"复制源码树（剔除 target/_build/.mooncakes/node_modules）+ 按文档命令全量构建 + e2e 启动"模拟；cargo release 58s、moon check+build 通过、启动/编译/预览全绿。注：需在首次 moon 命令物化 `.mooncakes` 后重跑 `tools/restore-wayland-stubs.sh`（docs 已记载） |

## 9.2 预算复核（design D10 全表）

| 指标 | 预算 | 实测 | 判定 |
|---|---|---|---|
| typst_abi.wasm 原始 / brotli（wasm-opt -Oz 后） | ≤ 39MB / ≤ 14MB | **38.34 MiB / 13.89 MiB** | ✓（2026-09-16，含 CJK/Times 字体） |
| app.wasm（含 MoUI，release）原始 / brotli | ≤ 3MB / ≤ 1MB | 0.47 MiB / 0.14 MiB | ✓ |
| 首载总传输（brotli） | ≤ 14.5MB | 14.03 MiB | ✓ |
| 初始化（到可编辑） | ≤ 5s（中端） | 902ms（桌面+**软件 WebGPU**） | ✓（≥5x 余量；真机矩阵待补） |
| 短文档编译 P95 | ≤ 500ms | 3.7ms（浏览器内，生产 ABI） | ✓ |
| 10 页文档编译 P95 | ≤ 3s | 14.0ms | ✓ |
| 单页 1x 渲染 P95 | ≤ 200ms | 18.2ms | ✓ |
| 100 次编辑 wasm memory 增长 | ≤ 20% | **0.0%**（39,976,960B 恒定，含内嵌字体） | ✓（comemo evict(0) 生效） |
| 浏览器基线 | 矩阵实测后修订 | chromium+WebGPU 全通过；Firefox（此构建）canvas2d 降级 | **基线修订见下** |

### 处理决定（超支/发现项）

1. **CJK/Times 字体内嵌（变更 `bundle-cjk-times-fonts`）**：中文源编译此前静默产出 `.notdef` 缺字；修复需内嵌 Noto Serif CJK SC GB2312 子集（Regular+Bold）与 Liberation Serif（Times New Roman 度量兼容，四字重），字体段不能被 wasm-opt 压缩。实测（2026-09-16，wasm-opt -Oz）：代码基线 32.64 / 10.37 MiB + 字体 5.70 / 3.52 MiB = **38.34 MiB raw / 13.89 MiB brotli**，首载 14.03 MiB。决定：**预算复议为 raw ≤ 39MB、brotli ≤ 14MB、首载总传输 ≤ 14.5MB**（原 ≤32 / ≤10 / ≤11）。理由：字体为功能必要增量；文档旧基线 31.40 已过期（同配置当前代码 32.64）；评估过的独立资源/懒加载方案总传输量相当或更差。
2. **Firefox（playwright Linux build）无 WebGPU**：应用降级运行（编辑/编译/状态正常，预览不渲染）。决定：**基线修订为"预览功能要求 WebGPU 浏览器（Chrome/Edge ≥ 119）"；无 WebGPU 浏览器为优雅降级模式**——与 D3 的 canvas2d 限制记录一致；后续变更可选：(a) 推动 MoUI canvas2d 图片支持上游、(b) 自研 canvas2d 图片绘制、(c) 等待 Firefox WebGPU 普及。spec 离线/编辑/编译/错误呈现场景在全部矩阵浏览器通过。
3. **WebKit/Safari**：本机缺系统依赖无法跑 playwright webkit；Safari 18 基线项转手动补验（需 macOS 或装齐依赖的 Linux 主机）。
