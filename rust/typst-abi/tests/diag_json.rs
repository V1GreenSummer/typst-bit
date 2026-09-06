//! Task 6.2: diagnostics JSON wide model tests (design D7).

use serde_json::Value;
use typst::diag::{SourceDiagnostic, Warned};
use typst::syntax::package::{PackageSpec, PackageVersion};
use typst::syntax::{
    DiagSpan, FileId, RootedPath, Span, VirtualPath, VirtualRoot,
};
use typst::World;
use typst_abi::diag_json::diagnostics_to_json;
use typst_abi::world::{normalize_vpath, VfsWorld};

fn main_id() -> FileId {
    normalize_vpath("/main.typ").unwrap().file_id()
}

/// Compile the source and return all diagnostics (errors or warnings).
fn compile_diags(world: &VfsWorld) -> Vec<SourceDiagnostic> {
    let warned: Warned<Result<typst_layout::PagedDocument, _>> =
        typst::compile::<typst_layout::PagedDocument>(world);
    match warned.output {
        Ok(_) => warned.warnings.iter().cloned().collect(),
        Err(errors) => errors.iter().cloned().collect(),
    }
}

fn world_with_main(text: &str) -> VfsWorld {
    let mut world = VfsWorld::new();
    let path = normalize_vpath("/main.typ").unwrap();
    world.set_file(path, text.as_bytes()).unwrap();
    world.set_main(path);
    world
}

#[test]
fn syntax_error_has_line_and_column() {
    // Line 3, the `#let` is incomplete.
    let world = world_with_main("Ok\n\n#let x = ");
    let diags = compile_diags(&world);
    assert_eq!(diags.len(), 1);
    let json: Value =
        serde_json::from_str(&diagnostics_to_json(&world, &diags)).unwrap();
    let diag = &json["diagnostics"][0];
    assert_eq!(diag["severity"], "error");
    assert!(
        diag["message"].as_str().unwrap().contains("expected"),
        "message: {}",
        diag["message"]
    );
    assert_eq!(diag["file"], "/main.typ");
    let start = &diag["start"];
    assert_eq!(start["line"], 3, "1-based line for the error");
    assert!(start["column"].as_u64().unwrap() >= 1);
}

#[test]
fn positionless_diagnostic_omits_position_fields() {
    let world = world_with_main("Ok");
    let detached = SourceDiagnostic::error(Span::detached(), "no position here");
    let json: Value =
        serde_json::from_str(&diagnostics_to_json(&world, &[detached])).unwrap();
    let diag = &json["diagnostics"][0];
    assert_eq!(diag["severity"], "error");
    assert_eq!(diag["message"], "no position here");
    assert!(diag.get("file").is_none());
    assert!(diag.get("start").is_none());
    assert!(diag.get("end").is_none());
}

#[test]
fn span_without_vfs_source_still_has_file() {
    // A span pointing at a file that is NOT in the VFS (e.g. a package
    // file): the file path is still reported, positions omitted.
    let world = world_with_main("Ok");
    let other = RootedPath::new(
        VirtualRoot::Package(PackageSpec {
            namespace: "preview".into(),
            name: "some-pkg".into(),
            version: PackageVersion { major: 0, minor: 1, patch: 0 },
        }),
        VirtualPath::new("lib.typ").unwrap(),
    )
    .intern();
    let span = DiagSpan::from_range(other, 0..3);
    let diag = SourceDiagnostic::error(span, "foreign file problem");
    let json: Value =
        serde_json::from_str(&diagnostics_to_json(&world, &[diag])).unwrap();
    let entry = &json["diagnostics"][0];
    assert!(entry["file"].as_str().unwrap().contains("lib.typ"));
    assert!(entry.get("start").is_none());
}

#[test]
fn warning_serializes_with_severity_and_span() {
    // Unknown font family triggers a warning with a span.
    let world = world_with_main("#set text(font: \"no-such-font-family\")\nHi");
    let diags = compile_diags(&world);
    assert!(
        !diags.is_empty(),
        "unknown font family should produce a warning"
    );
    let json: Value =
        serde_json::from_str(&diagnostics_to_json(&world, &diags)).unwrap();
    let list = json["diagnostics"].as_array().unwrap();
    assert!(!list.is_empty());
    for diag in list {
        assert_eq!(diag["severity"], "warning");
        assert!(diag["message"].as_str().unwrap().contains("font"));
        assert_eq!(diag["file"], "/main.typ");
        assert!(diag["start"]["line"].as_u64().unwrap() >= 1);
    }
}

#[test]
fn multi_line_range_has_distinct_start_end() {
    let world = world_with_main("a\nb");
    let id = main_id();
    // Bytes spanning two lines: "a\nb" starting at byte 0.
    let source = <VfsWorld as World>::source(&world, id).unwrap();
    let text = source.text();
    let newline = text.find('\n').unwrap();
    let span = DiagSpan::from_range(id, 0..newline + 2);
    let diag = SourceDiagnostic::error(span, "multi line");
    let json: Value =
        serde_json::from_str(&diagnostics_to_json(&world, &[diag])).unwrap();
    let entry = &json["diagnostics"][0];
    assert_eq!(entry["start"]["line"], 1);
    assert_eq!(entry["end"]["line"], 2);
}

#[test]
fn hints_are_serialized() {
    let world = world_with_main("Ok");
    let mut diag = SourceDiagnostic::error(Span::detached(), "with hints");
    diag.hints.push(typst::syntax::Spanned::new(
        "try this instead".into(),
        DiagSpan::from_span(Span::detached(), None),
    ));
    let json: Value =
        serde_json::from_str(&diagnostics_to_json(&world, &[diag])).unwrap();
    let entry = &json["diagnostics"][0];
    assert_eq!(entry["hints"][0], "try this instead");
}

#[test]
fn empty_diagnostics_is_valid_empty_list() {
    let world = world_with_main("Ok");
    let json: Value =
        serde_json::from_str(&diagnostics_to_json(&world, &[])).unwrap();
    assert_eq!(json["diagnostics"].as_array().unwrap().len(), 0);
}
