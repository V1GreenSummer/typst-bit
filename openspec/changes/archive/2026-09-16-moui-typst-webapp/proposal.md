# Proposal: moui-typst-webapp

## Why

Typst.bit 的定位是"排版引擎保持 Rust，其余全部由 MoonBit 编写"的 Typst Web 应用。经过前期探索，已选定路线 2：应用层用 MoonBit 编译到 wasm-gc，以 MoUI（非 DOM、WebGPU/canvas2d 渲染）作为 UI 框架依赖；Typst 则以平面 C ABI 编译为独立 WASM 模块。仓库当前为空，本变更是路线 2 的 v1 基线：一个可编辑 Typst 源码、实时预览、呈现错误的最小可用应用，用来打通并验证整条技术栈。

## What Changes

- 新增 Rust 工作区 `rust/`：`typst-abi` crate，对 `typst` crate 做平面 C ABI 封装（`#[no_mangle] extern "C"`），提供内存虚拟文件系统 World、编译入口、按页 PNG 渲染、诊断信息序列化；目标 `wasm32-unknown-unknown`，Rust 侧独占线性内存所有权
- 新增 JS 装载层（loader）：经 MoUI `bootMouiWasmGcApp({ imports })` 注入自定义宿主 import，实例化 `typst_abi.wasm`，承担双向字节摆渡（MoonBit wasm-gc 模块没有线性内存，无法与 Rust 模块共享指针）、实现 app.wasm 的 typst 宿主 import（全标量 + text-id）、把 PNG 字节经 Blob URL 交给 MoUI 图片资源系统（data-URL 仅作回退）
- 新增 MoonBit 应用：`moui new` 脚手架 + wasm-gc web 入口，MoUI 布局（源码编辑面板 + 预览面板 + 状态栏），编辑使用 MoUI textbox（具备 IME 支持），预览使用 MoUI `image` 组件（字符串源）+ 页码导航
- 新增 MoonBit `typst-binding` 包：对宿主 import 的类型化封装（`compileMain / pageCount / pageImage / errorJson`），隔离 FFI 细节
- 字体内嵌：通过 `typst-assets` 烘焙进 typst_abi.wasm，应用在已加载状态下离线可用
- 版本与工具链基线：固定 moon / MoUI / Rust / typst 版本与浏览器基线并留档 `docs/versions.md`（本机已有 moon，尚需安装 Rust 工具链与 wasm32 target）
- **阻断性 spike 前置**：MoUI runtime import 注入与 text-id 往返（Spike A）、最小 Typst World 的 wasm 构建与体积/耗时/内存实测（Spike B）、硬编码 PNG 的 Blob URL 渲染桥（Spike C）——三者之后冻结 ABI v1，再进入完整实现

范围决策（v1 假设，源自探索共识）：

- 产品形态为**单文档编辑器 MVP**（源码编辑 + 实时预览），多文件项目、PDF 导出、向量格式增量渲染、Worker 化编译均为后续工作
- MoUI 作为**依赖**使用，不承担共建/反哺义务（依赖边界收窄到视图层，缓解单一维护者风险）
- 编译在主线程执行：v1 接受单次编译冻结，但编译前先提交视图并等待两帧确保"编译中"状态可见；ABI 不依赖 JS 环境，为 Worker 迁移留路
- 离线语义 v1 取"**已加载页面断网可用**"；完整离线（service worker 预缓存、缓存版本升级、离线重开）为后续变更
- Rust ABI 取**单实例模型**（无 world/document 句柄）；VFS 统一 `set_file / set_main / compile` 语义，不为多 world 预付复杂度

## Capabilities

### New Capabilities

- `typst-preview`: 客户端 Typst 编译与实时预览——源码编辑、防抖重编译、分页 PNG 预览、编译错误呈现、已加载状态下离线可用

### Modified Capabilities

（无——仓库为绿地，`openspec/specs/` 尚无任何能力规格）

## Impact

- **代码布局**：全新 monorepo——`rust/`（cargo workspace）、`app/`（moonbit workspace，遵循 MoUI `moui new` 脚手架与 `web_wasm` 入口约定）、两者之间的 JS loader
- **新增依赖**：`wzzc-dev/moui`（Apache-2.0，年轻但工程纪律良好，wasm-gc + WebGPU 路径为其 committed 平台）；`typst` / `typst-render` / `typst-assets`（Apache-2.0，typst.ts 已证明 typst 可编译到 wasm32-unknown-unknown）
- **关键风险**：MoUI 迭代速度快（3.5 个月 3292 文件），API 可能漂移；`bootMouiWasmGcApp` 的 `options.imports` 注入机制已核实存在，但 text-id 字符串表的外部访问路径与 typst 侧平面 C ABI 的构建产物（体积/初始化/内存）仍是未知数——三项均以阻断性 spike 前置消除，spike 失败则回到路线决策点
- **非目标**：CodeMirror 级编辑体验、多文件/项目管理、PDF 导出、向量桥（typst.ts 向量格式 -> MoUI DrawCommand）、离线重开页面（service worker）、服务端任何能力
