//! motion-core: domain contracts for Motion mode video creation.
//!
//! Std-only crate (zero dependencies). Owns:
//! - `plan`: MotionPlan v1 schema + validation (domain rules live here, not in TS).
//! - `transport`: EditorTransport command/response envelopes.
//! - `providers`: AI/stock/audio provider interfaces + structured errors.
//! - `json`: minimal JSON value model used by the envelopes above.
//!
//! Async I/O lives at the boundary (worker / wasm adapters); these
//! interfaces are sync so the core stays platform-independent.

pub mod cache;
pub mod json;
pub mod plan;
pub mod providers;
pub mod transport;
