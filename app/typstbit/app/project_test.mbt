///|
test "project: add, edit, remove and active fallback" {
  let project = @app.Project::new("= A")
  assert_eq(project.active, "/main.typ")
  assert_eq(project.active_text(), "= A")
  assert_eq(project.add_file("/lib.typ", "#let x = 1"), Ok(()))
  assert_eq(project.add_file("/lib.typ", ""), Err(DuplicatePath("/lib.typ")))
  assert_eq(project.add_file("lib.typ", ""), Err(InvalidPath("lib.typ")))
  assert_eq(project.add_file("/a/../b", ""), Err(InvalidPath("/a/../b")))
  assert_eq(project.add_file("/a//b", ""), Err(InvalidPath("/a//b")))
  assert_eq(project.add_file("/images/a.png", "", kind=BinaryFile), Ok(()))
  assert_true(project.has("/lib.typ"))
  assert_eq(project.text("/lib.typ"), Some("#let x = 1"))
  assert_eq(project.text("/images/a.png"), None)
  assert_true(project.set_text("/lib.typ", "#let y = 1"))
  assert_eq(project.text("/lib.typ"), Some("#let y = 1"))
  assert_false(project.set_text("/missing.typ", "x"))
  assert_true(project.add_folder("/images"))
  assert_false(project.add_folder("/images"))
  assert_eq(project.paths(), ["/images/a.png", "/lib.typ", "/main.typ"])
  project.active = "/lib.typ"
  assert_true(project.remove("/lib.typ") is Some(_))
  assert_eq(project.active, "/main.typ")
  assert_eq(project.active_text(), "= A")
  assert_true(project.remove("/main.typ") is Some(_))
  assert_eq(project.active, "/images/a.png")
}

///|
test "project: image path detection" {
  assert_true(@app.is_image_path("/images/a.PNG"))
  assert_true(@app.is_image_path("/x/y.jpeg"))
  assert_true(@app.is_image_path("/a.webp"))
  assert_false(@app.is_image_path("/a.typ"))
  assert_false(@app.is_image_path("/png"))
}

///|
test "project: json round trip" {
  let project = @app.Project::new("= A")
  project.add_file("/lib.typ", "#let x = 1") |> ignore
  project.add_folder("/images") |> ignore
  project.active = "/lib.typ"
  let restored = @app.Project::from_json_string(project.to_json_string(), "fallback")
  assert_eq(restored, project)
  let broken = @app.Project::from_json_string("{not json", "fallback")
  assert_eq(broken.active, "/main.typ")
  assert_eq(broken.active_text(), "fallback")
  let partial = @app.Project::from_json_string(
    "{\"files\":[{\"path\":\"/lib.typ\",\"kind\":\"text\",\"text\":\"#let z = 2\"}],\"active\":\"/lib.typ\"}",
    "fallback",
  )
  assert_eq(partial.active, "/lib.typ")
  assert_eq(partial.active_text(), "#let z = 2")
  assert_true(partial.has("/main.typ"))
}
