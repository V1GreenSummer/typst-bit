///|
// Native Typst.bit CLI: the MoonBit application core linked directly against
// the Rust typst-abi static library (P4). Mirrors tools/typstbit-cli.mjs:
//   typstbit compile|pdf|svg|png|outline <file.typ> [-o out] [--page N] [--scale 1.5]

///|
#borrow(path, data)
extern "C" fn typstbit_set_file(path : Bytes, data : Bytes) -> Int64 = "typstbit_set_file"

///|
#borrow(spec, path, data)
extern "C" fn typstbit_set_package_file(
  spec : Bytes,
  path : Bytes,
  data : Bytes,
) -> Int64 = "typstbit_set_package_file"

///|
#borrow(path)
extern "C" fn typstbit_set_main(path : Bytes) -> Int64 = "typstbit_set_main"

///|
extern "C" fn typstbit_compile() -> Int64 = "typstbit_compile"

///|
extern "C" fn typstbit_page_count() -> Int64 = "typstbit_page_count"

///|
extern "C" fn typstbit_error_json() -> Bytes = "typstbit_error_json"

///|
extern "C" fn typstbit_export_pdf() -> Bytes = "typstbit_export_pdf"

///|
extern "C" fn typstbit_export_svg(page : Int64) -> Bytes = "typstbit_export_svg"

///|
extern "C" fn typstbit_render_page_png(
  page : Int64,
  scale_milli : Int64,
) -> Bytes = "typstbit_render_page_png"

///|
extern "C" fn exit(code : Int) -> Unit = "exit"

///|
let text_ext : Array[String] = [".typ", ".txt", ".md", ".csv", ".json"]

///|
let asset_ext : Array[String] = [
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
]

///|
fn path_is_absolute(path : String) -> Bool {
  path.has_prefix("/")
}

///|
fn path_join(dir : String, name : String) -> String {
  if path_is_absolute(name) {
    name
  } else if dir == "" || dir.has_suffix("/") {
    "\{dir}\{name}"
  } else {
    "\{dir}/\{name}"
  }
}

///|
fn path_dirname(path : String) -> String {
  let mut last = -1
  for i = 0; i < path.length(); i = i + 1 {
    if path.unsafe_get(i) == 47 {
      last = i
    }
  }
  if last <= 0 {
    "/"
  } else {
    path[:last].to_owned()
  }
}

///|
fn path_basename(path : String) -> String {
  let mut last = -1
  for i = 0; i < path.length(); i = i + 1 {
    if path.unsafe_get(i) == 47 {
      last = i
    }
  }
  path[last + 1:path.length()].to_owned()
}

///|
fn path_extname(path : String) -> String {
  let base = path_basename(path)
  let mut dot = -1
  for i = 0; i < base.length(); i = i + 1 {
    if base.unsafe_get(i) == 46 {
      dot = i
    }
  }
  if dot <= 0 {
    ""
  } else {
    base[dot:base.length()].to_owned().to_lower()
  }
}

///|
fn path_resolve(path : String) -> String {
  if path_is_absolute(path) {
    path
  } else {
    let cwd = @env.current_dir().unwrap_or(".")
    path_join(cwd, path)
  }
}

///|
fn path_relative(path : String, base : String) -> String {
  let prefix = base + "/"
  if path.has_prefix(prefix) {
    path[prefix.length():path.length()].to_owned()
  } else {
    path
  }
}

///|
fn usage() -> Unit {
  println(
    "用法:\n  typstbit compile <file.typ>\n  typstbit pdf     <file.typ> [-o out.pdf]\n  typstbit svg     <file.typ> [-o out.svg] [--page N]\n  typstbit png     <file.typ> [-o out.png] [--page N] [--scale 1.5]\n  typstbit outline <file.typ>\n\n项目内同目录的 .typ/图片会自动注册进 VFS，支持 #import \"lib.typ\"。",
  )
}

///|
fn fail(message : String) -> Unit {
  println(message)
  usage()
  exit(1)
}

///|
fn json_string(fields : Map[String, Json], key : String) -> String? {
  match fields.get(key) {
    Some(Json::String(value)) => Some(value)
    _ => None
  }
}

///|
fn parse_object(text : String) -> Map[String, Json]? {
  let parsed : Json? = Some(@json.parse(text)) catch { _ => None }
  match parsed {
    Some(Json::Object(map)) => Some(map)
    _ => None
  }
}

///|
fn bytes_to_utf16(bytes : Bytes) -> String {
  @utf8.decode_lossy(bytes)
}

///|
fn utf8(text : String) -> Bytes {
  @utf8.encode(text)
}

///|
fn set_file(vpath : String, data : Bytes) -> Unit {
  let status = typstbit_set_file(utf8(vpath), data)
  if status != 0 {
    println("set_file \{vpath} -> status \{status}")
    exit(1)
  }
}

///|
fn register_packages(dir : String) -> Unit {
  let manifest_path = path_join(dir, "manifest.json")
  let text : String? = Some(@fs.read_file_to_string(manifest_path)) catch {
    _ => None
  }
  match text {
    Some(text) =>
      match parse_object(text) {
        Some(root) =>
          match root.get("packages") {
            Some(Json::Array(entries)) =>
              for entry in entries {
                match entry {
                  Json::Object(fields) => register_package_entry(dir, fields)
                  _ => ()
                }
              }
            _ => ()
          }
        None => ()
      }
    None => ()
  }
}

///|
fn register_package_entry(dir : String, fields : Map[String, Json]) -> Unit {
  let spec = json_string(fields, "spec")
  let root = json_string(fields, "root")
  match (spec, root) {
    (Some(spec), Some(root)) =>
      match fields.get("files") {
        Some(Json::Array(files)) =>
          for file in files {
            match file {
              Json::String(file) => {
                let disk = path_join(path_join(dir, root), file)
                let data : Bytes? = Some(@fs.read_file_to_bytes(disk)) catch {
                  _ => None
                }
                match data {
                  Some(bytes) => {
                    let status = typstbit_set_package_file(
                      utf8(spec),
                      utf8(file),
                      bytes,
                    )
                    if status != 0 {
                      println(
                        "set_package_file \{spec}/\{file} -> status \{status}",
                      )
                    }
                  }
                  None => ()
                }
              }
              _ => ()
            }
          }
        _ => ()
      }
    _ => ()
  }
}

///|
fn walk(dir : String, base : String, out : Array[(String, String)]) -> Unit {
  let entries : Array[String] = @fs.read_dir(dir) catch { _ => [] }
  entries.sort()
  for entry in entries {
    let name = path_basename(entry)
    if name.has_prefix(".") || name == "node_modules" {
      continue
    }
    let full = path_join(dir, entry)
    let is_dir = @fs.is_dir(full) catch { _ => false }
    if is_dir {
      walk(full, base, out)
      continue
    }
    let ext = path_extname(full)
    if text_ext.contains(ext) || asset_ext.contains(ext) {
      let rel = path_relative(full, base)
      out.push((full, "/" + rel))
    }
  }
}

///|
fn replace_typ_ext(path : String, ext : String) -> String {
  if path.has_suffix(".typ") {
    "\{path[:path.length() - 4]}\{ext}"
  } else {
    "\{path}\{ext}"
  }
}

///|
fn report_diagnostics() -> Int {
  let text = bytes_to_utf16(typstbit_error_json())
  let mut count = 0
  match parse_object(text) {
    Some(root) =>
      match root.get("diagnostics") {
        Some(Json::Array(items)) =>
          for item in items {
            match item {
              Json::Object(fields) => {
                count = count + 1
                let severity = json_string(fields, "severity").unwrap_or(
                  "error",
                )
                let message = json_string(fields, "message").unwrap_or("")
                let location = match fields.get("start") {
                  Some(Json::Object(start)) =>
                    match start.get("line") {
                      Some(Json::Number(line, ..)) => "第 \{line.to_int()} 行"
                      _ => ""
                    }
                  _ => ""
                }
                println("[\{severity}] \{location} \{message}")
              }
              _ => ()
            }
          }
        _ => ()
      }
    None => ()
  }
  count
}

///|
fn main {
  let argv = @env.args()
  if argv.length() >= 2 && argv[1] == "mcp" {
    mcp_loop()
    exit(0)
  }
  if argv.length() < 3 {
    fail("缺少参数")
  }
  let command = argv[1]
  let file = argv[2]
  let mut output : String? = None
  let mut page = 0
  let mut scale = 1.5
  let mut packages_dir = @env.get_env_var("TYPSTBIT_PACKAGES").unwrap_or(
    "app/typstbit/web_wasm/packages",
  )
  let mut index = 3
  while index < argv.length() {
    let arg = argv[index]
    if arg == "-o" && index + 1 < argv.length() {
      output = Some(argv[index + 1])
      index = index + 2
    } else if arg == "--page" && index + 1 < argv.length() {
      page = @string.parse_int(argv[index + 1]) catch { _ => 0 }
      index = index + 2
    } else if arg == "--scale" && index + 1 < argv.length() {
      scale = @string.parse_double(argv[index + 1]) catch { _ => 1.5 }
      index = index + 2
    } else if arg == "--packages" && index + 1 < argv.length() {
      packages_dir = argv[index + 1]
      index = index + 2
    } else if arg == "--abi" && index + 1 < argv.length() {
      index = index + 2
    } else {
      index = index + 1
    }
  }

  let resolved = path_resolve(file)
  let root = path_dirname(resolved)
  let files : Array[(String, String)] = []
  walk(root, root, files)
  let mut found = false
  for entry in files {
    if entry.0 == resolved {
      found = true
    }
  }
  if !found {
    files.push((resolved, "/" + path_relative(resolved, root)))
  }
  for entry in files {
    let data : Bytes? = Some(@fs.read_file_to_bytes(entry.0)) catch {
      _ => None
    }
    match data {
      Some(bytes) => set_file(entry.1, bytes)
      None => ()
    }
  }
  register_packages(packages_dir)
  let main_vpath = "/" + path_relative(resolved, root)
  let _ = typstbit_set_main(utf8(main_vpath))

  if command == "outline" {
    let source : String? = Some(@fs.read_file_to_string(resolved)) catch {
      _ => None
    }
    match source {
      Some(source) => {
        let entries = @app.parse_outline(source)
        let list : Array[Json] = entries.map(entry => {
          Json::object({
            "level": Json::number(entry.level.to_double()),
            "title": Json::string(entry.title),
            "line": Json::number(entry.line.to_double()),
          })
        })
        println(Json::array(list).stringify())
      }
      None => fail("无法读取 \{file}")
    }
    exit(0)
  }

  let status = typstbit_compile().to_int()
  let pages = typstbit_page_count().to_int()
  if command == "compile" {
    let diagnostics = report_diagnostics()
    println(
      Json::object({
        "status": Json::string(
          if status == 0 {
            "ok"
          } else {
            "status-\{status}"
          },
        ),
        "pages": Json::number(pages.to_double()),
        "diagnostics": Json::number(diagnostics.to_double()),
      }).stringify(),
    )
    exit(if status == 0 { 0 } else { 1 })
  }

  if status != 0 {
    let _ = report_diagnostics()
    println("编译失败（状态码 \{status}）")
    exit(1)
  }

  let bytes = if command == "pdf" {
    typstbit_export_pdf()
  } else if command == "svg" {
    typstbit_export_svg(page.to_int64())
  } else if command == "png" {
    typstbit_render_page_png(
      page.to_int64(),
      (scale * 1000.0).round().to_int64(),
    )
  } else {
    fail("未知命令 \{command}")
    return
  }
  if bytes.length() == 0 {
    println("导出失败（页面越界或文档为空）")
    exit(1)
  }
  let target = match output {
    Some(output) => path_resolve(output)
    None =>
      if command == "pdf" {
        replace_typ_ext(resolved, ".pdf")
      } else if command == "svg" {
        replace_typ_ext(resolved, ".svg")
      } else {
        replace_typ_ext(resolved, ".png")
      }
  }
  let written : Bool = try {
    @fs.write_bytes_to_file(target, bytes)
    true
  } catch {
    _ => false
  }
  if !written {
    println("无法写入 \{target}")
    exit(1)
  }
  println("\{command}: \{target} (\{bytes.length()} bytes, \{pages} 页)")
}
