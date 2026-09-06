//! Virtual-filesystem Typst world (design D6, task 6.1).
//!
//! Single-instance world owning an in-memory VFS rooted at `/`. All paths
//! are absolute virtual paths; normalization rejects relative paths,
//! backslashes, `..` escaping the root, NUL bytes, and the root itself.
//!
//! Fonts come from `typst-assets` (feature `bundled-fonts`), registered once
//! with a stable index mapping (`FontBook` order == `fonts` order).
//!
//! `today()` returns the real local date (UTC-based, offset applied), or a
//! fixed injected date in tests for reproducibility.

use std::collections::HashMap;

use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, PathError, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt};
use typst::World;

/// A normalized absolute virtual path, plus its interned [`FileId`].
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct VPath {
    id: FileId,
}

/// Error returned by path normalization.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum PathReject {
    /// Empty path.
    Empty,
    /// Not rooted at `/`.
    Relative,
    /// The path is the virtual root itself.
    Root,
    /// Contains a NUL byte.
    Nul,
    /// A `.typ` source file is not valid UTF-8.
    NotUtf8,
    /// Rejected by `VirtualPath` (backslash or `..` escaping the root).
    Invalid,
}

/// Normalize an absolute virtual path per design D6.
///
/// Rules: must be non-empty, start with `/`, not be `/` itself, contain no
/// NUL bytes and no backslashes; `..` may not escape the root. Duplicate
/// separators and `.` components are folded. Returns the interned FileId
/// (identical spellings that normalize identically share one id).
pub fn normalize_vpath(path: &str) -> Result<VPath, PathReject> {
    if path.is_empty() {
        return Err(PathReject::Empty);
    }
    if !path.starts_with('/') {
        return Err(PathReject::Relative);
    }
    if path.contains('\0') {
        return Err(PathReject::Nul);
    }
    if path == "/" {
        return Err(PathReject::Root);
    }
    let vpath = VirtualPath::new(path).map_err(|err: PathError| match err {
        PathError::Escapes | PathError::Backslash => PathReject::Invalid,
    })?;
    if vpath.file_name().is_none() {
        return Err(PathReject::Root);
    }
    Ok(VPath {
        id: RootedPath::new(VirtualRoot::Project, vpath).intern(),
    })
}

impl VPath {
    pub fn file_id(self) -> FileId {
        self.id
    }

    /// Display path with a leading slash (e.g. `/main.typ`).
    pub fn display(self) -> String {
        self.id.vpath().get_with_slash().to_string()
    }
}

/// The in-memory virtual filesystem world (design D6).
pub struct VfsWorld {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    main: Option<FileId>,
    sources: HashMap<FileId, Source>,
    blobs: HashMap<FileId, Bytes>,
    versions: HashMap<FileId, u64>,
    today_override: Option<Datetime>,
}

impl VfsWorld {
    pub fn new() -> Self {
        let fonts: Vec<Font> = typst_assets::fonts()
            .filter_map(|data| Font::new(Bytes::new(data), 0))
            .collect();
        let book = FontBook::from_fonts(&fonts);
        Self {
            library: LazyHash::new(Library::default()),
            book: LazyHash::new(book),
            fonts,
            main: None,
            sources: HashMap::new(),
            blobs: HashMap::new(),
            versions: HashMap::new(),
            today_override: None,
        }
    }

    pub fn font_count(&self) -> usize {
        self.fonts.len()
    }

    /// Inject a fixed date for `today()` (tests); `None` restores real time.
    pub fn set_today_override(&mut self, date: Option<Datetime>) {
        self.today_override = date;
    }

    /// Insert or replace a file. `.typ` files must be valid UTF-8 and become
    /// sources; everything else is stored as raw bytes (binary files).
    /// Replacing content bumps the file's version (reserved for future
    /// incremental compilation).
    pub fn set_file(&mut self, path: VPath, data: &[u8]) -> Result<(), PathReject> {
        let id = path.file_id();
        let version = self.versions.get(&id).copied().unwrap_or(0) + 1;
        self.versions.insert(id, version);
        if path_is_typst_source(&path.display()) {
            let text = std::str::from_utf8(data).map_err(|_| PathReject::NotUtf8)?;
            self.sources.insert(id, Source::new(id, text.to_string()));
            self.blobs.remove(&id);
        } else {
            self.sources.remove(&id);
            self.blobs.insert(id, Bytes::new(data.to_vec()));
        }
        Ok(())
    }

    /// Remove a file from the VFS. Returns whether it existed.
    pub fn remove_file(&mut self, path: VPath) -> bool {
        let id = path.file_id();
        let existed = self.sources.remove(&id).is_some() | self.blobs.remove(&id).is_some();
        self.versions.remove(&id);
        existed
    }

    /// Record the main file path. The file does not need to exist yet;
    /// [`VfsWorld::compile`] reports `E_MAIN_NOT_SET` semantics via
    /// [`VfsWorld::main_is_available`].
    pub fn set_main(&mut self, path: VPath) {
        self.main = Some(path.file_id());
    }

    pub fn main(&self) -> Option<FileId> {
        self.main
    }

    /// Whether a main file is set AND present in the VFS.
    pub fn main_is_available(&self) -> bool {
        self.main.is_some_and(|id| self.sources.contains_key(&id))
    }

    /// Compile the main file. On success returns the document plus the
    /// warnings; on failure returns errors. (The caller stores diagnostics
    /// and the last-good document per design D9.)
    pub fn compile(
        &self,
    ) -> Result<
        (typst_layout::PagedDocument, Vec<typst::diag::SourceDiagnostic>),
        Vec<typst::diag::SourceDiagnostic>,
    > {
        let warned = typst::compile::<typst_layout::PagedDocument>(self);
        match warned.output {
            Ok(document) => Ok((document, warned.warnings.into_iter().collect())),
            Err(errors) => Err(errors.into_iter().collect()),
        }
    }

    /// Resolve a span's file and byte range for diagnostics (D7).
    pub fn source(&self, id: FileId) -> Option<&Source> {
        self.sources.get(&id)
    }
}

fn path_is_typst_source(display_path: &str) -> bool {
    display_path.ends_with(".typ")
}

impl World for VfsWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        // Typst's World trait requires a main FileId even before set_main;
        // use a detached placeholder id that is not in the VFS. Compile is
        // gated by `main_is_available` in the ABI layer.
        self.main.unwrap_or_else(|| {
            RootedPath::new(
                VirtualRoot::Project,
                VirtualPath::new("main.typ").expect("static path is valid"),
            )
            .intern()
        })
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        self.sources
            .get(&id)
            .cloned()
            .ok_or_else(|| FileError::NotFound(self.display_path_of(id).into()))
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        self.blobs
            .get(&id)
            .cloned()
            .ok_or_else(|| FileError::NotFound(self.display_path_of(id).into()))
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }

    fn today(&self, offset: Option<Duration>) -> Option<Datetime> {
        if let Some(fixed) = self.today_override {
            return Some(fixed);
        }
        let hours = offset.map(|d| d.hours()).unwrap_or(0.0) as i64;
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs() as i64;
        let shifted = secs + hours * 3600;
        let days = shifted.div_euclid(86_400);
        let (year, month, day) = civil_from_days(days);
        Datetime::from_ymd(year, month, day)
    }
}

impl VfsWorld {
    fn display_path_of(&self, id: FileId) -> String {
        id.vpath().get_with_slash().to_string()
    }
}

/// Convert days since the Unix epoch to a (year, month, day) civil date.
/// Howard Hinnant's `civil_from_days` algorithm.
fn civil_from_days(z: i64) -> (i32, u8, u8) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    (year as i32, m as u8, d as u8)
}
