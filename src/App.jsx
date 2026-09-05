import { createSignal, onMount, onCleanup, createEffect, Show } from "solid-js";
import OnboardingView from "./OnboardingView.jsx";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { createViewportObserver } from "@solid-primitives/intersection-observer";
import { Home, Folder, LayoutTemplate, BookOpen, Users, CircleDollarSign, Settings, Scissors, Film, WandSparkles, AudioLines, FileText, Clapperboard, PanelLeftClose, PanelLeftOpen, Play, AtSign, ChevronDown, Palette, Image, Music2, SlidersHorizontal, ZoomIn, Captions, Plus, Atom, Square, Check, X, Sparkles, SquarePlay, Pause, Video, Copy, Lock, ArrowLeftRight, Volume2, VolumeX } from "lucide-solid";
import NewVideoView from "./NewVideoView.jsx";
import LoadingView from "./LoadingView.jsx";
import StudioEditorView from "./StudioEditorView.jsx";
import { buildMotionPlanInput, createMotionJob } from "./motion/jobs.js";
import { createBrowserAdapters } from "./motion/browser.js";
import { buildCompRecord, getMotionProjects } from "./motion/projects.js";
import { EDITOR_ELEMENTS } from "./motion/hyperframesPresets.js";
import { mountAuthIsland, hasClerkKey, mountSettingsAuth } from "./auth/reactAuth.js";
import { CountdownNotice, pokeCountdown } from "./Availability.jsx";

const EDITOR_VIDEO_MIN = 1;
const EDITOR_VIDEO_MAX = 1;
const BRAND_FONTS = ["Figtree", "Lexend", "Inter", "Space Grotesk", "DM Sans"];

/** One-click preset swatches for the brand color rows. */
const BRAND_SWATCHES = ["#F5F3FF", "#FFFFFF", "#B8B2EE", "#7069AA", "#39375B", "#1F1B46", "#060511", "#2EC4B6", "#FF5A5A", "#FFC857"];

/**
 * Kokoro TTS voice catalog (Kokoro-82M voice IDs). Shown in Creator Brand
 * only when a script is written; TTS rendering itself lands later.
 */
const KOKORO_VOICES = [
  { group: "American Female", voices: ["af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky"] },
  { group: "American Male", voices: ["am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck"] },
  { group: "British Female", voices: ["bf_alice", "bf_emma", "bf_isabella", "bf_lily"] },
  { group: "British Male", voices: ["bm_daniel", "bm_fable", "bm_george", "bm_lewis"] },
];
const KOKORO_ACCENTS = { af: "American Female", am: "American Male", bf: "British Female", bm: "British Male" };

/** "af_heart" -> "American Female · Heart (af_heart)". Pure. */
function voiceLabel(id) {
  const [accent, name] = String(id).split("_");
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
  return `${KOKORO_ACCENTS[accent] || accent} · ${cap(name)} (${id})`;
}

const MAX_REFERENCE_IMAGES = 4;
const REFERENCE_MAX_DIM = 1024;

/** Load a File into an <img> (browser-only). Nota: `Image` de lucide eclipsa
 *  el constructor global en este módulo, por eso se usa `window.Image`. */
function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable image"));
    };
    img.src = url;
  });
}

/** Downscale an image File to a JPEG data URL (caps tokens sent to the model). */
async function downscaleImageFile(file, maxDim = REFERENCE_MAX_DIM) {
  const img = await loadImageFile(file);
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || maxDim) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || maxDim) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.82);
}

/**
 * Sample a video File at even fractions: poster frame (data URL for the
 * agent). Browser-only; timeouts keep submit snappy.
 */
async function sampleVideoFile(file, { fractions = [0.15, 0.5, 0.85], width = 320 } = {}) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("video metadata timeout")), 8000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("unreadable video"));
      };
      video.src = url;
    });
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    const w = width;
    const h = Math.max(1, Math.round((width * vh) / Math.max(1, vw)));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const seek = (t) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("video seek timeout")), 5000);
        video.onseeked = () => {
          clearTimeout(timer);
          resolve();
        };
        video.onerror = () => {
          clearTimeout(timer);
          reject(new Error("video seek failed"));
        };
        video.currentTime = Math.min(Math.max(0, t), Math.max(0, duration - 0.05));
      });
    let poster = null;
    for (let i = 0; i < fractions.length; i++) {
      if (!duration) break;
      await seek(fractions[i] * duration);
      ctx.drawImage(video, 0, 0, w, h);
      if (i === 1 || !poster) poster = canvas.toDataURL("image/jpeg", 0.82);
    }
    return { poster, duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const MOTION_PROXY = import.meta.env.VITE_MOTION_PROXY || "";
const MOTION_APP_TOKEN = import.meta.env.VITE_MOTION_APP_TOKEN || "";
let motionAdapters = null;
function getMotionAdapters() {
  if (!motionAdapters) {
    motionAdapters = createBrowserAdapters({ proxyBase: MOTION_PROXY, appToken: MOTION_APP_TOKEN });
  }
  return motionAdapters;
}

function LogoIcon() {
  return <img class="landing-logo-icon" src="/icon-animator.png" alt="" />;
}
function EnterIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 10 4 15l5 5" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></svg>;
}

/** React-powered Clerk controls mounted into a Solid-owned slot. */
function AuthIsland() {
  let slot = null;
  let unmount = () => {};
  onMount(() => {
    unmount = mountAuthIsland(slot);
  });
  onCleanup(() => unmount());
  return <div class="landing-auth-slot" ref={(el) => { slot = el; }} />;
}

/** Floating Settings window: billing shortcuts (paused) + Clerk session. */
function SettingsPop({ onClose }) {
  let slot = null;
  let unmount = () => {};
  const goLogin = () => {
    onClose();
    window.location.hash = "onboarding";
  };
  const goLanding = () => {
    onClose();
    window.location.hash = "top";
  };
  onMount(() => {
    unmount = mountSettingsAuth(slot, { onLogin: goLogin, onLogout: goLanding });
  });
  onCleanup(() => unmount());
  return (
    <div class="settings-overlay" onClick={onClose}>
      <div class="settings-pop" role="dialog" aria-label="Settings" onClick={(event) => event.stopPropagation()}>
        <p class="settings-title">Settings</p>
        <button type="button" class="settings-item" onClick={() => pokeCountdown()}>Upgrade to Plus</button>
        <button type="button" class="settings-item" onClick={() => pokeCountdown()}>Manage subscription</button>
        <div class="settings-auth" ref={(el) => { slot = el; }} />
        <CountdownNotice cls="settings-notice" />
      </div>
    </div>
  );
}

function useReveal() {
  // Created inside the component (not at module scope) so its
  // computations/cleanups belong to the app root instead of warning.
  const [addReveal] = createViewportObserver({ threshold: 0.18 });
  return (el) => {
    addReveal(el, (entry) => {
      if (entry.isIntersecting) el.classList.add("revealed");
    });
  };
}

function syncMotionPlay(video, playing) {
  const player = video.closest(".motion-rect-video, .creator-rect-video, .editor-rect-video");
  const button = player && player.querySelector(".motion-play");
  if (button) button.classList.toggle("playing", playing);
}
function toggleEditorMute(button) {
  const player = button.closest(".editor-rect-video");
  const video = player && player.querySelector(".motion-video");
  if (!video) return;
  if (video.muted) {
    document.querySelectorAll(".editor-rect-video .motion-video").forEach((v) => {
      v.muted = true;
      const b = v.closest(".editor-rect-video") && v.closest(".editor-rect-video").querySelector(".editor-mute");
      if (b) { b.classList.add("muted"); b.setAttribute("aria-label", "Unmute"); }
    });
    video.muted = false;
    button.classList.remove("muted");
    button.setAttribute("aria-label", "Mute");
  } else {
    video.muted = true;
    button.classList.add("muted");
    button.setAttribute("aria-label", "Unmute");
  }
}
function toggleMotionVideo(button) {
  const player = button.closest(".motion-rect-video, .creator-rect-video, .editor-rect-video");
  const video = player && player.querySelector(".motion-video");
  if (!video) return;
  if (video.paused) {
    video.play();
    button.classList.add("playing");
  } else {
    video.pause();
    button.classList.remove("playing");
  }
}

function ModeSwitch({ mode, setMode }) {
  return (
    <div class="landing-switch" role="tablist" aria-label="Workspace mode">
      <div class={`landing-switch-indicator ${mode()}`} />
      <button class={mode() === "editor" ? "selected" : ""} onClick={() => setMode("editor")} role="tab">Editor</button>
      <span class={`landing-divider ${mode() === "motion" ? "" : "hidden"}`} />
      <button class={mode() === "creator" ? "selected" : ""} onClick={() => setMode("creator")} role="tab">Creator</button>
      <span class={`landing-divider ${mode() === "editor" ? "" : "hidden"}`} />
      <button class={mode() === "motion" ? "selected" : ""} onClick={() => setMode("motion")} role="tab">Motion</button>
    </div>
  );
}

function CompThumb({ video }) {
  const [thumb, setThumb] = createSignal(null);
  onMount(() => {
    let url = null;
    let videoEl = null;
    let cancelled = false;
    (async () => {
      try {
        if (!video || !video.length) return;
        url = URL.createObjectURL(new Blob([video], { type: "video/mp4" }));
        videoEl = document.createElement("video");
        videoEl.muted = true;
        videoEl.preload = "auto";
        videoEl.src = url;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("thumb timeout")), 6000);
          videoEl.onloadedmetadata = () => {
            clearTimeout(timer);
            resolve();
          };
          videoEl.onerror = () => {
            clearTimeout(timer);
            reject(new Error("thumb load failed"));
          };
        });
        const target = videoEl.duration && Number.isFinite(videoEl.duration)
          ? Math.min(Math.max(0.5, videoEl.duration * 0.5), Math.max(0, videoEl.duration - 0.2))
          : 0.4;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("thumb seek timeout")), 6000);
          videoEl.onseeked = () => {
            clearTimeout(timer);
            resolve();
          };
          videoEl.currentTime = target;
        });
        if (cancelled || !videoEl.videoWidth) return;
        const canvas = document.createElement("canvas");
        const scale = 480 / videoEl.videoWidth;
        canvas.width = 480;
        canvas.height = Math.max(1, Math.round(videoEl.videoHeight * scale));
        canvas.getContext("2d").drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        if (!cancelled) setThumb(canvas.toDataURL("image/jpeg", 0.88));
      } catch {
        // Thumbnail is decorative: the colored tile stays.
      } finally {
        if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    })();
    onCleanup(() => {
      cancelled = true;
    });
  });
  return (
    <Show when={thumb()} fallback={<span class="project-random-fill" aria-hidden="true" />}>
      <img class="project-thumb" src={thumb()} alt="" />
    </Show>
  );
}

function ProjectsView({ onNewProject, onOpenComp }) {
  const [comps, setComps] = createSignal(null);
  const reload = async () => {
    try {
      setComps(await getMotionProjects().list());
    } catch (error) {
      console.warn("projects: list failed", error);
      setComps([]);
    }
  };
  onMount(reload);
  const removeComp = async (id, event) => {
    if (event) event.stopPropagation();
    try {
      await getMotionProjects().remove(id);
    } catch (error) {
      console.warn("projects: delete failed", error);
    }
    reload();
  };
  const colorFor = (id) => {
    let hash = 0;
    for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 45% 32%)`;
  };
  const metaFor = (comp) => {
    const bits = [];
    if (comp.durationSecs) bits.push(`${Math.round(comp.durationSecs)}s`);
    if (comp.ratio) bits.push(comp.ratio);
    if (comp.version > 1) bits.push(`v${comp.version}`);
    return bits.join(" · ");
  };

  return (
    <main class="projects-main" aria-label="Projects">
      <div class="projects-grid">
        <article class="project-card">
          <div class="project-preview" style={{ "--project-fill": "#191922" }} onClick={onNewProject} role="button" tabindex="0">
            <span class="project-plus" aria-hidden="true">＋</span>
          </div>
          <h2>New Project</h2>
        </article>
        <Show when={comps() === null}><p class="projects-empty">Loading projects…</p></Show>
        <Show when={comps() !== null && comps().length === 0}><p class="projects-empty">No compositions yet: create your first video.</p></Show>
        {comps() && comps().map((comp) => <article class="project-card">
          <div class="project-preview" style={{ "--project-fill": colorFor(comp.id) }} onClick={() => onOpenComp && onOpenComp(comp)} role="button" tabindex="0" aria-label={`Open ${comp.name}`}>
            <CompThumb video={comp.video} />
            <button class="project-more" aria-label={`Delete ${comp.name}`} onClick={(event) => removeComp(comp.id, event)}>×</button>
          </div>
          <h2>{comp.name}</h2>
          <p class="project-meta">{metaFor(comp)}</p>
        </article>)}
      </div>
    </main>
  );
}

function EditorView({ onBack, onEditRequest, onOpenComp, startOnProjects }) {
  const [prompt, setPrompt] = createSignal("");
  const [active, setActive] = createSignal(startOnProjects ? "projects" : "home");
  const [sidebarVisible, setSidebarVisible] = createSignal(true);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [editorMode, setEditorMode] = createSignal("editor");
  const [showProjects, setShowProjects] = createSignal(!!startOnProjects);
  const [openMenu, setOpenMenu] = createSignal(null);
  const [selectedElements, setSelectedElements] = createSignal([]);
  const [motionDuration, setMotionDuration] = createSignal(30);
  const [customDuration, setCustomDuration] = createSignal("");
  const durationPresets = ["Auto", 5, 10, 15, 30, 60];
  const durationLabel = () => motionDuration() === "Auto" ? "Auto" : `${motionDuration()}s`;
  const [motionScenes, setMotionScenes] = createSignal(1);
  const scenePresets = [1, 2, 3, 4];
  const sceneLabel = () => motionScenes() === 1 ? "1 scene" : `${motionScenes()} scenes`;
  const applyCustomDuration = () => {
    const n = Math.round(Number(customDuration()));
    if (Number.isFinite(n)) setMotionDuration(Math.min(60, Math.max(1, n)));
    setCustomDuration("");
  };
  const [format, setFormat] = createSignal("9:16");
  const [assetsOpen, setAssetsOpen] = createSignal(false);
  const [videoOpen, setVideoOpen] = createSignal(false);
  const [stylesOpen, setStylesOpen] = createSignal(false);
  const [scriptOpen, setScriptOpen] = createSignal(false);
  const [creatorTab, setCreatorTab] = createSignal("audio");
  const [creatorAudio, setCreatorAudio] = createSignal(null);
  const [creatorScript, setCreatorScript] = createSignal("");
  const [creatorVoice, setCreatorVoice] = createSignal("af_heart");
  const creatorCount = () => (creatorAudio() ? 1 : 0) + (creatorScript().trim() ? 1 : 0);
  const addCreatorAudio = (event) => {
    const file = event.currentTarget.files && event.currentTarget.files[0];
    event.currentTarget.value = "";
    if (!file || !String(file.type || "").startsWith("audio/")) return;
    if (creatorAudio()) URL.revokeObjectURL(creatorAudio().url);
    setCreatorAudio({ name: file.name, url: URL.createObjectURL(file), type: file.type || "", file });
  };
  const [selectedStyles, setSelectedStyles] = createSignal([]);
  const [brandColors, setBrandColors] = createSignal(["#F5F3FF", "#B8B2EE", "#1F1B46"]);
  const [brandFont, setBrandFont] = createSignal("Figtree");
  const setBrandColor = (i, v) => setBrandColors((prev) => prev.map((c, j) => (j === i ? v : c)));
  const toggleStyle = (label) => setSelectedStyles((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label]);
  const elements = EDITOR_ELEMENTS;

  const comingSoonTitle = () => active() === "templates" ? "Templates" : active() === "resources" ? "Resources" : active() === "community" ? "Community" : active() === "affiliates" ? "Affiliates" : "";
  const isComingSoon = () => ["templates", "resources", "community", "affiliates"].includes(active());
  const toggleMenu = (menu) => setOpenMenu(openMenu() === menu ? null : menu);
  const toggleElement = (element) => setSelectedElements((current) => current.includes(element) ? current.filter((item) => item !== element) : [...current, element]);
  const closeMenus = (event) => {
    if (!event.target.closest(".editor-toolbar-wrap")) setOpenMenu(null);
  };
  onMount(() => document.addEventListener("click", closeMenus));
  onCleanup(() => document.removeEventListener("click", closeMenus));

  const [videos, setVideos] = createSignal([]);
  const [assets, setAssets] = createSignal([]);
  const [referenceBusy, setReferenceBusy] = createSignal(false);
  const [videoError, setVideoError] = createSignal("");
  const editorVideoFull = () => editorMode() === "editor" && videos().length >= EDITOR_VIDEO_MAX;
  const addVideoFile = (event) => {
    const files = Array.from(event.currentTarget.files);
    event.currentTarget.value = "";
    if (!files.length) return;
    // Editor: min 1 / max 1 video fuente. Motion/Creator mantienen multi.
    if (editorMode() === "editor") {
      const first = files[0];
      if (!String(first.type || "").startsWith("video/")) {
        setVideoError("Upload a video (mp4/mov) to edit.");
        return;
      }
      setVideoError("");
      setVideos([{ name: first.name, url: URL.createObjectURL(first), type: first.type || "", file: first }].slice(0, EDITOR_VIDEO_MAX));
      return;
    }
    if (files.length) setVideos((prev) => [...prev, ...files.map((file) => ({ name: file.name, url: URL.createObjectURL(file), type: file.type || "", file }))]);
  };
  const addAsset = (event) => { const files = Array.from(event.currentTarget.files); if (!files.length) return; const added = files.map((file) => { const type = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "audio"; return { name: file.name, type, url: URL.createObjectURL(file) }; }); setAssets((prev) => [...prev, ...added]); event.currentTarget.value = ""; };
  const removeVideo = (video) => setVideos((prev) => prev.filter((v) => v.url !== video.url));
  const removeAsset = (asset) => setAssets((prev) => prev.filter((a) => a.url !== asset.url));
  const insertMention = (name) => { setPrompt((p) => `${p}${p && !p.endsWith(" ") ? " " : ""}@${name} `); setOpenMenu(null); };
  const submitEdit = async () => {
    const text = prompt().trim();
    if (!text || referenceBusy()) return;
    // Sends paused: clicking brings the countdown back instantly.
    pokeCountdown();
    return;
    const refs = videos();
    if (editorMode() !== "motion") {
      // Editor exige 1 video; Creator no bloquea pero avisa en el job.
      if (editorMode() === "editor" && refs.length < EDITOR_VIDEO_MIN) {
        setVideoError(`Add ${EDITOR_VIDEO_MIN} video to edit (min ${EDITOR_VIDEO_MIN}, max ${EDITOR_VIDEO_MAX}).`);
        setVideoOpen(true);
        return;
      }
      onEditRequest({ prompt: text, ratio: format(), elements: selectedElements(), duration: undefined, videos: refs.map(({ name, url, type }) => ({ name, url, type })), assets: assets().map(({ name, type, url }) => ({ name, type, url })), brand: { colors: brandColors(), font: brandFont() }, presets: "auto", creatorAudio: creatorAudio() ? { name: creatorAudio().name, url: creatorAudio().url, type: creatorAudio().type } : null, creatorScript: creatorScript().trim() || null, creatorVoice: creatorScript().trim() ? creatorVoice() : null });
      return;
    }
    // Motion: reference files travel as images only (data URLs), with no
    // steering text. The first video contributes a sampled poster frame.
    // Anything unreadable is skipped; the prompt alone still works.
    setReferenceBusy(true);
    try {
      const refs = videos();
      const imageItems = refs.filter((v) => (v.type || "").startsWith("image/") && v.file).slice(0, MAX_REFERENCE_IMAGES);
      const referenceImages = [];
      for (const item of imageItems) {
        try {
          referenceImages.push(await downscaleImageFile(item.file));
        } catch {
          // Skip unreadable files; the prompt alone still works.
        }
      }
      const videoItems = refs.filter((v) => (v.type || "").startsWith("video/") && v.file);
      let referenceVideoKey = null;
      if (videoItems.length && referenceImages.length < MAX_REFERENCE_IMAGES) {
        const first = videoItems[0];
        try {
          const sample = await sampleVideoFile(first.file);
          if (sample.poster) referenceImages.push(sample.poster);
          referenceVideoKey = `${first.name}:${first.file.size}:${Math.round(sample.duration || 0)}`;
        } catch {
          // Unreadable video: keep the key so equal inputs share cache keys.
        }
        if (!referenceVideoKey) referenceVideoKey = `${first.name}:${first.file.size}`;
      }
      onEditRequest({
        prompt: text,
        ratio: format(),
        elements: selectedElements(),
        duration: motionDuration(),
        videos: refs.map(({ name, url, type }) => ({ name, url, type })),
        referenceImages,
        hasVideoReference: videoItems.length > 0,
        referenceVideoKey,
        scenes: motionScenes(),
      });
    } finally {
      setReferenceBusy(false);
    }
  };
  createEffect(() => { document.body.style.overflow = (assetsOpen() || videoOpen() || stylesOpen()) ? "hidden" : ""; });

  return (
    <div class={`editor-page ${sidebarVisible() ? "" : "editor-sidebar-hidden"}`}>
      <aside class="editor-sidebar" aria-label="Main navigation">
        <div class="editor-brand">
          <button class="editor-back" onClick={onBack} aria-label="Back to landing">⌂</button>
          <LogoIcon />
          <span>Animator</span>
        </div>
        <div class="editor-sidebar-nav">
          <div class="editor-section-title editor-principal-title">Main</div>
          <button class={`editor-nav-item ${active() === "home" ? "active" : ""}`} onClick={() => { setActive("home"); setShowProjects(false); }}><Home /><span>Home</span></button>
          <button class={`editor-nav-item ${active() === "projects" ? "active" : ""}`} onClick={() => { setActive("projects"); setShowProjects(true); }}><Folder /><span>Projects</span></button>
          <div class="editor-section-title editor-assets-title">Assets</div>
          <button class={`editor-nav-item ${active() === "templates" ? "active" : ""}`} onClick={() => { setActive("templates"); setShowProjects(false); }}><LayoutTemplate /><span>Templates</span><span class="editor-soon-lock" aria-label="Coming soon"><Lock /></span></button>
          <button class={`editor-nav-item ${active() === "resources" ? "active" : ""}`} onClick={() => { setActive("resources"); setShowProjects(false); }}><BookOpen /><span>Resources</span><span class="editor-soon-lock" aria-label="Coming soon"><Lock /></span></button>
          <button class={`editor-nav-item ${active() === "community" ? "active" : ""}`} onClick={() => { setActive("community"); setShowProjects(false); }}><Users /><span>Community</span><span class="editor-soon-lock" aria-label="Coming soon"><Lock /></span></button>
          <div class="editor-section-title editor-user-title">User</div>
          <button class={`editor-nav-item ${active() === "affiliates" ? "active" : ""}`} onClick={() => { setActive("affiliates"); setShowProjects(false); }}><CircleDollarSign /><span>Affiliates</span><span class="editor-soon-lock" aria-label="Coming soon"><Lock /></span></button>
          <button class="editor-nav-item editor-settings" onClick={() => setSettingsOpen(true)}><Settings /><span>Settings</span></button>
        </div>
      </aside>
      <button class="editor-hide" onClick={() => setSidebarVisible(!sidebarVisible())} aria-label={sidebarVisible() ? "Hide sidebar" : "Show sidebar"}>{sidebarVisible() ? <PanelLeftClose /> : <PanelLeftOpen />}</button>
      <Show when={showProjects()}>
        <ProjectsView onNewProject={() => { setActive("home"); setShowProjects(false); }} onOpenComp={(comp) => { setShowProjects(false); if (onOpenComp) onOpenComp(comp); }} />
      </Show>
      <Show when={!showProjects()}>
      <Show when={isComingSoon()} fallback={
      <main class="editor-main">
        <div class="editor-mode-pill" role="tablist" aria-label="Editor mode">
          <div class={`editor-mode-indicator ${editorMode()}`} />
          <button class={editorMode() === "editor" ? "selected" : ""} onClick={() => setEditorMode("editor")} role="tab">Editor</button>
          <span class={`editor-mode-divider ${editorMode() === "motion" ? "" : "hidden"}`} />
          <button class={editorMode() === "creator" ? "selected" : ""} onClick={() => setEditorMode("creator")} role="tab">Creator</button>
          <span class={`editor-mode-divider ${editorMode() === "editor" ? "" : "hidden"}`} />
          <button class={editorMode() === "motion" ? "selected" : ""} onClick={() => setEditorMode("motion")} role="tab">Motion</button>
        </div>
        <h1 class={`editor-title ${editorMode()}`}>{editorMode() === "creator" ? "What’s your next video?" : editorMode() === "motion" ? "What’s your next motion graphics?" : "What’s your next edit?"}</h1>
        <div class="editor-chatbox">
          <div class="editor-resource-cards">
            <div class="editor-resource-button" onClick={() => editorMode() === "creator" ? setScriptOpen(true) : setVideoOpen(true)}><strong>{editorMode() === "creator" ? <AudioLines /> : editorMode() === "motion" ? <Clapperboard /> : <Scissors />}<small>{editorMode() === "editor" ? `${videos().length}/${EDITOR_VIDEO_MAX}` : editorMode() === "creator" ? creatorCount() : videos().length}</small></strong><span class={editorMode() === "motion" ? "resource-single" : ""}>{editorMode() === "creator" ? <>Script/<br />Audio</> : editorMode() === "motion" ? <>Reference</> : <>Video for<br />edit</>}</span></div>
            <div class="editor-resource-button" onClick={() => setAssetsOpen(true)}><strong><Film /><small>{assets().length}</small></strong><span>Assets</span></div>
            <div class="editor-resource-button" onClick={() => setStylesOpen(true)}><strong><Palette /><small>{brandColors().length}</small></strong><span>Brand</span></div>
          </div>
          <textarea value={prompt()} onInput={(event) => setPrompt(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitEdit(); } }} placeholder={editorMode() === "creator" ? "Describe what you want in your video" : editorMode() === "motion" ? "Describe what you want in your motion graphics" : "Describe what you want in your edit"} aria-label="Describe your edit" />
          <div class="editor-toolbar-wrap" onClick={(event) => event.stopPropagation()}>
            <Show when={openMenu() === "elements"}>
              <Show when={editorMode() === "motion"} fallback={
              <div class="editor-floating-menu elements-menu elements-selection-menu" role="menu" aria-label="Edit elements">
                <div class="elements-selection-grid">
                  {elements.map((element) => <button class={`element-option ${selectedElements().includes(element) ? "selected" : ""}`} onClick={() => toggleElement(element)} role="menuitemcheckbox" aria-checked={selectedElements().includes(element)}><span>{element}</span><span class="element-check" aria-hidden="true"><Check /></span></button>)}
                </div>
              </div>
              }>
              <div class="editor-floating-menu elements-menu elements-selection-menu" role="menu" aria-label="Motion duration">
                <div class="elements-selection-grid">
                  {durationPresets.map((preset) => <button class={`element-option ${motionDuration() === preset ? "selected" : ""}`} onClick={() => { setMotionDuration(preset); setOpenMenu(null); }} role="menuitemradio" aria-checked={motionDuration() === preset}><span>{preset === "Auto" ? "Auto" : `${preset}s`}</span><span class="element-check" aria-hidden="true"><Check /></span></button>)}
                </div>
                <form class="duration-custom" onSubmit={(event) => { event.preventDefault(); applyCustomDuration(); }}>
                  <input type="number" min="1" max="60" step="1" placeholder="Custom 1–60s" value={customDuration()} onInput={(event) => setCustomDuration(event.currentTarget.value)} aria-label="Custom duration in seconds" />
                  <button type="submit">Set</button>
                </form>
              </div>
              </Show>
            </Show>
            <Show when={openMenu() === "scenes"}>
              <div class="editor-floating-menu elements-menu elements-selection-menu" role="menu" aria-label="Motion scenes">
                <div class="elements-selection-grid">
                  {scenePresets.map((n) => <button class={`element-option ${motionScenes() === n ? "selected" : ""}`} onClick={() => { setMotionScenes(n); setOpenMenu(null); }} role="menuitemradio" aria-checked={motionScenes() === n}><span>{n === 1 ? "1 scene" : `${n} scenes`}</span><span class="element-check" aria-hidden="true"><Check /></span></button>)}
                </div>
              </div>
            </Show>
            <Show when={openMenu() === "mention"}>
              <div class="editor-floating-menu elements-menu elements-selection-menu" role="menu" aria-label="Mention assets">
                <div class="elements-selection-grid">
                  <Show when={videos().length + assets().length === 0} fallback={
                    <>{videos().map((v) => <button class="element-option" onClick={() => insertMention(v.name || "video")}><span>@{v.name || "video"}</span></button>)}
                    {assets().map((a) => <button class="element-option" onClick={() => insertMention(a.name || a.type)}><span>@{a.name || a.type}</span><span class="element-check">{a.type}</span></button>)}</>
                  }>
                    <p class="assets-desc">Upload a video or assets to tag them with @ in the chat.</p>
                  </Show>
                </div>
              </div>
            </Show>
            <Show when={openMenu() === "format"}>
              <div class="editor-floating-menu format-menu" role="menu">
                {[["9:16", "ratio-9-16"], ["16:9", "ratio-16-9"], ["1:1", "ratio-1-1"], ["4:3", "ratio-4-3"]].map(([label, cls]) => <button class={`floating-menu-item ${format() === label ? "active" : ""}`} role="menuitemradio" aria-checked={format() === label} onClick={() => setFormat(label)}><span class={`ratio-rect ${cls}`} aria-hidden="true" /><span>{label}</span></button>)}
              </div>
            </Show>
            <div class="editor-toolbar"><button class={`toolbar-elements ${openMenu() === "elements" ? "open" : ""}`} onClick={() => toggleMenu("elements")}>{editorMode() === "motion" ? durationLabel() : <>Elements <ChevronDown aria-hidden="true" /></>}</button><Show when={editorMode() === "motion"}><button class={`toolbar-elements ${openMenu() === "scenes" ? "open" : ""}`} onClick={() => toggleMenu("scenes")} aria-label="Scene count">{sceneLabel()}</button></Show><button class="toolbar-format" onClick={() => toggleMenu("format")}><span class={`toolbar-format-rectangle ${format() === "16:9" ? "landscape" : format() === "1:1" ? "square" : format() === "4:3" ? "landscape" : ""}`} aria-hidden="true" /><span>{format()}</span></button><button class="toolbar-at" aria-label="Mention" onClick={() => toggleMenu("mention")}><AtSign /></button><button class="editor-submit" disabled={!prompt().trim() || referenceBusy()} onClick={submitEdit}>{referenceBusy() ? "Preparing…" : editorMode() === "editor" ? "Edit it" : "Create it"}<Play /></button></div>
          </div>
        </div>
        <CountdownNotice cls="editor-notice" />
        <div class="editor-beta">This is an early beta, so there may be errors</div>
      </main>
      }>
      <main class="editor-main editor-coming-soon" aria-label={`${comingSoonTitle()} coming soon`}>
        <div class="coming-soon-card">
          <span class="coming-soon-lock" aria-hidden="true"><Lock /></span>
          <div class="coming-soon-title">{comingSoonTitle()}</div>
          <p class="coming-soon-sub">Coming soon</p>
        </div>
      </main>
      </Show>
      </Show>
      <Show when={assetsOpen()}>
        <div class="assets-overlay" onClick={() => setAssetsOpen(false)}>
          <div class="assets-modal" onClick={(event) => event.stopPropagation()}>
            <h2 class="assets-title">Add assets</h2>
            <p class="assets-desc">Upload assets so the agent can use them in your edits. Describe how to use them, and mention them with @ in the chat.</p>
            <button class="assets-close" onClick={() => setAssetsOpen(false)} aria-label="Close"><X /></button>
            <div class="assets-grid">
              <label class="assets-upload assets-upload-btn"><span class="assets-upload-label">Upload Images</span><span class="assets-plus"><Plus /></span><input type="file" accept="image/*" multiple onChange={addAsset} hidden /></label>
              <label class="assets-upload assets-upload-btn"><span class="assets-upload-label">Upload Videos</span><span class="assets-plus"><Plus /></span><input type="file" accept="video/*" multiple onChange={addAsset} hidden /></label>
              <label class="assets-upload assets-upload-btn"><span class="assets-upload-label">Upload Audios</span><span class="assets-plus"><Plus /></span><input type="file" accept="audio/*" multiple onChange={addAsset} hidden /></label>
              {assets().map((asset) => <div class="asset-slot" title={asset.name || asset.type}>{asset.type === "image" ? <img class="asset-slot-media" src={asset.url} alt={asset.name || ""} /> : asset.type === "video" ? <video class="asset-slot-media" src={asset.url} /> : <span class="asset-slot-media asset-slot-audio"><Music2 /></span>}<button class="asset-remove asset-remove-mini" onClick={() => removeAsset(asset)} aria-label="Remove"><X /></button></div>)}
            </div>
          </div>
        </div>
      </Show>
      <Show when={videoOpen()}>
        <div class="assets-overlay" onClick={() => setVideoOpen(false)}>
          <div class="assets-modal assets-modal-video" onClick={(event) => event.stopPropagation()}>
            <h2 class="assets-title">{editorMode() === "motion" ? "Add reference" : "Add video for edit"}</h2>
            <p class="assets-desc">{editorMode() === "motion" ? `Upload up to ${MAX_REFERENCE_IMAGES} images so the agent follows their style, colors and layout.` : `Upload ${EDITOR_VIDEO_MIN} video to edit (min ${EDITOR_VIDEO_MIN}, max ${EDITOR_VIDEO_MAX}). It's used as the base footage; assets go separately.`}</p>
            <Show when={videoError()}><p class="assets-desc" role="alert">{videoError()}</p></Show>
            <button class="assets-close" onClick={() => setVideoOpen(false)} aria-label="Close"><X /></button>
            <div class="assets-grid">
              <Show when={editorMode() === "motion"} fallback={
                <label class={`assets-upload assets-video-upload assets-upload-btn ${editorVideoFull() ? "is-disabled" : ""}`} aria-disabled={editorVideoFull()}><span class="assets-upload-label">Upload Video ({videos().length}/{EDITOR_VIDEO_MAX})</span><span class="assets-video-stack"><span class="video-rect video-rect-front" aria-hidden="true" /><span class="video-rect video-rect-back" aria-hidden="true" /><span class="assets-plus"><Plus /></span></span><input type="file" accept="video/*" onChange={addVideoFile} hidden disabled={editorVideoFull()} /></label>
              }>
                <label class="assets-upload assets-upload-btn"><span class="assets-upload-label">Upload Images</span><span class="assets-plus"><Plus /></span><input type="file" accept="image/*" multiple onChange={addVideoFile} hidden /></label>
              </Show>
              <Show when={videos().length > 0}><div class="assets-previews assets-previews-video">{videos().map((v) => <div class="assets-video-tile">{(v.type || "").startsWith("image/") ? <img class="assets-preview-media" src={v.url} alt={v.name} /> : <video class="assets-preview-media" src={v.url} controls />}<button class="asset-remove" onClick={() => removeVideo(v)} aria-label="Remove"><X /></button></div>)}</div></Show>
            </div>
          </div>
        </div>
      </Show>
      <Show when={scriptOpen()}>
        <div class="assets-overlay" onClick={() => setScriptOpen(false)}>
          <div class="assets-modal assets-modal-video" onClick={(event) => event.stopPropagation()}>
            <h2 class="assets-title">Add script / audio</h2>
            <p class="assets-desc">Upload a single audio file or write the script for your video.</p>
            <button class="assets-close" onClick={() => setScriptOpen(false)} aria-label="Close"><X /></button>
            <div class="script-tabs" role="tablist" aria-label="Script or audio">
              <button type="button" role="tab" aria-selected={creatorTab() === "audio"} class={`script-tab ${creatorTab() === "audio" ? "selected" : ""}`} onClick={() => setCreatorTab("audio")}>Upload audio</button>
              <button type="button" role="tab" aria-selected={creatorTab() === "script"} class={`script-tab ${creatorTab() === "script" ? "selected" : ""}`} onClick={() => setCreatorTab("script")}>Write script</button>
            </div>
            <Show when={creatorTab() === "audio"}>
              <div class="assets-grid">
                <label class="assets-upload assets-upload-btn"><span class="assets-upload-label">Upload Audio ({creatorAudio() ? "1/1" : "0/1"})</span><span class="assets-plus"><Plus /></span><input type="file" accept="audio/*" onChange={addCreatorAudio} hidden /></label>
                <Show when={creatorAudio()}><div class="assets-video-tile"><audio class="assets-preview-media" src={creatorAudio().url} controls /><span class="asset-name">{creatorAudio().name}</span><button class="asset-remove" onClick={() => { if (creatorAudio()) URL.revokeObjectURL(creatorAudio().url); setCreatorAudio(null); }} aria-label="Remove"><X /></button></div></Show>
              </div>
            </Show>
            <Show when={creatorTab() === "script"}>
              <textarea class="script-area" value={creatorScript()} onInput={(e) => setCreatorScript(e.currentTarget.value)} placeholder="Write your script here…" aria-label="Video script" />
            </Show>
          </div>
        </div>
      </Show>
      <Show when={stylesOpen()}>
        <div class="assets-overlay" onClick={() => setStylesOpen(false)}>
          <div class="assets-modal assets-modal-styles" onClick={(event) => event.stopPropagation()}>
            <h2 class="assets-title">Brand</h2>
            <p class="assets-desc">Colors and font for captions, lower thirds, and motion graphics.</p>
            <button class="assets-close" onClick={() => setStylesOpen(false)} aria-label="Close"><X /></button>
            <div class="brand-grid">
              {brandColors().map((c, i) => <label class="brand-color">Color {i + 1}<span class="brand-row"><input type="color" value={c} onChange={(e) => setBrandColor(i, e.currentTarget.value)} aria-label={`Pick color ${i + 1}`} /><input type="text" value={c} onInput={(e) => setBrandColor(i, e.currentTarget.value)} aria-label={`Color ${i + 1} hex value`} /></span><span class="brand-swatches">{BRAND_SWATCHES.map((s) => <button type="button" class={`brand-swatch ${String(s).toLowerCase() === String(c).toLowerCase() ? "selected" : ""}`} style={{ background: s }} title={s} aria-label={`Use ${s} for color ${i + 1}`} onClick={() => setBrandColor(i, s)} />)}</span></label>)}
              <label class="brand-color">Font<select value={brandFont()} onChange={(e) => setBrandFont(e.currentTarget.value)}>{BRAND_FONTS.map((f) => <option value={f}>{f}</option>)}</select></label>
              <Show when={editorMode() === "creator" && creatorScript().trim()}>
                <label class="brand-color">Voice<select value={creatorVoice()} onChange={(e) => setCreatorVoice(e.currentTarget.value)}>{KOKORO_VOICES.map((g) => <optgroup label={g.group}>{g.voices.map((v) => <option value={v}>{voiceLabel(v)}</option>)}</optgroup>)}</select></label>
                <p class="assets-desc">Kokoro TTS voice that reads your script.</p>
              </Show>
            </div>
          </div>
        </div>
      </Show>
      <Show when={settingsOpen()}>
        <SettingsPop onClose={() => setSettingsOpen(false)} />
      </Show>
    </div>
  );
}

export default function App() {
  const reveal = useReveal();
  const [page, setPage] = createSignal("landing");
  const [job, setJob] = createSignal({ prompt: "", ratio: "9:16" });
  // True when the editor must open on the Projects tab (e.g. exiting a comp).
  const [editorProjects, setEditorProjects] = createSignal(false);
  const [landingMode, setLandingMode] = createSignal("editor");
  const [billing, setBilling] = createSignal("monthly");
  const [landingScrolled, setLandingScrolled] = createSignal(false);
  const [caCopied, setCaCopied] = createSignal(false);
  // TODO: pegar aquí el CA real cuando esté (el clic ya copia este valor).
  const contractAddress = "Coming soon";
  const copyCA = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(contractAddress).catch(() => {});
    }
    setCaCopied(true);
    setTimeout(() => setCaCopied(false), 1500);
  };
  const navigate = (nextPage) => {
    window.location.hash = nextPage === "editor" ? "editor" : nextPage === "onboarding" ? "onboarding" : "top";
    if (nextPage === "editor") setEditorProjects(false);
    setPage(nextPage);
  };
  const scrollToSection = (selector) => {
    const el = document.querySelector(selector);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 110, behavior: "smooth" });
  };
  const handleHashChange = () => {
    const hash = window.location.hash;
    // Clerk owns "#/..." step hashes on the Get-started screen: don't route on them.
    if (hash.startsWith("#/")) return;
    setPage(hash === "#editor" ? "editor" : hash === "#onboarding" ? "onboarding" : "landing");
  };
  onMount(() => {
    const hash = window.location.hash;
    if (hash === "#editor") setPage("editor");
    else if (hash === "#onboarding" || hash.startsWith("#/")) setPage("onboarding");
    window.addEventListener("hashchange", handleHashChange);
    const updateLandingScroll = () => setLandingScrolled(window.scrollY > 24);
    updateLandingScroll();
    window.addEventListener("scroll", updateLandingScroll, { passive: true });
    onCleanup(() => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("scroll", updateLandingScroll);
    });
  });

  // @codebuff TEMP-FOR-TESTING: onboarding always shows on Get started
  const handleGetStarted = () => navigate("onboarding");
  const [motionJob, setMotionJob] = createSignal(null);
  const [motionSnap, setMotionSnap] = createSignal(null);
  const startJob = (j) => {
    // Motion composer submits carry a duration (number or "Auto").
    if (j && j.duration !== undefined) {
      const input = buildMotionPlanInput({
        prompt: j.prompt,
        ratio: j.ratio,
        duration: j.duration === "Auto" ? "auto" : j.duration,
        style: "auto",
        reference: (j.videos && j.videos[0] && j.videos[0].url) || null,
        palette: j.palette,
        referenceImages: j.referenceImages,
        hasVideoReference: j.hasVideoReference,
        referenceVideoKey: j.referenceVideoKey,
        sceneCount: j.scenes,
      });
      setMotionJob(createMotionJob(input));
      setMotionSnap({ state: "queued", progress: 0 });
      setJob(j);
      // Sin pantalla de carga: el Studio ejecuta el job y muestra el
      // degradado + % en el propio preview hasta que cae el MP4.
      setPage("studio");
      return;
    }
    setMotionJob(null);
    setJob(j);
    setPage("loading");
  };
  // Motion jobs persist as projects on completion (IndexedDB). Failures to
  // save never block navigation: the video stays alive for the session.
  const handleMotionDone = async (finishedJob) => {
    try {
      if (finishedJob && finishedJob.state === "done" && finishedJob.result && finishedJob.result.video) {
        const chat = [{ kind: "user", text: String(job()?.prompt || "") }];
        const id = await getMotionProjects().save(buildCompRecord({ job: finishedJob, chat, version: 1 }));
        finishedJob.compId = id;
        finishedJob.compVersion = 1;
        finishedJob.chat = chat;
      }
    } catch (error) {
      console.warn("projects: autosave failed", error);
    }
    setPage("studio");
  };
  // Reopen a saved comp in the Studio: envelope carries everything Studio
  // needs (plan, bytes, chat, version) without re-running the pipeline.
  const openComp = (record) => {
    if (!record) return;
    const job = {
      id: `motion-${record.id}`,
      type: "motion",
      state: "done",
      progress: 1,
      input: record.input || { prompt: record.prompt, ratio: record.ratio },
      plan: record.plan,
      result: { plan: record.plan, video: record.video, usage: record.usage },
      error: null,
      compId: record.id,
      compVersion: record.version || 1,
      chat: Array.isArray(record.chat) && record.chat.length ? record.chat : [{ kind: "user", text: String(record.prompt || "") }],
    };
    setJob({ prompt: record.prompt, ratio: record.ratio, videos: [] });
    setMotionJob(job);
    setMotionSnap({ state: "done", progress: 1 });
    setPage("studio");
  };
  const aiFeatures = ["High weekly usage limits", "Edit videos with AI: B-rolls, effects, zooms, transitions, motion graphics, captions", "Audio/script to video", "AI motion graphics"];
  const plans = [
    { name: "Plus", monthly: "20$/mo", yearly: "16$/mo", desc: "A good plan to make videos and edit fast", features: aiFeatures, checks: true, cta: "Get started" },
    { name: "Pro", monthly: "40$/mo", yearly: "32$/mo", desc: "The best plan to make videos and edit fast", features: ["2.5x weekly usage limits", ...aiFeatures.slice(1)], checks: true, cta: "Get started", badge: "Most popular" },
    { name: "Enterprise", monthly: "Custom", yearly: "Custom", desc: "A tailored plan to make videos and edit fast", features: ["Everything in Plus and Pro", "Member management", "Usage analytics and controls", "Custom usage limits", "SAML, SSO and MFA", "Priority support"], checks: true, cta: "Contact Sales" },
  ];
  const finishOnboarding = () => {
    localStorage.setItem("autoedit_onboarding_done", "1");
    navigate("editor");
  };

  return (
    <Show when={page() === "onboarding"} fallback={
      <Show when={page() === "editor"} fallback={
      <Show when={page() === "newvideo"} fallback={
      <Show when={page() === "loading"} fallback={
      <Show when={page() === "studio"} fallback={
      <div class={`landing-page landing-page-${landingMode()}`}>
        <header class={`landing-header ${landingScrolled() ? "landing-header-scrolled" : ""}`}>
          <div class="landing-header-inner">
            <a class="landing-brand" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor"><LogoIcon /><span>Animator</span></a>
            <nav class="landing-nav" aria-label="Primary navigation">
              <a href="#modes" onClick={(event) => { event.preventDefault(); scrollToSection(".landing-editor-mode"); }}>Products</a>
              <a href="#features" onClick={(event) => { event.preventDefault(); scrollToSection(".landing-features"); }}>Features</a>
              <a href="#pricing" onClick={(event) => { event.preventDefault(); scrollToSection(".landing-pricing"); }}>Pricing</a>
              <a href="#token" onClick={(event) => { event.preventDefault(); scrollToSection(".landing-token"); }}>Animator Stock</a>
            </nav>
            <Show when={hasClerkKey()} fallback={
            <a class="landing-auth" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }}>Sign Up/Log In</a>
            }>
              <AuthIsland />
            </Show>
          </div>
        </header>
        <main id="top" class="landing-main">
          <h1>{landingMode() === "creator" ? <>The AI that creates videos<br />from a Script / Audio</> : landingMode() === "motion" ? <>The AI that creates motion<br />graphics in one click</> : <>The AI that edits your<br />videos in one click</>}</h1>
          <ModeSwitch mode={landingMode} setMode={setLandingMode} />
          <a class="landing-cta" href="#editor" onClick={(event) => { event.preventDefault(); handleGetStarted(); }}>Get started for free</a>
          <section class="landing-editor-mode" aria-label="Editor mode demonstration">
            <DropdownMenu>
              <DropdownMenu.Trigger class="landing-demo-mode">{landingMode() === "creator" ? "Creator Mode" : landingMode() === "motion" ? "Motion Mode" : "Editor Mode"} <DropdownMenu.Icon class="landing-demo-caret"><ChevronDown /></DropdownMenu.Icon></DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="landing-demo-menu" aria-label="Workspace mode">
                  <DropdownMenu.RadioGroup value={landingMode()} onChange={setLandingMode}>
                    {["editor", "creator", "motion"].map((mode) => <DropdownMenu.RadioItem class="landing-demo-menu-item" value={mode}>{mode === "creator" ? "Creator" : mode === "motion" ? "Motion" : "Editor"} Mode</DropdownMenu.RadioItem>)}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
            <Show keyed when={landingMode()} fallback={null}>{() => landingMode() === "motion" ? (<div class="landing-mode-animate"><div class="landing-mode-motion">
              <div class="landing-motion-left">
              <div class="landing-motion-card landing-motion-reference"><svg class="card-dash" aria-hidden="true"><rect x="1" y="1" width="273" height="273" rx="30"/></svg><h2>Reference</h2><img class="landing-motion-thumb" src="/chart.webp" alt="Anthropic ARR reference" /></div>
              <div class="landing-motion-card landing-motion-assets"><svg class="card-dash" aria-hidden="true"><rect x="1" y="1" width="273" height="273" rx="30"/></svg><h2>Brand Colors</h2><div class="landing-swatches"><span class="landing-swatch-wrap"><span class="landing-swatch" style={{ background: "#7069AA" }} /><i>#7069AA</i></span><span class="landing-swatch-wrap"><span class="landing-swatch" style={{ background: "#B8B2EE" }} /><i>#B8B2EE</i></span><span class="landing-swatch-wrap"><span class="landing-swatch" style={{ background: "#EAE BF7" }} /><i>#EAE BF7</i></span></div><div class="landing-type-line"><span class="landing-type-aa-sm">Aa</span><span class="landing-type-meta">Figtree Black</span></div></div>
              </div>
              <div class="landing-motion-arrow" aria-hidden="true" />
              <div class="landing-motion-result"><video src="/animator-arr.mp4" autoplay muted loop playsinline preload="auto" ref={(el) => el?.play()?.catch(() => {})} /></div>
            </div></div>) : (<div class={`landing-mode-animate ${landingMode() === "creator" ? "landing-creator-2" : ""}`}>
              <div class="landing-demo-card landing-demo-video"><Show when={landingMode() === "creator"} fallback={<><h2>Add raw video for<br />the edit</h2><img src="/calm-ocean-poster.jpg" alt="Raw video preview" /></>}><h2>Add audio/script<br />for the video</h2><div class="landing-media-rects"><span class="landing-rect landing-rect-script"><FileText strokeWidth={3} /><b>Script</b><span class="creator-lines"><i /><i /><i /></span></span><span class="landing-rect landing-rect-audio"><AudioLines strokeWidth={3} /><b>Audio</b><span class="creator-wave"><i /><i /><i /><i /><i /><i /><i /></span></span></div></Show></div>
              <div class="landing-demo-card landing-demo-assets"><Show when={landingMode() === "creator"} fallback={<><h2>Add assets for the<br />edit</h2><div class="landing-asset-tiles"><span class="landing-asset-tile"><Image strokeWidth={2} /><b>Images</b></span><span class="landing-asset-tile"><Film strokeWidth={2} /><b>Videos</b></span><span class="landing-asset-tile"><AudioLines strokeWidth={2} /><b>Audios</b></span><span class="landing-asset-tile"><WandSparkles strokeWidth={2} /><b>Effects</b></span></div></>}><h2>Brand<br />Colors</h2><div class="landing-brand-art"><div class="landing-swatches"><span class="landing-swatch-wrap"><span class="landing-swatch" style={{ background: "#F5F3FF" }} /><i>#F5F3FF</i></span><span class="landing-swatch-wrap"><span class="landing-swatch" style={{ background: "#B8B2EE" }} /><i>#B8B2EE</i></span><span class="landing-swatch-wrap"><span class="landing-swatch" style={{ background: "#1F1B46" }} /><i>#1F1B46</i></span></div><div class="landing-type-sample"><span class="landing-type-aa">Aa</span><span class="landing-type-meta">Figtree Black</span><span class="landing-type-cap">Edit in <em>one click</em></span></div></div></Show></div>
              <Show when={landingMode() !== "creator"}><div class="landing-demo-card landing-demo-styles landing-demo-styles-reversed"><h2>Select styles and<br />elements for the edit</h2><div class="landing-style-grid"><span>Remove Silences <Scissors /></span><span>Captions <Captions /></span><span>B Rolls <Plus /></span><span>Transitions <ArrowLeftRight /></span><span>Motion Graphics <Atom /></span></div></div></Show>
              <div class="landing-demo-connector" aria-hidden="true" />
              <div class="landing-demo-result" aria-hidden="true"><Show when={landingMode() === "creator"}><video src="/animator-promo-vertical.mp4" autoplay muted loop playsinline preload="auto" ref={(el) => el?.play()?.catch(() => {})} /></Show><Show when={landingMode() === "editor"}><video src="/editor-after-preview.mp4" autoplay muted loop playsinline preload="auto" ref={(el) => el?.play()?.catch(() => {})} /></Show></div>
            </div>)}</Show>
          </section>
          <section class={`landing-showcase landing-showcase-${landingMode()}`} aria-label="Before and after video editing">
            <Show keyed when={landingMode()} fallback={null}>{() => landingMode() === "creator" ? <a class="landing-card landing-card-creator landing-mode-animate" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor"><span class="creator-square creator-square-back"><FileText strokeWidth={3} /><b>Script</b><span class="creator-lines"><i /><i /><i /></span></span><span class="creator-square creator-square-front"><AudioLines strokeWidth={3} /><b>Audio</b><span class="creator-wave"><i /><i /><i /><i /><i /><i /><i /></span></span></a> : landingMode() === "motion" ? <a class="landing-card landing-card-motion landing-mode-animate" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor"><span class="motion-rect" /><span class="motion-prompt">I want a graphic like this, but with these metrics and this style</span></a> : <a class="landing-card landing-card-editor landing-mode-animate" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor"><span class="editor-rect editor-rect-video"><video class="motion-video" src="/editor-before-preview.mp4" autoplay muted loop playsinline preload="auto" ref={(el) => el?.play()?.catch(() => {})} onPlay={(event) => syncMotionPlay(event.currentTarget, true)} onPause={(event) => syncMotionPlay(event.currentTarget, false)} /><button class="motion-play" onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleMotionVideo(event.currentTarget); }} aria-label="Play before"><span class="icon-play"><Play /></span><span class="icon-pause"><Pause /></span></button><button class="editor-mute muted" onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleEditorMute(event.currentTarget); }} aria-label="Unmute"><span class="icon-muted"><VolumeX /></span><span class="icon-unmuted"><Volume2 /></span></button></span></a>}</Show>
            <img class="landing-arrow" src="/vector-6.svg" alt="" aria-hidden="true" />
            <Show keyed when={landingMode()} fallback={null}>{() => landingMode() === "motion" ? <a class="landing-card landing-card-motion-right landing-mode-animate" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor"><span class="motion-rect motion-rect-video"><video class="motion-video" src="/animator-arr.mp4" autoplay muted loop playsinline preload="auto" ref={(el) => el?.play()?.catch(() => {})} onPlay={(event) => syncMotionPlay(event.currentTarget, true)} onPause={(event) => syncMotionPlay(event.currentTarget, false)} /><button class="motion-play" onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleMotionVideo(event.currentTarget); }} aria-label="Play chart"><span class="icon-play"><Play /></span><span class="icon-pause"><Pause /></span></button></span></a> : landingMode() === "creator" ? <a class="landing-card landing-card-creator-right landing-mode-animate" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor"><span class="creator-rect creator-rect-video"><video class="motion-video" src="/animator-promo-vertical.mp4" autoplay muted loop playsinline preload="auto" ref={(el) => el?.play()?.catch(() => {})} onPlay={(event) => syncMotionPlay(event.currentTarget, true)} onPause={(event) => syncMotionPlay(event.currentTarget, false)} /><button class="motion-play" onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleMotionVideo(event.currentTarget); }} aria-label="Play promo"><span class="icon-play"><Play /></span><span class="icon-pause"><Pause /></span></button></span></a> : <a class="landing-card landing-card-editor landing-mode-animate" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor"><span class="editor-rect editor-rect-video"><video class="motion-video" src="/editor-after-preview.mp4" autoplay muted loop playsinline preload="auto" ref={(el) => el?.play()?.catch(() => {})} onPlay={(event) => syncMotionPlay(event.currentTarget, true)} onPause={(event) => syncMotionPlay(event.currentTarget, false)} /><button class="motion-play" onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleMotionVideo(event.currentTarget); }} aria-label="Play after"><span class="icon-play"><Play /></span><span class="icon-pause"><Pause /></span></button><button class="editor-mute muted" onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleEditorMute(event.currentTarget); }} aria-label="Unmute"><span class="icon-muted"><VolumeX /></span><span class="icon-unmuted"><Volume2 /></span></button></span></a>}</Show>
          </section>
          <section class={`landing-features landing-features-${landingMode()}`} aria-label="Animator features">
            <h2 class="landing-features-title">Built by editors, for creators:</h2>
            <div class="landing-features-row landing-features-row-1">
              <article class="feature-card" use:reveal>
                <h2>Learn your editing style</h2>
                <p class="feature-sub">Upload a video, review the storyboard, and approve captions, b-roll, split screens, and motion graphics.</p>
                <div class="feature-visual feature-visual-learn">
                  <div class="fg fg-learn-structure">
                    <span class="fg-learn-panel">
                      <span class="fg-learn-avatar" />
                      <span class="fg-learn-body" />
                      <span class="fg-learn-cap">Captions</span>
                      <span class="fg-learn-rule" />
                      <span class="fg-learn-broll">B-Roll</span>
                    </span>
                    <img class="fg-learn-squiggle" src="/vector-56.svg" alt="" aria-hidden="true" />
                    <img class="fg-learn-arrow fg-learn-arrow-top" src="/arrow-15.svg" alt="" aria-hidden="true" />
                    <img class="fg-learn-arrow fg-learn-arrow-bottom" src="/arrow-15.svg" alt="" aria-hidden="true" />
                    <span class="fg-learn-callout fg-learn-callout-color">Add background color</span>
                    <span class="fg-learn-callout fg-learn-callout-roll">B-Roll from assets</span>
                  </div>
                </div>
              </article>
              <article class="feature-card" use:reveal>
                <h2>Brand-consistent videos</h2>
                <p class="feature-sub">Define your colors and fonts once and keep every caption, title, and motion graphic on-brand.</p>
                <div class="feature-visual feature-visual-brand">
                  <div class="fg fg-brand">
                    <div class="fg-brand-head">
                      <span class="fg-brand-title">Brand styles</span>
                    </div>
                    <div class="fg-brand-colors">
                      <span class="fg-swatch fg-swatch-a"><i>Primary</i></span>
                      <span class="fg-swatch fg-swatch-b"><i>Accent</i></span>
                      <span class="fg-swatch fg-swatch-c"><i>Dark</i></span>
                    </div>
                    <div class="fg-brand-font">
                      <span class="fg-font-aa">Aa</span>
                      <span class="fg-font-meta"><b>Figtree</b><i>Titles, captions &amp; motion graphics</i></span>
                    </div>
                  </div>
                </div>
              </article>
              <article class="feature-card" use:reveal>
                <h2>Save time on every edit</h2>
                <p class="feature-sub">Go from hours of manual editing to minutes — capture, trim, and polish in one click.</p>
                <div class="feature-visual feature-visual-save">
                  <div class="fg fg-save">
                    <div class="fg-brand-head"><span class="fg-brand-title">Edit 3 videos</span></div>
                    <div class="fg-save-cols">
                      <div class="fg-save-col fg-save-col-fast">
                        <span class="fg-clock fg-clock-fast"><i /><i /></span>
                        <span class="fg-save-label">20min</span>
                        <span class="fg-save-sub">With Animator</span>
                      </div>
                      <div class="fg-save-vs">vs</div>
                      <div class="fg-save-col fg-save-col-slow">
                        <span class="fg-clock fg-clock-slow"><i /><i /></span>
                        <span class="fg-save-label">4-5h</span>
                        <span class="fg-save-sub">Without Animator</span>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            </div>
            <div class="landing-features-row landing-features-row-2">
              <article class="feature-card" use:reveal>
                <h2>Plan first, then create</h2>
                <p class="feature-sub">Refine generated video insertions without rebuilding them manually in After Effects.</p>
                <div class="feature-visual feature-visual-plan">
                  <div class="fg fg-plan">
                    <span class="fg-plan-row"><span class="fg-plan-thumb fg-plan-motion"><Video /></span><b>B-Rolls:</b></span>
                    <span class="fg-plan-row"><span class="fg-plan-thumb fg-plan-motion"><Atom /></span><b>Motion Graphics:</b></span>
                    <span class="fg-plan-row"><span class="fg-plan-thumb fg-plan-motion"><Captions /></span><b>Captions:</b></span>
                    <span class="fg-accept">Accept</span>
                  </div>
                </div>
              </article>
              <article class="feature-card" use:reveal>
                <h2>Grow your brand</h2>
                <p class="feature-sub">Animator gets faster and more accurate as you approve, reject, and adjust your edits.</p>
                <div class="feature-visual feature-visual-grow">
                  <div class="fg fg-grow">
                    <svg class="fg-grow-chart" viewBox="0 0 560 230" role="img" aria-label="Growth from 100 to 1M followers">
                      <g stroke="#4A4870" stroke-width="1" opacity=".55">
                        <line x1="0" y1="60" x2="560" y2="60" />
                        <line x1="0" y1="115" x2="560" y2="115" />
                        <line x1="0" y1="170" x2="560" y2="170" />
                      </g>
                      <path d="M28,186 C140,178 180,150 250,128 C320,106 360,84 430,60 C470,48 500,40 532,32 L532,230 L28,230 Z" fill="rgba(184,178,238,.13)" />
                      <path d="M28,186 C140,178 180,150 250,128 C320,106 360,84 430,60 C470,48 500,40 532,32" fill="none" stroke="#B8B2EE" stroke-width="5" stroke-linecap="round" />
                      <g font-family="Figtree,sans-serif" font-size="19" fill="#A9A6C6" text-anchor="middle">
                        <circle cx="28" cy="186" r="7" fill="#060511" stroke="#B8B2EE" stroke-width="4" />
                        <text x="28" y="214">100</text>
                        <circle cx="250" cy="128" r="7" fill="#060511" stroke="#B8B2EE" stroke-width="4" />
                        <text x="250" y="156">10K</text>
                        <circle cx="430" cy="60" r="7" fill="#060511" stroke="#B8B2EE" stroke-width="4" />
                        <text x="430" y="88">100K</text>
                        <circle cx="532" cy="32" r="8" fill="#B8B2EE" />
                        <text x="520" y="22" fill="#fff">1M</text>
                      </g>
                    </svg>
                    <div class="fg-grow-row">
                      <span class="fg-grow-n">100 Followers</span>
                      <img class="fg-learn-arrow fg-grow-link" src="/arrow-15.svg" alt="" aria-hidden="true" />
                      <span class="fg-grow-n">1M Followers</span>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </section>
          <section class={`landing-pricing landing-pricing-${landingMode()}`} aria-label="Pricing">
            <div class="billing-toggle" role="group" aria-label="Billing period">
              <span class={`billing-indicator billing-${billing()}`} aria-hidden="true" />
              <button type="button" class={billing() === "monthly" ? "selected" : ""} onClick={() => setBilling("monthly")}>Monthly</button>
              <button type="button" class={billing() === "yearly" ? "selected" : ""} onClick={() => setBilling("yearly")}>Yearly</button>
            </div>
            <div class="pricing-grid">
              {plans.map((plan) => (
                <article class={plan.badge ? "price-card popular" : "price-card"}>
                  {plan.badge ? <span class="price-badge">{plan.badge}</span> : null}
                  <h3>{plan.name}</h3>
                  <p class="price-value">{billing() === "monthly" ? plan.monthly : plan.yearly}</p>
                  {billing() === "yearly" && plan.monthly !== plan.yearly ? <p class="price-note">billed yearly</p> : null}
                  <p class="price-desc">{plan.desc}</p>
                  <ul class="price-features">
                    {plan.features.map((f) => <li class={plan.checks ? "checked" : ""}>{plan.checks ? <span aria-hidden="true">✓</span> : null}<span>{f}</span></li>)}
                  </ul>
                  <button type="button" class="price-cta" onClick={handleGetStarted}>{plan.cta === "Get started" ? "↗ Get started" : plan.cta}</button>
                </article>
              ))}
            </div>
          </section>
          <section class={`landing-token landing-token-${landingMode()}`} aria-label="Token info">
            <img class="token-play" src="/logo-play.svg" alt="Animator play logo" />
            <h2 class="token-title">Animator Stock</h2>
            <div class="token-bar"><span class="token-ca" onClick={copyCA} title="Copy contract address">CA: {contractAddress}</span><button type="button" class="token-copy" onClick={copyCA} aria-label="Copy contract address">{caCopied() ? <Check size={18} /> : <Copy size={18} />}</button></div>
            <div class="token-cards">
              <article class="token-card"><span>Launched in:</span><img src="/logo-robinhood.svg" alt="Robinhood" /><img src="/logo-pump-big.svg" alt="Pump" /></article>
              <article class="token-card"><span>Fees:</span><b>1%</b></article>
              <a class="token-card" href="https://x.com/AnimatorStock" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><span>Official X:</span><img src="/logo-x.svg" alt="X" /></a>
            </div>
            <div class="value-loop">
              <h3 class="value-loop-title">The $AMST Value Loop</h3>
              <div class="value-flow">
                <div class="value-steps">
                  <div class="value-step"><img src="/value-buy.svg" alt="Buy Tokens" /><span>Buy Tokens</span></div>
                  <div class="value-step"><img class="value-arc" src="/value-arc.svg" alt="" aria-hidden="true" /><img src="/value-fees.svg" alt="Generate Fees" /><span>Generate Fees</span></div>
                  <div class="value-step"><img class="value-arc" src="/value-arc.svg" alt="" aria-hidden="true" /><img src="/value-growth.svg" alt="Growth Animator" /><span>Growth Animator</span></div>
                  <div class="value-step"><img class="value-arc" src="/value-arc.svg" alt="" aria-hidden="true" /><img src="/value-profits.svg" alt="Generate profits" /><span>Generate profits</span></div>
                </div>
                <div class="value-right">
                  <div class="fork-lines" aria-hidden="true"><i class="fork-top" /><i class="fork-bot" /></div>
                  <div class="value-col">
                    <div class="value-card"><b>30%</b><span>BuyBacks</span></div>
                    <div class="value-card"><b>20%</b><span>Dividends</span></div>
                  </div>
                  <div class="value-card"><b>50%</b><span>CashFlow</span></div>
                </div>
              </div>
            </div>
            <div class="holders">
              <h3 class="value-loop-title">Holder Benefits</h3>
              <div class="holders-grid">
                <article class="holder-card" use:reveal>
                  <span class="holder-eyebrow">01 · You earn</span>
                  <h2>Variable Dividends</h2>
                  <p class="holder-sub">20% of profits. Bag size + holding time determine your share.</p>
                  <div class="holder-visual"><b>20%</b></div>
                </article>
                <article class="holder-card" use:reveal>
                  <span class="holder-eyebrow">02 · You vote</span>
                  <h2>Governance</h2>
                  <p class="holder-sub">Vote on selected business decisions. Product, marketing, roadmap and other major decisions.</p>
                  <div class="holder-visual"><b>Vote</b></div>
                </article>
                <article class="holder-card" use:reveal>
                  <span class="holder-eyebrow">03 · You build</span>
                  <h2>Participation</h2>
                  <p class="holder-sub">Marketing · Content · Product · Community. Help build Animator and have the opportunity to become part of it.</p>
                  <div class="holder-visual"><b>Build</b></div>
                </article>
                <article class="holder-card" use:reveal>
                  <span class="holder-eyebrow">04 · You see</span>
                  <h2>Radical Transparency</h2>
                  <p class="holder-sub">No black box. Monthly reports on finances, business performance, analytics and major decisions.</p>
                  <div class="holder-visual holder-visual-sm"><b>No Black Box</b></div>
                </article>
              </div>
              <div class="profit-split" aria-label="The AMST profit split">
                <h4>The AMST Profit Split</h4>
                <div class="profit-split-grid">
                  <div><b>50%</b><span>Reinvest</span><i>Product · Marketing · Growth</i></div>
                  <div><b>30%</b><span>Buybacks &amp; Burns</span><i>$AMST</i></div>
                  <div><b>20%</b><span>Dividends</span><i>Holders</i></div>
                </div>
              </div>
            </div>
          </section>
            <footer class="landing-footer">
             <div class="footer-inner">
              <div class="footer-cta">
                <div>
                  <h3>Would you like to talk to us?</h3>
                  <p>We are moving fast, and your feedback is super important. Feel free to reach out =)</p>
                </div>
                <a href="https://x.com/AnimatorStock" target="_blank" rel="noreferrer">Talk to us</a>
              </div>
              <div class="footer-bottom">
                <span>© 2026 Animator</span>
                <div class="footer-links">
                  <nav aria-label="Product">
                    <a onClick={(event) => { event.preventDefault(); scrollToSection(".landing-editor-mode"); }}>Products</a>
                    <a onClick={(event) => { event.preventDefault(); scrollToSection(".landing-features"); }}>Features</a>
                    <a onClick={(event) => { event.preventDefault(); scrollToSection(".landing-pricing"); }}>Pricing</a>
                    <a onClick={(event) => { event.preventDefault(); scrollToSection(".landing-token"); }}>Animator Stock</a>
                  </nav>
                  <nav aria-label="Social">
                    <a href="https://x.com/AnimatorStock" target="_blank" rel="noreferrer">X / Twitter</a>
                  </nav>
                </div>
              </div>
              </div>
            </footer>
        </main>
      </div>
      }>
      {/* Studio oculto de momento: placeholder en vez del editor */}
      <div class="st-unavailable" role="status">
        <CountdownNotice prefix="The Studio will be available in" />
        <button type="button" onClick={() => { setEditorProjects(true); setPage("editor"); }}>Back to editor</button>
      </div>
      </Show>
      }>
      <LoadingView job={job()} onDone={handleMotionDone} />
      </Show>
      }>
      <NewVideoView initial={job()} onSubmit={startJob} />
      </Show>
      }>
      <EditorView onBack={() => navigate("landing")} onEditRequest={startJob} onOpenComp={openComp} startOnProjects={editorProjects()} />
    </Show>
    }>
      <OnboardingView onDone={finishOnboarding} />
    </Show>
  );
}
