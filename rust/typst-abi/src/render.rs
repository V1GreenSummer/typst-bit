//! Per-page PNG rendering (design D9 `render_page_png`, task 6.3).
//!
//! `scale_milli` is `px_per_pt * 1000` (integer; floats never cross the
//! ABI). Output dimensions: `round(page_size_pt * px_per_pt)`, floored at
//! one pixel, matching `typst_render::render`.

use typst::utils::Scalar;
use typst_layout::{Page, PagedDocument};
use typst_render::RenderOptions;

/// Render one page to PNG bytes.
///
/// `page` is 0-based. Returns `None` when the page index is out of range
/// or `scale_milli` is zero, or when PNG encoding fails (out of memory).
pub fn render_page_png(
    document: &PagedDocument,
    page: usize,
    scale_milli: u32,
) -> Option<Vec<u8>> {
    if scale_milli == 0 {
        return None;
    }
    let page_ref = document.pages().get(page)?;
    let pixel_per_pt = Scalar::new(scale_milli as f64 / 1000.0);
    let opts = RenderOptions {
        pixel_per_pt,
        ..RenderOptions::default()
    };
    let pixmap = typst_render::render(page_ref, &opts);
    pixmap.encode_png().ok()
}

/// Expected output pixel size for a page at the given scale:
/// `(round(width_pt * px_per_pt), round(height_pt * px_per_pt))`, with a
/// one-pixel floor. Used by tests and available for budget math.
pub fn page_pixel_size(
    page: &Page,
    scale_milli: u32,
) -> (u32, u32) {
    let pixel_per_pt = scale_milli as f64 / 1000.0;
    let size = page.frame.size();
    let w = (pixel_per_pt * size.x.to_pt()).round().max(1.0) as u32;
    let h = (pixel_per_pt * size.y.to_pt()).round().max(1.0) as u32;
    (w, h)
}
