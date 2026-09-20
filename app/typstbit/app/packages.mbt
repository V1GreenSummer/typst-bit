///|
// Package specification scanning (ported from web_wasm/packages.js).
//
// The workbench scans the source for `@namespace/name:version` references;
// the model owns parsing and de-duplication, the host fetches and registers
// the bytes through the ABI.

///|
pub(all) struct PackageSpec {
  ns : String
  name : String
  version : String
  text : String
} derive(Debug, Eq)

///|
fn spec_char(c : Char) -> Bool {
  (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-'
}

///|
fn spec_digit(c : Char) -> Bool {
  c >= '0' && c <= '9'
}

///|
fn chars_string(chars : Array[Char], from : Int, to : Int) -> String {
  let buf = StringBuilder::new()
  let end = if to > chars.length() { chars.length() } else { to }
  let mut i = from
  while i < end {
    buf.write_char(chars[i])
    i = i + 1
  }
  buf.to_string()
}

///|
/// Parses `@namespace/name:major.minor.patch` at `chars[start..]`.
pub fn parse_spec_at(chars : Array[Char], start : Int) -> PackageSpec? {
  let n = chars.length()
  if start < 0 || start >= n || chars[start] != '@' {
    return None
  }
  let mut i = start + 1
  let ns_start = i
  while i < n && spec_char(chars[i]) {
    i = i + 1
  }
  if i == ns_start || i >= n || chars[i] != '/' {
    return None
  }
  let ns = chars_string(chars, ns_start, i)
  i = i + 1
  let name_start = i
  while i < n && spec_char(chars[i]) {
    i = i + 1
  }
  if i == name_start || i >= n || chars[i] != ':' {
    return None
  }
  let name = chars_string(chars, name_start, i)
  i = i + 1
  let parts : Array[String] = []
  for p = 0; p < 3; p = p + 1 {
    let digit_start = i
    while i < n && spec_digit(chars[i]) {
      i = i + 1
    }
    if i == digit_start {
      return None
    }
    parts.push(chars_string(chars, digit_start, i))
    if p < 2 {
      if i < n && chars[i] == '.' {
        i = i + 1
      } else {
        return None
      }
    }
  }
  let version = "\{parts[0]}.\{parts[1]}.\{parts[2]}"
  Some({ ns, name, version, text: "@\{ns}/\{name}:\{version}" })
}

///|
/// Parses `@namespace/name:major.minor.patch`.
pub fn parse_spec(text : String) -> PackageSpec? {
  parse_spec_at(text.to_array(), 0)
}

///|
/// Unique `@namespace/name:version` references in first-seen order.
pub fn package_specs_in_source(source : String) -> Array[String] {
  let out : Array[String] = []
  let chars = source.to_array()
  let n = chars.length()
  let mut i = 0
  while i < n {
    if chars[i] == '@' {
      match parse_spec_at(chars, i) {
        Some(spec) => {
          if !out.contains(spec.text) {
            out.push(spec.text)
          }
          i = i + spec.text.length()
          continue
        }
        None => ()
      }
    }
    i = i + 1
  }
  out
}

///|
/// Manifest specs that the source references but that are not loaded yet.
/// Specs unknown to the manifest are ignored, matching `sourceNeedsPackages`.
pub fn missing_packages(
  specs : Array[String],
  manifest : Array[String],
  loaded : Array[String],
) -> Array[String] {
  let missing : Array[String] = []
  for spec in specs {
    if manifest.contains(spec) &&
      !loaded.contains(spec) &&
      !missing.contains(spec) {
      missing.push(spec)
    }
  }
  missing
}
