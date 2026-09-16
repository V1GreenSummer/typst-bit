//! Font coverage tests: bundled CJK + Times-compatible fonts.

use typst_abi::world::{normalize_vpath, VfsWorld};

const TEMPLATE: &str = "#set text(font: (\"Liberation Serif\", \"Noto Serif CJK SC\"))\n";

fn compile_pdf(text: &str) -> Vec<u8> {
    let mut world = VfsWorld::new();
    let main = normalize_vpath("/main.typ").unwrap();
    world.set_file(main, text.as_bytes()).unwrap();
    world.set_main(main);
    let (document, warnings) = world.compile().expect("compile should succeed");
    assert!(
        warnings.is_empty(),
        "unexpected warnings: {:?}",
        warnings.iter().map(|w| &w.message).collect::<Vec<_>>()
    );
    assert_eq!(document.pages().len(), 1);
    typst_pdf::pdf(&document, &typst_pdf::PdfOptions::default()).expect("pdf export")
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|window| window == needle)
}

#[test]
fn bundled_font_count_is_twenty_three() {
    let world = VfsWorld::new();
    assert_eq!(world.font_count(), 23);
}

#[test]
fn default_template_embeds_cjk_bold_and_times_compatible_fonts() {
    let source = format!(
        "{TEMPLATE}= 直接 GUI 驱动测试\n\n中文与 English 混排，标点：「引号」、句号。\n\n破折号——省略号……\n\n#strong[粗体中文]"
    );
    let pdf = compile_pdf(&source);
    assert!(
        contains(&pdf, b"NotoSerifCJKsc"),
        "CJK subset font must be embedded"
    );
    assert!(
        contains(&pdf, b"NotoSerifCJKsc-Bold"),
        "bold CJK must use the bundled Bold face"
    );
    assert!(
        contains(&pdf, b"LiberationSerif"),
        "Times-compatible font must be embedded for Latin"
    );
}

#[test]
fn gb2312_coverage_including_level_two_compiles_cleanly() {
    let source = format!("{TEMPLATE}浏览器与输入输出：直接驱动测试，龙马鸟鱼。");
    let _ = compile_pdf(&source);
}
