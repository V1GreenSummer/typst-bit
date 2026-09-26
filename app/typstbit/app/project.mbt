///|
// Multi-file project model (ported from the DOM workbench's project state).
//
// Pure structure: paths, kinds, text and the folder set. Binary payloads
// stay in the host keyed by path; the model tracks only path/kind. Paths are
// absolute inside the virtual file system ("/main.typ", "/images/a.png").

///|
pub(all) enum FileKind {
  TextFile
  BinaryFile
} derive(Debug, Eq)

///|
pub extend FileKind with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend FileKind with Eq::{not_equal, equal}

///|
pub(all) struct ProjectFile {
  path : String
  kind : FileKind
  text : String
} derive(Debug, Eq)

///|
pub extend ProjectFile with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend ProjectFile with Eq::{not_equal, equal}

///|
pub(all) enum ProjectError {
  DuplicatePath(String)
  InvalidPath(String)
} derive(Debug, Eq)

///|
pub extend ProjectError with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend ProjectError with Eq::{not_equal, equal}

///|
pub(all) struct Project {
  mut files : Array[ProjectFile]
  mut folders : Array[String]
  mut active : String
} derive(Debug, Eq)

///|
pub extend Project with @moonbitlang/core/debug.Debug::{to_repr}

///|
pub extend Project with Eq::{not_equal, equal}

///|
/// Whether a path looks like an image (used to create binary entries).
pub fn is_image_path(path : String) -> Bool {
  let lower = path.to_lower()
  lower.has_suffix(".png") ||
  lower.has_suffix(".jpg") ||
  lower.has_suffix(".jpeg") ||
  lower.has_suffix(".gif") ||
  lower.has_suffix(".svg") ||
  lower.has_suffix(".webp")
}

///|
/// Whether a path is a valid absolute VFS path: starts with `/`, has no
/// empty/`.`/`..` segments and no trailing slash.
pub fn is_valid_vfs_path(path : String) -> Bool {
  if path.length() < 2 || !path.has_prefix("/") || path.has_suffix("/") {
    return false
  }
  let segments = path.split("/").to_array()
  let mut i = 0
  if segments.length() > 0 && segments[0].length() == 0 {
    i = 1
  }
  while i < segments.length() {
    let part = segments[i].to_owned()
    if part == "" || part == "." || part == ".." {
      return false
    }
    i = i + 1
  }
  true
}

///|
pub fn Project::new(initial_text : String) -> Project {
  {
    files: [{ path: "/main.typ", kind: TextFile, text: initial_text }],
    folders: [],
    active: "/main.typ",
  }
}

///|
pub fn Project::find(self : Project, path : String) -> ProjectFile? {
  for file in self.files {
    if file.path == path {
      return Some(file)
    }
  }
  None
}

///|
pub fn Project::has(self : Project, path : String) -> Bool {
  self.find(path) is Some(_)
}

///|
pub fn Project::text(self : Project, path : String) -> String? {
  match self.find(path) {
    Some(file) if file.kind is TextFile => Some(file.text)
    _ => None
  }
}

///|
pub fn Project::active_text(self : Project) -> String {
  match self.text(self.active) {
    Some(text) => text
    None => ""
  }
}

///|
/// Adds a new file. Rejects duplicates and invalid paths; folders are
/// tracked separately and do not need to exist.
pub fn Project::add_file(
  self : Project,
  path : String,
  text : String,
  kind? : FileKind = TextFile,
) -> Result[Unit, ProjectError] {
  if !is_valid_vfs_path(path) {
    return Err(InvalidPath(path))
  }
  if self.has(path) {
    return Err(DuplicatePath(path))
  }
  self.files.push({ path, kind, text })
  Ok(())
}

///|
/// Replaces the text of an existing text file. Returns false when the path
/// is unknown or binary.
pub fn Project::set_text(self : Project, path : String, text : String) -> Bool {
  for i = 0; i < self.files.length(); i = i + 1 {
    let file = self.files[i]
    if file.path == path && file.kind is TextFile {
      self.files[i] = { path: file.path, kind: file.kind, text }
      return true
    }
  }
  false
}

///|
/// Records a folder path (display only). Existing entries are kept unique.
pub fn Project::add_folder(self : Project, path : String) -> Bool {
  if !is_valid_vfs_path(path) || self.folders.contains(path) {
    return false
  }
  self.folders.push(path)
  self.folders.sort()
  true
}

///|
/// Removes a file (folders are display-only and stay). When the active file
/// is removed the active path falls back to `/main.typ` or the first text
/// file. Returns the removed file when it existed.
pub fn Project::remove(self : Project, path : String) -> ProjectFile? {
  let mut removed : ProjectFile? = None
  let kept : Array[ProjectFile] = []
  for file in self.files {
    if file.path == path {
      removed = Some(file)
    } else {
      kept.push(file)
    }
  }
  if removed is Some(_) {
    self.files = kept
    if self.active == path {
      self.active = if self.has("/main.typ") {
        "/main.typ"
      } else {
        match kept {
          [first, ..] => first.path
          [] => ""
        }
      }
    }
  }
  removed
}

///|
/// Lexicographic UTF-16 comparison (MoonBit's `String::compare` is shortlex,
/// which would order paths by length first).
fn compare_path(a : String, b : String) -> Int {
  let al = a.length()
  let bl = b.length()
  let n = if al < bl { al } else { bl }
  for i = 0; i < n; i = i + 1 {
    let cmp = a.unsafe_get(i).compare(b.unsafe_get(i))
    if cmp != 0 {
      return cmp
    }
  }
  al.compare(bl)
}

///|
/// File paths in display order (lexicographic, case-insensitive), folders
/// excluded.
pub fn Project::paths(self : Project) -> Array[String] {
  let out = self.files.map(file => file.path)
  out.sort_by(fn(a, b) {
    let cmp = compare_path(a.to_lower(), b.to_lower())
    if cmp == 0 {
      compare_path(a, b)
    } else {
      cmp
    }
  })
  out
}

///|
/// The active file text after a host-side edit, keeping compile inputs in
/// one place.
pub fn Project::apply_edit(
  self : Project,
  path : String,
  text : String,
) -> Bool {
  self.set_text(path, text)
}

///|
pub fn Project::to_json(self : Project) -> Json {
  Json::object({
    "active": Json::string(self.active),
    "files": Json::array(
      self.files.map(file => {
        Json::object({
          "path": Json::string(file.path),
          "kind": Json::string(
            if file.kind is TextFile {
              "text"
            } else {
              "binary"
            },
          ),
          "text": Json::string(file.text),
        })
      }),
    ),
    "folders": Json::array(self.folders.map(Json::string)),
  })
}

///|
pub fn Project::to_json_string(self : Project) -> String {
  self.to_json().stringify()
}

///|
/// Restores a project from the host's persisted JSON. Unknown shapes fall
/// back to a fresh project with `fallback_text`, mirroring the workbench's
/// tolerated localStorage corruption behaviour.
pub fn Project::from_json_string(
  text : String,
  fallback_text : String,
) -> Project {
  let parsed : Json? = Some(@json.parse(text)) catch { _ => None }
  match parsed {
    Some(Object(root)) => {
      let project : Project = { files: [], folders: [], active: "/main.typ" }
      match root.get("files") {
        Some(Array(items)) =>
          for item in items {
            match item {
              Object(fields) => {
                let path = json_string(fields, "path")
                let kind = json_string(fields, "kind")
                if path is Some(path) && is_valid_vfs_path(path) {
                  project.files.push({
                    path,
                    kind: if kind == Some("binary") {
                      BinaryFile
                    } else {
                      TextFile
                    },
                    text: json_string(fields, "text").unwrap_or(""),
                  })
                }
              }
              _ => ()
            }
          }
        _ => ()
      }
      match root.get("folders") {
        Some(Array(items)) =>
          for item in items {
            match item {
              String(folder) => project.add_folder(folder) |> ignore
              _ => ()
            }
          }
        _ => ()
      }
      match root.get("active") {
        Some(String(active)) =>
          if project.has(active) {
            project.active = active
          }
        _ => ()
      }
      if !project.has("/main.typ") {
        project.files.push({
          path: "/main.typ",
          kind: TextFile,
          text: fallback_text,
        })
      }
      if !project.has(project.active) {
        project.active = "/main.typ"
      }
      project
    }
    _ => Project::new(fallback_text)
  }
}

///|
fn json_string(fields : Map[String, Json], key : String) -> String? {
  match fields.get(key) {
    Some(String(value)) => Some(value)
    _ => None
  }
}
