///|
// Host FFI declarations for the `typst` host module (design D9 ABI v1,
// frozen 2026-09-05). The loader JS implements this module; all values are
// scalars (wasm-gc has no linear memory, so no pointers cross this line).
//
// Text protocol mirrors wzzc-dev/window/web/ffi.mbt: wasm pushes a string
// with begin_create_string/string_append_char/finish_create_string (which
// stores it in the loader's persistent typst table and returns its
// text_id), and pulls with begin_read_string/string_read_char/
// finish_read_string.

///|
extern "wasm" fn typst_compile_main(source_text_id : Int) -> Int = "typst" "compile_main"

///|
extern "wasm" fn typst_page_count() -> Int = "typst" "page_count"

///|
extern "wasm" fn typst_page_image(
  page : Int,
  scale_milli : Int,
  revision : Int,
) -> Int = "typst" "page_image"

///|
extern "wasm" fn typst_error_json() -> Int = "typst" "error_json"

///|
extern "wasm" fn typst_begin_create_string() -> Int = "typst" "begin_create_string"

///|
extern "wasm" fn typst_string_append_char(handle : Int, ch : Char) -> Unit = "typst" "string_append_char"

///|
extern "wasm" fn typst_finish_create_string(handle : Int) -> Int = "typst" "finish_create_string"

///|
extern "wasm" fn typst_begin_read_string(text_id : Int) -> Int = "typst" "begin_read_string"

///|
extern "wasm" fn typst_string_read_char(handle : Int) -> Int = "typst" "string_read_char"

///|
extern "wasm" fn typst_finish_read_string(handle : Int) -> Unit = "typst" "finish_read_string"
