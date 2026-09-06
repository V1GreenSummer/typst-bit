//! Task 6.4: frozen C ABI round-trip tests (design D9).
//!
//! All tests serialize on one mutex: the ABI is single-instance and shares
//! module-level state.

use std::sync::{Mutex, MutexGuard, OnceLock};

use typst_abi::abi::*;

fn lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        LOCK.set(Mutex::new(())).ok();
    });
    LOCK.get().unwrap().lock().unwrap()
}

fn out_len() -> u32 {
    unsafe { *typst_abi_out_len_ptr() }
}

/// Write `bytes` into a fresh arena allocation; returns (ptr, len).
fn put(bytes: &[u8]) -> (usize, usize) {
    let ptr = typst_abi_alloc(bytes.len());
    assert!(!ptr.is_null(), "alloc must succeed");
    unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len()) };
    (ptr as usize, bytes.len())
}

/// set_file via the arena round-trip.
fn set_file(path: &str, data: &[u8]) -> u32 {
    let (p, plen) = put(path.as_bytes());
    let (d, dlen) = put(data);
    unsafe { typst_abi_set_file(p, plen, d, dlen) }
}

fn set_main(path: &str) -> u32 {
    let (p, plen) = put(path.as_bytes());
    unsafe { typst_abi_set_main(p, plen) }
}

fn compile() -> u32 {
    unsafe { typst_abi_compile() }
}

fn error_json() -> Option<String> {
    let ptr = unsafe { typst_abi_error_json() };
    if ptr == 0 {
        return None;
    }
    let len = out_len() as usize;
    Some(
        unsafe { std::slice::from_raw_parts(ptr as *const u8, len) }
            .to_vec(),
    )
    .map(|v| String::from_utf8(v).expect("json is utf-8"))
}

fn render_png(page: u32, scale_milli: u32) -> Option<Vec<u8>> {
    let ptr = unsafe { typst_abi_render_page_png(page, scale_milli) };
    if ptr == 0 {
        return None;
    }
    let len = out_len() as usize;
    Some(unsafe { std::slice::from_raw_parts(ptr as *const u8, len) }.to_vec())
}

/// Compile a fixed main source; assumes the lock is held.
fn compile_ok(text: &str) {
    assert_eq!(set_file("/main.typ", text.as_bytes()), OK);
    assert_eq!(set_main("/main.typ"), OK);
    assert_eq!(compile(), OK, "compile of {text:?} should succeed");
}

#[test]
fn success_path_round_trip() {
    let _guard = lock();
    assert_eq!(typst_abi_reset(), OK);
    compile_ok("Hello, typst!\n#pagebreak()\nSecond");
    assert_eq!(typst_abi_page_count(), 2);
    assert_eq!(error_json(), None, "no diagnostics on success");

    let png = render_png(0, 1000).expect("page 0 renders");
    assert_eq!(&png[0..8], b"\x89PNG\r\n\x1a\n");
    let w = u32::from_be_bytes(png[16..20].try_into().unwrap());
    let h = u32::from_be_bytes(png[20..24].try_into().unwrap());
    assert_eq!((w, h), (595, 842));
}

#[test]
fn compile_before_set_main_is_e_main_not_set() {
    let _guard = lock();
    assert_eq!(typst_abi_reset(), OK);
    assert_eq!(compile(), E_MAIN_NOT_SET);
    // Main set but file not in VFS.
    assert_eq!(set_main("/main.typ"), OK);
    assert_eq!(compile(), E_MAIN_NOT_SET);
}

#[test]
fn compile_errors_are_reported_and_last_good_survives() {
    let _guard = lock();
    assert_eq!(typst_abi_reset(), OK);
    compile_ok("Good");
    assert_eq!(typst_abi_page_count(), 1);

    // Break the source: syntax error.
    assert_eq!(set_file("/main.typ", b"Ok\n\n#let x = "), OK);
    assert_eq!(compile(), E_COMPILE_ERRORS);
    let json = error_json().expect("diagnostics available");
    assert!(json.contains("\"severity\":\"error\""));
    assert!(json.contains("/main.typ"));
    assert!(json.contains("\"line\":3"), "syntax error carries 1-based line");

    // Last-good document remains accessible.
    assert_eq!(typst_abi_page_count(), 1);
    assert!(render_png(0, 1000).is_some(), "last-good page renders");

    // Fix and recompile.
    assert_eq!(set_file("/main.typ", b"Good\n#pagebreak()\nMore"), OK);
    assert_eq!(compile(), OK);
    assert_eq!(typst_abi_page_count(), 2);
    assert_eq!(error_json(), None, "diagnostics cleared after success");
}

#[test]
fn page_out_of_range_and_no_document() {
    let _guard = lock();
    assert_eq!(typst_abi_reset(), OK);
    // No document at all.
    assert_eq!(typst_abi_page_count(), 0);
    assert_eq!(unsafe { typst_abi_render_page_png(0, 1000) }, 0);

    compile_ok("One");
    assert_eq!(unsafe { typst_abi_render_page_png(1, 1000) }, 0);
    assert_eq!(unsafe { typst_abi_render_page_png(0, 0) }, 0, "zero scale");
    assert!(render_png(0, 1000).is_some());
}

#[test]
fn invalid_arguments_per_category_no_trap() {
    let _guard = lock();
    assert_eq!(typst_abi_reset(), OK);
    compile_ok("Stable");

    // 1. Relative path.
    assert_eq!(set_file("main.typ", b"x"), E_INVALID_ARG);
    // 2. Path escaping the root.
    assert_eq!(set_file("/a/../../x.typ", b"x"), E_INVALID_ARG);
    // 3. Backslash in path.
    assert_eq!(set_file("/a\\b.typ", b"x"), E_INVALID_ARG);
    // 4. Root itself.
    assert_eq!(set_file("/", b"x"), E_INVALID_ARG);
    // 5. Empty path.
    assert_eq!(set_file("", b"x"), E_INVALID_ARG);
    // 6. NUL in path.
    assert_eq!(set_file("/a\0b.typ", b"x"), E_INVALID_ARG);
    // 7. Non-UTF-8 path.
    let (p, plen) = put(&[0xff, 0xfe]);
    let (d, dlen) = put(b"x");
    assert_eq!(
        unsafe { typst_abi_set_file(p, plen, d, dlen) },
        E_INVALID_ARG
    );
    // 8. Non-UTF-8 .typ source data.
    assert_eq!(set_file("/main.typ", &[0xff, 0xfe, 0xfd]), E_INVALID_ARG);
    // 9. Wild pointer (outside the arena).
    let wild = 0xdead_beefusize;
    assert_eq!(
        unsafe { typst_abi_set_file(wild, 4, wild, 4) },
        E_INVALID_ARG
    );
    // 10. Pointer + length arithmetic overflow.
    let (d, dlen) = put(b"x");
    assert_eq!(
        unsafe { typst_abi_set_file(usize::MAX, 2, d, dlen) },
        E_INVALID_ARG
    );
    assert_eq!(
        unsafe { typst_abi_set_file(d, dlen, usize::MAX, 2) },
        E_INVALID_ARG
    );
    // 11. Arena-internal but out of the allocated window (beyond top).
    let (p, plen) = put("/main.typ".as_bytes());
    assert_eq!(
        unsafe { typst_abi_set_file(p, plen + 64 * 1024 * 1024, d, dlen) },
        E_INVALID_ARG,
        "length far beyond the allocation must not trap"
    );
    // 12. Same for set_main / remove_file wild pointers.
    assert_eq!(unsafe { typst_abi_set_main(wild, 8) }, E_INVALID_ARG);
    assert_eq!(unsafe { typst_abi_remove_file(wild, 8) }, E_INVALID_ARG);

    // The valid state still compiles: no corruption from rejected calls.
    assert_eq!(compile(), OK);
    assert_eq!(typst_abi_page_count(), 1);
}

#[test]
fn zero_length_inputs_are_accepted() {
    let _guard = lock();
    assert_eq!(typst_abi_reset(), OK);
    // Empty binary file at a legal path (len 0 short-circuits).
    assert_eq!(set_file("/empty.bin", b""), OK);
    // Compile with a valid main still works afterwards.
    compile_ok("Hi");
}

#[test]
fn output_validity_window() {
    let _guard = lock();
    assert_eq!(typst_abi_reset(), OK);
    compile_ok("A\n#pagebreak()\nB");

    // PNG pointer stays valid across compile (compile is not a producing
    // call for outputs) and across further arena use...
    let png1 = render_png(0, 1000).expect("render 1");
    let ptr1 = unsafe { typst_abi_render_page_png(0, 1000) };
    assert_ne!(ptr1, 0);
    let len1 = out_len() as usize;
    assert_eq!(compile(), OK, "recompile ok");
    let bytes1 =
        unsafe { std::slice::from_raw_parts(ptr1 as *const u8, len1) }.to_vec();
    assert_eq!(bytes1, png1, "output survives a later compile");

    // ...but a second same-type producing call invalidates the old pointer
    // (we only assert the new result is correct; the old one is UB to read).
    let png2 = render_png(1, 2000).expect("render 2");
    assert_eq!(&png2[0..8], b"\x89PNG\r\n\x1a\n");
    assert_ne!(png2.len(), png1.len(), "different page and scale");

    // JSON window is independent of the PNG window.
    assert_eq!(set_file("/main.typ", b"#let x = "), OK);
    assert_eq!(compile(), E_COMPILE_ERRORS);
    let json1 = error_json().expect("json 1");
    let json2 = error_json().expect("json 2");
    assert_eq!(json1, json2, "idempotent reads of same diagnostics");
    assert!(json2.contains("\"severity\":\"error\""));
}

#[test]
fn arena_is_reset_at_compile_entry() {
    let _guard = lock();
    assert_eq!(typst_abi_reset(), OK);
    // Allocate an input, use it, compile (resets arena), then the stale
    // pointer must be rejected rather than dereferenced.
    let (p, plen) = put("/main.typ".as_bytes());
    let (d, dlen) = put(b"Stale");
    assert_eq!(unsafe { typst_abi_set_file(p, plen, d, dlen) }, OK);
    assert_eq!(set_main("/main.typ"), OK);
    assert_eq!(compile(), OK);
    // Stale pointers from before the compile are now out of bounds.
    assert_eq!(
        unsafe { typst_abi_set_file(p, plen, d, dlen) },
        E_INVALID_ARG,
        "arena was reset at compile entry; stale pointers rejected"
    );
}

#[test]
fn reset_clears_everything() {
    let _guard = lock();
    compile_ok("#pagebreak() Twice");
    assert_eq!(typst_abi_page_count(), 2);
    assert_eq!(typst_abi_reset(), OK);
    assert_eq!(typst_abi_page_count(), 0);
    assert_eq!(compile(), E_MAIN_NOT_SET);
    assert_eq!(error_json(), None);
}

#[test]
fn remove_file_round_trip() {
    let _guard = lock();
    assert_eq!(typst_abi_reset(), OK);
    assert_eq!(set_file("/lib.typ", b"#let x = 1"), OK);
    assert_eq!(set_file("/main.typ", b"#import \"lib.typ\": x\n#x"), OK);
    assert_eq!(set_main("/main.typ"), OK);
    assert_eq!(compile(), OK);

    let (p, plen) = put(b"/lib.typ");
    assert_eq!(unsafe { typst_abi_remove_file(p, plen) }, OK);
    assert_eq!(compile(), E_COMPILE_ERRORS);
    assert!(error_json().unwrap().contains("file not found"));
}

#[test]
fn alloc_cap_is_enforced() {
    let _guard = lock();
    assert_eq!(typst_abi_reset(), OK);
    // Over-cap request rejected without allocating.
    assert!(typst_abi_alloc(64 * 1024 * 1024 + 8).is_null());
    // Zero-length allocation is a valid non-null pointer.
    assert!(!typst_abi_alloc(0).is_null());
}

#[test]
fn multi_file_vfs_via_abi() {
    let _guard = lock();
    assert_eq!(typst_abi_reset(), OK);
    assert_eq!(set_file("/chapters/one.typ", b"#lorem(20)"), OK);
    assert_eq!(set_file("/chapters/two.typ", b"#lorem(20)"), OK);
    assert_eq!(
        set_file(
            "/main.typ",
            b"#include \"chapters/one.typ\"\n#include \"chapters/two.typ\""
        ),
        OK
    );
    assert_eq!(set_main("/main.typ"), OK);
    assert_eq!(compile(), OK);
    assert_eq!(typst_abi_page_count(), 1);
}
