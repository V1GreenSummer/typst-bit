///|
// Application core exports for the browser host (P2). Every export takes
// and returns JSON encoded as a JS string; the host stays a thin adapter.

///|
fn op_string(map : Map[String, Json], key : String) -> String? {
  match map.get(key) {
    Some(Json::String(value)) => Some(value)
    _ => None
  }
}

///|
fn op_int(map : Map[String, Json], key : String) -> Int? {
  match map.get(key) {
    Some(Json::Number(value, ..)) => Some(value.to_int())
    _ => None
  }
}

///|
fn op_object(map : Map[String, Json], key : String) -> Map[String, Json]? {
  match map.get(key) {
    Some(Json::Object(value)) => Some(value)
    _ => None
  }
}

///|
fn parse_object(text : String) -> Map[String, Json]? {
  let parsed : Json? = Some(@json.parse(text)) catch { _ => None }
  match parsed {
    Some(Json::Object(map)) => Some(map)
    _ => None
  }
}

///|
/// Document outline: `{"text": "..."}` -> `[{level,title,line}]`.
pub fn core_outline(payload : JsAny) -> JsAny {
  let text = read_js_string(payload)
  let entries = @app.parse_outline(text)
  js_string(
    Json::array(
      entries.map(entry => {
        Json::object({
          "level": Json::number(entry.level.to_double()),
          "title": Json::string(entry.title),
          "line": Json::number(entry.line.to_double()),
        })
      }),
    ).stringify(),
  )
}

///|
/// Command catalog plus UI structure.
pub fn core_commands(_payload : JsAny) -> JsAny {
  let commands = @app.default_commands()
  let command_json = commands.map(command => {
    Json::object({
      "id": Json::string(command.id),
      "label": Json::string(command.label),
      "category": Json::string(command.category),
      "shortcut": match command.shortcut {
        Some(shortcut) => Json::string(shortcut)
        None => Json::null()
      },
    })
  })
  let menus = @app.menu_structure().map(menu => {
    Json::object({
      "label": Json::string(menu.label),
      "items": Json::array(
        menu.items.map(item => {
          Json::object({
            "id": Json::string(item.id),
            "label": match item.label {
              Some(label) => Json::string(label)
              None => Json::null()
            },
          })
        }),
      ),
    })
  })
  let buttons = fn(buttons : Array[@app.ButtonSpec]) {
    Json::array(
      buttons.map(button => {
        Json::object({
          "id": Json::string(button.id),
          "label": Json::string(button.label),
          "variant": match button.variant {
            Some(variant) => Json::string(variant)
            None => Json::null()
          },
        })
      }),
    )
  }
  js_string(
    Json::object({
      "commands": Json::array(command_json),
      "menus": Json::array(menus),
      "formatButtons": buttons(@app.format_buttons()),
      "topbar": buttons(@app.topbar_actions()),
    }).stringify(),
  )
}

///|
/// Palette filtering: `{query, doc, from, to}` ->
/// `[{id, enabled, active}]` for the matching commands.
pub fn core_filter_commands(payload : JsAny) -> JsAny {
  let text = read_js_string(payload)
  let rows : Array[Json] = []
  match parse_object(text) {
    Some(map) => {
      let query = op_string(map, "query").unwrap_or("")
      let view : @app.EditorView = {
        doc: op_string(map, "doc").unwrap_or(""),
        sel_from: op_int(map, "from").unwrap_or(0),
        sel_to: op_int(map, "to").unwrap_or(0),
      }
      for command in @app.filter_commands(@app.default_commands(), query) {
        let enabled = command.is_enabled(view)
        if enabled {
          rows.push(
            Json::object({
              "id": Json::string(command.id),
              "enabled": Json::boolean(enabled),
              "active": Json::boolean(command.is_active(view)),
            }),
          )
        }
      }
    }
    None => ()
  }
  js_string(Json::array(rows).stringify())
}

///|
/// Package references: `{"source": "..."}` -> `["@preview/x:1.2.3"]`.
pub fn core_package_specs(payload : JsAny) -> JsAny {
  let text = read_js_string(payload)
  let source = match parse_object(text) {
    Some(map) => op_string(map, "source").unwrap_or("")
    None => ""
  }
  js_string(
    Json::array(@app.package_specs_in_source(source).map(Json::string)).stringify(),
  )
}

///|
/// Diagnostics mapping: `{json, activeFile}` -> editor diagnostics.
pub fn core_map_diagnostics(payload : JsAny) -> JsAny {
  let text = read_js_string(payload)
  let rows : Array[Json] = []
  match parse_object(text) {
    Some(map) => {
      let raw = @app.parse_raw_diagnostics(op_string(map, "json").unwrap_or(""))
      let active = op_string(map, "activeFile").unwrap_or("")
      for item in @app.map_diagnostics(raw, active) {
        rows.push(
          Json::object({
            "severity": Json::string(item.severity),
            "message": Json::string(item.message),
            "line": Json::number(item.line.to_double()),
            "column": Json::number(item.column.to_double()),
            "endLine": Json::number(item.end_line.to_double()),
            "endColumn": Json::number(item.end_column.to_double()),
          }),
        )
      }
    }
    None => ()
  }
  js_string(Json::array(rows).stringify())
}

///|
/// Theme planning: ThemeSettings JSON -> `{bodyTheme, bodyClasses, variables}`.
pub fn core_theme_plan(payload : JsAny) -> JsAny {
  let text = read_js_string(payload)
  let settings : @app.ThemeSettings = match parse_object(text) {
    Some(map) =>
      {
        theme: op_string(map, "theme").unwrap_or("default"),
        accent: op_string(map, "accent").unwrap_or(""),
        editor_font_size: op_string(map, "editorFontSize").unwrap_or(""),
        preview_background: op_string(map, "previewBackground").unwrap_or(""),
        sidebar_width: op_string(map, "sidebarWidth").unwrap_or(""),
        compact: match map.get("compact") {
          Some(Json::True) => true
          _ => false
        },
      }
    None => @app.ThemeSettings::default()
  }
  let plan = @app.plan_theme(settings)
  js_string(
    Json::object({
      "bodyTheme": match plan.body_theme {
        Some(theme) => Json::string(theme)
        None => Json::null()
      },
      "bodyClasses": Json::array(
        plan.body_classes.map(pair => {
          Json::object({
            "name": Json::string(pair.0),
            "enabled": Json::boolean(pair.1),
          })
        }),
      ),
      "variables": Json::array(
        plan.variables.map(pair => {
          Json::object({
            "name": Json::string(pair.0),
            "value": Json::string(pair.1),
          })
        }),
      ),
    }).stringify(),
  )
}

///|
/// Project operations: `{project?, fallback?, op}` -> `{project, result}`.
pub fn core_project_op(payload : JsAny) -> JsAny {
  let text = read_js_string(payload)
  let root = parse_object(text)
  let fallback = match root {
    Some(map) => op_string(map, "fallback").unwrap_or("")
    None => ""
  }
  let project = match root {
    Some(map) =>
      match op_string(map, "project") {
        Some(state) if state != "" =>
          @app.Project::from_json_string(state, fallback)
        _ => @app.Project::new(fallback)
      }
    None => @app.Project::new(fallback)
  }
  let mut result : Json = Json::null()
  match root {
    Some(map) =>
      match op_object(map, "op") {
        Some(op) =>
          match op_string(op, "kind").unwrap_or("") {
            "set_text" =>
              result = Json::boolean(
                project.set_text(
                  op_string(op, "path").unwrap_or(""),
                  op_string(op, "text").unwrap_or(""),
                ),
              )
            "add_file" => {
              let path = op_string(op, "path").unwrap_or("")
              let kind = if op_string(op, "fileKind") == Some("binary") {
                @app.BinaryFile
              } else {
                @app.TextFile
              }
              if project.has(path) {
                result = Json::string("duplicate")
              } else {
                result = match
                  project.add_file(
                    path,
                    op_string(op, "text").unwrap_or(""),
                    kind~,
                  ) {
                  Ok(_) => Json::string("ok")
                  Err(_) => Json::string("invalid")
                }
              }
            }
            "add_folder" =>
              result = Json::boolean(
                project.add_folder(op_string(op, "path").unwrap_or("")),
              )
            "remove" =>
              result = Json::boolean(
                project.remove(op_string(op, "path").unwrap_or("")) is Some(_),
              )
            "set_active" => {
              let path = op_string(op, "path").unwrap_or("")
              if project.has(path) {
                project.active = path
                result = Json::boolean(true)
              } else {
                result = Json::boolean(false)
              }
            }
            "paths" => result = Json::array(project.paths().map(Json::string))
            _ => ()
          }
        None => ()
      }
    None => ()
  }
  js_string(
    Json::object({ "project": project.to_json(), "result": result }).stringify(),
  )
}

///|
/// wasm-gc entry point (unused: the host calls the exported functions).
fn main {
  ()
}
