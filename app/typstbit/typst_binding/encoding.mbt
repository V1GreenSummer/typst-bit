///|
// Shared UTF-8 helpers. Compiled for every target so the encoding package
// stays referenced even when the native host binding file is excluded.
// The native host binding uses these; the browser binding gets UTF-8
// strings from the JavaScript host instead.

///|
pub fn utf8_bytes(text : String) -> Bytes {
  @utf8.encode(text)
}

///|
pub fn utf8_text(bytes : Bytes) -> String {
  @utf8.decode_lossy(bytes)
}
