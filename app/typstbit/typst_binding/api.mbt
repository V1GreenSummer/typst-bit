///|
// Typed API over the `typst` host imports (task 7.1, design D9 host ABI).
//
// All functions here are thin: push/pull strings through the text-id
// protocol and map status codes to a Result-style error enum. The only
// logic (diagnostics wide->narrow parsing) lives in diagnostics.mbt and is
// pure and unit-tested.

///|
/// Host-level failures surfaced by the typed API.
pub(all) enum TypstError {
  /// The main file was not set or is missing from the VFS (E_MAIN_NOT_SET).
  MainNotSet
  /// The compile failed; diagnostics are available via `error_json`
  /// (E_COMPILE_ERRORS).
  CompileErrors
  /// An argument was rejected by the ABI (E_INVALID_ARG).
  InvalidArgument
  /// Unexpected host behavior (unknown status, text protocol failure).
  /// The loader treats this class as fatal (design D9).
  Fatal(String)
} derive(Debug, Eq)

///|
/// Push `text` to the host's persistent typst table; returns its text id.
fn push_text(text : String) -> Result[Int, TypstError] {
  let handle = typst_begin_create_string()
  for i in 0..<text.length() {
    typst_string_append_char(handle, text.code_unit_at(i).unsafe_to_char())
  }
  let text_id = typst_finish_create_string(handle)
  if text_id == 0 {
    Err(Fatal("finish_create_string returned 0"))
  } else {
    Ok(text_id)
  }
}

///|
/// Pull the string registered under `text_id`; `None` when the id is 0
/// (the ABI's "no value" convention).
fn pull_text(text_id : Int) -> Result[String?, TypstError] {
  if text_id == 0 {
    return Ok(None)
  }
  let handle = typst_begin_read_string(text_id)
  if handle == 0 {
    return Err(Fatal("begin_read_string returned 0 for id \{text_id}"))
  }
  let buf = StringBuilder::new()
  while true {
    let code = typst_string_read_char(handle)
    if code == -1 {
      break
    }
    buf.write_char(code.unsafe_to_char())
  }
  typst_finish_read_string(handle)
  Ok(Some(buf.to_string()))
}

///|
fn status_to_error(status : Int) -> TypstError {
  match status {
    1 => InvalidArgument
    2 => MainNotSet
    3 => CompileErrors
    other => Fatal("unknown typst status \{other}")
  }
}

///|
/// Compile `source` as `/main.typ`. Mirrors the loader flow
/// set_file("/main.typ", source) + set_main + compile.
pub fn compile_main(source : String) -> Result[Unit, TypstError] {
  match push_text(source) {
    Err(e) => Err(e)
    Ok(text_id) => {
      let status = typst_compile_main(text_id)
      if status == 0 {
        Ok(())
      } else {
        Err(status_to_error(status))
      }
    }
  }
}

///|
/// Page count of the last successful compile; 0 when there is none.
pub fn page_count() -> Int {
  let n = typst_page_count()
  if n < 0 {
    0
  } else {
    n
  }
}

///|
/// Render `page` (0-based) at `scale_milli` (px_per_pt * 1000), binding the
/// result to `revision`. On success returns the image source string (a
/// blob: URL registered by the loader). The app must only accept results
/// whose revision is still current (design D3).
pub fn page_image(
  page : Int,
  scale_milli : Int,
  revision : Int,
) -> Result[String, TypstError] {
  let text_id = typst_page_image(page, scale_milli, revision)
  if text_id == 0 {
    return Err(Fatal("page_image(\{page}, \{scale_milli}) returned 0"))
  }
  match pull_text(text_id) {
    Err(e) => Err(e)
    Ok(None) => Err(Fatal("page_image text id \{text_id} not registered"))
    Ok(Some(url)) => Ok(url)
  }
}

///|
/// Diagnostics of the last compile, parsed from the wide JSON model
/// (design D7) into the narrow presentation model. `Ok([])` when there
/// are none.
pub fn error_json() -> Result[Array[Diagnostic], TypstError] {
  let text_id = typst_error_json()
  match pull_text(text_id) {
    Err(e) => Err(e)
    Ok(None) => Ok([])
    Ok(Some(json_text)) =>
      try parse_diagnostics(json_text) catch {
        _ => Err(Fatal("diagnostics JSON failed to parse"))
      } noraise {
        diags => Ok(diags)
      }
  }
}

///|
/// Debug/e2e helper: pull the string registered under `text_id` in the
/// loader's persistent typst table. `Ok(None)` when the id is 0.
pub fn pull_registered_text(text_id : Int) -> Result[String?, TypstError] {
  pull_text(text_id)
}
