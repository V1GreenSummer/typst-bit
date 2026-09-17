//! Bundled Typst package registration tests (change bundle-preview-packages).

use std::str::FromStr;

use typst::syntax::package::PackageSpec;
use typst_abi::world::{normalize_vpath, VfsWorld};

const SYNTHETIC_SPEC: &str = "@preview/hello:0.1.0";
const SYNTHETIC_MANIFEST: &[u8] = br#"[package]
name = "hello"
version = "0.1.0"
entrypoint = "src/lib.typ"
"#;

fn world_with_synthetic_package(files: &[(&str, &[u8])], main: &str) -> VfsWorld {
    let mut world = VfsWorld::new();
    let spec = PackageSpec::from_str(SYNTHETIC_SPEC).unwrap();
    for (path, data) in files {
        world.set_package_file(&spec, path, data).unwrap();
    }
    let main_path = normalize_vpath("/main.typ").unwrap();
    world.set_file(main_path, main.as_bytes()).unwrap();
    world.set_main(main_path);
    world
}

#[test]
fn bundled_package_import_compiles() {
    let world = world_with_synthetic_package(
        &[
            ("typst.toml", SYNTHETIC_MANIFEST),
            ("src/lib.typ", b"#let greet() = [Hello from the package]"),
        ],
        "#import \"@preview/hello:0.1.0\": greet\n#greet()",
    );
    let (document, warnings) = world.compile().expect("package import should compile");
    assert_eq!(document.pages().len(), 1);
    assert!(
        warnings.is_empty(),
        "{:?}",
        warnings.iter().map(|w| &w.message).collect::<Vec<_>>()
    );
}

#[test]
fn unbundled_package_reports_file_not_found() {
    let world = world_with_synthetic_package(&[], "#import \"@preview/missing:1.0.0\": x\n#x");
    let errors = world.compile().expect_err("unbundled package must fail");
    assert!(
        errors.iter().any(|e| e.message.contains("file not found")),
        "{:?}",
        errors.iter().map(|e| &e.message).collect::<Vec<_>>()
    );
}

#[test]
fn tiaoma_package_compiles_with_plugin() {
    let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../app/typstbit/web_wasm/packages/preview/tiaoma/0.3.0");
    let spec = PackageSpec::from_str("@preview/tiaoma:0.3.0").unwrap();
    let mut world = VfsWorld::new();
    for name in ["typst.toml", "lib.typ", "zint_typst_plugin.wasm"] {
        let data = std::fs::read(base.join(name))
            .unwrap_or_else(|_| panic!("missing {name}; run tools/vendor-typst-package.py first"));
        world.set_package_file(&spec, name, &data).unwrap();
    }
    let main = normalize_vpath("/main.typ").unwrap();
    world
        .set_file(
            main,
            b"#import \"@preview/tiaoma:0.3.0\": qrcode\n#qrcode(\"https://typst.app\", width: 2em)",
        )
        .unwrap();
    world.set_main(main);
    let (document, warnings) = world.compile().expect("tiaoma import should compile");
    assert_eq!(document.pages().len(), 1);
    assert!(
        warnings.is_empty(),
        "{:?}",
        warnings.iter().map(|w| &w.message).collect::<Vec<_>>()
    );
}
