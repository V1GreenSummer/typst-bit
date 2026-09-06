///|
// Typstbit web shell (task 8.1/8.2, design D3/D4/D9).
//
// Wiring: the pure state machine (@app) decides *what* happens; this shell
// executes its Actions against the host bindings (@typst_binding):
//
//   StartCompile(revision, source)
//     -> the view commits the Compiling state; the shell asks the host for
//        a paint callback (typstbit.after_paint, rAF x 2 — design D4) and
//        only then runs the synchronous compile.
//   RequestPageImage(revision, page)
//     -> typst.page_image; the returned URL flows back as PreviewSource.
//
// The loader drives everything asynchronous back in through the exports:
//   typst_image_event(revision, status)  image load completion (D3)
//   typstbit_paint_ready(tag)            D4 paint schedule completion
//
// Scalar-only e2e exports (e2e_*) let browser tests observe the shell.

///|
/// Fixed render scale for v1: 1.5 px per pt. The preview panel scales the
/// texture to fit (MoUI image fit=Contain), so this only affects sharpness.
const PREVIEW_SCALE_MILLI : Int = 1500

///|
pub(all) struct ShellModel {
  model : @app.Model
  /// Compile issued (StartCompile seen), awaiting the paint callback.
  compile_tag : Int?
  /// Source of the in-flight compile.
  compile_source : String
} derive(Debug, Eq)

///|
pub(all) enum ShellMsg {
  App(@app.Msg)
  PaintReady(tag~ : Int)
  Noop
} derive(Debug, Eq)

///|
let shell_dispatch : Ref[((ShellMsg) -> Unit)?] = Ref(None)

///|
/// Latest model snapshot for the e2e exports.
let shell_model_ref : Ref[ShellModel] = Ref({
  model: @app.Model::init(initial_source=@app.DEFAULT_SOURCE),
  compile_tag: None,
  compile_source: "",
})

///|
/// Host clock reading; textbox edits use it as their timestamp.
fn clock_now_ms() -> Int {
  extern_typstbit_now_ms()
}

///|
/// Shell-side host callback: the loader calls this after rAF x 2
/// (design D4 paint schedule). Runs the synchronous compile.
pub fn typstbit_paint_ready(tag : Int) -> Unit {
  match shell_dispatch.val {
    Some(dispatch) => dispatch(PaintReady(tag~))
    None => ()
  }
}

///|
/// Loader callback: an image load settled (status 0 = ready, 1 = failed),
/// bound to a compile revision. The state machine drops stale revisions.
pub fn typst_image_event(revision : Int, status : Int) -> Unit {
  match shell_dispatch.val {
    Some(dispatch) => {
      let msg = if status == 0 {
        @app.ImageReady(revision~)
      } else {
        @app.ImageFailed(revision~)
      }
      dispatch(App(msg))
    }
    None => ()
  }
}

///|
fn shell_init() -> (ShellModel, @moui.Effect[ShellMsg]) {
  let model : ShellModel = {
    model: @app.Model::init(initial_source=@app.DEFAULT_SOURCE),
    compile_tag: None,
    compile_source: "",
  }
  shell_model_ref.val = model
  let effect : @moui.Effect[ShellMsg] = @moui.Effect::dispatch(dispatch => {
    shell_dispatch.val = Some(dispatch)
    // The initial document is pending from boot (Model::init); arm
    // its debounce timer so the first compile happens right away.
    arm_debounce_timer()
  })
  (model, effect)
}

///|
fn shell_update(
  shell : ShellModel,
  msg : ShellMsg,
) -> (ShellModel, @moui.Effect[ShellMsg]) {
  let next = match msg {
    App(inner) => {
      let was_compiling = shell.model.status is Compiling
      let (model, actions) = @app.update(shell.model, inner)
      if !was_compiling && model.status is Compiling {
        compiling_count.val = compiling_count.val + 1
      }
      // Re-arm the debounce window on edits (the newest deadline wins).
      if inner is @app.SourceEdited(..) && model.pending {
        arm_debounce_timer()
      }
      if inner is @app.ResetSource(..) {
        arm_debounce_timer()
      }
      apply_actions({ ..shell, model, }, actions)
    }
    PaintReady(tag~) =>
      if shell.compile_tag == Some(tag) {
        // The Compiling state has been painted; run the compile now.
        run_compile(shell, tag)
      } else {
        shell
      }
    Noop => shell
  }
  shell_model_ref.val = next
  (next, @moui.Effect::none())
}

///|
/// Monotonic count of transitions into the Compiling state (e2e: the D4
/// schedule guarantees the Compiling view is painted — via after_paint's
/// rAF x 2 — before the synchronous compile runs).
let compiling_count : Ref[Int] = Ref(0)

///|
pub fn e2e_compiling_count() -> Int {
  compiling_count.val
}

///|
/// Execute state-machine actions against the host bindings.
fn apply_actions(
  shell : ShellModel,
  actions : Array[@app.Action],
) -> ShellModel {
  let mut next = shell
  for action in actions {
    match action {
      StartCompile(revision~, source~) => {
        // Ask the host for the D4 paint schedule; the compile itself runs
        // in PaintReady. A still-pending schedule is re-armed (newest
        // revision wins; stale callbacks are ignored via compile_tag).
        extern_typstbit_after_paint(revision)
        next = { ..next, compile_tag: Some(revision), compile_source: source }
      }
      RequestPageImage(revision~, page~) => {
        let (model, _) = @app.update(
          next.model,
          request_page_image(revision, page),
        )
        next = { ..next, model, }
      }
    }
  }
  next
}

///|
/// Request a page image and wrap the outcome as the matching state
/// machine message.
fn request_page_image(revision : Int, page : Int) -> @app.Msg {
  match @typst_binding.page_image(page, PREVIEW_SCALE_MILLI, revision) {
    Ok(url) => @app.PreviewSource(revision~, page~, source=url)
    Err(_) => @app.PreviewFailed(revision~, page~)
  }
}

///|
/// Execute the synchronous compile for `revision` (design D4: called only
/// after the Compiling state was painted) and feed the result into the
/// state machine.
fn run_compile(shell : ShellModel, revision : Int) -> ShellModel {
  let cleared : ShellModel = { ..shell, compile_tag: None, compile_source: "" }
  match @typst_binding.compile_main(shell.compile_source) {
    Ok(_) => {
      let pages = @typst_binding.page_count()
      let warnings = match @typst_binding.error_json() {
        Ok(diags) => @typst_binding.warning_count(diags)
        Err(_) => 0
      }
      let (model, actions) = @app.update(
        cleared.model,
        @app.CompileSucceeded(revision~, page_count=pages, warnings~),
      )
      apply_actions({ ..cleared, model, }, actions)
    }
    Err(CompileErrors) => {
      let diags = match @typst_binding.error_json() {
        Ok(diags) => diags
        Err(_) => []
      }
      let (model, actions) = @app.update(
        cleared.model,
        @app.CompileFailed(revision~, diagnostics=diags),
      )
      apply_actions({ ..cleared, model, }, actions)
    }
    Err(other) => {
      // Host-level failure (E_MAIN_NOT_SET / E_INVALID_ARG / Fatal):
      // surface as a failed compile with a readable message.
      let message = match other {
        MainNotSet => "main file not set"
        InvalidArgument => "invalid argument"
        Fatal(detail) => "host error: \{detail}"
        CompileErrors => "compile errors"
      }
      let diags : Array[@typst_binding.Diagnostic] = [
        {
          severity: @typst_binding.Error,
          message,
          line: None,
          column: None,
          file: None,
        },
      ]
      let (model, _) = @app.update(
        cleared.model,
        @app.CompileFailed(revision~, diagnostics=diags),
      )
      { ..cleared, model, }
    }
  }
}

///|
fn shell_view(shell : ShellModel) -> @moui.View[ShellMsg] {
  shell_layout(shell)
}

// ---------------------------------------------------------------------------
// typstbit host imports (loader-implemented): D4 paint schedule, host
// clock, and one-shot debounce timers. MoUI's web event loop goes dormant
// when nothing animates, so the shell drives its own wakeups.
// ---------------------------------------------------------------------------

///|
extern "wasm" fn extern_typstbit_after_paint(tag : Int) -> Unit = "typstbit" "after_paint"

///|
extern "wasm" fn extern_typstbit_now_ms() -> Int = "typstbit" "now_ms"

///|
extern "wasm" fn extern_typstbit_schedule_timeout(
  delay_ms : Int,
  tag : Int,
) -> Unit = "typstbit" "schedule_timeout"

///|
/// Debounce timer tag (one outstanding timeout; re-armed per edit).
const TIMER_TAG_DEBOUNCE : Int = 0

///|
/// Loader callback: a one-shot timer fired. Tag 0 is the debounce tick.
pub fn typstbit_timer(tag : Int, now_ms : Int) -> Unit {
  match shell_dispatch.val {
    Some(dispatch) =>
      if tag == TIMER_TAG_DEBOUNCE {
        dispatch(App(@app.DebounceTick(now_ms~)))
      }
    None => ()
  }
}

///|
/// Arm (or re-arm) the debounce timer for the standard window. The loader
/// replaces any outstanding timeout with the same tag.
fn arm_debounce_timer() -> Unit {
  extern_typstbit_schedule_timeout(@app.DEBOUNCE_MS, TIMER_TAG_DEBOUNCE)
}

// ---------------------------------------------------------------------------
// Debug / e2e exports (scalar only)
// ---------------------------------------------------------------------------

///|
/// e2e: compile status. 0 idle, 1 compiling, 2 success, 3 failed.
pub fn e2e_status() -> Int {
  match shell_model_ref.val.model.status {
    Idle => 0
    Compiling => 1
    Success(..) => 2
    Failed(..) => 3
  }
}

///|
pub fn e2e_page_count() -> Int {
  shell_model_ref.val.model.page_count
}

///|
pub fn e2e_current_page() -> Int {
  shell_model_ref.val.model.current_page
}

///|
pub fn e2e_preview_ready() -> Int {
  if shell_model_ref.val.model.preview_ready {
    1
  } else {
    0
  }
}

///|
pub fn e2e_revision() -> Int {
  shell_model_ref.val.model.current_revision
}

///|
pub fn e2e_error_count() -> Int {
  shell_model_ref.val.model.diagnostics.filter(d => d.is_error()).length()
}

///|
/// e2e: dispatch a source edit using a text id registered in the loader's
/// typst table (the same path a production editor value would take).
pub fn e2e_set_source(text_id : Int) -> Unit {
  match shell_dispatch.val {
    Some(dispatch) =>
      match @typst_binding.pull_registered_text(text_id) {
        Ok(Some(source)) =>
          dispatch(App(@app.SourceEdited(source~, now_ms=clock_now_ms())))
        _ => ()
      }
    None => ()
  }
}

///|
/// e2e: 1 when the current source contains the registered text (IME
/// commit verification: submitted text must arrive completely).
pub fn e2e_source_contains(text_id : Int) -> Int {
  match shell_dispatch.val {
    Some(_) =>
      match @typst_binding.pull_registered_text(text_id) {
        Ok(Some(needle)) =>
          if shell_model_ref.val.model.source.contains(needle) {
            1
          } else {
            0
          }
        _ => 0
      }
    None => 0
  }
}

///|
/// e2e: turn the page (0 = prev, 1 = next).
pub fn e2e_turn_page(direction : Int) -> Unit {
  match shell_dispatch.val {
    Some(dispatch) => {
      let msg = if direction == 0 { @app.PrevPage } else { @app.NextPage }
      dispatch(App(msg))
    }
    None => ()
  }
}
