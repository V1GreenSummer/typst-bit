//! Spike B measurement exports (task 3.2).
//!
//! Kept so that the measurements in `docs/spike-b.md` stay reproducible
//! (`rust/typst-abi/spike/measure.mjs` drives these). The production ABI
//! lives in [`crate::abi`].

#![allow(clippy::missing_safety_doc)]
#![allow(static_mut_refs)]

use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::Library;
use typst::LibraryExt;
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::World;

/// Minimal in-memory Typst world: embedded fonts, a single main source,
/// no binary files. Deliberately simple — the full VFS is [`crate::world`].
pub struct SpikeWorld {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    main: FileId,
    files: std::collections::HashMap<FileId, Source>,
}

impl SpikeWorld {
    pub fn new() -> Self {
        let fonts: Vec<Font> = typst_assets::fonts()
            .filter_map(|data| Font::new(Bytes::new(data), 0))
            .collect();
        let book = FontBook::from_fonts(&fonts);
        let main = RootedPath::new(VirtualRoot::Project, VirtualPath::new("main.typ").unwrap())
            .intern();
        Self {
            library: LazyHash::new(Library::default()),
            book: LazyHash::new(book),
            fonts,
            main,
            files: std::collections::HashMap::new(),
        }
    }

    pub fn font_count(&self) -> usize {
        self.fonts.len()
    }

    pub fn set_main_source(&mut self, text: &str) {
        let source = Source::new(self.main, text.to_string());
        self.files.insert(self.main, source);
    }

    pub fn compile(
        &self,
    ) -> Result<usize, typst::diag::EcoVec<typst::diag::SourceDiagnostic>> {
        let warned = typst::compile::<typst_layout::PagedDocument>(self);
        let document = warned.output?;
        Ok(document.pages().len())
    }
}

impl World for SpikeWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        self.main
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        self.files.get(&id).cloned().ok_or_else(|| {
            FileError::NotFound(std::path::PathBuf::from(id.vpath().get_with_slash()))
        })
    }

    fn file(&self, _id: FileId) -> FileResult<Bytes> {
        Err(FileError::Other(None))
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }

    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        // Deterministic date so spike measurements are reproducible.
        Datetime::from_ymd(2026, 1, 1)
    }
}

static mut SPIKE_WORLD: Option<SpikeWorld> = None;

/// Build the spike world (fonts + library). Returns the embedded font count.
#[no_mangle]
pub extern "C" fn spike_init() -> u32 {
    unsafe {
        let world = SpikeWorld::new();
        let fonts = world.font_count() as u32;
        SPIKE_WORLD = Some(world);
        fonts
    }
}

/// Allocate a scratch buffer for input data (models the D9 input arena).
/// The buffer is intentionally leaked so the host can reuse the slot
/// across calls; the spike has no free.
#[no_mangle]
pub extern "C" fn spike_alloc(len: usize) -> *mut u8 {
    let mut buf: Vec<u8> = Vec::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Evict comemo memoization results older than `max_age` compile
/// generations (0 = clear everything). Comemo never evicts on its own;
/// without this, every distinct source version retains its eval/layout
/// cache entries, so edit loops grow wasm memory without bound.
#[no_mangle]
pub extern "C" fn spike_evict(max_age: u32) {
    comemo::evict(max_age as usize);
}

/// Compile `main` from wasm memory. Returns the page count, or u32::MAX on
/// compile errors (diagnostics land with the production ABI).
#[no_mangle]
pub unsafe extern "C" fn spike_compile(ptr: *const u8, len: usize) -> u32 {
    let text = match std::str::from_utf8(unsafe { std::slice::from_raw_parts(ptr, len) }) {
        Ok(text) => text,
        Err(_) => return u32::MAX,
    };
    let world = unsafe {
        if SPIKE_WORLD.is_none() {
            spike_init();
        }
        SPIKE_WORLD.as_mut().expect("world present after init")
    };
    world.set_main_source(text);
    match world.compile() {
        Ok(pages) => pages as u32,
        Err(_) => u32::MAX,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_hello_typst() {
        let mut world = SpikeWorld::new();
        assert!(!world.fonts.is_empty(), "embedded fonts missing");
        world.set_main_source("Hello, typst!");
        let pages = world.compile().expect("compile should succeed");
        assert_eq!(pages, 1);
    }

    #[test]
    fn compile_error_returns_diagnostics() {
        let mut world = SpikeWorld::new();
        world.set_main_source("#let x = ");
        assert!(world.compile().is_err());
    }

    /// Spike B record: which of the bundled font files actually parse
    /// (run with `cargo test -- --nocapture` to see the inventory).
    #[test]
    fn font_inventory() {
        let world = SpikeWorld::new();
        let total = typst_assets::fonts().count();
        println!(
            "typst-assets files: {} -> Font::new accepted: {}",
            total,
            world.font_count()
        );
        for font in &world.fonts {
            println!(
                "  family={:?} variant={:?}",
                font.info().family,
                font.info().variant,
            );
        }
    }
}
