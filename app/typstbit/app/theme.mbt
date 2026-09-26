///|
// Theme and layout model (ported from web_wasm/plugins/theme.js).
//
// The model turns settings into a host-agnostic plan: body attributes and
// classes plus CSS variables. The DOM host applies the plan; no DOM types
// appear here.

///|
pub(all) struct ThemeSettings {
  theme : String
  accent : String
  editor_font_size : String
  preview_background : String
  sidebar_width : String
  compact : Bool
} derive(Debug, Eq)

///|
pub extend ThemeSettings with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend ThemeSettings with Eq::{not_equal, equal}

///|
pub fn ThemeSettings::default() -> ThemeSettings {
  {
    theme: "default",
    accent: "",
    editor_font_size: "",
    preview_background: "",
    sidebar_width: "",
    compact: false,
  }
}

///|
pub(all) struct ThemePlan {
  /// `data-theme` attribute value; `None` removes the attribute.
  body_theme : String?
  /// Body classes to toggle (name, enabled).
  body_classes : Array[(String, Bool)]
  /// CSS variables to set.
  variables : Array[(String, String)]
} derive(Debug, Eq)

///|
pub extend ThemePlan with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend ThemePlan with Eq::{not_equal, equal}

///|
pub fn theme_ids() -> Array[String] {
  ["default", "dark", "sepia"]
}

///|
pub fn theme_label(id : String) -> String {
  if id == "dark" {
    "暗色"
  } else if id == "sepia" {
    "暖色"
  } else {
    "明亮"
  }
}

///|
/// `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, case-insensitive.
pub fn is_hex_color(value : String) -> Bool {
  let text = value.trim()
  if text.length() < 4 || text.length() > 9 || !text.has_prefix("#") {
    return false
  }
  let chars = text.to_array()
  for i = 1; i < chars.length(); i = i + 1 {
    let ch = chars[i]
    let ok = (ch >= '0' && ch <= '9') ||
      (ch >= 'a' && ch <= 'f') ||
      (ch >= 'A' && ch <= 'F')
    if !ok {
      return false
    }
  }
  true
}

///|
fn bounded_number(value : String, min : Double, max : Double) -> Double? {
  let text = value.trim()
  if text == "" {
    return None
  }
  let parsed : Double? = Some(@string.parse_double(text)) catch { _ => None }
  match parsed {
    Some(number) =>
      if number >= min && number <= max {
        Some(number)
      } else {
        None
      }
    None => None
  }
}

///|
/// A number formatted the way the host would (`14px`, no trailing `.0`).
pub fn format_number(number : Double, unit : String) -> String {
  let rounded = number.round()
  let body = if (number - rounded).abs() < 0.000001 {
    rounded.to_int().to_string()
  } else {
    number.to_string()
  }
  "\{body}\{unit}"
}

///|
/// Builds the DOM plan for the given settings. Invalid colour/size values
/// are ignored, like the JS plugin does.
pub fn plan_theme(settings : ThemeSettings) -> ThemePlan {
  let theme = if theme_ids().contains(settings.theme) {
    settings.theme
  } else {
    "default"
  }
  let variables : Array[(String, String)] = []
  if is_hex_color(settings.accent) {
    variables.push(("--accent", settings.accent.trim().to_owned()))
  }
  if is_hex_color(settings.preview_background) {
    variables.push(
      ("--preview-bg", settings.preview_background.trim().to_owned()),
    )
  }
  match bounded_number(settings.editor_font_size, 8.0, 32.0) {
    Some(size) =>
      variables.push(("--font-size-editor", format_number(size, "px")))
    None => ()
  }
  match bounded_number(settings.sidebar_width, 120.0, 480.0) {
    Some(width) =>
      variables.push(("--sidebar-width", format_number(width, "px")))
    None => ()
  }
  {
    body_theme: if theme == "default" {
      None
    } else {
      Some(theme)
    },
    body_classes: [("compact", settings.compact)],
    variables,
  }
}

///|
/// The theme body-attribute name used by the host.
pub fn theme_attribute() -> String {
  "data-theme"
}
