/**
 * Preset catalog: the HyperFrames styles this harness can paint.
 * Until the HyperFrames package is vendored (needs network), presets are
 * data + local painters with pinned versions. The catalog is the single
 * place where a preset id resolves; unknown ids are a hard error.
 */

export const PRESETS = [
  {
    id: "kinetic-type",
    version: "1.0.0",
    description: "Full-screen kinetic typography over brand color.",
  },
  {
    id: "count-up",
    version: "1.0.0",
    description: "Animated number count-up with caption.",
  },
  {
    id: "lower-third",
    version: "1.0.0",
    description: "Lower-third band with title and subtitle.",
  },
  {
    id: "logo-sting",
    version: "1.0.0",
    description: "Brand mark sting: initial letter with expanding ring.",
  },
];

const BY_ID = new Map(PRESETS.map((preset) => [preset.id, preset]));

/** Resolve a preset id to its pinned record; throws unknown_preset otherwise. */
export function resolvePreset(id) {
  const preset = BY_ID.get(id);
  if (!preset) {
    const error = new Error(`unknown HyperFrames preset: ${id}`);
    error.code = "unknown_preset";
    throw error;
  }
  return preset;
}

/** ids only, for UI dropdowns. */
export function presetIds() {
  return PRESETS.map((preset) => preset.id);
}
