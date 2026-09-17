# Spike：Typst 语法/光标上下文 ABI 评估

日期：2026-09-16。背景：`workbench-editor-core` design 的 Open Question——用于上下文感知面板与精确 active 判定的 Typst AST/光标上下文 ABI 是否可行。方法：临时 native spike（`rust/typst-abi/tests/context_spike.rs`，验证后已删除；数据为运行记录）。

## 结论

**可行且成本低**。`typst-syntax` 已随 `typst` 链接进 wasm（无新依赖、无新数据段）；`Source` 的解析树在 `set_file` 时已构建并缓存；上下文查询为纯内存遍历，p95 < 0.1ms；单次查询 JSON 约 104 字节。

## 实测数据

| 指标 | 小文档（约 250B） | 大文档（14.8KB，200 节） |
|---|---|---|
| 查询 p50 | 0.0032 ms | 0.047 ms |
| 查询 p95 | 0.0051 ms | 0.086 ms |
| 查询最大 | 0.23 ms | 0.14 ms |
| `Source::new` 解析 | 0.054 ms | — |
| 上下文 JSON | 104 B | 104 B |

识别样例（按 offset 定位）：数学内 → `mode=math`；`#figure(` → `call=figure`；`image("photo.png")` 字符串内 → `mode=string, call=image`；注释 → `comment`；`*strong*` → `strong=true`。

## API 事实（typst-syntax 0.15.1）

- `Source::new` 即时解析并缓存根（`LazyHash`），VFS `set_file` 已承担该成本，查询不额外解析。
- `LinkedNode::new(root)` + `children()/range()` 可自顶向下按字节区间下降；`SyntaxKind::name()` 提供稳定名称。
- `Source::lines()` 返回 `Lines`，含 `utf16_to_byte` / `byte_to_utf16` / `byte_to_line` / `byte_to_column`：**ABI 可直接接收 CodeMirror 的 UTF-16 offset 并在 Rust 侧转换**，无需 JS 成本。

## 集成草案

- 新导出 `typst_abi_context_json(utf16_offset: u32) -> usize`：结果写入现有 out buffer，长度读 `typst_abi_out_len_ptr`。
- Schema v1（冻结）：`{ mode: "markup|code|math|string|comment", path: ["Markup","FuncCall","Args",...], call: string?, strong: bool, emph: bool }`；后续扩展只用可选字段。
- JS 在选区变化或命令面板打开时防抖约 50ms 查询，用于：面板按上下文过滤、上下文操作面板、精确 active 判定、智能插图/表格动作。
- 成本：新增 JSON 构造代码预计 wasm 增量 < 100KB；无新数据段。

## 备选与否决

- **JS 正则启发式**：字符串/数学/嵌套函数调用内不准确，且无法识别结构层级，否决。
- **完整 AST JSON 导出**：payload 大、schema 不稳定，否决；按需增量扩展。

## 风险

- 边界语义（token 末尾、空文档、EOF、UTF-16 代理对）需在实现时定义用例。
- ABI 为单实例同步调用；查询频率低（防抖后每数百毫秒一次），无阻塞风险。
- Schema 作为 ABI v1 冻结，避免前后端版本漂移。

## 建议

开一个后续变更（如 `workbench-context-abi`）：单导出 + schema v1 + 命令面板/active 集成；验收指标：10 页文档查询 p95 < 1ms、单次 payload < 1KB、`typst_abi.wasm` 增量 < 100KB。
