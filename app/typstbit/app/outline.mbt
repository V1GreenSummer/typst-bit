///|
// Document outline parsing (ported from web_wasm/outline.js).
//
// Pure logic: heading level, title (trailing <label> stripped), line number;
// fenced code blocks are skipped. This module is part of the MoonBit
// application core and is shared by the browser shell and CLI.

///|
pub(all) struct OutlineEntry {
  level : Int
  title : String
  line : Int
} derive(Debug, Eq)

///|
fn strip_trailing_label(title : String) -> String {
  let chars = title.trim().to_owned().to_array()
  let mut end = chars.length()
  if end > 0 && chars[end - 1] == '>' {
    let mut open = end - 1
    while open > 0 {
      open -= 1
      if chars[open] == '<' {
        end = open
        break
      }
    }
  }
  let buf = StringBuilder::new()
  for i in 0..<end {
    buf.write_char(chars[i])
  }
  buf.to_string().trim().to_owned()
}

///|
pub fn parse_outline(source : String) -> Array[OutlineEntry] {
  let entries : Array[OutlineEntry] = []
  let mut in_fence = false
  let mut line_no = 0
  for line in source.split("\n") {
    line_no += 1
    let text = line.to_owned()
    if text.trim().has_prefix("```") {
      in_fence = !in_fence
      continue
    }
    if in_fence {
      continue
    }
    let mut level = 0
    for ch in text {
      if ch == '=' {
        level += 1
      } else {
        break
      }
    }
    if level == 0 || level > 6 {
      continue
    }
    let rest = text[level:]
    if !(rest.has_prefix(" ") || rest.has_prefix("\t")) {
      continue
    }
    entries.push({
      level,
      title: strip_trailing_label(rest.to_owned()),
      line: line_no,
    })
  }
  entries
}
