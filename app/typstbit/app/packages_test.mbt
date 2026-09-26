///|
test "packages: parse specs" {
  match @app.parse_spec("@preview/tiaoma:0.3.0") {
    Some(spec) => {
      assert_eq(spec.ns, "preview")
      assert_eq(spec.name, "tiaoma")
      assert_eq(spec.version, "0.3.0")
      assert_eq(spec.text, "@preview/tiaoma:0.3.0")
    }
    None => fail("expected a spec")
  }
  assert_eq(@app.parse_spec("@a/b:1.2.3.4").unwrap().version, "1.2.3")
  assert_eq(@app.parse_spec("@a/b:1.2.3.4").unwrap().text, "@a/b:1.2.3")
  assert_eq(@app.parse_spec("@a/b:1.2"), None)
  assert_eq(@app.parse_spec("@A/b:1.2.3"), None)
  assert_eq(@app.parse_spec("@a/b:1..2"), None)
  assert_eq(@app.parse_spec("preview/a:1.2.3"), None)
  assert_eq(@app.parse_spec("@a/b:1.2.3-rc").unwrap().version, "1.2.3")
}

///|
test "packages: scan sources uniquely in order" {
  let source = "#import \"@preview/tiaoma:0.3.0\": qrcode\n#import \"@preview/tiaoma:0.3.0\": again\n#import \"@preview/tablex:0.0.8\": tablex\nplain @not/a:spec"
  assert_eq(@app.package_specs_in_source(source), [
    "@preview/tiaoma:0.3.0", "@preview/tablex:0.0.8",
  ])
  assert_eq(@app.package_specs_in_source("plain text"), [])
  assert_eq(@app.package_specs_in_source("@preview/a:1.0.0@preview/b:2.0.0"), [
    "@preview/a:1.0.0", "@preview/b:2.0.0",
  ])
}

///|
test "packages: missing manifest entries" {
  let manifest = ["@preview/tiaoma:0.3.0"]
  assert_eq(@app.missing_packages(["@preview/tiaoma:0.3.0"], manifest, []), [
    "@preview/tiaoma:0.3.0",
  ])
  assert_eq(
    @app.missing_packages(["@preview/tiaoma:0.3.0"], manifest, [
      "@preview/tiaoma:0.3.0",
    ]),
    [],
  )
  assert_eq(@app.missing_packages(["@preview/other:1.0.0"], manifest, []), [])
}
