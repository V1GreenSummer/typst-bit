///|
// Command catalog tests (parity with web_wasm/commands.js).

///|
test "default catalog has unique ids and expected size" {
  let commands = @app.default_commands()
  assert_eq(commands.length(), 19)
  let seen : Map[String, Unit] = Map([])
  for command in commands {
    assert_false(seen.contains(command.id))
    seen[command.id] = ()
  }
}

///|
test "ui structures reference known commands" {
  let commands = @app.default_commands()
  for menu in @app.menu_structure() {
    for item in menu.items {
      assert_true(@app.find_command(commands, item.id) is Some(_))
    }
  }
  for button in @app.format_buttons() {
    assert_true(@app.find_command(commands, button.id) is Some(_))
  }
  for action in @app.topbar_actions() {
    assert_true(@app.find_command(commands, action.id) is Some(_))
  }
}

///|
test "canonical labels stay stable" {
  let menus = @app.menu_structure()
  assert_eq(menus[0].label, "File")
  assert_eq(menus[0].items[0].label.unwrap(), "恢复示例")
  assert_eq(menus[1].items[0].label.unwrap(), "查找替换 ⌘F")
  let formats = @app.format_buttons()
  assert_eq(formats[1].label, "加粗")
  assert_eq(formats[9].label, "⌕ 搜索")
}

///|
test "filter commands by label, id and category" {
  let commands = @app.default_commands()
  assert_eq(@app.filter_commands(commands, "加粗").length(), 1)
  assert_eq(@app.filter_commands(commands, "bold")[0].id, "bold")
  assert_true(@app.filter_commands(commands, "格式").length() >= 9)
  assert_eq(@app.filter_commands(commands, "").length(), 19)
  assert_eq(@app.filter_commands(commands, "zzz-unknown").length(), 0)
}

///|
test "wrap markers drive the active state" {
  let bold = @app.find_command(@app.default_commands(), "bold").unwrap()
  assert_true(bold.is_active({ doc: "*hi*", sel_from: 1, sel_to: 3 }))
  assert_false(bold.is_active({ doc: "*hi*", sel_from: 0, sel_to: 2 }))
  assert_false(bold.is_active({ doc: "*hi*", sel_from: 1, sel_to: 1 }))
}

///|
test "line prefixes drive the active state" {
  let commands = @app.default_commands()
  let heading = @app.find_command(commands, "heading").unwrap()
  let list = @app.find_command(commands, "list").unwrap()
  assert_true(heading.is_active({ doc: "= title", sel_from: 2, sel_to: 2 }))
  assert_false(heading.is_active({ doc: "title", sel_from: 2, sel_to: 2 }))
  assert_true(list.is_active({ doc: "- item", sel_from: 3, sel_to: 3 }))
}

///|
test "enabled rules for selection and block markers" {
  let commands = @app.default_commands()
  let bold = @app.find_command(commands, "bold").unwrap()
  assert_false(bold.is_enabled({ doc: "hi", sel_from: 0, sel_to: 0 }))
  assert_true(bold.is_enabled({ doc: "hi", sel_from: 0, sel_to: 2 }))
  let clear = @app.find_command(commands, "clear-marks").unwrap()
  assert_false(clear.is_enabled({ doc: "plain", sel_from: 0, sel_to: 0 }))
  assert_true(clear.is_enabled({ doc: "= t", sel_from: 0, sel_to: 0 }))
  assert_true(clear.is_enabled({ doc: "1. item", sel_from: 0, sel_to: 0 }))
  assert_true(clear.is_enabled({ doc: "plain", sel_from: 0, sel_to: 3 }))
}
