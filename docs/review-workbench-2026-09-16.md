# 工作台评估报告（2026-09-16）

对象：HEAD `49c0a1a` 的浏览器工作台（`app/typstbit/web_wasm`）与 Typst ABI。方法：三个只读 subagent 分别审计功能/交互/编辑器、渲染/导出、实时渲染可行性，并复跑全部测试套件。

## 一、测试基线（全绿）

| 套件 | 结果 |
|---|---|
| `commands.test.mjs` | 22 PASS / 0 FAIL |
| `loader.mjs` | 19 PASS / 0 FAIL |
| `interactions.mjs` | 40 PASS / 0 FAIL |
| `drive-gui.mjs` | 24 PASS / 0 FAIL |
| `acceptance.mjs` | 8/8 预算项 PASS（init 568ms、短文档 P95 4.1ms、10 页 P95 14.4ms、PNG 1x P95 19.1ms、内存增长 0.0%） |

已验证可用：编译/防抖/revision 乱序丢弃/失败保留 last-good、诊断跳转、查找替换（含 replace all）、格式工具栏、⌘K 面板（过滤/↑↓/Enter/Esc）、分享链接往返、导出 PDF（CJK/Times 子集嵌入、pdftotext 完整提取）、新标签页打开、键盘撤销重做、CJK 输入与离线场景。

## 二、P0：功能回退与规范违背

1. **页面导航被移除且留下假兼容**：`e2e_turn_page: () => {}`、`e2e_current_page: () => 0`（`workbench.js:545,563`）；DOM 无翻页/缩放控件，`state.page` 无消费者。旧 MoonBit 壳本来具备上/下页与缩放（`view.mbt`）。`49c0a1a` 删除了 loader 的翻页断言，导致回归不可见。
2. **编辑会话并未真正单一化**：`session.update/subscribe` 生产路径无人调用，`state.source/selection` 恒为默认值（`session.js:22-31` 仅单测使用）；spec「编辑会话单一状态」不达标。
3. **撤销/重做菜单与面板项是假动作**：只弹 toast 提示用键盘（`workbench.js:515-518`），违反「菜单/工具栏/快捷键同源」场景；键盘路径正常。
4. **命令面板与菜单交互缺陷**：面板点击外部不关闭且 fixed 层拦截编辑器点击；菜单因 `stopPropagation`（`workbench.js:350-354`）可同时打开多个，Escape 不能关闭。
5. **预览就绪假阳性**：无 PDF 插件时 embed 的 load/error 均不触发，1500ms 盲置 `previewReady=true`（`workbench.js:481-487`）；验收因此不能证明 PDF 真正渲染。

## 三、P1：编辑体验缺陷

- 「引用」插入 `@label` 而非 `#quote[...]`，且测试固化了错误语义。
- 「清除标记」全局删 `[*_]`，破坏 `snake_case` 标识符，也无法清除 `#underline[]`。
- 大纲仅是 2.6s toast（无面板/跳转）；「未保存」为静态文案；格式按钮无 disabled 置灰；插入块后光标落在片段末尾；`autocompletion()` 无 completion source。
- 分享 hash 永久遮蔽后续编辑（刷新回退到链接版本）；localStorage 无 try/catch、每次按键同步写、分享 URL 无长度上限；弹窗被拦截无反馈；导出依赖活 blob。
- blob revoke 先于 `embed.src` 切换，可能 abort 在途加载。

## 四、规范与预算漂移

- `typst-preview` spec 仍写「分页栅格预览 + 页码导航」，实现已改为 PDF embed（需恢复栅格导航或修订 spec）。
- 「默认西文为 Times 度量兼容」只靠默认模板；用户不写 `#set text` 时仍是 Libertinus（world 层无默认字体覆盖）。
- acceptance 预算校验 `typst_abi.opt.wasm`（38.34/13.89 MiB），而 `index.html` 实际加载 pre-opt wasm（50.19/14.24 MiB）；实际首载约 14.5 MiB，贴顶 ≤14.5 预算，`docs/acceptance.md` 的 14.03 不成立；内存数字也停留在 33.7MB（现 39.98MB）。

## 五、实时渲染评估（Typst 能力与瓶颈）

- **Typst 0.15.1 无增量/实时 API**：只有 comemo 全局按龄记忆化，无法按键/revision 选择性失效；`typst-cli watch` = 热进程 + `world.reset()` + `comemo::evict(10)`。`Source::edit` 可增量重解析，但当前 `set_file` 每次整串新建（未启用）。
- **`evict(0)` 维持**：保留缓存的收益 ≤2ms（短文档热编译 0.5 vs 2.1ms；10 页 19.0 vs 19.2ms），代价是内存数量级上升（evict(30) 10 页 +480%，不驱逐线性发散）。
- **瓶颈实测**（生产 opt wasm）：`compile+export_pdf+blob` 合计 P95 6.6ms（1 页）/ 29.4ms（10 页）；PNG 渲染 1x 14ms / 31ms。编译、导出、blob 都不是瓶颈；**感知延迟来自 300ms 防抖 + PDF embed 整文档重载（完成时机不可观测）**。
- **推荐 (a)+(b)**：防抖 300→120-150ms；打字期间用 `typst_abi_render_page_png` 快速刷新当前页（img/canvas），空闲 600-800ms 后切换 PDF embed；保持 `evict(0)`；把盲等兜底改为可观测的 onload 指标。
- 建议验收指标：输入→首视觉更新 P95 ≤50ms（1 页）/≤100ms（10 页）；输入→PDF 可用 P95 ≤600ms 且非盲兜底；护栏 export_pdf P95 ≤20ms、render 1x P95 ≤40ms、内存平台期。

## 六、建议的后续变更

1. `workbench-parity-fixes`：页导航恢复、会话真单源、撤销/重做同源、面板/菜单交互、引用与清除标记语义、disabled 置灰、分享协议、预览就绪真实化、acceptance 校验实物并同步 spec/文档。
2. `png-first-live-preview`：防抖调优 + 首页/当前页 PNG 快速预览 + 空闲切换 PDF + 指标入 acceptance。
