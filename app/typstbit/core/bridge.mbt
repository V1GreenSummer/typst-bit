///|
// JS string bridge for the wasm-gc core module. The host provides the
// `core` import namespace: string builders are backed by a JS array so the
// core can return JS strings without linear memory.

///|
#external
pub type JsAny

///|
pub extern "wasm" fn sb_new() -> Int = "core" "sb_new"

///|
pub extern "wasm" fn sb_push(sb : Int, code : Int) -> Unit = "core" "sb_push"

///|
pub extern "wasm" fn sb_finish(sb : Int) -> JsAny = "core" "sb_finish"

///|
pub extern "wasm" fn js_len(s : JsAny) -> Int = "core" "js_len"

///|
pub extern "wasm" fn js_char(s : JsAny, i : Int) -> Int = "core" "js_char"

///|
/// Reads a JS string into MoonBit (UTF-16 code units).
pub fn read_js_string(s : JsAny) -> String {
  let n = js_len(s)
  let buf = StringBuilder::new()
  for i = 0; i < n; i = i + 1 {
    buf.write_char(Int::unsafe_to_char(js_char(s, i)))
  }
  buf.to_string()
}

///|
/// Builds a JS string from MoonBit (UTF-16 code units).
pub fn js_string(s : String) -> JsAny {
  let sb = sb_new()
  for i = 0; i < s.length(); i = i + 1 {
    sb_push(sb, s.unsafe_get(i).to_int())
  }
  sb_finish(sb)
}
