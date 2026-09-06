//! Task 6.1: virtual FS World tests (design D6).

use typst::foundations::Datetime;
use typst_abi::world::{normalize_vpath, PathReject};

fn world_with_main(text: &str) -> typst_abi::world::VfsWorld {
    let mut world = typst_abi::world::VfsWorld::new();
    let path = normalize_vpath("/main.typ").expect("valid path");
    world.set_file(path, text.as_bytes()).expect("set file");
    world.set_main(path);
    world
}

#[test]
fn compiles_hello_typst() {
    let world = world_with_main("Hello, typst!");
    assert!(world.font_count() > 0, "fonts present");
    let (document, warnings) = world.compile().expect("compile should succeed");
    assert_eq!(document.pages().len(), 1);
    assert!(warnings.is_empty());
}

#[test]
fn import_of_missing_file_reports_file_not_found() {
    let world = world_with_main("#import \"missing.typ\"\nHello");
    let err = world.compile().expect_err("import should fail");
    assert_eq!(err.len(), 1);
    assert!(
        err[0].message.contains("file not found"),
        "unexpected message: {}",
        err[0].message
    );
}

#[test]
fn import_of_added_file_succeeds() {
    let mut world = typst_abi::world::VfsWorld::new();
    let lib = normalize_vpath("/lib.typ").unwrap();
    world
        .set_file(lib, b"#let answer = 42")
        .expect("lib set ok");
    let main = normalize_vpath("/main.typ").unwrap();
    world
        .set_file(main, b"#import \"lib.typ\": answer\n#answer")
        .expect("main set ok");
    world.set_main(main);
    let (document, _) = world.compile().expect("compile should succeed");
    assert_eq!(document.pages().len(), 1);
}

#[test]
fn path_normalization_rejects() {
    assert_eq!(normalize_vpath(""), Err(PathReject::Empty));
    assert_eq!(normalize_vpath("main.typ"), Err(PathReject::Relative));
    assert_eq!(normalize_vpath("a/b.typ"), Err(PathReject::Relative));
    assert_eq!(normalize_vpath("/"), Err(PathReject::Root));
    assert_eq!(normalize_vpath("/a/../../b.typ"), Err(PathReject::Invalid));
    assert_eq!(normalize_vpath("/.."), Err(PathReject::Invalid));
    assert_eq!(normalize_vpath("/a\\b.typ"), Err(PathReject::Invalid));
    assert_eq!(normalize_vpath("/\0bad"), Err(PathReject::Nul));
}

#[test]
fn path_normalization_folds_and_interns() {
    // Duplicate separators and inner `.` fold to the same interned id.
    let a = normalize_vpath("/a//./b.typ").unwrap();
    let b = normalize_vpath("/a/b.typ").unwrap();
    assert_eq!(a.file_id(), b.file_id());
    assert_eq!(a.display(), "/a/b.typ");
    // `..` that stays inside the root is fine.
    let c = normalize_vpath("/a/x/../b.typ").unwrap();
    assert_eq!(c.file_id(), b.file_id());
}

#[test]
fn main_semantics() {
    let mut world = typst_abi::world::VfsWorld::new();
    assert!(!world.main_is_available(), "no main yet");

    let main = normalize_vpath("/main.typ").unwrap();
    world.set_main(main);
    assert!(
        !world.main_is_available(),
        "main set but file not in VFS yet"
    );

    world.set_file(main, b"Hi").unwrap();
    assert!(world.main_is_available());
}

#[test]
fn set_file_replacement_invalidates_content() {
    let mut world = world_with_main("One");
    let (document, _) = world.compile().expect("first compile");
    assert_eq!(document.pages().len(), 1);

    let main = normalize_vpath("/main.typ").unwrap();
    world.set_file(main, b"One\n#pagebreak()\nTwo").unwrap();
    let (document, _) = world.compile().expect("second compile");
    assert_eq!(document.pages().len(), 2, "new content must take effect");
}

#[test]
fn remove_file_takes_effect() {
    let mut world = typst_abi::world::VfsWorld::new();
    let lib = normalize_vpath("/lib.typ").unwrap();
    world.set_file(lib, b"#let x = 1").unwrap();
    let main = normalize_vpath("/main.typ").unwrap();
    world.set_file(main, b"#import \"lib.typ\": x\n#x").unwrap();
    world.set_main(main);
    assert!(world.compile().is_ok());

    assert!(world.remove_file(lib));
    let err = world.compile().expect_err("import target removed");
    assert!(err[0].message.contains("file not found"));
    // Removing again is a no-op.
    assert!(!world.remove_file(lib));
}

#[test]
fn binary_files_are_stored_as_bytes() {
    use typst::World;
    let mut world = typst_abi::world::VfsWorld::new();
    let png = normalize_vpath("/img.bin").unwrap();
    world.set_file(png, &[0u8, 1, 2, 255]).unwrap();
    let id = png.file_id();
    let bytes = world.file(id).expect("binary file readable");
    assert_eq!(bytes.as_ref(), &[0u8, 1, 2, 255]);
}

#[test]
fn non_utf8_typ_source_is_rejected() {
    let mut world = typst_abi::world::VfsWorld::new();
    let main = normalize_vpath("/main.typ").unwrap();
    let err = world.set_file(main, &[0xff, 0xfe, 0x00]).unwrap_err();
    assert_eq!(err, typst_abi::world::PathReject::NotUtf8);
}

#[test]
fn today_is_injectable_and_real() {
    let mut world = typst_abi::world::VfsWorld::new();
    world.set_today_override(Some(Datetime::from_ymd(2026, 1, 1).unwrap()));
    let fixed = <typst_abi::world::VfsWorld as typst::World>::today(&world, None);
    assert_eq!(fixed, Some(Datetime::from_ymd(2026, 1, 1).unwrap()));

    world.set_today_override(None);
    let real = <typst_abi::world::VfsWorld as typst::World>::today(&world, None);
    assert!(real.is_some(), "real date available on native");
}

#[test]
fn today_override_flows_into_compile() {
    // `datetime.today().year()` compiled under an injected fixed date.
    let mut world = world_with_main("#datetime.today().year()");
    world.set_today_override(Some(Datetime::from_ymd(2020, 6, 15).unwrap()));
    let (document, _) = world.compile().expect("compile ok");
    assert_eq!(document.pages().len(), 1);
}
