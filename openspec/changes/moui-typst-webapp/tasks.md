# Tasks: moui-typst-webapp

## 1. 版本与工具链基线

- [x] 1.1 安装 Rust 工具链并固定：rustup + `rust-toolchain.toml` + `wasm32-unknown-unknown` target（本机当前仅有 moon，无 cargo/rustup）；验证 `cargo build --target wasm32-unknown-unknown` 空工程通过
- [x] 1.2 固定并留档版本基线 `docs/versions.md`：moon 版本、MoUI 依赖版本（moon.mod 锁定）、Rust 工具链、typst/typst-render/typst-assets crate 版本（同版本号配对）、浏览器基线（Chrome/Edge ≥ 119、Firefox ≥ 120、Safari ≥ 18，无 WebGPU 走 canvas2d 降级）；建立 monorepo 骨架（`rust/` cargo workspace + `app/` moonbit workspace，`moui new` 脚手架），验证 `cargo check` 与 `moon check` 均通过

## 2. 阻断性 Spike A：MoUI runtime 注入与 text-id 往返

- [x] 2.1 验证 `bootMouiWasmGcApp({ imports })` 为 app.wasm 注入自定义 import 模块：新增 `typst` 模块 echo 函数，浏览器完成标量往返与 **text-id 字符串表注册/读取往返**断言；结论（注入机制 + 字符串表访问路径）回填 design.md 开放问题节。**本项与 3.1 通过前，不得实现完整 World、状态机或视图**

## 3. 阻断性 Spike B：Typst wasm 构建与实测

- [x] 3.2 最小 Typst World（Library::build + typst-assets 内嵌字体 + 单文件 + today()）编译到 `wasm32-unknown-unknown`（panic=abort）；记录 .wasm 原始/brotli 体积、初始化时间、短文档与 10 页文档编译 P50/P95、内存占用，对照 design D10 预算（超支触发字体策略复议并同步修订 spec 离线条款）。**阻断任务 6**

## 4. Spike C：Blob URL 渲染桥

- [x] 4.1 用硬编码 PNG 字节验证 Blob → `URL.createObjectURL` → MoUI image 显示、`URL.revokeObjectURL` 释放无泄漏、revision 乱序保护（旧图完成事件不覆盖新图）；data-URL 回退路径一并验证；结论回填 design D3

## 5. ABI v1 冻结（门禁）

- [x] 5.1 依据三个 spike 结论修订并冻结 design D9 的 ABI v1（单实例、`set_file/set_main/compile` VFS 语义、输入 arena/输出 buffer 生命周期与分离、状态码枚举、panic 策略、scale_milli）；冻结记录提交至 design.md，评审通过前不得进入实现

## 6. Rust typst-abi 实现（native 可测）

- [x] 6.1 实现虚拟 FS World **完整清单**（design D6）：Library::build、FontBook 与字体数组稳定索引、Source/Bytes 缓存与 set_file 版本失效、FileId/虚拟根/路径归一化（拒绝相对路径与 `..` 越根、拒绝非 UTF-8）、set_main 主文件、today() 策略（测试可注入固定日期）；native 单测编译 "Hello, typst!" 成功且 `#import` 未添加文件报 file-not-found 诊断
- [x] 6.2 实现诊断 JSON 宽模型（severity/message/file/start/end/hints，可选字段支持无位置诊断，design D7）；native 单测覆盖：语法错误（含行号）、无位置诊断、warning 序列化
- [x] 6.3 实现按页 PNG 渲染（typst-render + PNG 编码，scale_milli 语义）；native 单测校验多页文档页数、输出尺寸与 scale 换算
- [x] 6.4 实现全部 C ABI 导出 + 边界校验（ptr/len 溢出与线性内存边界、UTF-8、路径合法性，design D9）；native 往返测试覆盖：成功路径、每类状态码、**非法参数逐类返回 E_INVALID_ARG 且不 trap**、输出 buffer 有效期窗口（下次同类型调用前有效、arena 重置不使其失效）；wasm 装载冒烟（浏览器或 node/wasmtime 断言导出可调用）

## 7. MoonBit binding 与纯状态机（不依赖 MoUI）

- [x] 7.1 `typst-binding` 包：`typst.*` 标量 + text-id import 的类型化封装（compileMain/pageCount/pageImage/errorJson，Result 风格）；`moon check` 通过，stub import 表单测覆盖错误 JSON 解析路径（宽模型 → 窄呈现）
- [x] 7.2 应用状态机包（纯 MoonBit）：源码状态、防抖决策、编译状态流转、页码导航边界、last-good 保持、revision 乱序丢弃；单测仅覆盖 design 测试追踪表中归属 MoonBit 层的场景（防抖窗口、连续输入不编译、状态流转、边界页、last-good、乱序、修复恢复），**不声称覆盖 IME/离线/真实渲染**

## 8. Loader、视图与可绘制的编译状态

- [x] 8.1 实现 loader：MoUI imports 注入 + `typst_abi.wasm` 实例化 + `typst.*` 宿主 import（标量 + text-id + Blob URL 桥 + revoke + revision 保护，design D2/D3/D9）；浏览器集成断言：compile_main 端到端、Blob URL 显示与释放、旧 revision 丢弃
- [x] 8.2 视图：三栏布局（编辑/预览/状态栏）、textbox 接入状态机、image 预览、页码导航、状态指示；编译调度按 design D4（状态→提交视图→rAF×2→同步编译）；手动 E2E：有效文档出预览、语法错误显示含行号错误且预览保持 last-good、修复后恢复、长编译期间"编译中"可见
- [x] 8.3 IME 手动验证：编辑面板中日韩 IME 组合输入提交完整正确（spec "IME 提交" 场景）

## 9. 验收

- [x] 9.1 场景验收：已加载页面断网编辑编译（spec 离线场景）、浏览器矩阵（基线内逐项过一遍含 canvas2d 降级）、fresh clone 按文档命令完整构建运行
- [x] 9.2 预算复核：体积/首载/初始化/编译 P50/P95/单页渲染/100 次编辑内存增长（design D10 全表逐项）对照记录；超支项给出处理决定（字体策略/加载拆分/Worker 提前）
