///|
test "theme: plan applies theme, classes and valid variables" {
  let settings : ThemeSettings = {
    theme: "dark",
    accent: "#abc",
    editor_font_size: "14",
    preview_background: "#112233",
    sidebar_width: "200",
    compact: true,
  }
  let plan = plan_theme(settings)
  assert_eq(plan.body_theme, Some("dark"))
  assert_eq(plan.body_classes, [("compact", true)])
  assert_eq(plan.variables, [
    ("--accent", "#abc"),
    ("--preview-bg", "#112233"),
    ("--font-size-editor", "14px"),
    ("--sidebar-width", "200px"),
  ])
  let default_plan = plan_theme(ThemeSettings::default())
  assert_eq(default_plan.body_theme, None)
  assert_eq(default_plan.variables, [])
  assert_eq(default_plan.body_classes, [("compact", false)])
}

///|
test "theme: invalid values are ignored" {
  let plan = plan_theme({
    theme: "nope",
    accent: "red",
    editor_font_size: "2",
    preview_background: "#12",
    sidebar_width: "1000",
    compact: false,
  })
  assert_eq(plan.body_theme, None)
  assert_eq(plan.variables, [])
}

///|
test "theme: hex colours and labels" {
  assert_true(is_hex_color("#abc"))
  assert_true(is_hex_color("#abcd"))
  assert_true(is_hex_color("#A1B2C3"))
  assert_true(is_hex_color("#a1b2c3d4"))
  assert_false(is_hex_color("abcdef"))
  assert_true(is_hex_color("#abcde"))
  assert_false(is_hex_color("#ab"))
  assert_false(is_hex_color("#123456789"))
  assert_false(is_hex_color("#xyz"))
  assert_eq(theme_label("dark"), "暗色")
  assert_eq(theme_label("sepia"), "暖色")
  assert_eq(theme_label("default"), "明亮")
  assert_eq(format_number(14.0, "px"), "14px")
  assert_eq(format_number(14.5, "px"), "14.5px")
  assert_eq(format_number(200.0, "px"), "200px")
}
