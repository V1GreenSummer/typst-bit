///|
// Diagnostics mapping for the DOM workbench (ported from
// `syncEditorDiagnostics` in workbench.js).
//
// The ABI emits wide diagnostics with optional positions; the editor wants
// 1-based line/column pairs and a severity/message pair, filtered to the
// active file. Hints are folded into the message with " · ", matching the
// workbench tooltip text.

///|
pub(all) struct RawDiagnostic {
  severity : String
  message : String
  hints : Array[String]
  file : String?
  start_line : Int?
  start_column : Int?
  end_line : Int?
  end_column : Int?
} derive(Debug, Eq)

///|
pub(all) struct EditorDiagnostic {
  severity : String
  message : String
  line : Int
  column : Int
  end_line : Int
  end_column : Int
} derive(Debug, Eq)

///|
/// Parses the ABI's `{"diagnostics":[...]}` JSON into raw diagnostics.
/// Malformed input yields an empty list (the host keeps working).
pub fn parse_raw_diagnostics(json_text : String) -> Array[RawDiagnostic] {
  let parsed : Json? = Some(@json.parse(json_text)) catch { _ => None }
  let out : Array[RawDiagnostic] = []
  match parsed {
    Some(Json::Object(root)) =>
      match root.get("diagnostics") {
        Some(Json::Array(items)) =>
          for item in items {
            match item {
              Json::Object(fields) => out.push(diag_raw_from_fields(fields))
              _ => ()
            }
          }
        _ => ()
      }
    _ => ()
  }
  out
}

///|
fn diag_raw_from_fields(fields : Map[String, Json]) -> RawDiagnostic {
  let (start_line, start_column) = diag_position_fields(fields, "start")
  let (end_line, end_column) = diag_position_fields(fields, "end")
  {
    severity: diag_string(fields, "severity").unwrap_or("error"),
    message: diag_string(fields, "message").unwrap_or(""),
    hints: diag_strings(fields, "hints"),
    file: diag_string(fields, "file"),
    start_line,
    start_column,
    end_line,
    end_column,
  }
}

///|
fn diag_position_fields(
  fields : Map[String, Json],
  key : String,
) -> (Int?, Int?) {
  match fields.get(key) {
    Some(Json::Object(position)) =>
      (diag_int(position, "line"), diag_int(position, "column"))
    _ => (None, None)
  }
}

///|
fn diag_string(fields : Map[String, Json], key : String) -> String? {
  match fields.get(key) {
    Some(Json::String(value)) => Some(value)
    _ => None
  }
}

///|
fn diag_int(fields : Map[String, Json], key : String) -> Int? {
  match fields.get(key) {
    Some(Json::Number(value, ..)) => Some(value.to_int())
    _ => None
  }
}

///|
fn diag_strings(fields : Map[String, Json], key : String) -> Array[String] {
  match fields.get(key) {
    Some(Json::Array(items)) =>
      items.filter_map(fn(item) {
        match item {
          Json::String(value) => Some(value)
          _ => None
        }
      })
    _ => []
  }
}

///|
/// Maps raw diagnostics onto the active file. Diagnostics without a file
/// (host-level problems) are kept; other files are dropped.
pub fn map_diagnostics(
  raw : Array[RawDiagnostic],
  active_file : String,
) -> Array[EditorDiagnostic] {
  let out : Array[EditorDiagnostic] = []
  for item in raw {
    let belongs = match item.file {
      Some(file) => file == active_file
      None => true
    }
    if !belongs {
      continue
    }
    out.push({
      severity: if item.severity == "warning" {
        "warning"
      } else {
        "error"
      },
      message: with_hints(item.message, item.hints),
      line: item.start_line.unwrap_or(1),
      column: item.start_column.unwrap_or(1),
      end_line: item.end_line.unwrap_or(item.start_line.unwrap_or(1)),
      end_column: item.end_column.unwrap_or(item.start_column.unwrap_or(1) + 1),
    })
  }
  out
}

///|
fn with_hints(message : String, hints : Array[String]) -> String {
  if hints.length() == 0 {
    message
  } else {
    "\{message} · \{hints.join(" ")}"
  }
}
