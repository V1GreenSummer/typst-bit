///|
// Narrow presentation model for Typst diagnostics (task 7.1).
//
// The ABI's wide JSON model (design D7) is:
//   {"diagnostics":[{"severity":"error"|"warning","message":"...",
//                    "file":"/main.typ",
//                    "start":{"line":N,"column":N},
//                    "end":{"line":N,"column":N},
//                    "hints":["..."]}]}
// with file/start/end/hints optional (positionless diagnostics omit them).
// Line and column are 1-based.
//
// This module parses that JSON into a narrow model for the v1 UI:
// severity, message, line (errors show message + line; warnings are
// counted in the status bar). Parsing is pure and covered by unit tests
// with stub JSON fixtures.

///|
pub(all) enum Severity {
  Error
  Warning
} derive(Debug, Eq)

///|
pub extend Severity with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend Severity with Eq::{not_equal, equal}

///|
/// One diagnostic in the narrow presentation model.
pub(all) struct Diagnostic {
  severity : Severity
  message : String
  /// 1-based line of the diagnostic start; `None` for positionless
  /// diagnostics.
  line : Int?
  column : Int?
  file : String?
} derive(Debug, Eq)

///|
pub extend Diagnostic with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend Diagnostic with Eq::{not_equal, equal}

///|
/// Parse the ABI's wide diagnostics JSON (design D7) into the narrow
/// presentation model. Malformed documents raise (the caller treats that
/// as a host-format bug).
pub fn parse_diagnostics(json_text : String) -> Array[Diagnostic] raise {
  let value = @json.parse(json_text)
  let list : Array[Json] = match value {
    Object(map) =>
      match map.get("diagnostics") {
        Some(Array(items)) => items
        _ => fail("diagnostics JSON must have a \"diagnostics\" array")
      }
    _ => fail("diagnostics JSON must be an object")
  }
  let out : Array[Diagnostic] = []
  for item in list {
    let fields = match item {
      Object(fields) => fields
      _ => fail("each diagnostic must be an object")
    }
    let severity = match get_string(fields, "severity") {
      Some("error") => Error
      Some("warning") => Warning
      Some(other) => fail("unknown severity: \{other}")
      None => fail("diagnostic is missing \"severity\"")
    }
    let message = match get_string(fields, "message") {
      Some(message) => message
      None => fail("diagnostic is missing \"message\"")
    }
    let line_and_column = match fields.get("start") {
      Some(Object(start)) => (get_int(start, "line"), get_int(start, "column"))
      _ => (None, None)
    }
    out.push({
      severity,
      message,
      line: line_and_column.0,
      column: line_and_column.1,
      file: get_string(fields, "file"),
    })
  }
  out
}

///|
pub fn Diagnostic::is_error(self : Diagnostic) -> Bool {
  self.severity is Error
}

///|
/// Number of error-level diagnostics.
pub fn error_count(diags : Array[Diagnostic]) -> Int {
  diags.filter(d => d.is_error()).length()
}

///|
/// Number of warning-level diagnostics.
pub fn warning_count(diags : Array[Diagnostic]) -> Int {
  diags.filter(d => d.severity is Warning).length()
}

///|
fn get_string(map : Map[String, Json], key : String) -> String? {
  match map.get(key) {
    Some(String(value)) => Some(value)
    _ => None
  }
}

///|
fn get_int(map : Map[String, Json], key : String) -> Int? {
  match map.get(key) {
    Some(Number(value, ..)) => Some(value.to_int())
    _ => None
  }
}
