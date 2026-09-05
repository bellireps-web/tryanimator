/**
 * HyperFrames catalog presets por elemento del modo Editor.
 *
 * Fuente: https://hyperframes.heygen.com/catalog/components/ (375 páginas).
 * Cada elemento del editor mapea a bloques reales instalables con
 * `npx hyperframes add <id>`. Cuando no hay preset visual, se explica por qué
 * (el elemento no es visual o vive en otro pipeline).
 */

export const EDITOR_ELEMENTS = [
  "B Rolls",
  "Sounds",
  "Effects",
  "Transitions",
  "Motion Graphics",
  "Captions",
  "Remove Silences",
];

export const HYPERFRAMES_PRESETS = {
  Captions: {
    ids: [
      "caption-camera-follow",
      "caption-clip-wipe",
      "caption-editorial-emphasis",
      "caption-emoji-pop",
      "caption-glitch-rgb",
      "caption-gradient-fill",
      "caption-highlight",
      "caption-kinetic-slam",
      "caption-matrix-decode",
      "caption-neon-accent",
      "caption-neon-glow",
      "caption-parallax-layers",
      "caption-particle-burst",
      "caption-pill-karaoke",
      "caption-texture",
      "caption-weight-shift",
      "mk-callout-highlight",
    ],
    note: "17 estilos. Se instalan con `npx hyperframes add <id>`.",
  },
  Transitions: {
    ids: [
      // Shader Transitions (14)
      "chromatic-radial-split",
      "cinematic-zoom",
      "cross-warp-morph",
      "domain-warp-dissolve",
      "flash-through-white",
      "glitch",
      "gravitational-lens",
      "light-leak",
      "ridged-burn",
      "ripple-waves",
      "sdf-iris",
      "swirl-vortex",
      "thermal-distortion",
      "whip-pan",
      // CSS Transitions (grupos showcase)
      "transitions-3d",
      "transitions-blur",
      "transitions-cover",
      "transitions-destruction",
      "transitions-dissolve",
      "transitions-distortion",
      "transitions-grid",
      "transitions-light",
      "transitions-mechanical",
      "transitions-other",
      "transitions-push",
      "transitions-radial",
      "transitions-scale",
      "hw-scribble-transition",
      "mk-clone-wall-transition",
      "organic-light-leak-overlay",
      "beat-freeze-cut",
    ],
    note: "Shader + CSS. Van entre assets/b-rolls, no sobre el footage base.",
  },
  "Motion Graphics": {
    ids: [
      // Lower Thirds (12)
      "lower-third-bild",
      "lt-accent-underline",
      "lt-bold-block",
      "lt-clean-bar",
      "lt-color-block",
      "lt-dark-card",
      "lt-kicker-name",
      "lt-mask-reveal",
      "lt-side-rule",
      "lt-soft-pill",
      "lt-stack-bars",
      "news-ticker",
      // Kinetic / emphasis reutilizable
      "headline-slam",
      "kinetic-center-build",
      "kinetic-type-swap",
      "marker-highlight",
      "cta-lockup",
      "logo-sting",
    ],
    note: "Lower thirds + kinetic type. Overlays, no tocan el corte.",
  },
  Effects: {
    ids: [
      "rgb-glitch-text",
      "scan-band",
      "shimmer-sweep",
      "particle-text-dissolve",
      "vfx-anamorphic-flare",
      "grade-split-reveal",
      "editorial-flash-overlay",
      "freeze-frame-dressing",
    ],
    note: "Efectos visuales puntuales. Cobertura parcial: color-grade completo y 3D real van por pipeline canvas/WebGL, no por preset suelto.",
  },
  "B Rolls": {
    ids: [],
    note: "Sin preset: los b-rolls son tus assets (imagen/video) o stock. HyperFrames solo los coloca (slot img/video/HTML) y les da Ken Burns / entrada.",
  },
  Sounds: {
    ids: [],
    note: "Sin preset visual: SFX/música vienen de la librería de audio (Pixabay vía proxy), no del catálogo HyperFrames. Se mezclan en la timeline, no se renderizan como bloques.",
  },
  "Remove Silences": {
    ids: [],
    note: "Sin preset: es corte por transcript local (whisper-x). Ver editor/transcribe_local.py. Quita gaps >= 0.30s y pega clips edge-to-edge.",
  },
};

/** Explicación corta para la UI cuando un elemento no tiene presets. */
export function presetNoteFor(element) {
  return (HYPERFRAMES_PRESETS[element] && HYPERFRAMES_PRESETS[element].note) || "";
}

/** IDs instalables para un elemento (vacío = sin preset). */
export function presetIdsFor(element) {
  return (HYPERFRAMES_PRESETS[element] && HYPERFRAMES_PRESETS[element].ids) || [];
}
