# Design: moui-typst-webapp

## Context

仓库为绿地，无既有代码约束。路线与栈已由探索阶段确定（见 proposal.md），本设计受以下已核实的环境事实约束：

- MoonBit 的 wasm-gc 模块**没有线性内存**，无法与 Rust 的 wasm32 模块共享指针——两模块间只能传标量，字节必须经第三方摆渡；因此**宿主侧 ABI 只能收发标量与 text-id，不得出现任何 `_out_ptr` 型出参**
- MoUI（wzzc-dev/MoUI）的 image 组件签名为 `image(source : String, ...)`，图片经异步任务系统加载为纹理，Web 端有 `image_resource_change` 通知机制作为资源解析扩展点；官方开发文档建议图片资源保持 URL 字符串、由 Web renderer 在 wasm 外加载
- MoUI Web 入口约定：`web_wasm` 入口包含 `abi.mbt`（导出 shim）、`main.mbt`、`index.html`；`index.html` 通过 `moui_web_renderer/runtime.js` 的 `bootMouiWasmGcApp(options)` 实例化——**该函数原生支持 `options.imports` 注入**（自定义 import 模块被展开进最终 import 对象，内置的 `window_web` / `webgpu` / `spectest` 模块不可覆盖，新增模块可行）；**字符串跨越边界走 text-id 约定**（JS 字符串表 + int id），标量直接传
- typst.ts 已证明 `typst` crate 可编译到 `wasm32-unknown-unknown`，但其产物绑定 wasm-bindgen 胶水协议，无法脱离其 JS glue 驱动
- 本机已具备 `moon` 工具链；**尚无 cargo/rustup**，工具链准备是任务前置

## Goals / Non-Goals

**Goals:**

- 打通路线 2 全栈：Rust C ABI → wasm32 模块、MoonBit wasm-gc + MoUI 应用、loader 字节摆渡，端到端可运行
- 三个工件各自可独立测试：`typst-abi` 有 native 单测；`typst-binding` 可在 mock import 下测；应用状态逻辑为纯 MoonBit
- 满足 `specs/typst-preview/spec.md` 全部需求
- ABI v1 在三个阻断性 spike 之后冻结；冻结前不实现完整 World、状态机与视图

**Non-Goals:**

- 向量格式增量渲染桥（typst.ts Vector Format → MoUI DrawCommand）——本项目未来核心工作，本变更不做
- Worker 化编译、多文件 UI、PDF 导出、CodeMirror 级编辑体验（见 proposal 非目标）
- 离线重开页面（service worker 预缓存、缓存版本升级）——后续变更
- 不为 MoUI 贡献代码（依赖姿态，不共建）

## Decisions

### D1: Rust 侧用平面 C ABI，不用 wasm-bindgen

`#[no_mangle] pub extern "C"` + ptr/len 传参。理由：wasm-bindgen 的宿主模型假设 JS 胶水（externref 表、`__wbindgen_malloc` 等约定），与本路线"wasm-gc 宿主 + 薄 loader"的结构不匹配；平面 ABI 最小、稳定、可在 native 侧直接单测。
**备选否决**：复用 typst.ts 的 compiler.wasm——绑定其 glue 协议与增量编译语义，v1 驱动不了也用不上。

### D2: 字节摆渡由 loader JS 承担（alloc + 内存视图模式）

typst_abi 导出 `alloc(len) -> ptr` 并导出 memory；loader 用 `new Uint8Array(mem.buffer, ptr, len).set(bytes)` 写入源码/文件字节，渲染结果以 `(ptr, len)` 读出。app.wasm 对 typst 的 import 仅收发标量与 text-id（见 D9 宿主 ABI——无出参指针）。
**备选否决**：wasm-to-wasm 直接 import 接线（字节仍需摆渡，复杂度前置无收益）；multi-memory 共享内存（工具链支持不成熟）。

### D3: 渲染桥用 Blob URL（v1），data-URL 仅作回退

```
Rust PNG bytes -> JS 复制一次 -> Blob([bytes], {type:"image/png"})
  -> URL.createObjectURL(blob) -> text-id 注册 -> MoUI image(source)
  新图加载完成或被替换后 -> URL.revokeObjectURL(oldUrl)   // 防泄漏
```

理由：base64 data-URL 额外膨胀 ~33% 且制造大字符串复制，实时预览不划算；Blob URL 与 MoUI "URL 字符串 + renderer 在 wasm 外加载"的官方建议一致。
**乱序保护**：每次编译产生单调递增 revision；`page_image` 结果与 revision 绑定，状态机只接受 `revision == current` 的结果，旧 revision 的完成事件一律丢弃——异步加载不回退旧预览（对应 spec 场景）。
**备选否决**：原始 RGBA 摆渡（A4@1x ≈ 2MB/页，无压缩）；data-URL 保留为兼容性回退路径。

**Spike C 结论（2026-09-05，任务 4.1，`e2e/spike-c.mjs` 全绿）**：
- **桥接全通**：硬编码 PNG → Blob → objectURL → MoUI image → 纹理 → 像素级显示验证（截图采样 = 源色精确匹配）；data-URL 回退路径同样通过
- **乱序保护实证**：rev1（旧）加载完成晚于 rev2（新）519ms，完成后显示仍为新图且未被覆盖；revoke 记录：created=2 / revoked=2，无失败加载，旧 URL 在「非当前且已落定」时释放
- **关键缺口 1 —— MoUI 0.1.9 不会在图片加载完成后自行重渲染**：`image_resource_change(ready)` 只调度 rAF，但视图无变化时 wasm 渲染管线不再出帧，图片永远停在 placeholder（哈希色渐变）。**loader 必须在 ready 事件时回调 app**（导出函数 dispatch `ImageReady` 消息 → 状态变化 → 视图变化 → 重渲染出帧）——此回写桥为 8.1 loader 的必备行为；spike 以 ready_tick 文本变化实现该模式
- **关键缺口 2 —— canvas2d 后端不渲染图片**（`DrawImage` 落入 `_ => ()`，图片加载显式 unsupported）：无 WebGPU 的浏览器上应用可运行但**预览图不显示**。影响 D10 浏览器基线（Firefox/Safari 现状）——矩阵验收（任务 9.1）时必须按此事实修订基线或推动 MoUI 上游修复
- 测试构造注记：软件 WebGPU（SwiftShader）帧距 ~110ms，乱序交错经 300ms src 延迟 shim 确定性构造（解码/装载/生命周期全真实）；`--enable-unsafe-webgpu` 下 headless 可用软件 adapter

### D4: 编译在主线程（v1），但"编译中"状态必须先绘制

同步调用 Rust wasm 前浏览器不会绘制，直接编译会让"编译中"状态不可见（与 spec 冲突）。编译调度为：

```
1. 状态 -> Compiling; 提交 MoUI 视图更新
2. requestAnimationFrame ×2（保证浏览器完成一次绘制）
3. 再进入同步编译
```

编译耗时不预设"百毫秒级"结论，由 Spike B 实测冷启动 / 短文档 / 10 页文档的 P50/P95 回填预算表（D10）。防抖只减少编译次数，不缓解单次冻结——单次冻结时长即预算约束。
ABI 不依赖 JS 环境，未来整体迁入 Worker 只改 loader（变 message 协议），ABI 不动。

### D5: 字体内嵌（typst-assets）；离线语义收窄为"已加载页面断网可用"

字体贴烘焙进 typst_abi.wasm：无 CDN 依赖与加载态复杂度。v1 的离线承诺为：**页面保持打开期间断网，编辑与编译正常**；"关闭页面后无网络重开"需要 service worker 与 app shell 预缓存，属后续变更（proposal 非目标已同步）。
**字体策略复议结论（2026-09-05，Spike B 触发）**：体积超支后重议，维持内嵌、上调 D10 预算——实测两种方案总传输量相当（字体单独压缩率 ≈ 内嵌压缩率），按需获取的字体装载 ABI、loader 抓取/重试与 spec 离线条款改写得不偿失；原"按需获取"备选正式弃用，spec 离线条款不变。

### D6: World 实现范围（完整清单，非"文件 map + 字体"）

typst 的 `World` trait 要求远多于文件表，task 6.1 必须覆盖：

- `Library::build()`（标准库初始化，含 features 配置）
- `FontBook` 与字体数组的**稳定索引对应**：typst-assets 全部字体一次注册，索引不随编译轮次变化
- `Source` / `Bytes` 缓存与失效：依赖 comemo 的内容寻址缓存，`set_file` 替换内容即自动失效；文件版本计数为未来增量预留
- `FileId` 与虚拟根：所有路径为以 `/` 为根的绝对虚拟路径；归一化规则——折叠重复斜杠、拒绝相对路径、**拒绝 `..` 越出虚拟根**、拒绝非 UTF-8
- 主文件：经 `set_main` 指定（VFS 语义，见 D9），未设置或文件不存在返回明确状态码
- `today()`：取真实本地日期；native 测试可注入固定日期保证可复现
- **comemo 缓存驱逐**：编译入口执行 `comemo::evict(0)`（Spike B 实测：无驱逐时 100 次编辑后 10 页文档内存 +1600%，驱逐后 0% 增长；热编译耗时代价 ≤2ms，见 `docs/spike-b.md`）

v1 UI 只编辑主文件（单文档），但 VFS 完整支持多文件语义：`#import` 解析走虚拟 FS，未添加的文件报 typst 标准 file-not-found 诊断。

### D7: 诊断 JSON 结构（宽模型，UI 窄呈现）

```json
{
  "diagnostics": [
    {
      "severity": "error",              // "error" | "warning"
      "message": "expected expression",
      "file": "/main.typ",              // 可选：无位置诊断缺省
      "start": {"line": 1, "column": 3}, // 可选
      "end": {"line": 1, "column": 5},   // 可选（支持多行范围）
      "hints": ["..."]                   // 可选
    }
  ]
}
```

桥接格式一步到位（severity / 文件 / 范围 / hints / 无位置诊断），避免多文件时代重做；UI v1 仅呈现 error 级的 message + start.line，warning 计入状态栏计数。

### D8: 仓库布局与版本固定

```
Typst.bit/
  rust/                  # cargo workspace (rust-toolchain.toml 固定版本, panic=abort)
    typst-abi/           # C ABI crate + native 单测
  app/                   # moonbit workspace (moui new 脚手架演化)
    typst-binding/       # 宿主 import 的类型化封装 (无 MoUI 依赖)
    <app名>/             # 应用逻辑包 (状态机, 纯 MoonBit, 无 MoUI 依赖)
      web_wasm/          # 入口: abi.mbt / main.mbt / index.html / loader.js
  docs/                  # versions.md(版本基线) + 构建说明
```

关键分层约束：**应用状态与 Typst 交互逻辑不依赖 MoUI**，MoUI 只出现在视图层——对 MoUI API 漂移的对冲。
版本基线在任务 1 固定并记录于 `docs/versions.md`：moon 工具链版本、MoUI 依赖版本（moon.mod 锁定）、Rust 工具链（rust-toolchain.toml + wasm32-unknown-unknown target）、typst crate 版本、浏览器基线。

### D9: ABI v1（单实例模型）

**单实例 vs 句柄**：v1 取**单实例**——模块级唯一状态，无 world/document 句柄。理由：Worker 化迁移不要求多实例，`world_new` 暗示的多 world 能力是尚未使用的复杂度（评审结论）。全量重置经 `reset` 完成。

**Rust ABI**（`typst_abi.wasm`，Rust 拥有并独占线性内存；句柄/状态码均 u32）：

```
// 状态码枚举（所有导出共用，非零即失败）
//   0 OK
//   1 E_INVALID_ARG     ptr/len 越界或算术溢出、非 UTF-8、路径非法（相对/越根）
//   2 E_MAIN_NOT_SET    compile 前未 set_main，或主文件不在 VFS
//   3 E_COMPILE_ERRORS  编译失败；诊断可经 error_json 获取
//   4 E_NO_DOCUMENT     尚无成功编译结果时访问页面
//   5 E_PAGE_OUT_OF_RANGE
//   6 E_INTERNAL        不应发生；loader 视为致命错误

typst_abi_out_len_ptr() -> ptr                 // 固定 u32 槽：最近一次输出 buffer 的长度
typst_abi_alloc(len) -> ptr                    // 输入 arena bump 分配（8 字节对齐）；0 = 失败
typst_abi_reset() -> status                    // 清空 VFS/主文件/诊断/文档，重置 arena
typst_abi_set_file(path_ptr, path_len, data_ptr, data_len) -> status
typst_abi_remove_file(path_ptr, path_len) -> status
typst_abi_set_main(path_ptr, path_len) -> status
typst_abi_compile() -> status                  // 成功后持有新 Document
typst_abi_page_count() -> u32                  // 仅在 compile 成功后调用
typst_abi_render_page_png(page, scale_milli) -> ptr   // scale_milli = px_per_pt × 1000
typst_abi_error_json() -> ptr                  // 最近一次 compile 的诊断
```

**内存与生命周期模型**（输入 arena 与输出 buffer 物理分离）：

- **输入 arena**：`alloc` 的 bump 分配器（上限 64MB）；在**每次 `compile()` 入口与 `reset()` 时整体重置**——此时此前写入的输入均已被 `set_file`/`set_main` 消费进 VFS 自有存储。alloc 指针的有效期 = 至下一次 compile/reset。`compile()` 入口同时执行 `comemo::evict(0)`（无界缓存治理，D6/Spike B 实测）
- **输出 buffer**（PNG、error JSON）：各自独立专用 buffer；指针有效期 = 至下一次**同类型**产出调用成功；长度经固定槽 `out_len_ptr()` 读取。输入 arena 重置不影响输出指针
- **编译主入口的 VFS 语义**：`set_file(path, bytes)` + `set_main(path)` + `compile()`——不把"源码内容"当作 compile 参数，`#import`、诊断文件路径、未来多文件能力共用同一套模型，不存在第二套入口

**panic 与 UB 策略**：

- 所有导出在解引用前完成校验：`ptr + len` 算术溢出检查、线性内存边界检查、UTF-8 校验、路径合法性校验；失败返回 `E_INVALID_ARG`，不 panic
- 构建配置 `panic=abort`：任何内部 panic 直接 trap（不产生跨 FFI 的 UB），loader 将 trap 视为致命错误并上报 UI；验收标准是**非法输入无法触发 trap**（native 往返测试逐类断言）

**宿主 ABI**（app.wasm 的 `typst.*` import，loader JS 实现；**全标量，无出参指针**——wasm-gc 无线性内存，指针无落点）：

```
typst.compile_main(source_text_id) -> status            // loader: set_file("/main.typ", 源码) + set_main + compile
typst.page_count() -> i32                                // 0 = 无文档
typst.page_image(page, scale_milli, revision) -> text_id // 0 = 失败；Blob URL 注册进 typst 自有 text 表
typst.error_json() -> text_id                            // 0 = 无诊断
```

**app.wasm 导出（loader → app 的异步完成通知；Spike C 关键结论）**：

```
typst_image_event(revision : i32, status : i32) -> Unit  // status: 0 = ready, 1 = failed
```

- `page_image` 的 `revision` 由状态机传入并绑定结果；loader 在图片异步加载完成/失败时回调 `typst_image_event(revision, status)`，状态机校验 `revision == current` 后仅更新预览就绪状态（丢弃过期事件）
- **MoUI 0.1.9 不会在图片加载完成后自行重渲染**——`typst_image_event(ready)` 必须引起状态与视图变化（如状态栏"预览就绪"）以触发重渲染出帧，否则预览停留在 placeholder（Spike C 实证，D3）
- loader 的 text 表为 typst 模块**自有持久表**（镜像 `wzzc-dev/window/web/ffi.mbt` 协议：推 `begin_create_string/string_append_char`，拉 `begin_read_string/string_read_char/finish_read_string`；`window_web` 的 `eventTexts` 表 dispatch 后即清，不可复用——Spike A 实证）

浮点不跨界：缩放统一 `scale_milli`（i32，px_per_pt × 1000），避免 f64 接线的不确定性。

**数据流（一次重编译）**：

```
textbox 编辑 -> 防抖到期
  -> 状态 Compiling; 提交视图; rAF ×2（D4 绘制调度）
  -> typst-binding: typst.compile_main(source)
       loader: text 表取源码 -> alloc+写入 -> set_file+set_main+compile
  <- status
  成功: page_count + 当前页 render_page_png -> JS 读出 -> Blob -> objectURL
       -> text 表注册 -> page_image(page, scale, revision=current) 返回 text_id
  -> 状态 Success(页数)；image(source) 异步加载纹理
  <- typst_image_event(revision, ready)   // loader 异步回调（Spike C：MoUI 不自行重渲染）
  -> 状态机校验 revision == current -> PreviewReady -> 视图变化 -> 重渲染出帧
  失败: error_json -> text_id -> 错误列表；预览保持 last-good
  乱序保护: page_image 结果与 typst_image_event 仅在 revision == current 时生效（D3）
```

**ABI v1 冻结记录（2026-09-05，任务 5.1）**：

- 依据：Spike A（imports 注入 + text-id 协议，开放问题已回填）、Spike B（`docs/spike-b.md`：构建可行、预算修订、comemo evict(0) 治理）、Spike C（D3 回填：桥接全通、乱序保护实证、image-ready 重渲染缺口、canvas2d 图片缺口）
- 相对草案的修订：① compile 入口增补 `comemo::evict(0)`（Spike B）；② `page_image` 增补显式 `revision` 入参，乱序校验点从"page_image 结果"明确为"page_image 绑定 + typst_image_event 回调"（Spike C）；③ 新增 app 导出 `typst_image_event`（Spike C：无自动重渲染，app 必须在 ready 后自行触发重渲染）；④ 明确 loader 的 typst text 表为自有持久表（Spike A）
- 未变更：单实例模型与 `reset` 语义、`set_file/set_main/compile` VFS 语义、状态码枚举（0..6）、输入 arena/输出 buffer 生命周期与物理分离、panic=abort 与校验策略、`out_len_ptr` 长度槽、`scale_milli` 约定
- 其余已冻结条目以本节为准；实现（任务 6）开始前需评审通过本冻结记录

**实现补充（任务 8.1，2026-09-06；不改变冻结的 typst.\* ABI）**：

- app↔loader 增设 **`typstbit` 宿主模块**（app-shell 接线，与 typst.\* ABI 并列）：`now_ms() -> i32`（宿主时钟）、`after_paint(tag) -> ()`（D4 绘制调度：loader 执行 rAF×2 后回调 app 导出 `typstbit_paint_ready(tag)`，tag=编译 revision；tag 复用作单发定时器标签，`schedule_timeout(delay, tag)` 回调 `typstbit_timer(tag, now)` 驱动防抖到期）
- 增设缘由（MoUI 0.1.9 实测）：web 事件循环在无动画时休眠（ControlFlow::Wait），TimerSource 订阅不触发；且 wasm 侧无 yield 原语，同步 compile_main 调用前必须经宿主回调保证"编译中"已绘制
- Blob revoke 策略落定：URL 被替换即可释放（已落定或**从未开始加载**——经 window.Image 包装观测 src 赋值）；在途加载待落定后释放，其 failed 事件被状态机 revision 门控丢弃
- e2e 断言全套（`e2e/loader.mjs`，17 项全绿）：compile_main 端到端、blob 显示（像素级）与释放（created-1=revoked 不变量）、乱序丢弃、页码边界、last-good、修复恢复、重编译期间 Compiling 状态（D4 计数器 + 轮询）、IME 提交（keyboard.insertText 等价 IME commit 路径，CJK 文本完整入源码）

### D10: 验收预算（**9.2 验收后定稿**；实测记录见 `docs/acceptance.md`）

| 指标 | 预算（定稿） | 实测（2026-09-06） |
|---|---|---|
| typst_abi.wasm 原始 / brotli | ≤ 32MB / ≤ 10MB（wasm-opt 后；raw 自 30 上调 4.7%，用户侧约束不变） | 31.40 / 10.09 MiB |
| app.wasm（含 MoUI）原始 / brotli | ≤ 3MB / ≤ 1MB | 0.47 / 0.14 MiB |
| 首载总传输（压缩后） | ≤ 11MB | 10.23 MiB |
| 初始化（到可编辑） | ≤ 5s（中端设备） | 902ms（桌面+软件 WebGPU） |
| 短文档（~50 行）编译 | P95 ≤ 500ms | 3.7ms（浏览器内，生产 ABI） |
| 10 页文档编译 / 单页 1x 渲染 | P95 ≤ 3s / ≤ 200ms | 14.0ms / 18.2ms |
| 100 次编辑循环后 wasm memory 增长 | ≤ 20% | 0.0% |
| 浏览器基线 | **预览功能要求 WebGPU 浏览器（Chrome/Edge ≥ 119）**；无 WebGPU 浏览器（Firefox 现状 Linux 构建、canvas2d 降级）为优雅降级模式：编辑/编译/错误呈现可用、预览图不渲染（D3 已知 MoUI 0.1.9 限制）；WebKit/Safari 待具备依赖的主机补验 | chromium+WebGPU 全通过；Firefox 降级通过；canvas2d 降级通过 |

**Spike B 实测（2026-09-05，桌面级 CPU，node/V8 代理）**：编译/初始化/内存治理全部达标且余量巨大（短文档冷编译 P95 19.1ms、10 页冷编译 P95 27.9ms、evict(0) 后 100 次编辑 0.0% 增长）；单页渲染待任务 6.3/9.2 实测。体积预算按内嵌字体方案上调（原 25/8 → 30/10，实测 29.26/9.75；首载总传输 10 → 11MB）；字体策略复议结论见 D5，spec 离线条款不变。wasm-opt(-Oz) 纳入发布管线（binaryen 132 入版本基线）。

## 测试分层与需求追踪

| 验证层 | 覆盖内容（对应 spec 场景） |
|---|---|
| Rust native 单测 | 有效文档编译（页数一致）、语法错误行号、无位置诊断、warning 序列化、VFS 路径拒绝（相对/越根/非 UTF-8）、非法参数逐类返回状态码且不 trap、编译往返（成功/各失败类） |
| MoonBit 单测（纯状态机） | 防抖窗口判定、连续输入不编译、状态流转（Compiling→Success/Failure）、页码边界禁用、last-good 保持、revision 乱序丢弃、修复后恢复 |
| JS/浏览器集成 | `options.imports` 注入往返、text-id 注册/读取、Blob URL 显示与 revoke、compile_main 端到端、输出有效期窗口 |
| 手动/浏览器 E2E | IME 组合输入提交、已加载页面断网编辑编译、翻页与缩放显示、长编译期间"编译中"可见、视觉验收 |
| 构建验收 | fresh clone 按文档构建运行、版本基线一致、体积/耗时/内存预算复核（D10） |

状态机单测**不声称**覆盖 IME、离线、真实渲染与图片显示——这些归属上层。

## Risks / Trade-offs

- [MoUI API 漂移：3.5 个月、单一维护者、高速演进] → 状态逻辑与 binding 不依赖 MoUI；漂移只波及视图层，重写面小
- [MoUI runtime 能否注入自定义 imports] → **机制已核实**：`bootMouiWasmGcApp({ imports })` 原生展开自定义 import 模块；剩余未知是 text-id 字符串表的外部访问路径——Spike A 阻断性验证，通过前不进入实现
- [typst 依赖树在 wasm32 + 平面 ABI 下的构建未知数（体积、初始化、内存）] → Spike B 阻断性验证并回填 D10 预算；typst.ts 证明核心可行
- [Blob URL 泄漏或异步乱序] → 替换后 `revokeObjectURL`；revision 单调递增 + 状态机丢弃过期结果（D3）
- [同步编译冻结 UI] → 绘制调度（D4）保证"编译中"可见；单次冻结时长受 D10 预算约束；Worker 迁移路径保留
- [主线程内存只增不减] → 输入 arena 随 compile 入口重置；输出 buffer 按次复用；100 次编辑循环内存预算验收（D10）
- [wasm-gc 浏览器基线] → MoUI committed 平台；**Spike C 发现 canvas2d 降级不渲染图片（MoUI 0.1.9）**——基线浏览器中预览功能实际依赖 WebGPU（Firefox/Safari 现状受影响）；9.1 矩阵验收时修订基线或推动上游；基线版本经矩阵实测修订

## Migration Plan

绿地项目，无迁移与回滚负担；构建产物独立于任何现有系统。若路线验证失败，整个 change 目录即完整的事后记录。Spike A/B 任一失败时，本设计回到评审点重新决策（含"路线 2 是否降级为路线 1"的显式结论），不带着未消除的阻断进入实现。

## Open Questions

- ~~text-id 字符串表能否从 loader 侧直接访问/注册~~ **已由 Spike A 解决（2026-09-05，任务 2.1）**：
  - `bootMouiWasmGcApp({ imports: { typst: {...} } })` 注入验证通过——自定义 import 模块直接展开进最终 import 对象
  - MoonBit 侧声明方式为 `extern "wasm" fn name(args) = "typst" "import_name"`；标量（Int/Bool）与 `Char`（映射 i32 codepoint）均可作参数/返回值
  - **字符串协议**（镜像 `wzzc-dev/window/web/ffi.mbt`，已实测）：推（wasm→JS）`begin_create_string() -> handle` + `string_append_char(handle, ch : Char)`，loader 端句柄表累积；拉（JS→wasm）loader 在**自有持久表**注册 `text_id -> string`，wasm 经 `begin_read_string(text_id) -> handle` / `string_read_char(handle) -> Int`（codepoint，-1 为 EOF）/ `finish_read_string(handle)` 逐字符拉取。注意 `window_web` 自带的 `eventTexts` 表在每次 dispatch 后即清除（`finally` 删除），**typst 模块必须维护自己的持久表**——这决定了 D9 宿主 ABI 的 `page_image / error_json` 返回的 text_id 应注册在 typst 模块自有表中
  - 附带确认：`println` 经 `spectest.print_char` → boot 的 `onPrint` 可捕获（调试通道可用）；headless chromium 无 GPU adapter 时 canvas2d 降级路径正常
- typst crates.io 版本与 typst-assets 的版本配对——任务 1 已锁定：typst / typst-render / typst-assets = 0.15.1（同版本配对，`docs/versions.md` 留档），不改变设计
- ~~typst 依赖树在 wasm32 + 平面 ABI 下的构建未知数（体积、初始化、内存）~~ **已由 Spike B 解决（2026-09-05，任务 3.2，`docs/spike-b.md`）**：
  - 构建可行：`Library::default()`（`LibraryExt`，0.15.1 中 `Library::build` 的等价物）+ typst-assets 内嵌字体 + today() 全量编译通过，panic=abort
  - 编译/初始化预算全部大幅达标；主线程编译（D4）成立
  - comemo 缓存无界增长已确认并治理：编译入口 `evict(0)`（回填 D6/D9）
  - 体积超支（29.26/9.75 MiB vs 原 25/8）经复议后**决策：保持内嵌，上调 D10 预算至 30/10MB**（2026-09-05）；字体按需获取备选弃用（D5 记录理由），spec 离线条款不变
