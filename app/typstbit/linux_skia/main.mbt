///|
// Native (Linux/skia) smoke entry for the MoUI runtime. Self-contained:
// the application logic packages are pure (no MoUI dependency, design D8)
// and the real view ships with web_wasm (task 8.2).

///|
priv struct NativeSmokeModel {
  count : Int
}

///|
priv enum NativeSmokeMsg {
  Increment
  Reset
}

///|
fn native_smoke_view(model : NativeSmokeModel) -> @views.View[NativeSmokeMsg] {
  @views.column([
    @views.text("Typstbit native smoke").title(),
    @views.text("Count: \{model.count}"),
    @views.row([
      @views.button("-", on_click=Reset),
      @views.button("+", on_click=Increment),
    ]),
  ])
}

///|
fn main {
  let runtime = @runtime.new_program_with_dimensions(
    program=@moui.Program::simple(
      init={ count: 0 },
      update=(model, msg) => {
        match msg {
          Increment => { count: model.count + 1 }
          Reset => { count: 0 }
        }
      },
      view=native_smoke_view,
    ),
    width=720.0,
    height=480.0,
  )
  @runtime.run_app("Typstbit", runtime)
  .render_all(
    @render_skia.from_env(platform=@render_skia.NativeGpuPlatform::Linux),
  )
  .backend(@platform_host.entry())
  .run()
}
