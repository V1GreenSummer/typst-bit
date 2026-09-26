///|
// Task 7.2: state machine unit tests. Scenarios come from the design's
// MoonBit test-tracking table: debounce window, no compile during
// continuous input, status transitions, page bounds, last-good retention,
// stale-revision dropping, fix-and-recover. These tests do NOT claim to
// cover IME, offline, or real rendering (they belong to the layers above).

///|
let diags_err : Array[@typst_binding.Diagnostic] = [
  {
    severity: @typst_binding.Error,
    message: "expected expression",
    line: Some(3),
    column: Some(1),
    file: Some("/main.typ"),
  },
]

///|
let diags_err2 : Array[@typst_binding.Diagnostic] = [
  {
    severity: @typst_binding.Error,
    message: "boom A",
    line: Some(1),
    column: None,
    file: Some("/main.typ"),
  },
  {
    severity: @typst_binding.Error,
    message: "boom B",
    line: Some(2),
    column: None,
    file: Some("/main.typ"),
  },
  {
    severity: @typst_binding.Warning,
    message: "unknown font family",
    line: Some(4),
    column: None,
    file: Some("/main.typ"),
  },
]

///|
fn step(model : @app.Model, msg : @app.Msg) -> (@app.Model, Array[@app.Action]) {
  @app.update(model, msg)
}

///|
fn step_many(model : @app.Model, msgs : Array[@app.Msg]) -> (@app.Model, Array[@app.Action]) {
  let mut m = model
  let actions : Array[@app.Action] = []
  for msg in msgs {
    let (next, acts) = @app.update(m, msg)
    m = next
    for a in acts {
      actions.push(a)
    }
  }
  (m, actions)
}

///|
test "initial document compiles on the first tick" {
  let m0 = @app.Model::init(initial_source="boot doc")
  inspect(m0.pending, content="true")
  let (m1, a1) = step(m0, DebounceTick(now_ms=0))
  inspect(a1.length(), content="1")
  guard a1[0] is StartCompile(revision=1, source="boot doc") else {
    fail("expected the initial document to compile")
  }
  inspect(m1.status is Compiling, content="true")
}

///|
test "debounce window: edit arms, early tick does nothing, expiry compiles" {
  let m0 = @app.Model::init(initial_source="= Title")
  // Edit at t=100 arms the window (deadline 400).
  let (m1, a1) = step(m0, SourceEdited(source="= Title v2", now_ms=100))
  inspect(a1.length(), content="0")
  inspect(m1.pending, content="true")
  // Tick inside the window: no compile.
  let (m2, a2) = step(m1, DebounceTick(now_ms=399))
  inspect(a2.length(), content="0")
  inspect(m2.status is Idle, content="true")
  // Tick at/after the deadline: exactly one compile, revision bumped.
  let (m3, a3) = step(m2, DebounceTick(now_ms=400))
  inspect(a3.length(), content="1")
  guard a3[0] is StartCompile(revision=1, source="= Title v2") else {
    fail("expected StartCompile(revision=1, latest source)")
  }
  inspect(m3.status is Compiling, content="true")
  inspect(m3.current_revision, content="1")
  inspect(m3.pending, content="false")
}

///|
test "continuous input compiles once with the latest source" {
  let m0 = @app.Model::init(initial_source="")
  let (m1, _) = step(m0, SourceEdited(source="a", now_ms=0))
  let (m2, _) = step(m1, SourceEdited(source="ab", now_ms=100))
  let (m3, _) = step(m2, SourceEdited(source="abc", now_ms=200))
  let (m4, _) = step(m3, SourceEdited(source="abcd", now_ms=250))
  // Window re-arms on every edit (deadline 550).
  let (m5, _) = step(m4, DebounceTick(now_ms=549))
  inspect(m5.status is Idle, content="true")
  let (m6, actions) = step(m5, DebounceTick(now_ms=550))
  inspect(actions.length(), content="1")
  guard actions[0] is StartCompile(revision=1, source="abcd") else {
    fail("expected a single compile of the latest source")
  }
  // No pending work left: further ticks are no-ops.
  let (_, a7) = step(m6, DebounceTick(now_ms=6000))
  inspect(a7.length(), content="0")
}

///|
test "status transitions: compiling -> success with pages and warnings" {
  let m0 = @app.Model::init(initial_source="doc")
  let (m1, _) = step(m0, SourceEdited(source="doc", now_ms=0))
  let (m2, _) = step(m1, DebounceTick(now_ms=@app.DEBOUNCE_MS))
  inspect(m2.status is Compiling, content="true")
  // Success with 3 pages and 1 warning requests the first page image.
  let (m3, a3) = step(
    m2,
    CompileSucceeded(revision=1, page_count=3, warnings=1),
  )
  guard m3.status is Success(pages=3, warnings=1) else {
    fail("expected Success(3, 1)")
  }
  debug_inspect(m3.doc_revision, content="Some(1)")
  guard a3[0] is RequestPageImage(revision=1, page=0) else {
    fail("expected first page image request")
  }
  debug_inspect(m3.pending_image_page, content="Some(0)")
}

///|
test "status transitions: compiling -> failed keeps counts" {
  let m0 = @app.Model::init(initial_source="doc")
  let (m1, _) = step(m0, SourceEdited(source="bad", now_ms=0))
  let (m2, _) = step(m1, DebounceTick(now_ms=@app.DEBOUNCE_MS))
  let (m3, a3) = step(m2, CompileFailed(revision=1, diagnostics=diags_err2))
  guard m3.status is Failed(errors=2, warnings=1) else {
    fail("expected Failed(2, 1)")
  }
  inspect(a3.length(), content="0")
  inspect(m3.diagnostics.length(), content="3")
}

///|
test "page navigation bounds" {
  let m0 = @app.Model::init(initial_source="doc")
  let (m1, _) = step_many(m0, [
    SourceEdited(source="doc", now_ms=0),
    DebounceTick(now_ms=@app.DEBOUNCE_MS),
    CompileSucceeded(revision=1, page_count=3, warnings=0),
    PreviewSource(revision=1, page=0, source="blob:p0"),
    ImageReady(revision=1),
  ])
  inspect(m1.current_page, content="0")
  inspect(m1.can_go_prev(), content="false")
  // Prev at first page: no-op.
  let (m2, a2) = step(m1, PrevPage)
  inspect(m2.current_page, content="0")
  inspect(a2.length(), content="0")
  // Next twice -> page 2 (last).
  let (m3, a3) = step(m2, NextPage)
  inspect(m3.current_page, content="1")
  guard a3[0] is RequestPageImage(revision=1, page=1) else {
    fail("expected page 1 image request")
  }
  let (m4, _) = step(m3, PreviewSource(revision=1, page=1, source="blob:p1"))
  let (m5, _) = step(m4, NextPage)
  inspect(m5.current_page, content="2")
  inspect(m5.can_go_next(), content="false")
  // Next at last page: no-op.
  let (m6, a6) = step(m5, NextPage)
  inspect(m6.current_page, content="2")
  inspect(a6.length(), content="0")
  // GotoPage clamps into [0, pages-1].
  let (m7, _) = step(m6, GotoPage(page=99))
  inspect(m7.current_page, content="2")
  let (m8, _) = step(m7, GotoPage(page=-4))
  inspect(m8.current_page, content="0")
  let (m9, _) = step(m8, GotoPage(page=1))
  inspect(m9.current_page, content="1")
  // Navigation without a document is a no-op.
  let fresh = @app.Model::init(initial_source="")
  let (mf, af) = step(fresh, NextPage)
  inspect(mf.current_page, content="0")
  inspect(af.length(), content="0")
}

///|
test "last-good preview survives a failing compile" {
  let m0 = @app.Model::init(initial_source="good")
  let (m1, _) = step_many(m0, [
    SourceEdited(source="good", now_ms=0),
    DebounceTick(now_ms=@app.DEBOUNCE_MS),
    CompileSucceeded(revision=1, page_count=2, warnings=0),
    PreviewSource(revision=1, page=0, source="blob:good"),
    ImageReady(revision=1),
  ])
  debug_inspect(m1.preview_source, content="Some(\"blob:good\")")
  inspect(m1.preview_ready, content="true")
  // Introduce a syntax error.
  let (m2, _) = step(m1, SourceEdited(source="bad", now_ms=1000))
  let (m3, _) = step(m2, DebounceTick(now_ms=1300))
  let (m4, _) = step(m3, CompileFailed(revision=2, diagnostics=diags_err))
  guard m4.status is Failed(errors=1, warnings=0) else {
    fail("expected Failed(1, 0)")
  }
  // Preview still shows the last good result.
  debug_inspect(m4.preview_source, content="Some(\"blob:good\")")
  inspect(m4.preview_ready, content="true")
  inspect(m4.page_count, content="2")
  inspect(m4.diagnostics.length(), content="1")
  // The failing diagnostic carries the line for the error display.
  debug_inspect(m4.diagnostics[0].line, content="Some(3)")
}

///|
test "no preview at all before the first successful compile" {
  let m0 = @app.Model::init(initial_source="")
  let (m1, _) = step_many(m0, [
    SourceEdited(source="#let x = ", now_ms=0),
    DebounceTick(now_ms=@app.DEBOUNCE_MS),
    CompileFailed(revision=1, diagnostics=diags_err),
  ])
  debug_inspect(m1.preview_source, content="None")
  guard m1.status is Failed(errors=1, warnings=0) else {
    fail("expected Failed(1, 0)")
  }
}

///|
test "stale revisions are dropped (compiles, previews, image events)" {
  let m0 = @app.Model::init(initial_source="v1")
  let (m1, _) = step_many(m0, [
    SourceEdited(source="v1", now_ms=0),
    DebounceTick(now_ms=@app.DEBOUNCE_MS), // rev 1
  ])
  // A second edit arrives while rev 1 compiles; rev 2 is issued.
  let (m2, _) = step(m1, SourceEdited(source="v2", now_ms=500))
  let (m3, _) = step(m2, DebounceTick(now_ms=800)) // rev 2
  inspect(m3.current_revision, content="2")
  // Rev 1's late success must be dropped entirely.
  let (m4, a4) = step(
    m3,
    CompileSucceeded(revision=1, page_count=9, warnings=0),
  )
  inspect(a4.length(), content="0")
  inspect(m4.page_count, content="0")
  debug_inspect(m4.doc_revision, content="None")
  inspect(m4.status is Compiling, content="true")
  // Rev 2 succeeds; its preview is accepted...
  let (m5, a5) = step(
    m4,
    CompileSucceeded(revision=2, page_count=1, warnings=0),
  )
  guard a5[0] is RequestPageImage(revision=2, page=0) else {
    fail("expected rev 2 page image request")
  }
  let (m6, _) = step(m5, PreviewSource(revision=2, page=0, source="blob:v2p0"))
  debug_inspect(m6.preview_source, content="Some(\"blob:v2p0\")")
  // ...but a rev-1 image event must not flip the ready flag path.
  let (m7, _) = step(m6, ImageReady(revision=1))
  inspect(m7.preview_ready, content="false")
  let (m8, _) = step(m7, ImageReady(revision=2))
  inspect(m8.preview_ready, content="true")
  // Stale PreviewSource (old revision) is dropped.
  let (m9, _) = step(m8, PreviewSource(revision=1, page=0, source="blob:old"))
  debug_inspect(m9.preview_source, content="Some(\"blob:v2p0\")")
  // Stale PreviewSource for a page we no longer await is dropped.
  let (m10, _) = step(
    m9,
    PreviewSource(revision=2, page=0, source="blob:again"),
  )
  debug_inspect(m10.preview_source, content="Some(\"blob:v2p0\")")
}

///|
test "fix and recover: failure then success clears errors and refreshes preview" {
  let m0 = @app.Model::init(initial_source="#let x = ")
  let (m1, _) = step_many(m0, [
    SourceEdited(source="#let x = ", now_ms=0),
    DebounceTick(now_ms=@app.DEBOUNCE_MS),
    CompileFailed(revision=1, diagnostics=diags_err),
  ])
  guard m1.status is Failed(errors=1, warnings=0) else {
    fail("expected failure first")
  }
  debug_inspect(m1.preview_source, content="None")
  // Fix the source.
  let (m2, _) = step(m1, SourceEdited(source="#let x = 1\nx", now_ms=2000))
  let (m3, _) = step(m2, DebounceTick(now_ms=2300))
  inspect(m3.status is Compiling, content="true")
  let (m4, a4) = step(
    m3,
    CompileSucceeded(revision=2, page_count=1, warnings=0),
  )
  guard m4.status is Success(pages=1, warnings=0) else {
    fail("expected recovery")
  }
  inspect(m4.diagnostics.length(), content="0")
  guard a4[0] is RequestPageImage(revision=2, page=0) else {
    fail("expected fresh preview request after recovery")
  }
  let (m5, _) = step(m4, PreviewSource(revision=2, page=0, source="blob:fixed"))
  let (m6, _) = step(m5, ImageReady(revision=2))
  debug_inspect(m6.preview_source, content="Some(\"blob:fixed\")")
  inspect(m6.preview_ready, content="true")
}

///|
test "image failure paths" {
  let m0 = @app.Model::init(initial_source="d")
  let (m1, _) = step_many(m0, [
    SourceEdited(source="d", now_ms=0),
    DebounceTick(now_ms=@app.DEBOUNCE_MS),
    CompileSucceeded(revision=1, page_count=2, warnings=0),
  ])
  debug_inspect(m1.pending_image_page, content="Some(0)")
  let (m2, _) = step(m1, PreviewFailed(revision=1, page=0))
  inspect(m2.preview_failed, content="true")
  debug_inspect(m2.preview_source, content="None")
  debug_inspect(m2.pending_image_page, content="None")
  // A PreviewFailed for a page nobody awaits is dropped.
  let (m3, _) = step(m2, PreviewFailed(revision=1, page=5))
  debug_inspect(m3.pending_image_page, content="None")
  debug_inspect(m3.preview_source, content="None")
  // Re-arm by navigating, then a stale page's PreviewFailed is dropped...
  let (m4, a4) = step(m3, NextPage)
  debug_inspect(m4.pending_image_page, content="Some(1)")
  inspect(a4.length(), content="1")
  let (m5, _) = step(m4, PreviewFailed(revision=1, page=0))
  debug_inspect(m5.pending_image_page, content="Some(1)")
  // ...while the awaited page's source is accepted.
  let (m6, _) = step(m5, PreviewSource(revision=1, page=1, source="blob:x"))
  debug_inspect(m6.preview_source, content="Some(\"blob:x\")")
  let (m7, _) = step(m6, ImageReady(revision=1))
  inspect(m7.preview_ready, content="true")
  // ImageFailed for the current doc marks the preview not ready.
  let (m8, _) = step(m7, ImageFailed(revision=1))
  inspect(m8.preview_ready, content="false")
  inspect(m8.preview_failed, content="true")
}

///|
test "edit during compiling re-arms the debounce" {
  let m0 = @app.Model::init(initial_source="a")
  let (m1, _) = step_many(m0, [
    SourceEdited(source="a", now_ms=0),
    DebounceTick(now_ms=@app.DEBOUNCE_MS),
  ])
  inspect(m1.status is Compiling, content="true")
  // Edit while compiling: window re-arms; the in-flight compile result is
  // still applied (revision matches) but a new compile follows.
  let (m2, _) = step(m1, SourceEdited(source="b", now_ms=50))
  inspect(m2.pending, content="true")
  let (m3, a3) = step(
    m2,
    CompileSucceeded(revision=1, page_count=1, warnings=0),
  )
  guard m3.status is Success(pages=1, warnings=0) else {
    fail("in-flight result applies")
  }
  inspect(a3.length(), content="1")
  let (m4, a4) = step(m3, DebounceTick(now_ms=350))
  inspect(a4.length(), content="1")
  guard a4[0] is StartCompile(revision=2, source="b") else {
    fail("expected the follow-up compile")
  }
  inspect(m4.status is Compiling, content="true")
}
