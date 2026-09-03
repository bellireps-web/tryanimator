//! EditorTransport: the single entry between UI and engine.
//!
//! Every UI request is one of these commands; every reply is a `Response`.
//! Errors are structured (`ApiError`) and must propagate — no silent
//! defaults, no swallowed failures.

use crate::json::Value;
use crate::plan::{MotionPlan, PlanError};
use std::collections::BTreeMap;

/// Patch operations the chat produces against an existing plan.
#[derive(Debug, Clone, PartialEq)]
pub enum PatchOp {
    SetDurationSecs(f32),
    SetStylePreset {
        id: String,
        version: String,
    },
    SetStyleAuto,
    SetBrand {
        colors: Vec<String>,
        font: String,
    },
    UpdateScene {
        index: usize,
        duration_secs: Option<f32>,
        text: Option<String>,
    },
    AddScene {
        index: usize,
    },
    RemoveScene {
        index: usize,
    },
    SetMusicTrack {
        track_id: Option<String>,
    },
    SetSeed(u64),
}

/// The complete command surface. No direct calls around it.
#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    CreateMotion { plan: MotionPlan },
    PatchMotion { plan_id: String, ops: Vec<PatchOp> },
    Render { plan_id: String },
    Cancel { job_id: String },
    Status { job_id: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobState {
    Queued,
    Running,
    Done,
    Cancelled,
    Failed,
}

impl JobState {
    pub fn label(self) -> &'static str {
        match self {
            JobState::Queued => "queued",
            JobState::Running => "running",
            JobState::Done => "done",
            JobState::Cancelled => "cancelled",
            JobState::Failed => "failed",
        }
    }

    pub fn from_label(label: &str) -> Option<JobState> {
        match label {
            "queued" => Some(JobState::Queued),
            "running" => Some(JobState::Running),
            "done" => Some(JobState::Done),
            "cancelled" => Some(JobState::Cancelled),
            "failed" => Some(JobState::Failed),
            _ => None,
        }
    }
}

/// Structured error: machine-readable code plus human message. Callers must
/// surface these, never replace them with defaults.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
}

impl ApiError {
    pub fn new(code: &str, message: &str) -> ApiError {
        ApiError {
            code: code.to_string(),
            message: message.to_string(),
            detail: None,
        }
    }

    pub fn plan_errors(errors: Vec<PlanError>) -> ApiError {
        let detail = errors
            .iter()
            .map(|error| error.to_string())
            .collect::<Vec<_>>()
            .join("; ");
        ApiError {
            code: "invalid_plan".to_string(),
            message: format!("plan rejected with {} error(s)", errors.len()),
            detail: Some(detail),
        }
    }

    pub fn to_json(&self) -> Value {
        let mut obj = BTreeMap::new();
        obj.insert("code".to_string(), Value::Str(self.code.clone()));
        obj.insert("message".to_string(), Value::Str(self.message.clone()));
        obj.insert(
            "detail".to_string(),
            match &self.detail {
                Some(detail) => Value::Str(detail.clone()),
                None => Value::Null,
            },
        );
        Value::Obj(obj)
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.detail {
            Some(detail) => write!(f, "[{}] {} ({})", self.code, self.message, detail),
            None => write!(f, "[{}] {}", self.code, self.message),
        }
    }
}

impl std::error::Error for ApiError {}

#[derive(Debug, Clone, PartialEq)]
pub enum Response {
    Accepted {
        job_id: String,
    },
    JobStatus {
        job_id: String,
        state: JobState,
        progress: f32,
    },
    Plan {
        plan_id: String,
        plan: MotionPlan,
    },
    Error(ApiError),
}

fn error_missing(field: &str) -> ApiError {
    ApiError::new("bad_command", &format!("missing field '{field}'"))
}

fn error_type(field: &str, expected: &str) -> ApiError {
    ApiError::new(
        "bad_command",
        &format!("field '{field}' must be {expected}"),
    )
}

fn get_str(obj: &BTreeMap<String, Value>, field: &str) -> Result<String, ApiError> {
    match obj.get(field) {
        Some(Value::Str(text)) => Ok(text.clone()),
        Some(_) => Err(error_type(field, "a string")),
        None => Err(error_missing(field)),
    }
}

fn parse_patch_op(value: &Value) -> Result<PatchOp, ApiError> {
    let obj = match value {
        Value::Obj(map) => map,
        _ => return Err(ApiError::new("bad_command", "patch op must be an object")),
    };
    let op = get_str(obj, "op")?;
    match op.as_str() {
        "set_duration_secs" => match obj.get("secs").and_then(|entry| entry.as_f64()) {
            Some(secs) => Ok(PatchOp::SetDurationSecs(secs as f32)),
            None => Err(error_type("secs", "a number")),
        },
        "set_style_preset" => Ok(PatchOp::SetStylePreset {
            id: get_str(obj, "id")?,
            version: get_str(obj, "version")?,
        }),
        "set_style_auto" => Ok(PatchOp::SetStyleAuto),
        "set_brand" => {
            let colors = match obj.get("colors").and_then(|entry| entry.as_arr()) {
                Some(items) => {
                    let mut colors = Vec::with_capacity(items.len());
                    for item in items {
                        match item.as_str() {
                            Some(color) => colors.push(color.to_string()),
                            None => return Err(error_type("colors", "an array of strings")),
                        }
                    }
                    colors
                }
                None => return Err(error_type("colors", "an array of strings")),
            };
            Ok(PatchOp::SetBrand {
                colors,
                font: get_str(obj, "font")?,
            })
        }
        "update_scene" => {
            let index = match obj.get("index").and_then(|entry| entry.as_u32()) {
                Some(index) => index as usize,
                None => return Err(error_type("index", "a non-negative integer")),
            };
            Ok(PatchOp::UpdateScene {
                index,
                duration_secs: obj
                    .get("duration_secs")
                    .and_then(|entry| entry.as_f64())
                    .map(|secs| secs as f32),
                text: obj
                    .get("text")
                    .and_then(|entry| entry.as_str())
                    .map(|text| text.to_string()),
            })
        }
        "add_scene" => match obj.get("index").and_then(|entry| entry.as_u32()) {
            Some(index) => Ok(PatchOp::AddScene {
                index: index as usize,
            }),
            None => Err(error_type("index", "a non-negative integer")),
        },
        "remove_scene" => match obj.get("index").and_then(|entry| entry.as_u32()) {
            Some(index) => Ok(PatchOp::RemoveScene {
                index: index as usize,
            }),
            None => Err(error_type("index", "a non-negative integer")),
        },
        "set_music_track" => Ok(PatchOp::SetMusicTrack {
            track_id: match obj.get("track_id") {
                Some(Value::Str(id)) => Some(id.clone()),
                Some(Value::Null) | None => None,
                Some(_) => return Err(error_type("track_id", "a string or null")),
            },
        }),
        "set_seed" => match obj.get("seed").and_then(|entry| entry.as_f64()) {
            Some(seed) => Ok(PatchOp::SetSeed(seed as u64)),
            None => Err(error_type("seed", "a number")),
        },
        unknown => Err(ApiError::new(
            "bad_command",
            &format!("unknown patch op '{unknown}'"),
        )),
    }
}

impl Command {
    /// Envelope kind discriminator.
    pub fn kind(&self) -> &'static str {
        match self {
            Command::CreateMotion { .. } => "create_motion",
            Command::PatchMotion { .. } => "patch_motion",
            Command::Render { .. } => "render",
            Command::Cancel { .. } => "cancel",
            Command::Status { .. } => "status",
        }
    }

    pub fn to_json(&self) -> Value {
        let mut obj = BTreeMap::new();
        obj.insert("kind".to_string(), Value::Str(self.kind().to_string()));
        match self {
            Command::CreateMotion { plan } => {
                obj.insert("plan".to_string(), plan.to_json());
            }
            Command::PatchMotion { plan_id, ops } => {
                obj.insert("plan_id".to_string(), Value::Str(plan_id.clone()));
                obj.insert(
                    "ops".to_string(),
                    Value::Arr(ops.iter().map(patch_op_to_json).collect()),
                );
            }
            Command::Render { plan_id } => {
                obj.insert("plan_id".to_string(), Value::Str(plan_id.clone()));
            }
            Command::Cancel { job_id } => {
                obj.insert("job_id".to_string(), Value::Str(job_id.clone()));
            }
            Command::Status { job_id } => {
                obj.insert("job_id".to_string(), Value::Str(job_id.clone()));
            }
        }
        Value::Obj(obj)
    }

    /// Decode a command envelope. Unknown kinds and malformed fields are
    /// errors — the transport never guesses.
    pub fn from_json(value: &Value) -> Result<Command, ApiError> {
        let obj = match value {
            Value::Obj(map) => map,
            _ => return Err(ApiError::new("bad_command", "command must be an object")),
        };
        let kind = get_str(obj, "kind")?;
        match kind.as_str() {
            "create_motion" => match obj.get("plan") {
                Some(plan_value) => match MotionPlan::from_json(plan_value) {
                    Ok(plan) => Ok(Command::CreateMotion { plan }),
                    Err(errors) => Err(ApiError::plan_errors(errors)),
                },
                None => Err(error_missing("plan")),
            },
            "patch_motion" => {
                let plan_id = get_str(obj, "plan_id")?;
                let ops = match obj.get("ops").and_then(|entry| entry.as_arr()) {
                    Some(items) => {
                        let mut ops = Vec::with_capacity(items.len());
                        for item in items {
                            ops.push(parse_patch_op(item)?);
                        }
                        ops
                    }
                    None => return Err(error_type("ops", "an array")),
                };
                Ok(Command::PatchMotion { plan_id, ops })
            }
            "render" => Ok(Command::Render {
                plan_id: get_str(obj, "plan_id")?,
            }),
            "cancel" => Ok(Command::Cancel {
                job_id: get_str(obj, "job_id")?,
            }),
            "status" => Ok(Command::Status {
                job_id: get_str(obj, "job_id")?,
            }),
            unknown => Err(ApiError::new(
                "bad_command",
                &format!("unknown command kind '{unknown}'"),
            )),
        }
    }
}

fn patch_op_to_json(op: &PatchOp) -> Value {
    let mut obj = BTreeMap::new();
    match op {
        PatchOp::SetDurationSecs(secs) => {
            obj.insert(
                "op".to_string(),
                Value::Str("set_duration_secs".to_string()),
            );
            obj.insert("secs".to_string(), Value::Num(*secs as f64));
        }
        PatchOp::SetStylePreset { id, version } => {
            obj.insert("op".to_string(), Value::Str("set_style_preset".to_string()));
            obj.insert("id".to_string(), Value::Str(id.clone()));
            obj.insert("version".to_string(), Value::Str(version.clone()));
        }
        PatchOp::SetStyleAuto => {
            obj.insert("op".to_string(), Value::Str("set_style_auto".to_string()));
        }
        PatchOp::SetBrand { colors, font } => {
            obj.insert("op".to_string(), Value::Str("set_brand".to_string()));
            obj.insert(
                "colors".to_string(),
                Value::Arr(
                    colors
                        .iter()
                        .map(|color| Value::Str(color.clone()))
                        .collect(),
                ),
            );
            obj.insert("font".to_string(), Value::Str(font.clone()));
        }
        PatchOp::UpdateScene {
            index,
            duration_secs,
            text,
        } => {
            obj.insert("op".to_string(), Value::Str("update_scene".to_string()));
            obj.insert("index".to_string(), Value::Num(*index as f64));
            if let Some(secs) = duration_secs {
                obj.insert("duration_secs".to_string(), Value::Num(*secs as f64));
            }
            if let Some(text) = text {
                obj.insert("text".to_string(), Value::Str(text.clone()));
            }
        }
        PatchOp::AddScene { index } => {
            obj.insert("op".to_string(), Value::Str("add_scene".to_string()));
            obj.insert("index".to_string(), Value::Num(*index as f64));
        }
        PatchOp::RemoveScene { index } => {
            obj.insert("op".to_string(), Value::Str("remove_scene".to_string()));
            obj.insert("index".to_string(), Value::Num(*index as f64));
        }
        PatchOp::SetMusicTrack { track_id } => {
            obj.insert("op".to_string(), Value::Str("set_music_track".to_string()));
            obj.insert(
                "track_id".to_string(),
                match track_id {
                    Some(id) => Value::Str(id.clone()),
                    None => Value::Null,
                },
            );
        }
        PatchOp::SetSeed(seed) => {
            obj.insert("op".to_string(), Value::Str("set_seed".to_string()));
            obj.insert("seed".to_string(), Value::Num(*seed as f64));
        }
    }
    Value::Obj(obj)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json::{parse, stringify};
    use crate::plan::tests::sample_plan;

    #[test]
    fn create_motion_round_trip() {
        let command = Command::CreateMotion {
            plan: sample_plan(),
        };
        let encoded = stringify(&command.to_json());
        let decoded = parse(&encoded).expect("parses");
        assert_eq!(Command::from_json(&decoded).expect("valid"), command);
    }

    #[test]
    fn patch_ops_round_trip() {
        let command = Command::PatchMotion {
            plan_id: "plan-1".to_string(),
            ops: vec![
                PatchOp::SetDurationSecs(15.0),
                PatchOp::SetStyleAuto,
                PatchOp::SetBrand {
                    colors: vec!["#FFFFFF".to_string()],
                    font: "Lexend".to_string(),
                },
                PatchOp::UpdateScene {
                    index: 0,
                    duration_secs: Some(5.0),
                    text: Some("Hi".to_string()),
                },
                PatchOp::AddScene { index: 1 },
                PatchOp::RemoveScene { index: 2 },
                PatchOp::SetMusicTrack { track_id: None },
                PatchOp::SetSeed(99),
            ],
        };
        let encoded = stringify(&command.to_json());
        let decoded = parse(&encoded).expect("parses");
        assert_eq!(Command::from_json(&decoded).expect("valid"), command);
    }

    #[test]
    fn rejects_unknown_kind_and_bad_plan() {
        let bad_kind = parse(r#"{"kind":"teleport"}"#).expect("parses");
        let error = Command::from_json(&bad_kind).expect_err("unknown kind");
        assert_eq!(error.code, "bad_command");

        let bad_plan = parse(r#"{"kind":"create_motion","plan":{"version":9}}"#).expect("parses");
        let error = Command::from_json(&bad_plan).expect_err("bad plan");
        assert_eq!(error.code, "invalid_plan");
        assert!(error.detail.is_some());
    }

    #[test]
    fn job_state_labels() {
        assert_eq!(JobState::from_label("running"), Some(JobState::Running));
        assert_eq!(JobState::from_label("nope"), None);
    }
}
