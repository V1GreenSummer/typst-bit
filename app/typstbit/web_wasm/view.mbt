///| 
// Dense Typst Playground-style workbench. The canvas is intentionally split
// into product areas instead of presenting the editor and preview as cards.

///|
fn shell_layout(shell : ShellModel) -> @moui.View[ShellMsg] {
  let model = shell.model
  @views.column(
    [
      title_bar(model),
      menu_bar(),
      editor_toolbar(),
      @views.row(
        [file_sidebar(), editor_workspace(model), preview_workspace(model)],
        spacing=0.0,
        align=@style.CrossAlign::Stretch,
      ),
      diagnostics_bar(model),
      status_bar(model),
    ],
    spacing=0.0,
    align=@style.CrossAlign::Stretch,
  ).frame(width=1000.0, height=560.0)
}

///|
fn title_bar(model : @app.Model) -> @moui.View[ShellMsg] {
  @views.toolbar(
    [
      @views.text(
        "Typstbit",
        role=@style.TextRole::Title,
        width=110.0,
        height=34.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.text(
        "WORKSPACE / UNTITLED",
        role=@style.TextRole::Caption,
        width=220.0,
        height=34.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.spacer(min_length=20.0),
      @views.status_badge(
        status_label(model),
        tone=status_tone(model),
        detail="",
        width=96.0,
        height=26.0,
      ),
      @views.button(
        "分享",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=62.0,
        height=28.0,
      ),
      @views.button(
        "导出",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=62.0,
        height=28.0,
      ),
      @views.button(
        "立即编译",
        on_click=App(@app.CompileNow),
        variant=@style.ButtonVariant::Primary,
        icon=Some(@style.IconName::Check),
        width=106.0,
        height=30.0,
      ),
    ],
    width=1000.0,
    height=38.0,
  )
}

///|
fn menu_bar() -> @moui.View[ShellMsg] {
  @views.row(
    [
      menu_item("File"),
      menu_item("Edit"),
      menu_item("View"),
      menu_item("Help"),
      @views.spacer(min_length=18.0),
      @views.text(
        "⌘K  搜索命令",
        role=@style.TextRole::Caption,
        width=150.0,
        height=26.0,
        align=@core.TextAlign::TextStart,
      ),
    ],
    spacing=2.0,
    align=@style.CrossAlign::Center,
  ).frame(width=1000.0, height=28.0)
}

///|
fn menu_item(label : String) -> @moui.View[ShellMsg] {
  @views.button(
    label,
    on_click=Noop,
    variant=@style.ButtonVariant::Ghost,
    width=58.0,
    height=26.0,
  )
}

///|
fn editor_toolbar() -> @moui.View[ShellMsg] {
  @views.toolbar(
    [
      @views.button(
        "正文",
        on_click=Noop,
        variant=@style.ButtonVariant::Subtle,
        width=66.0,
        height=28.0,
      ),
      @views.button(
        "B",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=30.0,
        height=28.0,
      ),
      @views.button(
        "I",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=30.0,
        height=28.0,
      ),
      @views.button(
        "U",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=30.0,
        height=28.0,
      ),
      @views.divider(inset=6.0),
      @views.button(
        "标题",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=52.0,
        height=28.0,
      ),
      @views.button(
        "列表",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=52.0,
        height=28.0,
      ),
      @views.button(
        "数学",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=52.0,
        height=28.0,
      ),
      @views.button(
        "代码",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=52.0,
        height=28.0,
      ),
      @views.button(
        "引用",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=52.0,
        height=28.0,
      ),
      @views.spacer(min_length=10.0),
      @views.button(
        "⌕ 搜索",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=76.0,
        height=28.0,
      ),
      @views.button(
        "设置",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=58.0,
        height=28.0,
      ),
    ],
    width=1000.0,
    height=36.0,
  )
}

///|
fn file_sidebar() -> @moui.View[ShellMsg] {
  @views.column(
    [
      @views.row(
        [
          @views.text(
            "PROJECT",
            role=@style.TextRole::Caption,
            width=112.0,
            height=28.0,
            align=@core.TextAlign::TextStart,
          ),
          @views.button(
            "+",
            on_click=Noop,
            variant=@style.ButtonVariant::Ghost,
            width=28.0,
            height=26.0,
          ),
        ],
        spacing=2.0,
        align=@style.CrossAlign::Center,
      ),
      @views.divider(inset=0.0),
      @views.text(
        "▾  main.typ",
        role=@style.TextRole::Control,
        width=174.0,
        height=30.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.text(
        "   ▣  main.typ",
        role=@style.TextRole::Control,
        width=174.0,
        height=30.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.text(
        "   ○  images",
        role=@style.TextRole::Caption,
        width=174.0,
        height=30.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.spacer(min_length=90.0),
      @views.divider(inset=0.0),
      @views.button(
        "⌕  搜索",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=174.0,
        height=30.0,
      ),
      @views.button(
        "☷  文档大纲",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=174.0,
        height=30.0,
      ),
    ],
    spacing=0.0,
    align=@style.CrossAlign::Stretch,
  ).frame(width=186.0, height=390.0)
}

///|
fn editor_workspace(model : @app.Model) -> @moui.View[ShellMsg] {
  let line_numbers = @views.column(
    [
      @views.text(
        "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15",
        role=@style.TextRole::Caption,
        width=32.0,
        height=350.0,
        align=@core.TextAlign::TextEnd,
      ),
    ],
    spacing=0.0,
    align=@style.CrossAlign::End,
  )
  @views.column(
    [
      @views.row(
        [
          @views.text(
            "main.typ",
            role=@style.TextRole::Control,
            width=190.0,
            height=28.0,
            align=@core.TextAlign::TextStart,
          ),
          @views.text(
            "未保存",
            role=@style.TextRole::Caption,
            width=64.0,
            height=28.0,
            align=@core.TextAlign::TextStart,
          ),
        ],
        spacing=4.0,
        align=@style.CrossAlign::Center,
      ),
      @views.divider(inset=0.0),
      @views.row(
        [
          line_numbers,
          @views.scroll_view(
            @views.text_area(
              model.source,
              on_input=text => {
                App(@app.SourceEdited(source=text, now_ms=clock_now_ms()))
              },
              placeholder="输入 Typst 源码…",
              lines=15,
              variant=@style.TextFieldVariant::Plain,
              width=258.0,
              line_height=22.0,
            ),
            width=268.0,
            height=348.0,
            shows_indicator=true,
          ),
        ],
        spacing=8.0,
        align=@style.CrossAlign::Start,
      ),
    ],
    spacing=0.0,
    align=@style.CrossAlign::Stretch,
  ).frame(width=330.0, height=390.0)
}

///|
fn preview_workspace(model : @app.Model) -> @moui.View[ShellMsg] {
  let canvas = match model.preview_source {
    Some(url) => @views.image(url, width=284.0, height=324.0)
    None => preview_empty(model)
  }
  @views.column(
    [
      @views.row(
        [
          @views.text(
            "预览",
            role=@style.TextRole::Control,
            width=100.0,
            height=28.0,
            align=@core.TextAlign::TextStart,
          ),
          @views.spacer(min_length=8.0),
          @views.button(
            "−",
            on_click=Noop,
            variant=@style.ButtonVariant::Ghost,
            width=28.0,
            height=26.0,
          ),
          @views.text(
            "100%",
            role=@style.TextRole::Caption,
            width=42.0,
            height=26.0,
          ),
          @views.button(
            "+",
            on_click=Noop,
            variant=@style.ButtonVariant::Ghost,
            width=28.0,
            height=26.0,
          ),
          @views.button(
            "弹出",
            on_click=Noop,
            variant=@style.ButtonVariant::Ghost,
            width=44.0,
            height=26.0,
          ),
        ],
        spacing=2.0,
        align=@style.CrossAlign::Center,
      ),
      @views.divider(inset=0.0),
      @views.center(
        @views.container(canvas, width=300.0, height=344.0),
        width=344.0,
        height=344.0,
      ),
    ],
    spacing=0.0,
    align=@style.CrossAlign::Stretch,
  ).frame(width=484.0, height=390.0)
}

///|
fn preview_empty(model : @app.Model) -> @moui.View[ShellMsg] {
  let message = if model.preview_failed {
    "预览生成失败"
  } else if model.status is Compiling {
    "正在排版…"
  } else {
    "等待编译"
  }
  @views.column(
    [
      @views.icon(@style.IconName::Eye, size=30.0),
      @views.text(message, role=@style.TextRole::Subtitle, width=230.0),
      @views.text(
        "纸张预览将在此显示",
        role=@style.TextRole::Caption,
        width=230.0,
      ),
    ],
    spacing=8.0,
    align=@style.CrossAlign::Center,
  )
}

///|
fn diagnostics_bar(model : @app.Model) -> @moui.View[ShellMsg] {
  let errors = model.diagnostics.filter(d => d.is_error()).length()
  let warnings = model.diagnostics.filter(d => !d.is_error()).length()
  @views.row(
    [
      @views.text(
        "问题",
        role=@style.TextRole::Control,
        width=54.0,
        height=32.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.text(
        "✕  \{errors} 个错误",
        role=@style.TextRole::Caption,
        width=105.0,
        height=32.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.text(
        "⚠  \{warnings} 个警告",
        role=@style.TextRole::Caption,
        width=120.0,
        height=32.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.spacer(min_length=20.0),
      first_error_text(model),
    ],
    spacing=6.0,
    align=@style.CrossAlign::Center,
  ).frame(width=1000.0, height=34.0)
}

///|
fn status_bar(model : @app.Model) -> @moui.View[ShellMsg] {
  @views.row(
    [
      @views.text(
        status_detail(model),
        role=@style.TextRole::Caption,
        width=520.0,
        height=28.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.spacer(min_length=10.0),
      nav_button(
        enabled=model.can_go_prev(),
        label="上一页",
        msg=@app.PrevPage,
        icon=@style.IconName::ChevronLeft,
      ),
      @views.text(
        "第 \{model.current_page + 1} / \{if model.page_count > 0 { model.page_count } else { 0 }} 页",
        role=@style.TextRole::Control,
        width=100.0,
        height=28.0,
      ),
      nav_button(
        enabled=model.can_go_next(),
        label="下一页",
        msg=@app.NextPage,
        icon=@style.IconName::ChevronRight,
      ),
    ],
    spacing=6.0,
    align=@style.CrossAlign::Center,
  ).frame(width=1000.0, height=34.0)
}

///|
fn nav_button(
  enabled~ : Bool,
  label~ : String,
  msg~ : @app.Msg,
  icon~ : @style.IconName,
) -> @moui.View[ShellMsg] {
  if enabled {
    @views.button(
      label,
      on_click=App(msg),
      variant=@style.ButtonVariant::Ghost,
      icon=Some(icon),
      width=78.0,
      height=28.0,
    )
  } else {
    @views.button(
      label,
      variant=@style.ButtonVariant::Subtle,
      icon=Some(icon),
      width=78.0,
      height=28.0,
    ).disabled(disabled=true)
  }
}

///|
fn first_error_text(model : @app.Model) -> @moui.View[ShellMsg] {
  match model.diagnostics.filter(d => d.is_error()).get(0) {
    Some(diag) =>
      @views.text(
        diag.message,
        role=@style.TextRole::Caption,
        width=560.0,
        height=28.0,
        align=@core.TextAlign::TextStart,
      )
    None =>
      @views.text(
        "没有问题 · 文档状态良好",
        role=@style.TextRole::Caption,
        width=560.0,
        height=28.0,
        align=@core.TextAlign::TextStart,
      )
  }
}

///|
fn status_label(model : @app.Model) -> String {
  match model.status {
    Idle => "待编译"
    Compiling => "编译中"
    Success(..) => "就绪"
    Failed(..) => "有问题"
  }
}

///|
fn status_tone(model : @app.Model) -> @style.BadgeTone {
  match model.status {
    Idle => @style.BadgeTone::Neutral
    Compiling => @style.BadgeTone::Accent
    Success(..) => @style.BadgeTone::Success
    Failed(..) => @style.BadgeTone::Danger
  }
}

///|
fn status_detail(model : @app.Model) -> String {
  match model.status {
    Idle => "编辑源码后将自动编译"
    Compiling => "正在生成最新排版结果"
    Success(pages~, warnings~) =>
      if warnings > 0 {
        "已生成 \{pages} 页 · \{warnings} 个警告"
      } else {
        "已生成 \{pages} 页 · 预览为最新结果"
      }
    Failed(errors~, warnings~) =>
      "发现 \{errors} 个错误 · \{warnings} 个警告 · 已保留上次预览"
  }
}
