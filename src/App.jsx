import { createSignal, onMount, onCleanup, createEffect, Show } from "solid-js";
import OnboardingView from "./OnboardingView.jsx";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { Home, Folder, LayoutTemplate, BookOpen, Users, CircleDollarSign, Settings, Scissors, Film, WandSparkles, AudioLines, Clapperboard, PanelLeftClose, PanelLeftOpen, Play, AtSign, ChevronDown, Palette, Image, Music2, SlidersHorizontal, ZoomIn, Captions, Plus, Atom, Square, Check, X, Sparkles, SquarePlay, Pause } from "lucide-solid";

function LogoIcon() {
  return <img class="landing-logo-icon" src="/icon-animator.png" alt="" />;
}
function EnterIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 10 4 15l5 5" /><path d="M20 4v7a4 4 0 0 1-4 4H4" /></svg>;
}

function toggleMotionVideo(button) {
  const player = button.closest(".motion-rect-video, .creator-rect-video");
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

function ProjectsView({ onNewProject }) {
  const projects = [
    { name: "New Project", color: "#191922", newProject: true },
    { name: "Black background", color: "#29313b" },
    { name: "Remotion skill", color: "#7020a7" },
    { name: "Chat odysser UI", color: "#252526" },
    { name: "Premier edit", color: "#8d6d5c" },
  ];

  return (
    <main class="projects-main" aria-label="Projects">
      <div class="projects-grid">
        {projects.map((project) => <article class="project-card">
          <div class="project-preview" style={{ "--project-fill": project.color }} onClick={project.newProject ? onNewProject : undefined} role={project.newProject ? "button" : undefined} tabindex={project.newProject ? "0" : undefined}>
            {project.newProject && <span class="project-plus" aria-hidden="true">＋</span>}
            {!project.newProject && <span class="project-random-fill" aria-hidden="true" />}
            {!project.newProject && <button class="project-more" aria-label={`More options for ${project.name}`}>•••</button>}
          </div>
          <h2>{project.name}</h2>
        </article>)}
      </div>
    </main>
  );
}

function EditorView({ onBack }) {
  const [prompt, setPrompt] = createSignal("");
  const [active, setActive] = createSignal("home");
  const [sidebarVisible, setSidebarVisible] = createSignal(true);
  const [editorMode, setEditorMode] = createSignal("editor");
  const [showProjects, setShowProjects] = createSignal(false);
  const [openMenu, setOpenMenu] = createSignal(null);
  const [selectedElements, setSelectedElements] = createSignal([]);
  const [format, setFormat] = createSignal("9:16");
  const [assetsOpen, setAssetsOpen] = createSignal(false);
  const [videoOpen, setVideoOpen] = createSignal(false);
  const [stylesOpen, setStylesOpen] = createSignal(false);
  const [selectedStyles, setSelectedStyles] = createSignal([]);
  const toggleStyle = (label) => setSelectedStyles((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label]);
  const elements = ["B Rolls", "Sounds", "Effects", "Transitions", "Zooms", "Captions", "Motion Graphics", "Remove Silences"];

  const toggleMenu = (menu) => setOpenMenu(openMenu() === menu ? null : menu);
  const toggleElement = (element) => setSelectedElements((current) => current.includes(element) ? current.filter((item) => item !== element) : [...current, element]);
  const closeMenus = (event) => {
    if (!event.target.closest(".editor-toolbar-wrap")) setOpenMenu(null);
  };
  onMount(() => document.addEventListener("click", closeMenus));
  onCleanup(() => document.removeEventListener("click", closeMenus));

  const [videos, setVideos] = createSignal([]);
  const [assets, setAssets] = createSignal([]);
  const addVideoFile = (event) => { const files = Array.from(event.currentTarget.files); if (files.length) setVideos((prev) => [...prev, ...files.map((file) => ({ url: URL.createObjectURL(file), type: file.type }))]); event.currentTarget.value = ""; };
  const addAsset = (event) => { const files = Array.from(event.currentTarget.files); if (!files.length) return; const added = files.map((file) => { const type = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "audio"; return { type, url: URL.createObjectURL(file) }; }); setAssets((prev) => [...prev, ...added]); event.currentTarget.value = ""; };
  const removeVideo = (video) => setVideos((prev) => prev.filter((v) => v.url !== video.url));
  const removeAsset = (asset) => setAssets((prev) => prev.filter((a) => a.url !== asset.url));
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
          <div class="editor-section-title editor-principal-title">Principal</div>
          <button class={`editor-nav-item ${active() === "home" ? "active" : ""}`} onClick={() => { setActive("home"); setShowProjects(false); }}><Home /><span>Home</span></button>
          <button class={`editor-nav-item ${active() === "projects" ? "active" : ""}`} onClick={() => { setActive("projects"); setShowProjects(true); }}><Folder /><span>Projects</span></button>
          <div class="editor-section-title editor-assets-title">Assets</div>
          <button class={`editor-nav-item ${active() === "templates" ? "active" : ""}`} onClick={() => setActive("templates")}><LayoutTemplate /><span>Templates</span></button>
          <button class={`editor-nav-item ${active() === "resources" ? "active" : ""}`} onClick={() => setActive("resources")}><BookOpen /><span>Resources</span></button>
          <button class={`editor-nav-item ${active() === "community" ? "active" : ""}`} onClick={() => setActive("community")}><Users /><span>Community</span></button>
          <div class="editor-section-title editor-user-title">User</div>
          <button class={`editor-nav-item ${active() === "affiliates" ? "active" : ""}`} onClick={() => setActive("affiliates")}><CircleDollarSign /><span>Affiliates</span></button>
          <button class="editor-nav-item editor-settings" onClick={() => setActive("settings")}><Settings /><span>Settings</span></button>
        </div>
      </aside>
      <button class="editor-hide" onClick={() => setSidebarVisible(!sidebarVisible())} aria-label={sidebarVisible() ? "Hide sidebar" : "Show sidebar"}>{sidebarVisible() ? <PanelLeftClose /> : <PanelLeftOpen />}</button>
      <Show when={showProjects()}>
        <ProjectsView onNewProject={() => { setActive("home"); setShowProjects(false); }} />
      </Show>
      <Show when={!showProjects()}>
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
            <div class="editor-resource-button" onClick={() => setVideoOpen(true)}><strong>{editorMode() === "creator" ? <AudioLines /> : editorMode() === "motion" ? <Clapperboard /> : <Scissors />}<small>0</small></strong><span class={editorMode() === "motion" ? "resource-single" : ""}>{editorMode() === "creator" ? <>Script/<br />Audio</> : editorMode() === "motion" ? <>Reference</> : <>Video for<br />edit</>}</span></div>
            <div class="editor-resource-button" onClick={() => setAssetsOpen(true)}><strong><Film /><small>0</small></strong><span>Assets</span></div>
            <div class="editor-resource-button" onClick={() => setStylesOpen(true)}><strong><WandSparkles /><small>0</small></strong><span>Styles</span></div>
          </div>
          <textarea value={prompt()} onInput={(event) => setPrompt(event.currentTarget.value)} placeholder={editorMode() === "creator" ? "Describe what you want in your video" : editorMode() === "motion" ? "Describe what you want in your motion graphics" : "Describe what you want in your edit"} aria-label="Describe your edit" />
          <div class="editor-toolbar-wrap" onClick={(event) => event.stopPropagation()}>
            <Show when={openMenu() === "elements"}>
              <div class="editor-floating-menu elements-menu elements-selection-menu" role="menu" aria-label="Edit elements">
                <div class="elements-selection-grid">
                  {elements.map((element) => <button class={`element-option ${selectedElements().includes(element) ? "selected" : ""}`} onClick={() => toggleElement(element)} role="menuitemcheckbox" aria-checked={selectedElements().includes(element)}><span>{element}</span><span class="element-check" aria-hidden="true"><Check /></span></button>)}
                </div>
              </div>
            </Show>
            <Show when={openMenu() === "format"}>
              <div class="editor-floating-menu format-menu" role="menu">
                {[["9:16", "ratio-9-16"], ["16:9", "ratio-16-9"], ["1:1", "ratio-1-1"], ["4:3", "ratio-4-3"]].map(([label, cls]) => <button class={`floating-menu-item ${format() === label ? "active" : ""}`} role="menuitemradio" aria-checked={format() === label} onClick={() => setFormat(label)}><span class={`ratio-rect ${cls}`} aria-hidden="true" /><span>{label}</span></button>)}
              </div>
            </Show>
            <div class="editor-toolbar"><button class={`toolbar-elements ${openMenu() === "elements" ? "open" : ""}`} onClick={() => toggleMenu("elements")}>Elements <ChevronDown aria-hidden="true" /></button><button class="toolbar-format" onClick={() => toggleMenu("format")}><span class={`toolbar-format-rectangle ${format() === "16:9" ? "landscape" : format() === "1:1" ? "square" : format() === "4:3" ? "landscape" : ""}`} aria-hidden="true" /><span>{format()}</span></button><button class="toolbar-at" aria-label="Mention"><AtSign /></button><button class="editor-submit" disabled={!prompt().trim()}>{editorMode() === "editor" ? "Edit it" : "Create it"}<Play /></button></div>
          </div>
        </div>
        <div class="editor-beta">This is an early beta, so there may be errors</div>
      </main>
      </Show>
      <Show when={assetsOpen()}>
        <div class="assets-overlay" onClick={() => setAssetsOpen(false)}>
          <div class="assets-modal" onClick={(event) => event.stopPropagation()}>
            <h2 class="assets-title">Add assets</h2>
            <p class="assets-desc">Upload assets so the agent can use them to edit your videos. You can describe how you want them used, and use the @ in the chat to add context.</p>
            <button class="assets-close" onClick={() => setAssetsOpen(false)} aria-label="Close"><X /></button>
            <div class="assets-grid">
              <label class="assets-upload assets-upload-btn"><span class="assets-upload-label">Upload Images</span><span class="assets-plus"><Plus /></span><input type="file" accept="image/*" multiple onChange={addAsset} hidden /></label>
              <label class="assets-upload assets-upload-btn"><span class="assets-upload-label">Upload Videos</span><span class="assets-plus"><Plus /></span><input type="file" accept="video/*" multiple onChange={addAsset} hidden /></label>
              <label class="assets-upload assets-upload-btn"><span class="assets-upload-label">Upload Audios</span><span class="assets-plus"><Plus /></span><input type="file" accept="audio/*" multiple onChange={addAsset} hidden /></label>
              <div class="assets-upload assets-asset-preview"><Show when={assets().length > 0}><div class="assets-mini-grid">{assets().map((asset) => <div class="assets-mini-wrap">{asset.type === "image" ? <img class="assets-mini" src={asset.url} alt="" /> : asset.type === "video" ? <video class="assets-mini" src={asset.url} /> : <span class="assets-mini assets-mini-audio"><Music2 /></span>}<button class="asset-remove asset-remove-mini" onClick={() => removeAsset(asset)} aria-label="Remove"><X /></button></div>)}</div></Show></div>
            </div>
          </div>
        </div>
      </Show>
      <Show when={videoOpen()}>
        <div class="assets-overlay" onClick={() => setVideoOpen(false)}>
          <div class="assets-modal assets-modal-video" onClick={(event) => event.stopPropagation()}>
            <h2 class="assets-title">Add video for edit</h2>
            <p class="assets-desc">Upload assets so the agent can use them to edit your videos. You can describe how you want them used, and use the @ in the chat to add context.</p>
            <button class="assets-close" onClick={() => setVideoOpen(false)} aria-label="Close"><X /></button>
            <div class="assets-grid">
              <label class="assets-upload assets-video-upload assets-upload-btn"><span class="assets-upload-label">Upload Videos</span><span class="assets-video-stack"><span class="video-rect video-rect-front" aria-hidden="true" /><span class="video-rect video-rect-back" aria-hidden="true" /><span class="assets-plus"><Plus /></span></span><input type="file" accept="video/*" multiple onChange={addVideoFile} hidden /></label>
              <Show when={videos().length > 0}><div class="assets-previews assets-previews-video">{videos().map((v) => <div class="assets-video-tile"><video class="assets-preview-media" src={v.url} controls /><button class="asset-remove" onClick={() => removeVideo(v)} aria-label="Remove"><X /></button></div>)}</div></Show>
            </div>
          </div>
        </div>
      </Show>
      <Show when={stylesOpen()}>
        <div class="assets-overlay" onClick={() => setStylesOpen(false)}>
          <div class="assets-modal assets-modal-styles" onClick={(event) => event.stopPropagation()}>
            <h2 class="assets-title">Styles</h2>
            <p class="assets-desc">Customize every element of your edit</p>
            <button class="assets-close" onClick={() => setStylesOpen(false)} aria-label="Close"><X /></button>
            <div class="styles-grid">
              {[{ label: "B Rolls" }, { label: "Zooms", icon: <ZoomIn /> }, { label: "Captions", icon: <Captions /> }, { label: "Motion Graphics", icon: <Atom /> }, { label: "Transitions", icon: <Square /> }, { label: "Effects", icon: <Sparkles /> }, { label: "Sounds", icon: <Music2 /> }, { label: "Style Video", icon: <SquarePlay /> }].map((style) => <button class={`style-card ${selectedStyles().includes(style.label) ? "selected" : ""}`} role="menuitemcheckbox" aria-checked={selectedStyles().includes(style.label)} onClick={() => toggleStyle(style.label)}><span class="style-label">{style.label}</span>{style.label === "B Rolls" ? <span class="style-icon style-icon-brolls"><span class="broll-frame"><Plus /></span></span> : <span class="style-icon">{style.icon}</span>}</button>)}
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default function App() {
  const [page, setPage] = createSignal(window.location.hash === "#editor" ? "editor" : "landing");
  const [landingMode, setLandingMode] = createSignal("editor");
  const [landingScrolled, setLandingScrolled] = createSignal(false);
  const navigate = (nextPage) => {
    window.location.hash = nextPage === "editor" ? "editor" : "top";
    setPage(nextPage);
  };
  const handleHashChange = () => setPage(window.location.hash === "#editor" ? "editor" : "landing");
  onMount(() => {
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
  const handleGetStarted = () => setPage("onboarding");
  const finishOnboarding = () => {
    localStorage.setItem("autoedit_onboarding_done", "1");
    navigate("editor");
  };

  return (
    <Show when={page() === "onboarding"} fallback={
      <Show when={page() === "editor"} fallback={
      <div class={`landing-page landing-page-${landingMode()}`}>
        <header class={`landing-header ${landingScrolled() ? "landing-header-scrolled" : ""}`}>
          <div class="landing-header-inner">
            <a class="landing-brand" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor"><LogoIcon /><span>Animator</span></a>
            <nav class="landing-nav" aria-label="Primary navigation">
              {['Products', 'Features', 'Pricing', 'Coin Stock'].map((item) => <a href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }}>{item}</a>)}
            </nav>
            <a class="landing-auth" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }}>Sign Up/Log In</a>
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
              <div class="landing-motion-card landing-motion-reference"><h2>Reference</h2><img class="landing-motion-thumb" src="/reference-chart.png" alt="Monthly Revenue Growth reference" /></div>
              <div class="landing-motion-card landing-motion-assets"><h2>Assets</h2></div>
              <div class="landing-motion-card landing-motion-style"><h2>Style</h2></div>
              <div class="landing-motion-arrow" aria-hidden="true" />
              <div class="landing-motion-result"><h2>Monthly Revenue Growth</h2><img src="/reference-chart.png" alt="Monthly Revenue Growth result" /></div>
            </div></div>) : (<div class="landing-mode-animate">
              <div class="landing-demo-card landing-demo-video"><Show when={landingMode() === "creator"} fallback={<><h2>Add raw video for<br />the edit</h2><img src="/image%2010.png" alt="Raw video preview" /></>}><h2>Add audio/script<br />for the video</h2><div class="landing-media-rects"><span class="landing-rect" /><span class="landing-rect" /></div></Show></div>
              <div class="landing-demo-card landing-demo-assets"><h2>Add assets for the<br />edit</h2><div class="landing-asset-art"><img src="/3699619.png" alt="" /><img src="/3274143.png" alt="" /><img src="/2843659.png" alt="" /><img src="/2376399.png" alt="" /><img src="/4924130.png" alt="" /></div></div>
              <div class="landing-demo-card landing-demo-styles landing-demo-styles-reversed"><Show when={landingMode() === "creator"} fallback={<><h2>Select styles and<br />elements for the edit</h2><div class="landing-style-grid"><span>Zooms <ZoomIn /></span><span>Captions <Captions /></span><span>B Rolls <Plus /></span><span>Transitions <Square /></span><span>Motion Graphics <Atom /></span></div></>}><h2>Style</h2><div class="landing-style-single"><span class="landing-rect landing-rect-style" /></div></Show></div>
              <div class="landing-demo-connector" aria-hidden="true" />
              <div class="landing-demo-result" aria-hidden="true" />
            </div>)}</Show>
          </section>
          <section class="landing-showcase" aria-label="Before and after video editing">
            <Show keyed when={landingMode()} fallback={null}>{() => landingMode() === "creator" ? <a class="landing-card landing-card-creator landing-mode-animate" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor"><span class="creator-square creator-square-back" /><span class="creator-square creator-square-front" /></a> : landingMode() === "motion" ? <a class="landing-card landing-card-motion landing-mode-animate" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor"><span class="motion-rect" /><span class="motion-prompt">Prompt: I want a graphic like this, but with these metrics and this style</span></a> : <a class="landing-card landing-mode-animate" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor" />}</Show>
            <img class="landing-arrow" src="/vector-6.svg" alt="" aria-hidden="true" />
            <Show keyed when={landingMode()} fallback={null}>{() => landingMode() === "motion" ? <a class="landing-card landing-card-motion-right landing-mode-animate" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor"><span class="motion-rect motion-rect-video"><video class="motion-video" src="/animator-arr.mp4" muted loop playsinline preload="metadata" /><button class="motion-play" onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleMotionVideo(event.currentTarget); }} aria-label="Play chart"><span class="icon-play"><Play /></span><span class="icon-pause"><Pause /></span></button></span></a> : landingMode() === "creator" ? <a class="landing-card landing-card-creator-right landing-mode-animate" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor"><span class="creator-rect creator-rect-video"><video class="motion-video" src="/animator-promo-vertical.mp4" muted loop playsinline preload="metadata" /><button class="motion-play" onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleMotionVideo(event.currentTarget); }} aria-label="Play promo"><span class="icon-play"><Play /></span><span class="icon-pause"><Pause /></span></button></span></a> : <a class="landing-card landing-mode-animate" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor" />}</Show>
          </section>
          <section class={`landing-features landing-features-${landingMode()}`} aria-label="Animator features">
            <div class="landing-features-row landing-features-row-1">
              <div class="feature-card feature-learn">
                <h2>Learn Your Style</h2>
                <span class="feature-label">Structure</span>
                <div class="learn-figure">
                  <span class="learn-avatar" />
                  <span class="learn-slot" />
                  <span class="learn-tile" />
                  <span class="learn-arrow learn-arrow-blue" />
                  <span class="learn-arrow learn-arrow-white" />
                  <span class="learn-caption">Captions</span>
                  <span class="learn-broll">B-Roll</span>
                  <span class="learn-rule" />
                  <span class="learn-note learn-note-color">Add background<br />color</span>
                  <span class="learn-note learn-note-roll">B-Roll from<br />assets</span>
                </div>
              </div>
              <div class="feature-card feature-brand">
                <h2>Consistent Brand</h2>
                <span class="feature-label">Colors</span>
                <div class="brand-swatches">
                  <span class="brand-swatch brand-swatch-dark" />
                  <span class="brand-swatch brand-swatch-blue" />
                  <span class="brand-swatch brand-swatch-white" />
                  <span class="brand-swatch brand-swatch-indigo" />
                  <span class="brand-swatch brand-swatch-violet" />
                </div>
                <span class="feature-label brand-font-label">Font Text</span>
                <span class="brand-font-name">Sansation Light</span>
              </div>
              <div class="feature-card feature-save">
                <h2>Save Time</h2>
                <div class="save-comparison-label"><span>With Animator</span><span>Without</span></div>
                <div class="save-cols">
                  <div class="save-col">
                    <span class="save-title">Edit 3<br />Videos</span>
                    <span class="save-clock save-clock-anim" />
                    <span class="save-time">20min</span>
                  </div>
                  <div class="save-col">
                    <span class="save-title">Edit 3<br />Videos</span>
                    <span class="save-clock save-clock-manual" />
                    <span class="save-time">4-5h</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="landing-features-row landing-features-row-2">
              <div class="feature-card feature-plan">
                <h2>First Plan, then Create</h2>
                <div class="plan-panel">
                  <div class="plan-row"><span class="plan-thumb plan-avatar" /><span class="plan-name">B-Rolls 1:</span></div>
                  <div class="plan-row"><span class="plan-thumb plan-motion"><Atom /></span><span class="plan-name">Motion G:</span></div>
                  <div class="plan-row"><span class="plan-thumb plan-avatar" /><span class="plan-name">B-Rolls 2:</span></div>
                  <div class="plan-row"><span class="plan-thumb plan-avatar plan-caption"><span>Captions</span></span><span class="plan-name">Captions:</span></div>
                  <span class="plan-accept">Accept <EnterIcon /></span>
                </div>
              </div>
              <div class="feature-card feature-grow">
                <h2>Grow your brand</h2>
                <div class="grow-figure">
                  <span class="grow-arrow" />
                  <span class="grow-avatar" />
                  <span class="grow-follow grow-follow-100">100 Followers</span>
                  <span class="grow-follow grow-follow-1m">1M Followers</span>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    }>
      <EditorView onBack={() => navigate("landing")} />
    </Show>
    }>
      <OnboardingView onDone={finishOnboarding} />
    </Show>
  );
}
