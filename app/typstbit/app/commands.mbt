///|
// Command catalog and UI structure (ported from web_wasm/commands.js).
//
// The catalog is the single source of truth for menus, the format toolbar,
// the topbar and the command palette. Command *execution* stays in the
// shell (DOM/ABI side effects); this module owns metadata, filtering and
// the active/enabled predicates.

///|
pub(all) struct EditorView {
  doc : String
  sel_from : Int
  sel_to : Int
} derive(Debug, Eq)

///|
pub extend EditorView with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend EditorView with Eq::{not_equal, equal}

///|
pub(all) enum ActiveRule {
  NoActive
  Wrap(before~ : String, after~ : String)
  LinePrefix(prefix~ : String)
} derive(Debug, Eq)

///|
pub extend ActiveRule with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend ActiveRule with Eq::{not_equal, equal}

///|
pub(all) enum EnabledRule {
  AlwaysEnabled
  NeedSelection
  NeedSelectionOrLineMarker
} derive(Debug, Eq)

///|
pub extend EnabledRule with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend EnabledRule with Eq::{not_equal, equal}

///|
pub(all) struct CommandSpec {
  id : String
  label : String
  category : String
  shortcut : String?
  active : ActiveRule
  enabled_rule : EnabledRule
} derive(Debug, Eq)

///|
pub extend CommandSpec with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend CommandSpec with Eq::{not_equal, equal}

///|
pub(all) struct MenuItem {
  id : String
  label : String?
} derive(Debug, Eq)

///|
pub extend MenuItem with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend MenuItem with Eq::{not_equal, equal}

///|
pub(all) struct MenuSpec {
  label : String
  items : Array[MenuItem]
} derive(Debug, Eq)

///|
pub extend MenuSpec with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend MenuSpec with Eq::{not_equal, equal}

///|
pub(all) struct ButtonSpec {
  id : String
  label : String
  variant : String?
} derive(Debug, Eq)

///|
pub extend ButtonSpec with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend ButtonSpec with Eq::{not_equal, equal}

///|
fn line_start_of(doc : String, index : Int) -> Int {
  let chars = doc.to_array()
  let len = chars.length()
  let limit = if index < 0 { 0 } else if index > len { len } else { index }
  let mut start = 0
  for i in 0..<limit {
    if chars[i] == '\n' {
      start = i + 1
    }
  }
  start
}

///|
fn line_text(doc : String, index : Int) -> String {
  let chars = doc.to_array()
  let start = line_start_of(doc, index)
  let buf = StringBuilder()
  let mut i = start
  while i < chars.length() && chars[i] != '\n' {
    buf.write_char(chars[i])
    i += 1
  }
  buf.to_string()
}

///|
fn has_block_marker(line : String) -> Bool {
  let chars = line.trim().to_owned().to_array()
  if chars.length() >= 2 {
    if chars[0] == '=' && chars[1] == ' ' {
      return true
    }
    if (chars[0] == '-' || chars[0] == '+') && chars[1] == ' ' {
      return true
    }
  }
  if chars.length() >= 3 && chars[0] >= '0' && chars[0] <= '9' {
    let mut i = 0
    while i < chars.length() && chars[i] >= '0' && chars[i] <= '9' {
      i += 1
    }
    if i + 1 < chars.length() && chars[i] == '.' && chars[i + 1] == ' ' {
      return true
    }
  }
  false
}

///|
pub fn EditorView::selection_is_empty(self : EditorView) -> Bool {
  self.sel_from == self.sel_to
}

///|
pub fn EditorView::slice(self : EditorView, from : Int, to : Int) -> String {
  let chars = self.doc.to_array()
  let len = chars.length()
  let start = if from < 0 { 0 } else if from > len { len } else { from }
  let end = if to < start { start } else if to > len { len } else { to }
  let buf = StringBuilder()
  for i in start..<end {
    buf.write_char(chars[i])
  }
  buf.to_string()
}

///|
pub fn CommandSpec::is_active(self : CommandSpec, view : EditorView) -> Bool {
  match self.active {
    NoActive => false
    Wrap(before~, after~) =>
      if view.selection_is_empty() {
        false
      } else {
        let prefix = view.slice(view.sel_from - before.length(), view.sel_from)
        let suffix = view.slice(view.sel_to, view.sel_to + after.length())
        prefix == before && suffix == after
      }
    LinePrefix(prefix~) =>
      line_text(view.doc, view.sel_from).trim().has_prefix(prefix)
  }
}

///|
pub fn CommandSpec::is_enabled(self : CommandSpec, view : EditorView) -> Bool {
  match self.enabled_rule {
    AlwaysEnabled => true
    NeedSelection => !view.selection_is_empty()
    NeedSelectionOrLineMarker =>
      if !view.selection_is_empty() {
        true
      } else {
        has_block_marker(line_text(view.doc, view.sel_from))
      }
  }
}

///|
pub fn find_command(commands : Array[CommandSpec], id : String) -> CommandSpec? {
  for command in commands {
    if command.id == id {
      return Some(command)
    }
  }
  None
}

///|
pub fn filter_commands(
  commands : Array[CommandSpec],
  query : StringView,
) -> Array[CommandSpec] {
  let needle = query.trim().to_owned().to_lower()
  if needle == "" {
    return commands.copy()
  }
  commands.filter(fn(command) {
    command.label.to_lower().contains(needle) ||
    command.id.to_lower().contains(needle) ||
    command.category.to_lower().contains(needle)
  })
}

///|
fn command(
  id : String,
  label : String,
  category : String,
  shortcut? : String? = None,
  active? : ActiveRule = NoActive,
  enabled? : EnabledRule = AlwaysEnabled,
) -> CommandSpec {
  { id, label, category, shortcut, active, enabled_rule: enabled }
}

///|
pub fn default_commands() -> Array[CommandSpec] {
  [
    command("reset-example", "恢复示例", "文件"),
    command("export-pdf", "导出 PDF", "文件"),
    command("share", "分享", "文件"),
    command("open-search", "查找替换", "编辑", shortcut=Some("Mod-f")),
    command("undo", "撤销", "编辑", shortcut=Some("Mod-z")),
    command("redo", "重做", "编辑", shortcut=Some("Mod-Shift-z")),
    command("open-pdf-tab", "新标签页打开 PDF", "视图"),
    command("command-palette", "命令面板", "视图", shortcut=Some("Mod-k")),
    command("shortcuts", "快捷键", "帮助"),
    command(
      "clear-marks",
      "清除标记",
      "格式",
      enabled=NeedSelectionOrLineMarker,
    ),
    command(
      "bold",
      "加粗",
      "格式",
      shortcut=Some("Mod-b"),
      active=Wrap(before="*", after="*"),
      enabled=NeedSelection,
    ),
    command(
      "italic",
      "斜体",
      "格式",
      shortcut=Some("Mod-i"),
      active=Wrap(before="_", after="_"),
      enabled=NeedSelection,
    ),
    command(
      "underline",
      "下划线",
      "格式",
      shortcut=Some("Mod-u"),
      active=Wrap(before="#underline[", after="]"),
      enabled=NeedSelection,
    ),
    command("heading", "标题", "格式", active=LinePrefix(prefix="= ")),
    command("list", "列表", "格式", active=LinePrefix(prefix="- ")),
    command("math", "数学", "格式"),
    command("codeblock", "代码块", "格式"),
    command("quote", "引用", "格式"),
    command("compile-now", "立即编译", "编译", shortcut=Some("Mod-Enter")),
  ]
}

///|
pub fn menu_structure() -> Array[MenuSpec] {
  [
    {
      label: "File",
      items: [
        { id: "reset-example", label: Some("恢复示例") },
        { id: "export-pdf", label: Some("导出 PDF") },
        { id: "share", label: Some("复制分享链接") },
      ],
    },
    {
      label: "Edit",
      items: [
        { id: "open-search", label: Some("查找替换 ⌘F") },
        { id: "undo", label: Some("撤销 ⌘Z") },
        { id: "redo", label: Some("重做 ⇧⌘Z") },
      ],
    },
    {
      label: "View",
      items: [
        { id: "open-pdf-tab", label: Some("新标签页打开 PDF") },
        { id: "export-pdf", label: Some("下载 PDF") },
        { id: "reset-example", label: Some("重置示例") },
      ],
    },
    { label: "Help", items: [{ id: "shortcuts", label: Some("快捷键") }] },
  ]
}

///|
pub fn format_buttons() -> Array[ButtonSpec] {
  [
    { id: "clear-marks", label: "清除标记", variant: None },
    { id: "bold", label: "加粗", variant: None },
    { id: "italic", label: "斜体", variant: None },
    { id: "underline", label: "下划线", variant: None },
    { id: "heading", label: "标题", variant: None },
    { id: "list", label: "列表", variant: None },
    { id: "math", label: "数学", variant: None },
    { id: "codeblock", label: "代码块", variant: None },
    { id: "quote", label: "引用", variant: None },
    { id: "open-search", label: "⌕ 搜索", variant: None },
  ]
}

///|
pub fn topbar_actions() -> Array[ButtonSpec] {
  [
    { id: "share", label: "分享", variant: None },
    { id: "export-pdf", label: "导出 PDF", variant: None },
    { id: "compile-now", label: "立即编译", variant: Some("primary") },
  ]
}
