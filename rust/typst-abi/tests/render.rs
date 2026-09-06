//! Task 6.3: per-page PNG rendering tests (design D9 `render_page_png`).

use typst_abi::render::{page_pixel_size, render_page_png};
use typst_abi::world::{normalize_vpath, VfsWorld};

fn compile_world(main_text: &str) -> typst_layout::PagedDocument {
    let mut world = VfsWorld::new();
    let path = normalize_vpath("/main.typ").unwrap();
    world.set_file(path, main_text.as_bytes()).unwrap();
    world.set_main(path);
    world.compile().expect("compile should succeed").0
}

/// Decode the IHDR dimensions of a PNG byte stream.
fn png_size(png: &[u8]) -> (u32, u32) {
    assert!(png.len() > 24, "png too short");
    assert_eq!(&png[0..8], b"\x89PNG\r\n\x1a\n", "PNG signature");
    assert_eq!(&png[12..16], b"IHDR", "first chunk is IHDR");
    let w = u32::from_be_bytes(png[16..20].try_into().unwrap());
    let h = u32::from_be_bytes(png[20..24].try_into().unwrap());
    (w, h)
}

#[test]
fn a4_default_page_at_1x() {
    let document = compile_world("Hello");
    assert_eq!(document.pages().len(), 1);
    let png = render_page_png(&document, 0, 1000).expect("render ok");
    let (w, h) = png_size(&png);
    // A4: 595.28 x 841.89 pt -> 595 x 842 px at 1x.
    assert_eq!((w, h), (595, 842));
    assert_eq!(page_pixel_size(&document.pages()[0], 1000), (595, 842));
}

#[test]
fn scale_conversion_2x_and_1500() {
    let document = compile_world("Hello");
    let (w, h) = png_size(&render_page_png(&document, 0, 2000).unwrap());
    assert_eq!((w, h), (1191, 1684)); // 595.28*2 = 1190.56 -> 1191

    let (w, h) = png_size(&render_page_png(&document, 0, 1500).unwrap());
    assert_eq!((w, h), (893, 1263)); // 595.28*1.5 = 892.92 -> 893
}

#[test]
fn multi_page_document_page_count_and_rendering() {
    let document = compile_world("A\n#pagebreak()\nB\n#pagebreak()\nC");
    assert_eq!(document.pages().len(), 3);
    for page in 0..3 {
        let png = render_page_png(&document, page, 1000)
            .unwrap_or_else(|| panic!("page {page} should render"));
        assert_eq!(png_size(&png), (595, 842));
    }
}

#[test]
fn landscape_page_orientation_is_respected() {
    let document = compile_world("#set page(width: 20cm, height: 10cm)\nWide");
    let png = render_page_png(&document, 0, 1000).unwrap();
    // 20cm = 566.93pt, 10cm = 283.46pt.
    assert_eq!(png_size(&png), (567, 283));
}

#[test]
fn out_of_range_and_zero_scale_fail() {
    let document = compile_world("A\n#pagebreak()\nB");
    assert_eq!(document.pages().len(), 2);
    assert!(render_page_png(&document, 2, 1000).is_none(), "page index 2");
    assert!(render_page_png(&document, 999, 1000).is_none(), "far index");
    assert!(render_page_png(&document, 0, 0).is_none(), "zero scale");
}

#[test]
fn pages_render_distinct_content() {
    let document = compile_world("#page(width: 10cm, height: 10cm)[A]\n#page(width: 12cm, height: 10cm)[B]");
    let first = render_page_png(&document, 0, 1000).unwrap();
    let second = render_page_png(&document, 1, 1000).unwrap();
    assert_ne!(png_size(&first), png_size(&second), "different page sizes");
}
