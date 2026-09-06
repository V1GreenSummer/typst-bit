//! Diagnostics-to-JSON serialization, wide model (design D7, task 6.2).
//!
//! Shape (all position fields optional to support positionless
//! diagnostics; line/column are 1-based):
//!
//! ```json
//! {"diagnostics":[{"severity":"error","message":"...",
//!                  "file":"/main.typ",
//!                  "start":{"line":1,"column":3},
//!                  "end":{"line":1,"column":5},
//!                  "hints":["..."]}]}
//! ```

use serde::Serialize;
use typst::diag::{Severity, SourceDiagnostic};
use typst::syntax::{DiagSpanKind, FileId, Source};

use crate::world::VfsWorld;

#[derive(Serialize)]
struct DiagnosticsDoc {
    diagnostics: Vec<DiagnosticJson>,
}

#[derive(Serialize)]
struct DiagnosticJson {
    severity: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    start: Option<PositionJson>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end: Option<PositionJson>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    hints: Vec<String>,
}

#[derive(Serialize)]
struct PositionJson {
    line: usize,
    column: usize,
}

/// Serialize one diagnostic's position info against the world's sources.
fn position(
    world: &VfsWorld,
    id: FileId,
    byte: usize,
) -> Option<PositionJson> {
    let source: &Source = world.source(id)?;
    let (line, column) = source.lines().byte_to_line_column(byte)?;
    Some(PositionJson {
        line: line + 1,
        column: column + 1,
    })
}

/// Resolve a diagnostic's span to (file, byte range), if it points into a
/// file present in the VFS.
fn resolve_span(world: &VfsWorld, diag: &SourceDiagnostic) -> Option<(FileId, std::ops::Range<usize>)> {
    match diag.span.get() {
        DiagSpanKind::Detached => None,
        DiagSpanKind::Number { id, num, sub_range } => {
            let source = world.source(id)?;
            let range = source.range(num, sub_range)?;
            Some((id, range))
        }
        DiagSpanKind::Range { id, range } => Some((id, range)),
    }
}

fn one_diag(world: &VfsWorld, diag: &SourceDiagnostic) -> DiagnosticJson {
    let severity = match diag.severity {
        Severity::Error => "error",
        Severity::Warning => "warning",
    };
    let (file, start, end) = match resolve_span(world, diag) {
        Some((id, range)) => {
            let file = id.vpath().get_with_slash().to_string();
            let start = position(world, id, range.start);
            let end = position(world, id, range.end);
            (Some(file), start, end)
        }
        None => (None, None, None),
    };
    DiagnosticJson {
        severity,
        message: diag.message.to_string(),
        file,
        start,
        end,
        hints: diag.hints.iter().map(|h| h.v.to_string()).collect(),
    }
}

/// Serialize diagnostics (errors and/or warnings of the last compile) into
/// the D7 wide JSON model.
pub fn diagnostics_to_json(
    world: &VfsWorld,
    diags: &[SourceDiagnostic],
) -> String {
    let doc = DiagnosticsDoc {
        diagnostics: diags.iter().map(|d| one_diag(world, d)).collect(),
    };
    serde_json::to_string(&doc).expect("diagnostics JSON cannot fail")
}
