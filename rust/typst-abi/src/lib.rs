//! typst-abi: flat C ABI over the typst compiler (design D9, ABI v1).
//!
//! Modules:
//! - [`world`]: virtual-filesystem World (design D6)
//! - [`diag_json`]: wide diagnostics JSON model (design D7)
//! - [`render`]: per-page PNG rendering with `scale_milli` (design D9)
//! - [`abi`]: the frozen C ABI exports (design D9)
//! - [`spike`]: Spike B measurement exports (task 3.2, kept for
//!   reproducing `docs/spike-b.md` measurements)

#![allow(clippy::missing_safety_doc)]
#![allow(static_mut_refs)]

pub mod abi;
pub mod diag_json;
pub mod render;
pub mod spike;
pub mod world;
