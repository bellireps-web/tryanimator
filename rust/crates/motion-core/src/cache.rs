//! Content-addressed cache keys (Slice 3).
//!
//! Key design: `motion/v1/{scope}/{hex}` where hex is FNV-1a 64 over a
//! canonical composite string. FNV-1a is NOT cryptographic — keys only
//! need stability and uniformity, and both properties are pinned by the
//! cross-language vectors in `src/cache/keys.test.js` (must match these).
//! Canonical plan JSON comes from `MotionPlan::to_json` + `stringify`,
//! whose object keys are already sorted.

/// FNV-1a 64-bit. Offset basis 14695981039346656037, prime 1099511628211.
pub fn fnv1a64(bytes: &[u8]) -> u64 {
    const OFFSET: u64 = 14695981039346656037;
    const PRIME: u64 = 1099511628211;
    let mut hash = OFFSET;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

/// Lowercase 16-hex-digit rendering (padded).
pub fn hex16(value: u64) -> String {
    format!("{value:016x}")
}

fn scoped(scope: &str, composite: &str) -> String {
    format!("motion/v1/{scope}/{}", hex16(fnv1a64(composite.as_bytes())))
}

/// Key for a validated plan's canonical JSON.
pub fn plan_key(canonical_plan_json: &str) -> String {
    scoped("plan", canonical_plan_json)
}

/// Key for a generated scene document. Binds plan + doc + model version so
/// a model upgrade or a scene edit invalidates exactly what changed.
pub fn doc_key(plan_key: &str, doc_id: &str, model_version: &str) -> String {
    scoped(
        "doc",
        &format!("{plan_key}\n{doc_id}\n{model_version}"),
    )
}

/// Key for one rendered segment. Binds plan + segment geometry.
pub fn segment_key(plan_key: &str, index: u32, start_frame: u32, frame_count: u32) -> String {
    scoped(
        "seg",
        &format!("{plan_key}\n{index}\n{start_frame}\n{frame_count}"),
    )
}

/// Key for the final muxed MP4. Binds plan + model version.
pub fn final_key(plan_key: &str, model_version: &str) -> String {
    scoped("final", &format!("{plan_key}\n{model_version}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv_vectors() {
        // Pinned cross-language vectors (must match src/cache/keys.js).
        assert_eq!(fnv1a64(b""), 14695981039346656037);
        assert_eq!(hex16(fnv1a64(b"")), "cbf29ce484222325");
        assert_eq!(hex16(fnv1a64(b"foobar")), "85944171f73967e8");
    }

    #[test]
    fn keys_are_stable_and_scoped() {
        let a = plan_key("{}");
        assert_eq!(a, plan_key("{}"));
        assert!(a.starts_with("motion/v1/plan/"));
        assert_ne!(a, plan_key("{\"a\":1}"));
        assert_ne!(
            doc_key(&a, "d1", "m1"),
            segment_key(&a, 0, 0, 600),
            "scopes must not collide"
        );
    }

    #[test]
    fn model_version_separates_outputs() {
        let plan = plan_key("{\"seed\":7}");
        assert_ne!(doc_key(&plan, "d1", "m1"), doc_key(&plan, "d1", "m2"));
        assert_ne!(final_key(&plan, "m1"), final_key(&plan, "m2"));
    }

    #[test]
    fn segment_geometry_separates_keys() {
        let plan = plan_key("{\"seed\":7}");
        assert_ne!(
            segment_key(&plan, 0, 0, 600),
            segment_key(&plan, 1, 600, 600)
        );
    }
}
