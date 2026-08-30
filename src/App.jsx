import { createSignal, onMount, onCleanup, Show } from "solid-js";

function LogoIcon() {
  return <img class="landing-logo-icon" src="/icon-animator.png" alt="" />;
}

function ModeSwitch() {
  const [mode, setMode] = createSignal("editor");
  return (
    <div class="landing-switch" role="tablist" aria-label="Workspace mode">
      <div class={`landing-switch-indicator ${mode()}`} />
      <button class={mode() === "editor" ? "selected" : ""} onClick={() => setMode("editor")} role="tab">Editor</button>
      <span class="landing-divider" />
      <button class={mode() === "creator" ? "selected" : ""} onClick={() => setMode("creator")} role="tab">Creator</button>
      <span class="landing-divider" />
      <button class={mode() === "motion" ? "selected" : ""} onClick={() => setMode("motion")} role="tab">Motion</button>
    </div>
  );
}

function EditorView({ onBack }) {
  const [prompt, setPrompt] = createSignal("");
  const [active, setActive] = createSignal("home");
  const [sidebarVisible, setSidebarVisible] = createSignal(true);

  return (
    <div class={`editor-page ${sidebarVisible() ? "" : "editor-sidebar-hidden"}`}>
      <aside class="editor-sidebar" aria-label="Main navigation">
        <div class="editor-brand">
          <button class="editor-back" onClick={onBack} aria-label="Back to landing">←</button>
          <LogoIcon />
          <span>Animator</span>
        </div>
        <button class="editor-hide" onClick={() => setSidebarVisible(false)} aria-label="Hide sidebar">←</button>
        <div class="editor-section-title">Projects</div>
        <button class={`editor-nav-item ${active() === "home" ? "active" : ""}`} onClick={() => setActive("home")}>◇ <span>Home</span></button>
        <button class={`editor-nav-item ${active() === "projects" ? "active" : ""}`} onClick={() => setActive("projects")}>◇ <span>Projects</span></button>
        <div class="editor-section-title editor-assets-title">Assets</div>
        <button class={`editor-nav-item ${active() === "templates" ? "active" : ""}`} onClick={() => setActive("templates")}>▱ <span>Templates</span></button>
        <button class={`editor-nav-item ${active() === "resources" ? "active" : ""}`} onClick={() => setActive("resources")}>◌ <span>Resources</span></button>
        <button class={`editor-nav-item ${active() === "community" ? "active" : ""}`} onClick={() => setActive("community")}>♧ <span>Community</span></button>
        <div class="editor-section-title editor-user-title">User</div>
        <button class={`editor-nav-item ${active() === "user" ? "active" : ""}`} onClick={() => setActive("user")}>◇ <span>User</span></button>
        <button class="editor-nav-item editor-settings" onClick={() => setActive("settings")}>◇ <span>Settings</span></button>
      </aside>
      {!sidebarVisible() && <button class="editor-show" onClick={() => setSidebarVisible(true)} aria-label="Show sidebar">→</button>}

      <main class="editor-main">
        <div class="editor-mode-pill"><span class="selected">Video</span><span>Audio</span><i></i><span>Motion</span></div>
        <h1>What’s your next edit?</h1>
        <div class="editor-chatbox">
          <div class="editor-resource-cards">
            <div><strong>⌁ <small>0</small></strong><span>Video for<br />edit</span></div>
            <div><strong>▦ <small>0</small></strong><span>Assets</span></div>
            <div><strong>◇ <small>0</small></strong><span>Styles</span></div>
          </div>
          <textarea value={prompt()} onInput={(event) => setPrompt(event.currentTarget.value)} placeholder="Describe what you want im the de video edit" aria-label="Describe your video edit" />
          <div class="editor-toolbar"><button>Elements ▾</button><button>▯ 9:16</button><button>@</button><button class="editor-submit">Edit it ▶</button></div>
        </div>
        <section class="editor-inspiration"><h2>Inspiration</h2><div><article><div class="inspiration-placeholder">Premier edit</div><strong>Premier edit</strong></article><article><div class="inspiration-placeholder">Black background</div><strong>Black background</strong></article><article><div class="inspiration-placeholder">Remotion skill</div><strong>Remotion skill</strong></article><article><div class="inspiration-placeholder">Chat odyssey UI</div><strong>Chat odyssey UI</strong></article></div></section>
      </main>
    </div>
  );
}

export default function App() {
  const [page, setPage] = createSignal(window.location.hash === "#editor" ? "editor" : "landing");
  const navigate = (nextPage) => {
    window.location.hash = nextPage === "editor" ? "editor" : "top";
    setPage(nextPage);
  };
  const handleHashChange = () => setPage(window.location.hash === "#editor" ? "editor" : "landing");
  onMount(() => window.addEventListener("hashchange", handleHashChange));
  onCleanup(() => window.removeEventListener("hashchange", handleHashChange));

  return (
    <Show when={page() === "editor"} fallback={
      <div class="landing-page">
        <header class="landing-header">
          <a class="landing-brand" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }} aria-label="Open editor"><LogoIcon /><span>Animator</span></a>
          <nav class="landing-nav" aria-label="Primary navigation">
            {['Products', 'Use Cases', 'Pricing', 'Resources'].map((item) => <a href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }}>{item}</a>)}
          </nav>
          <a class="landing-auth" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }}>Sign Up/Log In</a>
        </header>
        <main id="top" class="landing-main">
          <h1>The AI that edits your<br />videos in one click</h1>
          <ModeSwitch />
          <a class="landing-cta" href="#editor" onClick={(event) => { event.preventDefault(); navigate("editor"); }}>Get started for free</a>
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
  );
}
