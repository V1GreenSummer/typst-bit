///|
// Outline parser tests (parity with web_wasm/outline.js).

///|
test "outline strips labels and tracks levels and lines" {
  let entries = @app.parse_outline(
    "= A <one>\n\n== B\n\n```\n= NotHeading\n```\n\n=== C",
  )
  assert_eq(entries.length(), 3)
  assert_eq(entries[0].level, 1)
  assert_eq(entries[0].title, "A")
  assert_eq(entries[0].line, 1)
  assert_eq(entries[1].level, 2)
  assert_eq(entries[1].title, "B")
  assert_eq(entries[1].line, 3)
  assert_eq(entries[2].level, 3)
  assert_eq(entries[2].title, "C")
  assert_eq(entries[2].line, 9)
}

///|
test "outline ignores fenced code and plain text" {
  let entries = @app.parse_outline("just text\n\n```typ\n= hidden\n```")
  assert_eq(entries.length(), 0)
}

///|
test "outline ignores levels beyond six and missing space" {
  let entries = @app.parse_outline("======= seven\n=NoSpace\n")
  assert_eq(entries.length(), 0)
}
