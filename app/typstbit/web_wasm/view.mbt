///|
// Typstbit workbench. Three-row layout for a 1000x560 canvas.

///|
fn shell_layout(shell : ShellModel) -> @moui.View[ShellMsg] {
  let model = shell.model
  @views.column(
    [
      header_bar(model),
      @views.row(
        [file_sidebar(), editor_workspace(model), preview_workspace(model)],
        spacing=0.0,
        align=@style.CrossAlign::Stretch,
      ),
      footer_bar(model),
    ],
    spacing=0.0,
    align=@style.CrossAlign::Stretch,
  ).frame(width=1000.0, height=560.0)
}

///|
fn header_bar(model : @app.Model) -> @moui.View[ShellMsg] {
  @views.toolbar(
    [
      @views.text(
        "Typstbit",
        role=@style.TextRole::Title,
        width=100.0,
        height=30.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.text(
        "WORKSPACE / UNTITLED",
        role=@style.TextRole::Caption,
        width=150.0,
        height=30.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.spacer(min_length=12.0),
      @views.status_badge(
        status_label(model),
        tone=status_tone(model),
        detail="",
        width=72.0,
        height=22.0,
      ),
      @views.button(
        "分享",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=48.0,
        height=24.0,
      ),
      @views.button(
        "导出",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=48.0,
        height=24.0,
      ),
      @views.button(
        "立即编译",
        on_click=App(@app.CompileNow),
        variant=@style.ButtonVariant::Primary,
        icon=Some(@style.IconName::Check),
        width=94.0,
        height=24.0,
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
            width=90.0,
            height=24.0,
            align=@core.TextAlign::TextStart,
          ),
          @views.button(
            "+",
            on_click=Noop,
            variant=@style.ButtonVariant::Ghost,
            width=22.0,
            height=22.0,
          ),
        ],
        spacing=2.0,
        align=@style.CrossAlign::Center,
      ),
      @views.divider(inset=0.0),
      @views.text(
        "▾ main.typ",
        role=@style.TextRole::Control,
        width=160.0,
        height=26.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.text(
        "  ▣ main.typ",
        role=@style.TextRole::Control,
        width=160.0,
        height=26.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.text(
        "  ○ images",
        role=@style.TextRole::Caption,
        width=160.0,
        height=26.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.spacer(min_length=40.0),
      @views.divider(inset=0.0),
      @views.button(
        "⌕ 搜索",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=160.0,
        height=28.0,
      ),
      @views.button(
        "☷ 大纲",
        on_click=Noop,
        variant=@style.ButtonVariant::Ghost,
        width=160.0,
        height=28.0,
      ),
    ],
    spacing=0.0,
    align=@style.CrossAlign::Stretch,
  ).frame(width=180.0, height=496.0)
}

///|
fn editor_workspace(model : @app.Model) -> @moui.View[ShellMsg] {
  let line_count = count_lines(model.source)
  let line_numbers_text = make_line_numbers(line_count)

  @views.column(
    [
      @views.row(
        [
          @views.text(
            "main.typ",
            role=@style.TextRole::Control,
            width=200.0,
            height=24.0,
            align=@core.TextAlign::TextStart,
          ),
          @views.text(
            "未保存",
            role=@style.TextRole::Caption,
            width=60.0,
            height=24.0,
            align=@core.TextAlign::TextStart,
          ),
        ],
        spacing=4.0,
        align=@style.CrossAlign::Center,
      ),
      @views.divider(inset=0.0),
      @views.scroll_view(
        @views.row(
          [
            @views.text(
              line_numbers_text,
              role=@style.TextRole::Caption,
              width=40.0,
              align=@core.TextAlign::TextEnd,
            ),
            @views.text_area(
              model.source,
              on_input=text => {
                App(@app.SourceEdited(source=text, now_ms=clock_now_ms()))
              },
              placeholder="输入 Typst 源码…",
              lines=25,
              variant=@style.TextFieldVariant::Outline,
              width=420.0,
              line_height=22.0,
            ),
          ],
          spacing=12.0,
          align=@style.CrossAlign::Start,
        ),
        width=480.0,
        height=468.0,
        shows_indicator=true,
      ),
    ],
    spacing=0.0,
    align=@style.CrossAlign::Stretch,
  ).frame(width=490.0, height=496.0)
}

///|
fn preview_workspace(model : @app.Model) -> @moui.View[ShellMsg] {
  let canvas = match model.preview_source {
    Some(url) => @views.image(url, width=300.0, height=300.0)
    None => preview_empty(model)
  }
  @views.column(
    [
      @views.row(
        [
          @views.text(
            "预览",
            role=@style.TextRole::Control,
            width=56.0,
            height=24.0,
            align=@core.TextAlign::TextStart,
          ),
          @views.spacer(min_length=12.0),
          @views.text(
            "⌘K 搜索命令",
            role=@style.TextRole::Caption,
            width=120.0,
            height=24.0,
            align=@core.TextAlign::TextStart,
          ),
          @views.spacer(min_length=12.0),
          @views.button(
            "−",
            on_click=Noop,
            variant=@style.ButtonVariant::Ghost,
            width=24.0,
            height=22.0,
          ),
          @views.text(
            "100%",
            role=@style.TextRole::Caption,
            width=40.0,
            height=22.0,
          ),
          @views.button(
            "+",
            on_click=Noop,
            variant=@style.ButtonVariant::Ghost,
            width=24.0,
            height=22.0,
          ),
          @views.button(
            "弹出",
            on_click=Noop,
            variant=@style.ButtonVariant::Ghost,
            width=40.0,
            height=22.0,
          ),
        ],
        spacing=2.0,
        align=@style.CrossAlign::Center,
      ),
      @views.divider(inset=0.0),
      @views.center(canvas, width=330.0, height=470.0),
    ],
    spacing=0.0,
    align=@style.CrossAlign::Stretch,
  ).frame(width=330.0, height=496.0)
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
fn footer_bar(model : @app.Model) -> @moui.View[ShellMsg] {
  @views.toolbar(
    [
      @views.text(
        status_detail(model),
        role=@style.TextRole::Caption,
        width=320.0,
        height=24.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.text(
        "✕  \{model.diagnostics.filter(d => d.is_error()).length()} 错误",
        role=@style.TextRole::Caption,
        width=80.0,
        height=24.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.text(
        "⚠  \{model.diagnostics.filter(d => !d.is_error()).length()} 警告",
        role=@style.TextRole::Caption,
        width=86.0,
        height=24.0,
        align=@core.TextAlign::TextStart,
      ),
      @views.spacer(min_length=20.0),
      nav_button(
        enabled=model.can_go_prev(),
        label="上一页",
        msg=@app.PrevPage,
        icon=@style.IconName::ChevronLeft,
      ),
      @views.text(
        "第 \{model.current_page + 1} / \{if model.page_count > 0 { model.page_count } else { 0 }} 页",
        role=@style.TextRole::Control,
        width=90.0,
        height=24.0,
      ),
      nav_button(
        enabled=model.can_go_next(),
        label="下一页",
        msg=@app.NextPage,
        icon=@style.IconName::ChevronRight,
      ),
    ],
    width=1000.0,
    height=28.0,
  )
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
      width=76.0,
      height=24.0,
    )
  } else {
    @views.button(
      label,
      variant=@style.ButtonVariant::Subtle,
      icon=Some(icon),
      width=76.0,
      height=24.0,
    ).disabled(disabled=true)
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

///|
fn count_lines(source : String) -> Int {
  let lines = source.split("\n")
  lines.length()
}

///|
fn make_line_numbers(count : Int) -> String {
  if count <= 0 {
    return ""
  }
  let mut result = ""
  for i in 1..<=count {
    if i > 1 {
      result = result + "\n"
    }
    result = result + i.to_string()
  }
  result
}
