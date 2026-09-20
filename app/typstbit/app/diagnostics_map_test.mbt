///|
test "diagnostics: parse and map onto the active file" {
  let json = "{\"diagnostics\":[{\"severity\":\"error\",\"message\":\"expected expression\",\"file\":\"/main.typ\",\"start\":{\"line\":1,\"column\":14},\"end\":{\"line\":1,\"column\":15},\"hints\":[\"try adding a value\"]},{\"severity\":\"warning\",\"message\":\"unused\",\"file\":\"/lib.typ\",\"start\":{\"line\":3,\"column\":2}},{\"severity\":\"error\",\"message\":\"host boom\"}]}"
  let raw = parse_raw_diagnostics(json)
  assert_eq(raw.length(), 3)
  let mapped = map_diagnostics(raw, "/main.typ")
  assert_eq(mapped.length(), 2)
  assert_eq(mapped[0].severity, "error")
  assert_eq(mapped[0].message, "expected expression · try adding a value")
  assert_eq(mapped[0].line, 1)
  assert_eq(mapped[0].column, 14)
  assert_eq(mapped[0].end_line, 1)
  assert_eq(mapped[0].end_column, 15)
  assert_eq(mapped[1].message, "host boom")
  assert_eq(mapped[1].line, 1)
  assert_eq(mapped[1].column, 1)
  assert_eq(mapped[1].end_line, 1)
  assert_eq(mapped[1].end_column, 2)
  let lib = map_diagnostics(raw, "/lib.typ")
  assert_eq(lib.length(), 2)
  assert_eq(lib[0].severity, "warning")
  assert_eq(lib[0].line, 3)
  assert_eq(lib[0].end_line, 3)
  assert_eq(lib[0].end_column, 3)
}

///|
test "diagnostics: malformed input is tolerated" {
  assert_eq(parse_raw_diagnostics("not json"), [])
  assert_eq(parse_raw_diagnostics("{\"diagnostics\":\"nope\"}"), [])
  assert_eq(parse_raw_diagnostics("{}"), [])
}
