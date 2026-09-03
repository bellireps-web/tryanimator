//! Provider interfaces: AI (Muse Spark via worker proxy), stock media,
//! and licensed audio. Sync traits so the core stays platform-independent;
//! async adapters live at the boundary (worker / wasm).
//!
//! Model output is validated, never trusted: malformed JSON or a plan that
//! fails rules becomes a structured `ProviderError`, never a silent default.

use crate::json::{parse, Value};
use crate::plan::{MotionPlan, PlanError};

/// Maximum bytes of a model response kept in an error report.
pub const OUTPUT_EXCERPT_LEN: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderError {
    /// HTTP transport failure at the boundary.
    Transport {
        message: String,
    },
    Unauthorized,
    RateLimited {
        retry_after_secs: Option<u64>,
    },
    /// The model answered, but the body was not usable JSON.
    InvalidJson {
        excerpt: String,
        message: String,
    },
    /// Valid JSON that violates the contract (plan rules, missing fields).
    InvalidOutput {
        excerpt: String,
        errors: Vec<PlanError>,
    },
}

impl ProviderError {
    pub fn excerpt_of(body: &str) -> String {
        let end = body
            .char_indices()
            .take_while(|(index, _)| *index < OUTPUT_EXCERPT_LEN)
            .map(|(index, ch)| index + ch.len_utf8())
            .last()
            .unwrap_or(0);
        body[..end].to_string()
    }

    /// Short machine-readable code for logs and UI status.
    pub fn code(&self) -> &'static str {
        match self {
            ProviderError::Transport { .. } => "provider_transport",
            ProviderError::Unauthorized => "provider_unauthorized",
            ProviderError::RateLimited { .. } => "provider_rate_limited",
            ProviderError::InvalidJson { .. } => "provider_invalid_json",
            ProviderError::InvalidOutput { .. } => "provider_invalid_output",
        }
    }
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProviderError::Transport { message } => write!(f, "provider transport: {message}"),
            ProviderError::Unauthorized => write!(f, "provider unauthorized"),
            ProviderError::RateLimited { retry_after_secs } => {
                write!(
                    f,
                    "provider rate limited (retry after {retry_after_secs:?}s)"
                )
            }
            ProviderError::InvalidJson { message, .. } => {
                write!(f, "provider returned invalid JSON: {message}")
            }
            ProviderError::InvalidOutput { errors, .. } => {
                write!(f, "provider output rejected with {} error(s)", errors.len())
            }
        }
    }
}

impl std::error::Error for ProviderError {}

/// Decode + validate a model answer that must be a MotionPlan.
/// Shared by every AI call so all of them enforce the same contract.
pub fn decode_plan_output(body: &str) -> Result<MotionPlan, ProviderError> {
    let value: Value = parse(body).map_err(|error| ProviderError::InvalidJson {
        excerpt: ProviderError::excerpt_of(body),
        message: error.to_string(),
    })?;
    MotionPlan::from_json(&value).map_err(|errors| ProviderError::InvalidOutput {
        excerpt: ProviderError::excerpt_of(body),
        errors,
    })
}

/// What the model must return for Auto resolution: duration + style preset.
#[derive(Debug, Clone, PartialEq)]
pub struct AutoResolution {
    pub duration_secs: f32,
    pub style_id: String,
    pub style_version: String,
}

/// Muse Spark through the worker proxy (OpenAI-compatible chat endpoint).
/// Implementations perform I/O; this trait only fixes the contract.
pub trait AiProvider {
    /// Propose duration (1..=60s) and HyperFrames preset for Auto fields.
    fn resolve_auto(&self, prompt: &str, ratio: &str) -> Result<AutoResolution, ProviderError>;
    /// Author one HyperFrames scene document; returns the stored doc id.
    fn author_scene(&self, prompt: &str, scene_brief: &str) -> Result<String, ProviderError>;
    /// Turn a chat message into validated patch ops (encoded as JSON).
    fn chat_patch(&self, plan_json: &str, message: &str) -> Result<Value, ProviderError>;
}

/// Stock raster provider (API supplied later; key lives in the worker).
pub trait StockProvider {
    /// Search licensed images; returns asset ids usable as `Visual::Asset`.
    fn search_images(&self, query: &str, count: u32) -> Result<Vec<String>, ProviderError>;
}

/// Licensed music + SFX library (default: Pixabay).
pub trait AudioLibrary {
    /// Pick a music track id for a mood/prompt description.
    fn pick_music(&self, mood: &str) -> Result<String, ProviderError>;
    /// Pick an SFX id by name.
    fn pick_sfx(&self, name: &str) -> Result<String, ProviderError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json::stringify;
    use crate::plan::tests::sample_plan;

    #[test]
    fn accepts_valid_plan_output() {
        let body = stringify(&sample_plan().to_json());
        assert!(decode_plan_output(&body).is_ok());
    }

    #[test]
    fn rejects_malformed_json_with_excerpt() {
        let error = decode_plan_output("{oops").expect_err("malformed");
        assert_eq!(error.code(), "provider_invalid_json");
        match error {
            ProviderError::InvalidJson { excerpt, .. } => assert_eq!(excerpt, "{oops"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn rejects_rule_breaking_plan_with_errors() {
        let body = r##"{"version":1,"ratio":"9:16","height":1080,"fps":30,"duration":61,"style":"auto","brand":{"colors":["#FFF"],"font":"Figtree"},"audio":{"music_track_id":null,"sfx":[]},"scenes":[],"seed":1}"##;
        let error = decode_plan_output(body).expect_err("61s, no scenes");
        assert_eq!(error.code(), "provider_invalid_output");
        match error {
            ProviderError::InvalidOutput { excerpt, errors } => {
                assert!(excerpt.len() <= OUTPUT_EXCERPT_LEN + 4);
                assert!(!errors.is_empty());
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn excerpt_cuts_at_char_boundary() {
        let body = "é".repeat(1000);
        let excerpt = ProviderError::excerpt_of(&body);
        assert!(excerpt.len() <= OUTPUT_EXCERPT_LEN + 4);
        assert!(body.starts_with(&excerpt));
    }
}
