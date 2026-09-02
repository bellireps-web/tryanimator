import { createSignal, onMount, onCleanup, Show } from "solid-js";
import OnboardingView from "./OnboardingView.jsx";
import { Home, Folder, LayoutTemplate, BookOpen, Users, CircleDollarSign, Settings, Scissors, Film, WandSparkles, AudioLines, Clapperboard, PanelLeftClose, PanelLeftOpen, Play, AtSign, ChevronDown, Palette, Image, Music2, RectangleHorizontal, Smartphone, SlidersHorizontal, ZoomIn, Captions, Plus, Atom, Square } from "lucide-solid";

function LogoIcon() {
  return <img class="landing-logo-icon" src="/icon-animator.png" alt="" />;
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
  const elements = ["B Rolls", "Sounds", "Effects", "Transitions", "Zooms", "Captions", "Motion Graphics", "Remove Silences"];

  const toggleMenu = (menu) => setOpenMenu(openMenu() === menu ? null : menu);
  const toggleElement = (element) => setSelectedElements((current) => current.includes(element) ? current.filter((item) => item !== element) : [...current, element]);
  const closeMenus = (event) => {
    if (!event.target.closest(".editor-toolbar-wrap")) setOpenMenu(null);
  };
  onMount(() => document.addEventListener("click", closeMenus));
  onCleanup(() => document.removeEventListener("click", closeMenus));

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
            <div><strong>{editorMode() === "creator" ? <AudioLines /> : editorMode() === "motion" ? <Clapperboard /> : <Scissors />}<small>0</small></strong><span class={editorMode() === "motion" ? "resource-single" : ""}>{editorMode() === "creator" ? <>Script/<br />Audio</> : editorMode() === "motion" ? <>Reference</> : <>Video for<br />edit</>}</span></div>
            <div><strong><Film /><small>0</small></strong><span>Assets</span></div>
            <div><strong><WandSparkles /><small>0</small></strong><span>Styles</span></div>
          </div>
          <textarea value={prompt()} onInput={(event) => setPrompt(event.currentTarget.value)} placeholder={editorMode() === "creator" ? "Describe what you want in your video" : editorMode() === "motion" ? "Describe what you want in your motion graphics" : "Describe what you want in your edit"} aria-label="Describe your edit" />
          <div class="editor-toolbar-wrap" onClick={(event) => event.stopPropagation()}>
            <Show when={openMenu() === "elements"}>
              <div class="editor-floating-menu elements-menu elements-selection-menu" role="menu" aria-label="Edit elements">
                <div class="elements-selection-grid">
                  {elements.map((element) => <button class={`element-option ${selectedElements().includes(element) ? "selected" : ""}`} onClick={() => toggleElement(element)} role="menuitemcheckbox" aria-checked={selectedElements().includes(element)}><span>{element}</span><span class="element-check" aria-hidden="true">✓</span></button>)}
                </div>
              </div>
            </Show>
            <Show when={openMenu() === "format"}>
              <div class="editor-floating-menu format-menu" role="menu">
                <button class="floating-menu-item active"><Smartphone /><span>9:16</span></button>
                <button class="floating-menu-item"><RectangleHorizontal /><span>16:9</span></button>
                <button class="floating-menu-item"><RectangleHorizontal /><span>1:1</span></button>
                <button class="floating-menu-item"><RectangleHorizontal /><span>4:3</span></button>
              </div>
            </Show>
            <div class="editor-toolbar"><button class="toolbar-elements" onClick={() => toggleMenu("elements")}>Elements <ChevronDown aria-hidden="true" /></button><button class="toolbar-format" onClick={() => toggleMenu("format")}><span class="toolbar-format-rectangle" aria-hidden="true" /><span>9:16</span></button><button class="toolbar-at" aria-label="Mention"><AtSign /></button><button class="editor-submit" disabled={!prompt().trim()}>{editorMode() === "editor" ? "Edit it" : "Create it"}<Play /></button></div>
          </div>
        </div>
      </main>
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
      <div class="landing-page">
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
            <button class="landing-demo-mode">Editor Mode <ChevronDown /></button>
            <div class="landing-demo-card landing-demo-video"><h2>Add raw video for<br />the edit</h2><img src="/image%2010.png" alt="Raw video preview" /></div>
            <div class="landing-demo-card landing-demo-assets"><h2>Add assets for the<br />edit</h2><div class="landing-asset-art"><img src="/3699619.png" alt="" /><img src="/3274143.png" alt="" /><img src="/2843659.png" alt="" /><img src="/2376399.png" alt="" /><img src="/4924130.png" alt="" /></div></div>
            <div class="landing-demo-card landing-demo-styles landing-demo-styles-reversed"><h2>Select styles and<br />elements for the edit</h2><div class="landing-style-grid"><span>Zooms <ZoomIn /></span><span>Captions <Captions /></span><span>B Rolls <Plus /></span><span>Transitions <Square /></span><span>Motion Graphics <Atom /></span></div></div>
            <div class="landing-demo-connector" aria-hidden="true" />
          </section>
          <section class="landing-showcase" aria-label="Before and after video editing">
            <a class="landing-card" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor" />
            <img class="landing-arrow" src="/vector-6.svg" alt="" aria-hidden="true" />
            <a class="landing-card" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor" />
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
