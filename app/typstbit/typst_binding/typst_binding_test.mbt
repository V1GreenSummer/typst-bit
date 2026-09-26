///|
// Task 7.1: diagnostics parsing tests. The fixtures mirror the Rust ABI's
// wide JSON model (design D7); only the pure parsing layer is covered
// here — the FFI layer needs the host import table (browser/loader tests).

///|
test "parse single error with position" {
  let json =
    #|{
    #|  "diagnostics": [
    #|    {
    #|      "severity": "error",
    #|      "message": "expected expression",
    #|      "file": "/main.typ",
    #|      "start": { "line": 3, "column": 1 },
    #|      "end": { "line": 3, "column": 5 },
    #|      "hints": ["did you mean ...?"]
    #|    }
    #|  ]
    #|}
  let diags = @typst_binding.parse_diagnostics(json)
  inspect(diags.length(), content="1")
  let d = diags[0]
  inspect(d.severity is Error, content="true")
  inspect(d.message, content="expected expression")
  debug_inspect(d.file, content="Some(\"/main.typ\")")
  debug_inspect(d.line, content="Some(3)")
  debug_inspect(d.column, content="Some(1)")
  inspect(@typst_binding.error_count(diags), content="1")
  inspect(@typst_binding.warning_count(diags), content="0")
}

///|
test "parse positionless diagnostic (optional fields missing)" {
  let json =
    #|{
    #|  "diagnostics": [
    #|    { "severity": "error", "message": "no position here" }
    #|  ]
    #|}
  let diags = @typst_binding.parse_diagnostics(json)
  inspect(diags.length(), content="1")
  let d = diags[0]
  inspect(d.is_error(), content="true")
  inspect(d.message, content="no position here")
  debug_inspect(d.line, content="None")
  debug_inspect(d.column, content="None")
  debug_inspect(d.file, content="None")
}

///|
test "parse warning and counts" {
  let json =
    #|{
    #|  "diagnostics": [
    #|    { "severity": "warning", "message": "unknown font family", "file": "/main.typ", "start": { "line": 1, "column": 12 } },
    #|    { "severity": "error", "message": "boom", "file": "/main.typ", "start": { "line": 4, "column": 3 } },
    #|    { "severity": "warning", "message": "another warning" }
    #|  ]
    #|}
  let diags = @typst_binding.parse_diagnostics(json)
  inspect(diags.length(), content="3")
  inspect(@typst_binding.error_count(diags), content="1")
  inspect(@typst_binding.warning_count(diags), content="2")
  inspect(diags[0].severity is Warning, content="true")
  debug_inspect(diags[1].line, content="Some(4)")
  debug_inspect(diags[2].line, content="None")
}

///|
test "empty diagnostics list is valid" {
  let json = "{\"diagnostics\":[]}"
  let diags = @typst_binding.parse_diagnostics(json)
  inspect(diags.length(), content="0")
}

///|
test "malformed documents raise" {
  // Missing "diagnostics" key.
  try @typst_binding.parse_diagnostics("{\"other\":1}") catch {
    _ => inspect("raised", content="raised")
  } noraise {
    _ => fail("missing diagnostics key must raise")
  }
  // Unknown severity.
  try
    @typst_binding.parse_diagnostics(
      "{\"diagnostics\":[{\"severity\":\"fatal\",\"message\":\"x\"}]}",
    )
  catch {
    _ => inspect("raised", content="raised")
  } noraise {
    _ => fail("unknown severity must raise")
  }
  // Non-string message.
  try
    @typst_binding.parse_diagnostics(
      "{\"diagnostics\":[{\"severity\":\"error\",\"message\":42}]}",
    )
  catch {
    _ => inspect("raised", content="raised")
  } noraise {
    _ => fail("non-string message must raise")
  }
}
