//! The frozen flat C ABI (design D9, ABI v1, task 6.4).
//!
//! Single-instance model: module-level state, no handles. Status codes:
//!
//! ```text
//! 0 OK
//! 1 E_INVALID_ARG     ptr/len out of arena bounds or arithmetic overflow,
//!                     non-UTF-8, illegal path (relative / escaping / root)
//! 2 E_MAIN_NOT_SET    compile before set_main, or main file not in the VFS
//! 3 E_COMPILE_ERRORS  compile failed; diagnostics via error_json
//! 4 E_NO_DOCUMENT     no successful compile result yet when accessing pages
//! 5 E_PAGE_OUT_OF_RANGE
//! 6 E_INTERNAL        must not happen; loader treats as fatal
//! ```
//!
//! Memory model: the input arena and the output buffers are physically
//! separate. Arena allocations are valid until the next `compile` or
//! `reset` entry (both reset the arena). An output pointer (PNG, JSON) is
//! valid until the next successful call producing the same kind of output;
//! arena resets do not invalidate outputs. Output lengths are read through
//! the single fixed u32 slot behind `typst_abi_out_len_ptr`, which always
//! reflects the most recent successful producing call.
//!
//! All exports validate ptr/len (arithmetic overflow + arena bounds) and
//! data encoding before dereferencing; invalid input returns
//! `E_INVALID_ARG` and never traps (build uses panic=abort, so a panic is
//! a trap).

use typst::diag::SourceDiagnostic;

use crate::diag_json::diagnostics_to_json;
use crate::render::render_page_png;
use crate::world::{normalize_vpath, VfsWorld};

/// Status codes (u32 shared by all exports).
pub const OK: u32 = 0;
pub const E_INVALID_ARG: u32 = 1;
pub const E_MAIN_NOT_SET: u32 = 2;
pub const E_COMPILE_ERRORS: u32 = 3;
pub const E_NO_DOCUMENT: u32 = 4;
pub const E_PAGE_OUT_OF_RANGE: u32 = 5;
pub const E_INTERNAL: u32 = 6;

/// Input arena cap: 64 MB (design D9).
const ARENA_CAP: usize = 64 * 1024 * 1024;
/// Bump allocation alignment.
const ARENA_ALIGN: usize = 8;

// ---------------------------------------------------------------------------
// Input arena
// ---------------------------------------------------------------------------

/// Chunked bump arena. Chunks are never moved or freed while live, so
/// previously returned pointers stay valid across later allocations; the
/// whole arena is reclaimed at once on reset.
struct Arena {
    chunks: Vec<Vec<u8>>,
    /// Used bytes in the last chunk.
    top: usize,
    total: usize,
}

impl Arena {
    fn new() -> Self {
        Arena {
            chunks: Vec::new(),
            top: 0,
            total: 0,
        }
    }

    fn reset(&mut self) {
        self.chunks.clear();
        self.top = 0;
        self.total = 0;
    }

    /// Allocate `len` bytes, 8-byte aligned. Returns 0 on exhaustion.
    fn alloc(&mut self, len: usize) -> *mut u8 {
        let aligned_len = len.div_ceil(ARENA_ALIGN) * ARENA_ALIGN;
        if self.chunks.is_empty() {
            // Always keep at least one live chunk so that even zero-length
            // allocations return a valid, aligned, non-null pointer.
            self.chunks.push(vec![0u8; 64 * 1024]);
            self.top = 0;
        }
        if aligned_len == 0 {
            let base = self.chunks[0].as_ptr();
            let offset = self.top.min(self.chunks[0].len() - ARENA_ALIGN);
            return unsafe { base.add(offset) } as *mut u8;
        }
        if self.total + aligned_len > ARENA_CAP {
            return core::ptr::null_mut();
        }
        let need_new = match self.chunks.last() {
            Some(last) => self.top + aligned_len > last.len(),
            None => true,
        };
        if need_new {
            // Chunk sizes grow geometrically, starting at 64 KiB, but a
            // single large request gets an exactly-sized chunk.
            let next = self.chunks.len();
            let geometric = 64 * 1024 * (1 << next.min(10));
            let chunk_len = aligned_len.max(geometric);
            self.chunks.push(vec![0u8; chunk_len]);
            self.top = 0;
        }
        let chunk = self.chunks.last().expect("chunk just ensured");
        // SAFETY: top + aligned_len <= chunk.len() was ensured above.
        let ptr = unsafe { chunk.as_ptr().add(self.top) } as *mut u8;
        self.top += aligned_len;
        self.total += aligned_len;
        ptr
    }

    fn current_base(&self) -> *const u8 {
        match self.chunks.last() {
            Some(last) => last.as_ptr(),
            None => core::ptr::null(),
        }
    }

    /// Validate that `ptr .. ptr+len` (no overflow) lies fully inside the
    /// used region of one arena chunk. This is the anti-trap check for all
    /// host-supplied pointers: they can only legally point into arena
    /// allocations, so anything else (or out of the bumped region) is
    /// rejected before dereferencing.
    fn contains(&self, ptr: usize, len: usize) -> bool {
        let Some(end) = ptr.checked_add(len) else {
            return false;
        };
        for chunk in &self.chunks {
            let base = chunk.as_ptr() as usize;
            let used = if core::ptr::eq(chunk.as_ptr(), self.current_base()) {
                self.top
            } else {
                chunk.len()
            };
            let chunk_end = base.checked_add(used);
            let Some(chunk_end) = chunk_end else {
                continue;
            };
            if ptr >= base && end <= chunk_end {
                return true;
            }
        }
        false
    }
}

// ---------------------------------------------------------------------------
// Single-instance state
// ---------------------------------------------------------------------------

struct State {
    world: VfsWorld,
    document: Option<typst_layout::PagedDocument>,
    /// Diagnostics of the most recent compile (errors on failure, warnings
    /// on success).
    diagnostics: Vec<SourceDiagnostic>,
    arena: Arena,
    png_out: Vec<u8>,
    json_out: Vec<u8>,
    pdf_out: Vec<u8>,
    svg_out: Vec<u8>,
}

impl State {
    fn new() -> Self {
        State {
            world: VfsWorld::new(),
            document: None,
            diagnostics: Vec::new(),
            arena: Arena::new(),
            png_out: Vec::new(),
            json_out: Vec::new(),
            pdf_out: Vec::new(),
            svg_out: Vec::new(),
        }
    }
}

static mut STATE: Option<State> = None;
static mut OUT_LEN: u32 = 0;

/// # Safety
/// Single-threaded, single-instance ABI; the wasm host never calls exports
/// concurrently. (Worker migration would move the whole module.)
unsafe fn state() -> &'static mut State {
    unsafe {
        if STATE.is_none() {
            STATE = Some(State::new());
        }
        STATE.as_mut().expect("state initialized above")
    }
}

unsafe fn read_bytes<'a>(ptr: usize, len: usize) -> Result<&'a [u8], u32> {
    if len == 0 {
        return Ok(&[]);
    }
    let st = unsafe { state() };
    if !st.arena.contains(ptr, len) {
        return Err(E_INVALID_ARG);
    }
    Ok(unsafe { core::slice::from_raw_parts(ptr as *const u8, len) })
}

unsafe fn read_path<'a>(ptr: usize, len: usize) -> Result<&'a str, u32> {
    let bytes = unsafe { read_bytes(ptr, len) }?;
    core::str::from_utf8(bytes).map_err(|_| E_INVALID_ARG)
}

// ---------------------------------------------------------------------------
// Exports (design D9 ABI v1)
// ---------------------------------------------------------------------------

/// Fixed u32 slot holding the length of the most recent successful output
/// (PNG or JSON). Read it before copying from the returned pointer.
#[no_mangle]
pub extern "C" fn typst_abi_out_len_ptr() -> *const u32 {
    &raw const OUT_LEN
}

/// Allocate `len` bytes (8-byte aligned) in the input arena. Valid until
/// the next `compile`/`reset`. Returns 0 on exhaustion (cap: 64 MB).
#[no_mangle]
pub extern "C" fn typst_abi_alloc(len: usize) -> *mut u8 {
    unsafe { state().arena.alloc(len) }
}

/// Clear the VFS, main file, diagnostics, document, arena, and outputs.
#[no_mangle]
pub extern "C" fn typst_abi_reset() -> u32 {
    unsafe {
        STATE = Some(State::new());
        OUT_LEN = 0;
    }
    OK
}

/// Insert or replace a file at the absolute virtual path `path`.
/// `.typ` files must be UTF-8; other files are stored as raw bytes.
#[no_mangle]
pub unsafe extern "C" fn typst_abi_set_file(
    path_ptr: usize,
    path_len: usize,
    data_ptr: usize,
    data_len: usize,
) -> u32 {
    unsafe {
        let path = match read_path(path_ptr, path_len) {
            Ok(path) => path,
            Err(status) => return status,
        };
        let vpath = match normalize_vpath(path) {
            Ok(vpath) => vpath,
            Err(_) => return E_INVALID_ARG,
        };
        let data = match read_bytes(data_ptr, data_len) {
            Ok(data) => data,
            Err(status) => return status,
        };
        let st = state();
        match st.world.set_file(vpath, data) {
            Ok(()) => OK,
            Err(_) => E_INVALID_ARG,
        }
    }
}

/// Insert or replace a file inside a bundled Typst package.
/// `spec` is `@namespace/name:version`; `path` is package-relative.
#[no_mangle]
pub unsafe extern "C" fn typst_abi_set_package_file(
    spec_ptr: usize,
    spec_len: usize,
    path_ptr: usize,
    path_len: usize,
    data_ptr: usize,
    data_len: usize,
) -> u32 {
    unsafe {
        let spec_text = match read_path(spec_ptr, spec_len) {
            Ok(spec) => spec,
            Err(status) => return status,
        };
        let path = match read_path(path_ptr, path_len) {
            Ok(path) => path,
            Err(status) => return status,
        };
        let spec = match spec_text.parse::<typst::syntax::package::PackageSpec>() {
            Ok(spec) => spec,
            Err(_) => return E_INVALID_ARG,
        };
        let data = match read_bytes(data_ptr, data_len) {
            Ok(data) => data,
            Err(status) => return status,
        };
        match state().world.set_package_file(&spec, path, data) {
            Ok(()) => OK,
            Err(_) => E_INVALID_ARG,
        }
    }
}

/// Remove a file from the VFS. Removing an unknown path succeeds (idempotent).
#[no_mangle]
pub unsafe extern "C" fn typst_abi_remove_file(
    path_ptr: usize,
    path_len: usize,
) -> u32 {
    unsafe {
        let path = match read_path(path_ptr, path_len) {
            Ok(path) => path,
            Err(status) => return status,
        };
        let vpath = match normalize_vpath(path) {
            Ok(vpath) => vpath,
            Err(_) => return E_INVALID_ARG,
        };
        state().world.remove_file(vpath);
        OK
    }
}

/// Register bytes for an `http(s)://` URL used by `#image`/`#read`. The
/// source keeps the URL; the VFS resolves it from these bytes offline.
#[no_mangle]
pub unsafe extern "C" fn typst_abi_set_remote_file(
    url_ptr: usize,
    url_len: usize,
    data_ptr: usize,
    data_len: usize,
) -> u32 {
    unsafe {
        let url = match read_path(url_ptr, url_len) {
            Ok(url) => url,
            Err(status) => return status,
        };
        let data = match read_bytes(data_ptr, data_len) {
            Ok(data) => data,
            Err(status) => return status,
        };
        match state().world.set_remote_file(url, data) {
            Ok(()) => OK,
            Err(_) => E_INVALID_ARG,
        }
    }
}

/// Drop a remote URL registered with [`typst_abi_set_remote_file`].
#[no_mangle]
pub unsafe extern "C" fn typst_abi_remove_remote_file(
    url_ptr: usize,
    url_len: usize,
) -> u32 {
    unsafe {
        let url = match read_path(url_ptr, url_len) {
            Ok(url) => url,
            Err(status) => return status,
        };
        state().world.remove_remote_file(url);
        OK
    }
}

/// Record the main file path (must be set before `compile`).
#[no_mangle]
pub unsafe extern "C" fn typst_abi_set_main(
    path_ptr: usize,
    path_len: usize,
) -> u32 {
    unsafe {
        let path = match read_path(path_ptr, path_len) {
            Ok(path) => path,
            Err(status) => return status,
        };
        let vpath = match normalize_vpath(path) {
            Ok(vpath) => vpath,
            Err(_) => return E_INVALID_ARG,
        };
        state().world.set_main(vpath);
        OK
    }
}

/// Compile the main file. Resets the input arena and the comemo cache
/// (`evict(0)`, Spike B) at entry. On success, holds the new document
/// (page access via `typst_abi_page_count` / `typst_abi_render_page_png`).
/// On failure the previous document, if any, stays available (last-good).
#[no_mangle]
pub unsafe extern "C" fn typst_abi_compile() -> u32 {
    unsafe {
        let st = state();
        if !st.world.main_is_available() {
            return E_MAIN_NOT_SET;
        }
        st.arena.reset();
        comemo::evict(0);
        let world = &st.world;
        match world.compile() {
            Ok((document, warnings)) => {
                st.document = Some(document);
                st.diagnostics = warnings;
                OK
            }
            Err(errors) => {
                st.diagnostics = errors;
                E_COMPILE_ERRORS
            }
        }
    }
}

/// Page count of the most recent successful compile; 0 when none.
#[no_mangle]
pub extern "C" fn typst_abi_page_count() -> u32 {
    unsafe {
        state()
            .document
            .as_ref()
            .map(|doc| doc.pages().len() as u32)
            .unwrap_or(0)
    }
}
/// Render `page` (0-based) to PNG at `scale_milli` (px_per_pt * 1000).
/// Returns a pointer into the PNG output buffer (valid until the next
/// successful `typst_abi_render_page_png`), or 0 on failure:
/// no document, page out of range, zero scale, or encoding failure.
/// The byte length is in the `typst_abi_out_len_ptr` slot.
#[no_mangle]
pub unsafe extern "C" fn typst_abi_render_page_png(
    page: u32,
    scale_milli: u32,
) -> usize {
    unsafe {
        let st = state();
        let Some(document) = st.document.as_ref() else {
            return 0;
        };
        if (page as usize) >= document.pages().len() {
            return 0;
        }
        if scale_milli == 0 {
            return 0;
        }
        let Some(png) = render_page_png(document, page as usize, scale_milli)
        else {
            return 0;
        };
        let len = png.len() as u32;
        st.png_out = png;
        OUT_LEN = len;
        st.png_out.as_ptr() as usize
    }
}

/// Diagnostics of the most recent `typst_abi_compile` (errors on failure,
/// warnings on success) as D7 JSON. Returns a pointer into the JSON output
/// buffer (valid until the next successful `typst_abi_error_json`), or 0
/// when there are no diagnostics. Length in `typst_abi_out_len_ptr`.
#[no_mangle]
pub unsafe extern "C" fn typst_abi_error_json() -> usize {
    unsafe {
        let st = state();
        if st.diagnostics.is_empty() {
            return 0;
        }
        let json = diagnostics_to_json(&st.world, &st.diagnostics);
        let len = json.len() as u32;
        st.json_out = json.into_bytes();
        OUT_LEN = len;
        st.json_out.as_ptr() as usize
    }
}

/// Export the most recent successful document as a PDF. Returns a pointer
/// into the PDF output buffer (valid until the next successful
/// `typst_abi_export_pdf`), or 0 when there is no document or the PDF
/// encoding fails. Length in `typst_abi_out_len_ptr`.
#[no_mangle]
pub unsafe extern "C" fn typst_abi_export_pdf() -> usize {
    unsafe {
        let st = state();
        let Some(document) = st.document.as_ref() else {
            return 0;
        };
        let options = typst_pdf::PdfOptions::default();
        let bytes = match typst_pdf::pdf(document, &options) {
            Ok(bytes) => bytes,
            Err(_) => return 0,
        };
        let len = bytes.len() as u32;
        st.pdf_out = bytes;
        OUT_LEN = len;
        st.pdf_out.as_ptr() as usize
    }
}

/// Export one page of the most recent document as SVG. Returns a pointer into
/// the SVG output buffer (valid until the next successful
/// `typst_abi_export_svg`), or 0 when there is no document or the page index is
/// out of range. Length in `typst_abi_out_len_ptr`.
#[no_mangle]
pub unsafe extern "C" fn typst_abi_export_svg(page: u32) -> usize {
    unsafe {
        let st = state();
        let Some(document) = st.document.as_ref() else {
            return 0;
        };
        let Some(page) = document.pages().get(page as usize) else {
            return 0;
        };
        let bytes = typst_svg::svg(page, &typst_svg::SvgOptions::default()).into_bytes();
        let len = bytes.len() as u32;
        st.svg_out = bytes;
        OUT_LEN = len;
        st.svg_out.as_ptr() as usize
    }
}
