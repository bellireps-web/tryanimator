//! MotionPlan v1: the single source of truth for Motion mode creation.
//!
//! All domain rules live here (Rust owns them; TS only transports them):
//! fixed render profile (1080p, 30fps), duration bounds (1..=60s),
//! scene accounting, brand constraints, and derived frame dimensions.

use crate::json::Value;
use std::collections::BTreeMap;

/// Schema version accepted by this crate.
pub const PLAN_VERSION: u32 = 1;
/// Fixed render profile.
pub const RENDER_HEIGHT: u32 = 1080;
pub const RENDER_FPS: u32 = 30;
/// Duration bounds in seconds (UI clamps to the same range).
pub const MIN_DURATION_SECS: f32 = 1.0;
pub const MAX_DURATION_SECS: f32 = 60.0;
/// Tolerance when a resolved duration must match the scene sum.
pub const DURATION_EPSILON_SECS: f32 = 0.05;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AspectRatio {
    SixteenNine,
    NineSixteen,
    OneOne,
    FourThree,
}

impl AspectRatio {
    pub fn from_label(label: &str) -> Option<AspectRatio> {
        match label {
            "16:9" => Some(AspectRatio::SixteenNine),
            "9:16" => Some(AspectRatio::NineSixteen),
            "1:1" => Some(AspectRatio::OneOne),
            "4:3" => Some(AspectRatio::FourThree),
            _ => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            AspectRatio::SixteenNine => "16:9",
            AspectRatio::NineSixteen => "9:16",
            AspectRatio::OneOne => "1:1",
            AspectRatio::FourThree => "4:3",
        }
    }

    /// Render dimensions for the fixed 1080p profile. Widths are even so
    /// hardware encoders accept them (9:16 rounds 607.5 up to 608).
    pub fn dims(self) -> (u32, u32) {
        match self {
            AspectRatio::SixteenNine => (1920, 1080),
            AspectRatio::NineSixteen => (608, 1080),
            AspectRatio::OneOne => (1080, 1080),
            AspectRatio::FourThree => (1440, 1080),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum DurationSel {
    Auto,
    Secs(f32),
}

#[derive(Debug, Clone, PartialEq)]
pub enum StyleSel {
    Auto,
    /// Free canvas: no preset styles. Every scene is authored directly.
    Free,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Brand {
    /// CSS hex colors (`#rgb` or `#rrggbb`).
    pub colors: Vec<String>,
    /// Google Fonts family name.
    pub font: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Visual {
    /// Existing user/reference asset.
    Asset { id: String },
    /// Raster to fetch from the stock provider.
    Stock { query: String },
    /// HyperFrames scene authored by the model (HTML fragment id).
    Authored { doc_id: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Scene {
    pub duration_secs: f32,
    pub visual: Visual,
    pub text: String,
    pub transition: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SfxCue {
    pub id: String,
    pub at_secs: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AudioPlan {
    pub music_track_id: Option<String>,
    pub sfx: Vec<SfxCue>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MotionPlan {
    pub version: u32,
    pub ratio: AspectRatio,
    pub height: u32,
    pub fps: u32,
    pub duration: DurationSel,
    pub style: StyleSel,
    pub brand: Brand,
    pub audio: AudioPlan,
    pub scenes: Vec<Scene>,
    pub seed: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanError {
    /// Dotted field path, e.g. `scenes[2].duration_secs`.
    pub(crate) field: String,
    pub(crate) code: String,
    pub(crate) message: String,
}

impl PlanError {
    pub(crate) fn new(field: &str, code: &str, message: &str) -> PlanError {
        PlanError {
            field: field.to_string(),
            code: code.to_string(),
            message: message.to_string(),
        }
    }
}

impl std::fmt::Display for PlanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} [{}]: {}", self.field, self.code, self.message)
    }
}

impl std::error::Error for PlanError {}

fn is_hex_color(text: &str) -> bool {
    let digits = text.strip_prefix('#').unwrap_or("");
    (digits.len() == 3 || digits.len() == 6) && digits.bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_font_name(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 64
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b' ' | b'+' | b'-'))
}

impl MotionPlan {
    /// Total scene time in seconds.
    pub fn total_secs(&self) -> f32 {
        self.scenes.iter().map(|scene| scene.duration_secs).sum()
    }

    /// Total frame count at the fixed profile (rounds up partial frames).
    pub fn total_frames(&self) -> u32 {
        (self.total_secs() * RENDER_FPS as f32).ceil().max(1.0) as u32
    }

    /// Validate every rule; returns ALL violations (never just the first).
    pub fn validate(&self) -> Result<(), Vec<PlanError>> {
        let mut errors: Vec<PlanError> = Vec::new();

        if self.version != PLAN_VERSION {
            errors.push(PlanError::new(
                "version",
                "unsupported_version",
                &format!("expected plan version {PLAN_VERSION}"),
            ));
        }
        if self.height != RENDER_HEIGHT {
            errors.push(PlanError::new(
                "height",
                "fixed_profile",
                &format!("render height is fixed at {RENDER_HEIGHT}p"),
            ));
        }
        if self.fps != RENDER_FPS {
            errors.push(PlanError::new(
                "fps",
                "fixed_profile",
                &format!("frame rate is fixed at {RENDER_FPS}fps"),
            ));
        }
        if self.scenes.is_empty() {
            errors.push(PlanError::new(
                "scenes",
                "empty",
                "at least one scene is required",
            ));
        }

        let total = self.total_secs();
        if !total.is_finite() || total <= 0.0 {
            errors.push(PlanError::new(
                "scenes",
                "non_positive_total",
                "scene durations must sum to a positive length",
            ));
        } else if total > MAX_DURATION_SECS + DURATION_EPSILON_SECS {
            errors.push(PlanError::new(
                "scenes",
                "too_long",
                &format!("total length {total:.2}s exceeds the {MAX_DURATION_SECS:.0}s cap"),
            ));
        }
        match self.duration {
            DurationSel::Auto => {}
            DurationSel::Secs(expected) => {
                if !expected.is_finite()
                    || !(MIN_DURATION_SECS..=MAX_DURATION_SECS).contains(&expected)
                {
                    errors.push(PlanError::new(
                        "duration",
                        "out_of_range",
                        &format!(
                            "resolved duration must be within {MIN_DURATION_SECS:.0}..={MAX_DURATION_SECS:.0}s"
                        ),
                    ));
                } else if total.is_finite() && (total - expected).abs() > DURATION_EPSILON_SECS {
                    errors.push(PlanError::new(
                        "duration",
                        "scene_sum_mismatch",
                        &format!(
                            "resolved duration {expected:.2}s does not match scene sum {total:.2}s"
                        ),
                    ));
                }
            }
        }

        for (index, scene) in self.scenes.iter().enumerate() {
            let base = format!("scenes[{index}]");
            if !scene.duration_secs.is_finite() || scene.duration_secs <= 0.0 {
                errors.push(PlanError::new(
                    &format!("{base}.duration_secs"),
                    "non_positive",
                    "scene duration must be positive",
                ));
            }
            if scene.transition.trim().is_empty() {
                errors.push(PlanError::new(
                    &format!("{base}.transition"),
                    "empty",
                    "scene transition must name a HyperFrames transition",
                ));
            }
            match &scene.visual {
                Visual::Asset { id } | Visual::Authored { doc_id: id } => {
                    if id.trim().is_empty() {
                        errors.push(PlanError::new(
                            &format!("{base}.visual"),
                            "empty",
                            "visual reference id must not be empty",
                        ));
                    }
                }
                Visual::Stock { query } => {
                    if query.trim().is_empty() {
                        errors.push(PlanError::new(
                            &format!("{base}.visual"),
                            "empty",
                            "stock query must not be empty",
                        ));
                    }
                }
            }
        }

        match &self.style {
            // Free canvas: nothing to validate. Auto and Free both pass.
            StyleSel::Auto | StyleSel::Free => {}
        }

        if self.brand.colors.is_empty() {
            errors.push(PlanError::new(
                "brand.colors",
                "empty",
                "at least one brand color is required",
            ));
        }
        for (index, color) in self.brand.colors.iter().enumerate() {
            if !is_hex_color(color) {
                errors.push(PlanError::new(
                    &format!("brand.colors[{index}]"),
                    "bad_color",
                    "brand colors must be #rgb or #rrggbb",
                ));
            }
        }
        if !is_font_name(&self.brand.font) {
            errors.push(PlanError::new(
                "brand.font",
                "bad_font",
                "brand font must be a Google Fonts family name",
            ));
        }

        for (index, cue) in self.audio.sfx.iter().enumerate() {
            if cue.id.trim().is_empty() {
                errors.push(PlanError::new(
                    &format!("audio.sfx[{index}].id"),
                    "empty",
                    "sfx id must not be empty",
                ));
            }
            if !cue.at_secs.is_finite() || cue.at_secs < 0.0 || cue.at_secs > total {
                errors.push(PlanError::new(
                    &format!("audio.sfx[{index}].at_secs"),
                    "out_of_range",
                    "sfx cue must land inside the total length",
                ));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    /// Canonical JSON encoding of the plan (for cache keys and transport).
    pub fn to_json(&self) -> Value {
        let mut obj = BTreeMap::new();
        obj.insert("version".to_string(), Value::Num(self.version as f64));
        obj.insert(
            "ratio".to_string(),
            Value::Str(self.ratio.label().to_string()),
        );
        obj.insert("height".to_string(), Value::Num(self.height as f64));
        obj.insert("fps".to_string(), Value::Num(self.fps as f64));
        obj.insert(
            "duration".to_string(),
            match self.duration {
                DurationSel::Auto => Value::Str("auto".to_string()),
                DurationSel::Secs(secs) => Value::Num(secs as f64),
            },
        );
        obj.insert(
            "style".to_string(),
            match &self.style {
                StyleSel::Auto => Value::Str("auto".to_string()),
                StyleSel::Free => Value::Str("free".to_string()),
            },
        );
        let mut brand = BTreeMap::new();
        brand.insert(
            "colors".to_string(),
            Value::Arr(
                self.brand
                    .colors
                    .iter()
                    .map(|color| Value::Str(color.clone()))
                    .collect(),
            ),
        );
        brand.insert("font".to_string(), Value::Str(self.brand.font.clone()));
        obj.insert("brand".to_string(), Value::Obj(brand));

        let mut audio = BTreeMap::new();
        audio.insert(
            "music_track_id".to_string(),
            match &self.audio.music_track_id {
                Some(id) => Value::Str(id.clone()),
                None => Value::Null,
            },
        );
        audio.insert(
            "sfx".to_string(),
            Value::Arr(
                self.audio
                    .sfx
                    .iter()
                    .map(|cue| {
                        let mut item = BTreeMap::new();
                        item.insert("id".to_string(), Value::Str(cue.id.clone()));
                        item.insert("at_secs".to_string(), Value::Num(cue.at_secs as f64));
                        Value::Obj(item)
                    })
                    .collect(),
            ),
        );
        obj.insert("audio".to_string(), Value::Obj(audio));

        obj.insert(
            "scenes".to_string(),
            Value::Arr(
                self.scenes
                    .iter()
                    .map(|scene| {
                        let mut item = BTreeMap::new();
                        item.insert(
                            "duration_secs".to_string(),
                            Value::Num(scene.duration_secs as f64),
                        );
                        item.insert(
                            "visual".to_string(),
                            match &scene.visual {
                                Visual::Asset { id } => {
                                    let mut visual = BTreeMap::new();
                                    visual.insert(
                                        "kind".to_string(),
                                        Value::Str("asset".to_string()),
                                    );
                                    visual.insert("id".to_string(), Value::Str(id.clone()));
                                    Value::Obj(visual)
                                }
                                Visual::Stock { query } => {
                                    let mut visual = BTreeMap::new();
                                    visual.insert(
                                        "kind".to_string(),
                                        Value::Str("stock".to_string()),
                                    );
                                    visual.insert("query".to_string(), Value::Str(query.clone()));
                                    Value::Obj(visual)
                                }
                                Visual::Authored { doc_id } => {
                                    let mut visual = BTreeMap::new();
                                    visual.insert(
                                        "kind".to_string(),
                                        Value::Str("authored".to_string()),
                                    );
                                    visual.insert("doc_id".to_string(), Value::Str(doc_id.clone()));
                                    Value::Obj(visual)
                                }
                            },
                        );
                        item.insert("text".to_string(), Value::Str(scene.text.clone()));
                        item.insert(
                            "transition".to_string(),
                            Value::Str(scene.transition.clone()),
                        );
                        Value::Obj(item)
                    })
                    .collect(),
            ),
        );
        obj.insert("seed".to_string(), Value::Num(self.seed as f64));
        Value::Obj(obj)
    }

    /// Decode a plan from JSON, then validate it. Decoding problems and rule
    /// violations share the same structured error list (never silent defaults).
    pub fn from_json(value: &Value) -> Result<MotionPlan, Vec<PlanError>> {
        let mut errors: Vec<PlanError> = Vec::new();
        let obj = match value {
            Value::Obj(map) => map,
            _ => {
                return Err(vec![PlanError::new(
                    "",
                    "type",
                    "plan must be a JSON object",
                )]);
            }
        };
        fn lookup<'m>(
            obj: &'m BTreeMap<String, Value>,
            errors: &mut Vec<PlanError>,
            field: &str,
        ) -> Option<&'m Value> {
            match obj.get(field) {
                Some(entry) => Some(entry),
                None => {
                    errors.push(PlanError::new(
                        field,
                        "missing",
                        "required field is missing",
                    ));
                    None
                }
            }
        }
        // Local alias so call sites read naturally.
        let lookup = lookup;

        let version = lookup(obj, &mut errors, "version").and_then(|entry| entry.as_u32());
        if version.is_none() && obj.contains_key("version") {
            errors.push(PlanError::new("version", "type", "expected a number"));
        }
        let ratio = lookup(obj, &mut errors, "ratio").and_then(|entry| {
            match entry.as_str().and_then(AspectRatio::from_label) {
                Some(ratio) => Some(ratio),
                None => {
                    errors.push(PlanError::new(
                        "ratio",
                        "unknown",
                        "expected 16:9, 9:16, 1:1 or 4:3",
                    ));
                    None
                }
            }
        });
        let height = lookup(obj, &mut errors, "height").and_then(|entry| entry.as_u32());
        if height.is_none() && obj.contains_key("height") {
            errors.push(PlanError::new("height", "type", "expected a number"));
        }
        let fps = lookup(obj, &mut errors, "fps").and_then(|entry| entry.as_u32());
        if fps.is_none() && obj.contains_key("fps") {
            errors.push(PlanError::new("fps", "type", "expected a number"));
        }
        let duration = lookup(obj, &mut errors, "duration").and_then(|entry| match entry {
            Value::Str(text) if text == "auto" => Some(DurationSel::Auto),
            Value::Num(secs) => Some(DurationSel::Secs(*secs as f32)),
            _ => {
                errors.push(PlanError::new(
                    "duration",
                    "type",
                    "expected \"auto\" or seconds",
                ));
                None
            }
        });
        let style = lookup(obj, &mut errors, "style").and_then(|entry| match entry {
            Value::Str(text) if text == "auto" => Some(StyleSel::Auto),
            Value::Str(text) if text == "free" => Some(StyleSel::Free),
            _ => {
                errors.push(PlanError::new(
                    "style",
                    "type",
                    "expected \"auto\" or \"free\" (presets were removed)",
                ));
                None
            }
        });

        let mut colors: Vec<String> = Vec::new();
        let mut font: Option<String> = None;
        match lookup(obj, &mut errors, "brand") {
            Some(Value::Obj(brand)) => {
                match brand.get("colors").and_then(|entry| entry.as_arr()) {
                    Some(items) => {
                        for item in items {
                            match item.as_str() {
                                Some(color) => colors.push(color.to_string()),
                                None => errors.push(PlanError::new(
                                    "brand.colors",
                                    "type",
                                    "colors must be strings",
                                )),
                            }
                        }
                    }
                    None => errors.push(PlanError::new(
                        "brand.colors",
                        "type",
                        "expected an array of strings",
                    )),
                }
                match brand.get("font").and_then(|entry| entry.as_str()) {
                    Some(name) => font = Some(name.to_string()),
                    None => errors.push(PlanError::new("brand.font", "type", "expected a string")),
                }
            }
            Some(_) => errors.push(PlanError::new("brand", "type", "expected an object")),
            None => {}
        }

        let mut music_track_id: Option<String> = None;
        let mut sfx: Vec<SfxCue> = Vec::new();
        match lookup(obj, &mut errors, "audio") {
            Some(Value::Obj(audio)) => {
                match audio.get("music_track_id") {
                    Some(Value::Null) | None => {}
                    Some(Value::Str(id)) => music_track_id = Some(id.clone()),
                    Some(_) => errors.push(PlanError::new(
                        "audio.music_track_id",
                        "type",
                        "expected a string or null",
                    )),
                }
                match audio.get("sfx").and_then(|entry| entry.as_arr()) {
                    Some(items) => {
                        for (index, item) in items.iter().enumerate() {
                            let base = format!("audio.sfx[{index}]");
                            let id = item
                                .get("id")
                                .and_then(|entry| entry.as_str())
                                .unwrap_or("")
                                .to_string();
                            let at_secs = item
                                .get("at_secs")
                                .and_then(|entry| entry.as_f64())
                                .unwrap_or(f32::NAN as f64)
                                as f32;
                            if item.get("id").and_then(|entry| entry.as_str()).is_none() {
                                errors.push(PlanError::new(
                                    &format!("{base}.id"),
                                    "type",
                                    "expected a string",
                                ));
                            }
                            if item
                                .get("at_secs")
                                .and_then(|entry| entry.as_f64())
                                .is_none()
                            {
                                errors.push(PlanError::new(
                                    &format!("{base}.at_secs"),
                                    "type",
                                    "expected a number",
                                ));
                            }
                            sfx.push(SfxCue { id, at_secs });
                        }
                    }
                    None => errors.push(PlanError::new("audio.sfx", "type", "expected an array")),
                }
            }
            Some(_) => errors.push(PlanError::new("audio", "type", "expected an object")),
            None => {}
        }

        let mut scenes: Vec<Scene> = Vec::new();
        match lookup(obj, &mut errors, "scenes").and_then(|entry| entry.as_arr()) {
            Some(items) => {
                for (index, item) in items.iter().enumerate() {
                    let base = format!("scenes[{index}]");
                    let duration_secs = item
                        .get("duration_secs")
                        .and_then(|entry| entry.as_f64())
                        .unwrap_or(f32::NAN as f64) as f32;
                    if item
                        .get("duration_secs")
                        .and_then(|entry| entry.as_f64())
                        .is_none()
                    {
                        errors.push(PlanError::new(
                            &format!("{base}.duration_secs"),
                            "type",
                            "expected a number",
                        ));
                    }
                    let visual = match item.get("visual") {
                        Some(Value::Obj(visual)) => {
                            match visual.get("kind").and_then(|kind| kind.as_str()) {
                                Some("asset") => Some(Visual::Asset {
                                    id: visual
                                        .get("id")
                                        .and_then(|id| id.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                }),
                                Some("stock") => Some(Visual::Stock {
                                    query: visual
                                        .get("query")
                                        .and_then(|query| query.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                }),
                                Some("authored") => Some(Visual::Authored {
                                    doc_id: visual
                                        .get("doc_id")
                                        .and_then(|doc| doc.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                }),
                                _ => {
                                    errors.push(PlanError::new(
                                        &format!("{base}.visual.kind"),
                                        "type",
                                        "expected asset, stock or authored",
                                    ));
                                    None
                                }
                            }
                        }
                        _ => {
                            errors.push(PlanError::new(
                                &format!("{base}.visual"),
                                "type",
                                "expected an object",
                            ));
                            None
                        }
                    };
                    let text = item
                        .get("text")
                        .and_then(|entry| entry.as_str())
                        .unwrap_or("")
                        .to_string();
                    if item.get("text").and_then(|entry| entry.as_str()).is_none() {
                        errors.push(PlanError::new(
                            &format!("{base}.text"),
                            "type",
                            "expected a string",
                        ));
                    }
                    let transition = item
                        .get("transition")
                        .and_then(|entry| entry.as_str())
                        .unwrap_or("")
                        .to_string();
                    if item
                        .get("transition")
                        .and_then(|entry| entry.as_str())
                        .is_none()
                    {
                        errors.push(PlanError::new(
                            &format!("{base}.transition"),
                            "type",
                            "expected a string",
                        ));
                    }
                    if let Some(visual) = visual {
                        scenes.push(Scene {
                            duration_secs,
                            visual,
                            text,
                            transition,
                        });
                    }
                }
            }
            None => {
                if obj.contains_key("scenes") {
                    errors.push(PlanError::new("scenes", "type", "expected an array"));
                }
            }
        }

        let seed = lookup(obj, &mut errors, "seed").and_then(|entry| entry.as_f64());
        if seed.is_none() && obj.contains_key("seed") {
            errors.push(PlanError::new("seed", "type", "expected a number"));
        }

        if !errors.is_empty() {
            return Err(errors);
        }
        let plan = MotionPlan {
            version: version.unwrap_or(0),
            ratio: ratio.unwrap_or(AspectRatio::SixteenNine),
            height: height.unwrap_or(0),
            fps: fps.unwrap_or(0),
            duration: duration.unwrap_or(DurationSel::Auto),
            style: style.unwrap_or(StyleSel::Auto),
            brand: Brand {
                colors,
                font: font.unwrap_or_default(),
            },
            audio: AudioPlan {
                music_track_id,
                sfx,
            },
            scenes,
            seed: seed.unwrap_or(0.0) as u64,
        };
        match plan.validate() {
            Ok(()) => Ok(plan),
            Err(mut rule_errors) => {
                errors.append(&mut rule_errors);
                Err(errors)
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::json::{parse, stringify};

    pub fn sample_plan() -> MotionPlan {
        MotionPlan {
            version: 1,
            ratio: AspectRatio::NineSixteen,
            height: 1080,
            fps: 30,
            duration: DurationSel::Secs(30.0),
            style: StyleSel::Free,
            brand: Brand {
                colors: vec!["#7069AA".to_string(), "#1F1B46".to_string()],
                font: "Figtree".to_string(),
            },
            audio: AudioPlan {
                music_track_id: Some("pixabay-42".to_string()),
                sfx: vec![SfxCue {
                    id: "whoosh-1".to_string(),
                    at_secs: 5.0,
                }],
            },
            scenes: vec![
                Scene {
                    duration_secs: 10.0,
                    visual: Visual::Authored {
                        doc_id: "scene-1".to_string(),
                    },
                    text: "Hello".to_string(),
                    transition: "cut".to_string(),
                },
                Scene {
                    duration_secs: 20.0,
                    visual: Visual::Stock {
                        query: "neon city".to_string(),
                    },
                    text: "World".to_string(),
                    transition: "fade".to_string(),
                },
            ],
            seed: 7,
        }
    }

    #[test]
    fn valid_plan_passes() {
        assert!(sample_plan().validate().is_ok());
    }

    #[test]
    fn dims_cover_all_ratios() {
        assert_eq!(AspectRatio::SixteenNine.dims(), (1920, 1080));
        assert_eq!(AspectRatio::NineSixteen.dims(), (608, 1080));
        assert_eq!(AspectRatio::OneOne.dims(), (1080, 1080));
        assert_eq!(AspectRatio::FourThree.dims(), (1440, 1080));
    }

    #[test]
    fn total_frames_rounds_up() {
        let mut plan = sample_plan();
        plan.scenes[0].duration_secs = 0.05;
        plan.scenes[1].duration_secs = 0.05;
        plan.duration = DurationSel::Secs(0.1);
        // 0.1s at 30fps = 3 frames.
        assert_eq!(plan.total_frames(), 3);
    }

    #[test]
    fn rejects_every_rule() {
        let mut plan = sample_plan();
        plan.version = 2;
        plan.height = 720;
        plan.fps = 60;
        plan.duration = DurationSel::Secs(61.0);
        plan.scenes.clear();
        plan.brand.colors = vec!["red".to_string()];
        plan.brand.font = "Evil<script>".to_string();
        plan.audio.sfx.push(SfxCue {
            id: "".to_string(),
            at_secs: 999.0,
        });
        let errors = plan.validate().expect_err("must fail");
        let codes: Vec<&str> = errors.iter().map(|error| error.code.as_str()).collect();
        for expected in [
            "unsupported_version",
            "fixed_profile",
            "out_of_range",
            "empty",
            "bad_color",
            "bad_font",
            "out_of_range",
        ] {
            assert!(codes.contains(&expected), "missing {expected} in {codes:?}");
        }
        // All violations reported, not just the first.
        assert!(errors.len() >= 8, "got {errors:?}");
    }

    #[test]
    fn rejects_sum_mismatch() {
        let mut plan = sample_plan();
        plan.duration = DurationSel::Secs(10.0);
        let errors = plan.validate().expect_err("sum is 30, expected 10");
        assert!(errors
            .iter()
            .any(|error| error.code == "scene_sum_mismatch"));
    }

    #[test]
    fn json_round_trip() {
        let plan = sample_plan();
        let encoded = stringify(&plan.to_json());
        let decoded = parse(&encoded).expect("parses");
        assert_eq!(MotionPlan::from_json(&decoded).expect("valid"), plan);
    }

    #[test]
    fn json_rejects_missing_and_types() {
        let decoded = parse(r#"{"version":"1","ratio":"3:2"}"#).expect("parses");
        let errors = MotionPlan::from_json(&decoded).expect_err("must fail");
        assert!(errors.len() >= 3, "got {errors:?}");
    }
}
