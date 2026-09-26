///|
// Native (P4) implementation of the host FFI surface used by api.mbt.
//
// The browser loader provides these through `extern "wasm"` imports; on
// native the same interface is implemented over the Rust typst-abi
// static library plus a small in-process text table. Only the typed API in
// api.mbt is used by the native CLI; `page_image` has no native consumer and
// reports a fatal error.

///|
#borrow(path, data)
extern "C" fn typstbind_set_file(path : Bytes, data : Bytes) -> Int64 = "typstbind_set_file"

///|
#borrow(path)
extern "C" fn typstbind_set_main(path : Bytes) -> Int64 = "typstbind_set_main"

///|
extern "C" fn typstbind_compile() -> Int64 = "typstbind_compile"

///|
extern "C" fn typstbind_page_count() -> Int64 = "typstbind_page_count"

///|
extern "C" fn typstbind_error_json() -> Bytes = "typstbind_error_json"

///|
let native_texts : Array[String] = []

///|
let native_read_pos : Array[Int] = []

///|
fn native_utf8(text : String) -> Bytes {
  utf8_bytes(text)
}

///|
fn native_set_source(source : String) -> Int {
  let status = typstbind_set_file(native_utf8("/main.typ"), native_utf8(source)).to_int()
  if status != 0 {
    return status
  }
  let main_status = typstbind_set_main(native_utf8("/main.typ")).to_int()
  if main_status != 0 {
    return main_status
  }
  typstbind_compile().to_int()
}

///|
fn typst_compile_main(source_text_id : Int) -> Int {
  let index = source_text_id - 1
  if index < 0 || index >= native_texts.length() {
    return 1
  }
  native_set_source(native_texts[index])
}

///|
fn typst_page_count() -> Int {
  typstbind_page_count().to_int()
}

///|
fn typst_page_image(_page : Int, _scale_milli : Int, _revision : Int) -> Int {
  0
}

///|
fn typst_error_json() -> Int {
  native_texts.push(utf8_text(typstbind_error_json()))
  native_read_pos.push(0)
  native_texts.length()
}

///|
fn typst_begin_create_string() -> Int {
  native_texts.push("")
  native_read_pos.push(0)
  native_texts.length()
}

///|
fn typst_string_append_char(handle : Int, ch : Char) -> Unit {
  let index = handle - 1
  if index >= 0 && index < native_texts.length() {
    native_texts[index] = native_texts[index] + ch.to_string()
  }
}

///|
fn typst_finish_create_string(handle : Int) -> Int {
  if handle < 1 || handle > native_texts.length() {
    0
  } else {
    handle
  }
}

///|
fn typst_begin_read_string(text_id : Int) -> Int {
  if text_id < 1 || text_id > native_texts.length() {
    0
  } else {
    native_read_pos[text_id - 1] = 0
    text_id
  }
}

///|
fn typst_string_read_char(handle : Int) -> Int {
  let index = handle - 1
  if index < 0 || index >= native_texts.length() {
    return -1
  }
  let text = native_texts[index]
  let pos = native_read_pos[index]
  if pos >= text.length() {
    return -1
  }
  native_read_pos[index] = pos + 1
  text.code_unit_at(pos).to_int()
}

///|
fn typst_finish_read_string(_handle : Int) -> Unit {
  ()
}

///|
/// Registers a file in the native ABI VFS (multi-file projects).
pub fn set_file(path : String, data : String) -> Int {
  typstbind_set_file(native_utf8(path), native_utf8(data)).to_int()
}

///|
/// Registers binary file content in the native ABI VFS.
pub fn set_file_bytes(path : String, data : Bytes) -> Int {
  typstbind_set_file(native_utf8(path), data).to_int()
}
