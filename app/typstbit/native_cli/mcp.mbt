///|
// MCP server (stdio JSON-RPC, protocol 2024-11-05) implemented natively on
// top of the typst-abi static library. Mirrors tools/typstbit-mcp.mjs:
//   typst_compile, typst_export_pdf, typst_export_svg, typst_render_png,
//   typst_outline

///|
#borrow(buf)
extern "C" fn typstbit_read(fd : Int64, buf : Bytes) -> Int64 = "typstbit_read"

///|
extern "C" fn typstbit_flush_stdout() -> Unit = "typstbit_flush_stdout"

///|
fn json_str(map : Map[String, Json], key : String) -> String? {
  match map.get(key) {
    Some(Json::String(value)) => Some(value)
    _ => None
  }
}

///|
fn json_num(map : Map[String, Json], key : String) -> Double? {
  match map.get(key) {
    Some(Json::Number(value, ..)) => Some(value)
    _ => None
  }
}

///|
fn text_content(value : String) -> Json {
  Json::object({
    "content": Json::array([
      Json::object({ "type": Json::string("text"), "text": Json::string(value) }),
    ]),
  })
}

///|
fn image_content(summary : String, png : Bytes) -> Json {
  Json::object({
    "content": Json::array([
      Json::object({
        "type": Json::string("text"),
        "text": Json::string(summary),
      }),
      Json::object({
        "type": Json::string("image"),
        "data": Json::string(@base64.encode(png)),
        "mimeType": Json::string("image/png"),
      }),
    ]),
  })
}

///|
fn json_array_strings(items : Array[String]) -> Json {
  Json::array(items.map(Json::string))
}

///|
fn tool_definitions() -> Json {
  let source_prop = Json::object({ "type": Json::string("string") })
  let page_prop = Json::object({ "type": Json::string("number") })
  let scale_prop = Json::object({ "type": Json::string("number") })
  let path_prop = Json::object({ "type": Json::string("string") })
  let schema = fn(properties : Map[String, Json], required : Array[String]) {
    Json::object({
      "type": Json::string("object"),
      "properties": Json::object(properties),
      "required": json_array_strings(required),
    })
  }
  Json::array([
    Json::object({
      "name": Json::string("typst_compile"),
      "description": Json::string(
        "Compile Typst source and return page count plus diagnostics.",
      ),
      "inputSchema": schema({ "source": source_prop }, ["source"]),
    }),
    Json::object({
      "name": Json::string("typst_export_pdf"),
      "description": Json::string(
        "Compile Typst source and write a PDF to disk; returns the path and size.",
      ),
      "inputSchema": schema({ "source": source_prop, "path": path_prop }, [
        "source",
      ]),
    }),
    Json::object({
      "name": Json::string("typst_export_svg"),
      "description": Json::string(
        "Compile Typst source and return one page as SVG text.",
      ),
      "inputSchema": schema({ "source": source_prop, "page": page_prop }, [
        "source",
      ]),
    }),
    Json::object({
      "name": Json::string("typst_render_png"),
      "description": Json::string(
        "Compile Typst source and return one page as a PNG image.",
      ),
      "inputSchema": schema(
        { "source": source_prop, "page": page_prop, "scale": scale_prop },
        ["source"],
      ),
    }),
    Json::object({
      "name": Json::string("typst_outline"),
      "description": Json::string(
        "Return the heading outline of Typst source as JSON.",
      ),
      "inputSchema": schema({ "source": source_prop }, ["source"]),
    }),
  ])
}

///|
fn mcp_compile(source : String) -> (Int, Int, Array[Json]) {
  let set_status = typstbit_set_file(utf8("/main.typ"), utf8(source)).to_int()
  if set_status != 0 {
    return (set_status, 0, [])
  }
  let _ = typstbit_set_main(utf8("/main.typ"))
  let status = typstbit_compile().to_int()
  let pages = typstbit_page_count().to_int()
  let diagnostics : Array[Json] = []
  match parse_object(bytes_to_utf16(typstbit_error_json())) {
    Some(root) =>
      match root.get("diagnostics") {
        Some(Json::Array(items)) => diagnostics.append(items)
        _ => ()
      }
    None => ()
  }
  (status, pages, diagnostics)
}

///|
fn status_name(code : Int) -> String {
  if code == 0 {
    "ok"
  } else if code == 3 {
    "error"
  } else {
    "status-\{code}"
  }
}

///|
fn mcp_call_tool(
  name : String,
  args : Map[String, Json],
) -> Result[Json, (Int, String)] {
  let source = json_str(args, "source").unwrap_or("")
  if name == "typst_outline" {
    let entries = @app.parse_outline(source)
    let list : Array[Json] = entries.map(entry => {
      Json::object({
        "level": Json::number(entry.level.to_double()),
        "title": Json::string(entry.title),
        "line": Json::number(entry.line.to_double()),
      })
    })
    return Ok(text_content(Json::array(list).stringify()))
  }
  let (status, pages, diagnostics) = mcp_compile(source)
  if name == "typst_compile" {
    let summary : Array[Json] = diagnostics.map(item => {
      match item {
        Json::Object(fields) => {
          let line = match fields.get("start") {
            Some(Json::Object(start)) =>
              match start.get("line") {
                Some(Json::Number(value, ..)) => Json::number(value)
                _ => Json::null()
              }
            _ => Json::null()
          }
          Json::object({
            "severity": Json::string(
              json_str(fields, "severity").unwrap_or("error"),
            ),
            "message": Json::string(json_str(fields, "message").unwrap_or("")),
            "line": line,
          })
        }
        _ => Json::null()
      }
    })
    return Ok(
      text_content(
        Json::object({
          "status": Json::string(status_name(status)),
          "pages": Json::number(pages.to_double()),
          "diagnostics": Json::array(summary),
        }).stringify(),
      ),
    )
  }
  if status != 0 {
    return Ok(
      text_content(
        Json::object({
          "status": Json::string(status_name(status)),
          "diagnostics": Json::array(diagnostics),
        }).stringify(),
      ),
    )
  }
  let page = json_num(args, "page").unwrap_or(0.0).to_int()
  if name == "typst_export_pdf" {
    let bytes = typstbit_export_pdf()
    if bytes.length() == 0 {
      return Ok(
        text_content(
          Json::object({
            "status": Json::string("error"),
            "message": Json::string("pdf export failed"),
          }).stringify(),
        ),
      )
    }
    let target = json_str(args, "path").unwrap_or("/tmp/typstbit-output.pdf")
    let written : Bool = try {
      @fs.write_bytes_to_file(target, bytes)
      true
    } catch {
      _ => false
    }
    if !written {
      return Ok(
        text_content(
          Json::object({
            "status": Json::string("error"),
            "message": Json::string("cannot write \{target}"),
          }).stringify(),
        ),
      )
    }
    return Ok(
      text_content(
        Json::object({
          "path": Json::string(target),
          "bytes": Json::number(bytes.length().to_double()),
          "pages": Json::number(pages.to_double()),
        }).stringify(),
      ),
    )
  }
  if name == "typst_export_svg" {
    let bytes = typstbit_export_svg(page.to_int64())
    if bytes.length() == 0 {
      return Ok(
        text_content(
          Json::object({
            "status": Json::string("error"),
            "message": Json::string("page \{page} unavailable"),
          }).stringify(),
        ),
      )
    }
    return Ok(text_content(bytes_to_utf16(bytes)))
  }
  if name == "typst_render_png" {
    let scale = json_num(args, "scale").unwrap_or(1.5)
    let scale_milli = if scale < 1.0 {
      1000
    } else {
      (scale * 1000.0).round().to_int()
    }
    let bytes = typstbit_render_page_png(
      page.to_int64(),
      scale_milli.to_int64(),
    )
    if bytes.length() == 0 {
      return Ok(
        text_content(
          Json::object({
            "status": Json::string("error"),
            "message": Json::string("page \{page} unavailable"),
          }).stringify(),
        ),
      )
    }
    return Ok(image_content("page \{page} · \{bytes.length()} bytes", bytes))
  }
  Err((-32000, "unknown tool: \{name}"))
}

///|
fn mcp_dispatch(
  rpc_method : String,
  params : Map[String, Json],
) -> Result[Json, (Int, String)] {
  if rpc_method == "initialize" {
    return Ok(
      Json::object({
        "protocolVersion": Json::string("2024-11-05"),
        "capabilities": Json::object({ "tools": Json::object({}) }),
        "serverInfo": Json::object({
          "name": Json::string("typstbit-mcp"),
          "version": Json::string("0.1.0"),
        }),
      }),
    )
  }
  if rpc_method == "ping" {
    return Ok(Json::object({}))
  }
  if rpc_method == "tools/list" {
    return Ok(Json::object({ "tools": tool_definitions() }))
  }
  if rpc_method == "tools/call" {
    let name = json_str(params, "name").unwrap_or("")
    let arguments = match params.get("arguments") {
      Some(Json::Object(arguments)) => arguments
      _ => Map([])
    }
    return mcp_call_tool(name, arguments)
  }
  Err((-32601, "method not found: \{rpc_method}"))
}

///|
fn take_line(buffer : String) -> (String?, String) {
  let chars = buffer.to_array()
  let mut index = -1
  for i = 0; i < chars.length(); i = i + 1 {
    if chars[i] == '\n' {
      index = i
      break
    }
  }
  if index < 0 {
    (None, buffer)
  } else {
    let head = StringBuilder()
    let tail = StringBuilder()
    for i = 0; i < chars.length(); i = i + 1 {
      if i < index {
        head.write_char(chars[i])
      } else if i > index {
        tail.write_char(chars[i])
      }
    }
    (Some(head.to_string()), tail.to_string())
  }
}

///|
fn mcp_send(message : Json) -> Unit {
  println(message.stringify())
  typstbit_flush_stdout()
}

///|
fn mcp_send_error(id : Json, code : Int, message : String) -> Unit {
  mcp_send(
    Json::object({
      "jsonrpc": Json::string("2.0"),
      "id": id,
      "error": Json::object({
        "code": Json::number(code.to_double()),
        "message": Json::string(message),
      }),
    }),
  )
}

///|
fn mcp_handle_line(line : String) -> Unit {
  let trimmed = line.trim().to_owned()
  if trimmed == "" {
    return
  }
  let parsed : Json? = Some(@json.parse(trimmed)) catch { _ => None }
  let fields = match parsed {
    Some(Json::Object(fields)) => fields
    _ => return
  }
  let id = match fields.get("id") {
    Some(value) => value
    None => return
  }
  let rpc_method = json_str(fields, "method").unwrap_or("")
  let params = match fields.get("params") {
    Some(Json::Object(params)) => params
    _ => Map([])
  }
  match mcp_dispatch(rpc_method, params) {
    Ok(result) =>
      mcp_send(
        Json::object({
          "jsonrpc": Json::string("2.0"),
          "id": id,
          "result": result,
        }),
      )
    Err((code, message)) => mcp_send_error(id, code, message)
  }
}

///|
/// Runs the MCP stdio loop until EOF.
pub fn mcp_loop() -> Unit {
  let packages_dir = @env.get_env_var("TYPSTBIT_PACKAGES").unwrap_or(
    "app/typstbit/web_wasm/packages",
  )
  register_packages(packages_dir)
  let chunk = Bytes::make(65536, b'\x00')
  let mut buffer = ""
  while true {
    let read = typstbit_read(0, chunk).to_int()
    if read <= 0 {
      break
    }
    buffer = buffer + @utf8.decode_lossy(chunk[:read])
    let mut parsing = true
    while parsing {
      let (line, rest) = take_line(buffer)
      match line {
        Some(line) => {
          buffer = rest
          mcp_handle_line(line)
        }
        None => parsing = false
      }
    }
  }
}
