///|
// Pure application state machine (task 7.2, design D3/D4/D9).
//
// No MoUI dependency, no host imports, no clock: time arrives through
// message payloads (`now_ms`), image/compile completions through typed
// messages, and side effects leave as `Action` values for the shell
// (web_wasm) to execute. This keeps every scenario in the design's
// MoonBit test-tracking table unit-testable:
// debounce window, no compile during continuous input, status
// transitions, page bounds, last-good retention, stale-revision dropping,
// fix-and-recover.
//
// NOT covered here (by design): IME, offline, real rendering.

///|
/// Debounce window in milliseconds (spec: "停止编辑一段防抖窗口时间后").
pub const DEBOUNCE_MS : Int = 300

///|
/// Starter document used by the web shell's new-document action.
pub const DEFAULT_SOURCE : String = "#set page(width: 20cm, height: 10cm)\n= Hello, Typst!\n\n#lorem(60)"

///|
/// Compile status shown in the status bar.
pub(all) enum CompileStatus {
  /// Initial state; nothing compiled yet.
  Idle
  /// A compile has been issued and is running.
  Compiling
  /// Last compile succeeded: page count and warning count of the last
  /// good document.
  Success(pages~ : Int, warnings~ : Int)
  /// Last compile failed: error and warning counts of the failed compile.
  Failed(errors~ : Int, warnings~ : Int)
} derive(Debug, Eq)

///|
pub extend CompileStatus with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend CompileStatus with Eq::{not_equal, equal}

///|
/// Side effects the shell must perform after `update`.
pub(all) enum Action {
  /// Enter the D4 paint schedule: render the Compiling state, wait two
  /// animation frames, then call `typst.compile_main(source)`; report the
  /// result back as `CompileSucceeded`/`CompileFailed(revision, ...)`.
  StartCompile(revision~ : Int, source~ : String)
  /// Call `typst.page_image(page, scale, revision)` (scale chosen by the
  /// shell from the preview panel size) and report the URL back as
  /// `PreviewSource`.
  RequestPageImage(revision~ : Int, page~ : Int)
} derive(Debug, Eq)

///|
pub extend Action with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend Action with Eq::{not_equal, equal}

///|
pub(all) struct Model {
  /// Current source text (what the textbox shows).
  source : String
  /// True when an edit is inside the debounce window.
  pending : Bool
  /// Debounce deadline in ms; valid while `pending`.
  deadline : Int
  /// Latest issued compile revision (monotonic; bumped per compile).
  current_revision : Int
  /// Revision of the document backing the preview (last good compile).
  doc_revision : Int?
  /// Page count of the last good document (0 when none).
  page_count : Int
  /// 0-based index of the page being previewed.
  current_page : Int
  /// Image source (blob URL) of the preview, if any.
  preview_source : String?
  /// Page whose image was requested and is awaited (stale URLs dropped).
  pending_image_page : Int?
  /// Whether the preview image finished loading (texture ready).
  preview_ready : Bool
  /// Whether the last page_image request failed.
  preview_failed : Bool
  status : CompileStatus
  /// Narrow diagnostics of the last compile (errors on failure, warnings
  /// on success — used for the error list / status bar counts).
  diagnostics : Array[@typst_binding.Diagnostic]
} derive(Debug, Eq)

///|
pub extend Model with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend Model with Eq::{not_equal, equal}

///|
/// Messages into the state machine.
pub(all) enum Msg {
  /// The textbox content changed at time `now_ms`.
  SourceEdited(source~ : String, now_ms~ : Int)
  /// Clock tick; fires the compile when the debounce window expires.
  DebounceTick(now_ms~ : Int)
  /// Compile immediately, bypassing the debounce window.
  CompileNow
  /// Restore the starter document and schedule a fresh compile.
  ResetSource(now_ms~ : Int)
  /// A compile finished successfully.
  CompileSucceeded(revision~ : Int, page_count~ : Int, warnings~ : Int)
  /// A compile failed.
  CompileFailed(
    revision~ : Int,
    diagnostics~ : Array[@typst_binding.Diagnostic]
  )
  /// `page_image` returned an image source for the requested page.
  PreviewSource(revision~ : Int, page~ : Int, source~ : String)
  /// `page_image` failed.
  PreviewFailed(revision~ : Int, page~ : Int)
  /// The image of the given revision finished loading (loader callback,
  /// `typst_image_event`; also the Spike C re-render trigger).
  ImageReady(revision~ : Int)
  /// The image of the given revision failed to load.
  ImageFailed(revision~ : Int)
  PrevPage
  NextPage
  GotoPage(page~ : Int)
} derive(Debug, Eq)

///|
pub extend Msg with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend Msg with Eq::{not_equal, equal}

///|
pub fn Model::init(initial_source~ : String) -> Model {
  {
    source: initial_source,
    // The initial document counts as a pending edit: the first timer
    // tick after boot compiles it (deadline 0 = immediately due).
    pending: true,
    deadline: 0,
    current_revision: 0,
    doc_revision: None,
    page_count: 0,
    current_page: 0,
    preview_source: None,
    pending_image_page: None,
    preview_ready: false,
    preview_failed: false,
    status: Idle,
    diagnostics: [],
  }
}

///|
/// Pure transition: returns the next model and the actions the shell
/// must run.
pub fn update(model : Model, msg : Msg) -> (Model, Array[Action]) {
  match msg {
    SourceEdited(source~, now_ms~) => {
      let next = {
        ..model,
        source,
        pending: true,
        deadline: now_ms + DEBOUNCE_MS,
      }
      (next, [])
    }
    DebounceTick(now_ms~) =>
      if model.pending && now_ms >= model.deadline {
        let revision = model.current_revision + 1
        let next = {
          ..model,
          pending: false,
          current_revision: revision,
          status: Compiling,
        }
        (next, [StartCompile(revision~, source=model.source)])
      } else {
        (model, [])
      }
    CompileNow =>
      if model.status is Compiling {
        (model, [])
      } else {
        let revision = model.current_revision + 1
        let next = {
          ..model,
          pending: false,
          current_revision: revision,
          status: Compiling,
        }
        (next, [StartCompile(revision~, source=model.source)])
      }
    ResetSource(now_ms~) => {
      let next = {
        ..model,
        source: DEFAULT_SOURCE,
        pending: true,
        deadline: now_ms + DEBOUNCE_MS,
      }
      (next, [])
    }
    CompileSucceeded(revision~, page_count~, warnings~) => {
      if revision != model.current_revision {
        return (model, [])
      }
      // Fresh document: reset the preview to the first page.
      let next = {
        ..model,
        status: Success(pages=page_count, warnings~),
        doc_revision: Some(revision),
        page_count,
        current_page: 0,
        pending_image_page: Some(0),
        preview_ready: false,
        preview_failed: false,
        diagnostics: [],
      }
      (next, [RequestPageImage(revision~, page=0)])
    }
    CompileFailed(revision~, diagnostics~) => {
      if revision != model.current_revision {
        return (model, [])
      }
      let errors = @typst_binding.error_count(diagnostics)
      let warnings = @typst_binding.warning_count(diagnostics)
      // Last-good preview (doc_revision, page_count, preview_source)
      // is intentionally retained (spec: 编译错误呈现).
      let next = { ..model, status: Failed(errors~, warnings~), diagnostics }
      (next, [])
    }
    PreviewSource(revision~, page~, source~) => {
      let accepted = model.doc_revision == Some(revision) &&
        model.pending_image_page == Some(page)
      if !accepted {
        return (model, [])
      }
      let next = {
        ..model,
        preview_source: Some(source),
        pending_image_page: None,
        preview_ready: false,
        preview_failed: false,
      }
      (next, [])
    }
    PreviewFailed(revision~, page~) => {
      let accepted = model.doc_revision == Some(revision) &&
        model.pending_image_page == Some(page)
      if !accepted {
        return (model, [])
      }
      let next = { ..model, pending_image_page: None, preview_failed: true }
      (next, [])
    }
    ImageReady(revision~) =>
      if model.doc_revision == Some(revision) {
        // The view must change so MoUI re-renders the finished texture
        // (Spike C: no automatic re-render on image load).
        ({ ..model, preview_ready: true, preview_failed: false }, [])
      } else {
        (model, [])
      }
    ImageFailed(revision~) =>
      if model.doc_revision == Some(revision) {
        ({ ..model, preview_ready: false, preview_failed: true }, [])
      } else {
        (model, [])
      }
    PrevPage =>
      if model.current_page > 0 && model.doc_revision is Some(_) {
        goto_page(model, model.current_page - 1)
      } else {
        (model, [])
      }
    NextPage =>
      if model.current_page < model.page_count - 1 &&
        model.doc_revision is Some(_) {
        goto_page(model, model.current_page + 1)
      } else {
        (model, [])
      }
    GotoPage(page~) =>
      if model.doc_revision is Some(_) {
        goto_page(model, page)
      } else {
        (model, [])
      }
  }
}

///|
/// Navigate to `page` (clamped to the document bounds) and request its
/// image. No-op (no action) when the page does not change.
fn goto_page(model : Model, page : Int) -> (Model, Array[Action]) {
  let clamped = if page < 0 {
    0
  } else if page >= model.page_count {
    model.page_count - 1
  } else {
    page
  }
  if clamped == model.current_page || clamped < 0 {
    return (model, [])
  }
  match model.doc_revision {
    Some(revision) => {
      let next = {
        ..model,
        current_page: clamped,
        pending_image_page: Some(clamped),
        preview_ready: false,
      }
      (next, [RequestPageImage(revision~, page=clamped)])
    }
    None => (model, [])
  }
}

///|
pub fn Model::can_go_prev(self : Model) -> Bool {
  self.current_page > 0
}

///|
pub fn Model::can_go_next(self : Model) -> Bool {
  self.current_page < self.page_count - 1
}
