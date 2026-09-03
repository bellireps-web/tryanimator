# Reglas de cambios del proyecto

## Relojes save-time — 2026-09-03

- "Edit 3 videos" centrado (regla scopeada a `.fg-save`, sin tocar brand).
- Reloj rápido (20min): minutera a las 6 (180°), horaria a medio camino 12→1 (15°); arco de media luna 0→180°.
- Reloj lento (4-5h): horaria a las 12 (0°), minutera entre las 4 y 5 (135°); arco 0→135°. Arcos en `conic-gradient` sobre `::before` (las agujas pintan encima).
- Solo CSS, sin tocar JSX. Build ✅ (revisar visual en local).
- Ajuste: reloj rápido con las dos agujas pequeñas (aguja 1 recta a las 12, aguja 2 entre 12 y 1); el lento queda como estaba. Arco sin cambios.
- Arco = distancia entre agujas: rápido 0→15° (fina), lento 0→135° intacto; minutera del lento también pequeña.
- Grow your brand: curva SVG 100→10K→100K→1M con área, fila avatar→1M y chips ✓ Approved/✓ Adjusted. Build ✅.
- Grow bis: fuera chips, fuera tira azul (regla eliminada), avatar a rectángulo con radius, fila bajo gráfica [100 Followers →(flecha blanca learn, flipped) 1M Followers]. Build ✅.
- Grow ter: fuera avatar (reglas eliminadas), fila 100→1M centrada, pills a 19px (el 600 ya era semi-bold). Build ✅.
- Features: sección bajada 80px (3 modos), título blanco "Built by editors, for creators.". Build ✅.
- Pricing bajo features (3025/3725/3025 por modo): toggle Monthly/Yearly funcional (yearly −20% placeholder + "billed yearly"), 3 cards Plus 20/Pro 40/Enterprise Custom con checks, CTAs a onboarding (Contact Sales pendiente de destino real). Build ✅.
- Pricing v2: toggle compacto como el mode pill (220×44, 16px), cards min-height 680px, borde suavizado a #4A4870 y badge "Most popular" en Pro. Build ✅.
- Pricing v3: hover con borde iluminado, divisor bajo la descripción, checks en acento, CTA Pro más brillante, descripción a 20px. Build ✅.
- Pricing v4: sección reubicada por modo (editor 3025→3600, creator 3725→3850, motion 3025→2880) para que no solape las 5 cards en editor/creator y sin margen de más en motion; alturas de página ajustadas (default 3400→4620, editor 4380, motion 2560→3660). Build ✅.
- Creator showcase: los dos cuadrados pasan a tarjetas Script (icono FileText + líneas de texto) y Audio (icono AudioLines + waveform de 7 barras), con gradiente, sombra y etiqueta en mayúsculas. Build ✅.
- Showcase autoplay: los videos de creator (`animator-promo-vertical.mp4`) y motion (`animator-arr.mp4`) arrancan solos (muted + `play()` al montar con catch silencioso); el botón flotante se sincroniza con eventos play/pause en vez de asumir estado. Build ✅.
- Demo creator: los dos rectángulos grises de "Add audio/script for the video" pasan a mini-tarjetas Script y Audio (mismo diseño del showcase, compacto). Build ✅.
- Iconos Script/Audio: stroke 1.5→3 y color #B8B2EE→#E4E2F6 (showcase + minis). Build ✅.
- Iconos bis: `strokeWidth={3}` pasado por prop Lucide en los 4 iconos (el atributo `stroke-width=2` de Lucide + CSS en caché explicaba que no se viera el cambio). Build ✅.

## Video + elements al job — 2026-09-03

- El mock mete al job los videos subidos (nombre+url, sesión) y los elements marcados; `Edit it`/Enter va al loading con todo.
- Loading por etapas: solo las fases de los elements elegidos (silencios/captions/b-rolls con counts del plan); el resto aparece como "en cola del agente". Sin elements, van las 3 soportadas.
- Studio: si hay video subido, el preview lo reproduce de verdad (transporte play/pausa/seek/tiempos contra el elemento; captura compone su frame) y muestra chips de fuente + elements.
- `generate.py --only silence|captions|brolls --elements "..." --videos "..."`: filtra etapas y registra `elements{requested,applied,queued}` + `sourceVideos` en `plan.json` (verificado: solo-captions → 0 cortes, 27.0s, Transitions en queued).
- Verificación: `npm run build` ✅. Límite honesto: las urls subidas mueren al recargar (persistencia real con el servidor de render, plan pendiente de approve).

## Fix crash Loading (Kobalte Progress.Root undefined) — 2026-09-03

- Causa raíz probada: bajo el bundler de dev (esbuild, ESM y CJS), `Progress.Root` llega `undefined` (`Root:undefined, Track:function` reproducido aquí empaquetando el import), y Solid casca con `reading 'name'` al renderizar `LoadingView`. En build (rollup) resolvía bien: por eso compilaba pero moría en dev.
- Fix: fuera Kobalte de `LoadingView`; barra nativa `role=progressbar` + `aria-valuenow` con el mismo gradiente (además corrige un bug latente: el fill dependía de una var CSS de Kobalte y se veía siempre lleno). Sin dependencias nuevas, sin borrados.
- `DropdownMenu` de la landing no afectado (otro chunk, renderiza bien).
- Verificación: `npm run build` ✅. Requiere reinicio limpio del dev + pestaña nueva.

## Loading tarjeta ratio + gradiente vivo — 2026-09-03

- `LoadingView` rehecho: tarjeta con las proporciones del ratio elegido (16:9 640×360, 9:16 270×480, 1:1, 4:3), gradiente animado dentro (3 blobs radiales morados a la deriva + grano SVG + viñeta, según tus referencias Dreaming/Imaginando), pill de fase + % grande + "quedan ~Xs" en vivo.
- Fases con datos reales de `plan.json` (nº silencios/captions/b-rolls; degradado elegante sin él). Progreso simulado ~12s hasta que exista el agente real; la barra fina de Kobalte se mantiene por accesibilidad.
- Librerías buscadas: el consenso (componentes MIT tipo shadcn, volt/vortex-ui) implementa esto con CSS puro (blobs + blur + ruido SVG), sin runtime. Aplicado igual: cero dependencias nuevas, `prefers-reduced-motion` respeta estático.
- Verificación: `npm run build` ✅. Sin probar en navegador (sandbox).

## Restaura mock + fuera vista plan — 2026-09-03

- `EditorView` + `ProjectsView` restaurados en `src/App.jsx` como página `editor` (sidebar, pill, título dinámico, chatbox con resource cards, toolbar Elements/ratio/@, modales, beta). Verificado por diff contra HEAD: idénticos salvo el cableado Enter/submit.
- Único añadido funcional: `Edit it`/Enter del chatbox crea el job (prompt + ratio del toolbar) y va al loading → studio. `Export` del studio vuelve al mock.
- Eliminados `src/HFEditorView.jsx` y `src/hf-editor.css` (vista plan). Se conserva `editor/` + `public/plan.json` + `public/poster.png` porque el studio los usa (transporte, captions, captura).
- Verificación: `npm run build` ✅, cero referencias a HFEditorView.

## Flujo Enter→carga→studio — 2026-09-03

- Nuevas vistas independientes: `src/NewVideoView.jsx` (prompt + ratio 9:16/16:9/1:1/4:3, Enter envía), `src/LoadingView.jsx` (ratio elegido + `Progress` de Kobalte con gradiente 0→100% en ~3.6s, con cleanup), `src/StudioEditorView.jsx` (editor de tu spec) + `src/studio.css`. Páginas `newvideo`/`loading`/`studio` en `App`; el plan (`editor`) suma botón "Nuevo video".
- Studio según spec: izquierda (← New Video, Upgrade to Plus, chat con +, ratio cíclico y send redondo, nota beta), derecha (Export → vista plan, ＋Capturar Frame descarga PNG real vía canvas con caption del frame, preview dimensionada por ratio, transporte play/pausa + seek + tiempos con datos de `plan.json`).
- Librería para la carga: Kobalte `@kobalte/core/progress` (ya instalada, MIT) — sin dependencias nuevas. Ratio funcional: redimensiona el preview (479px de alto, ancho por ratio).
- Verificación: `npm run build` ✅. `Progress.Root value/minValue/maxValue` confirmado en sus `.d.ts`. Sin probar en navegador (sandbox sin puertos): revisar transición loading→studio y captura en local.

## Editor HyperFrames v0 (rebanada plan→composicion) — 2026-09-02

- `opencut/` y `opencut-classic/` eliminados del repo (decisión del usuario; HyperFrames es el motor). Su contrato útil queda mapeado: `CommandManager.execute({command})` + comandos por dominio como referencia para la entrada única UI+agente. Recovery: `refs/tbh/recovery/before-opencut-removal/20260902T222456Z-43636`.
- Nuevo proyecto `editor/`: `generate.py` (transcript.json → `plan.json` + `index.html`), `media/` (voz + 3 b-rolls + logo), `index.html` standalone 1080×1920 (~26.4s). Entrada única: UI y agente operan sobre `editor/plan.json` y regeneran con `python3 editor/generate.py` (`public/plan.json` es copia servida derivada).
- Plan real medido: 1 silencio (24.0→24.33s), lead-trim 0.27s, 0 muletillas, 9 captions por frase, 3 b-rolls, voz en 2 clips pegados (recetas hard-cut/split/trim). 27.0s → 26.4s.
- Nueva vista `src/HFEditorView.jsx` + `src/hf-editor.css` (componente independiente): revisa cortes (activar/desactivar con duración efectiva en vivo), captions, b-rolls, voz y comandos de render. Navegación interna restaurada (`landing`/`editor`/`onboarding`, `#editor`).
- Verificación: `npm run build` ✅. Composición validada contra contrato (standalone sin template, root 1080×1920, 1 timeline pausada, audios con id, sin crossorigin/br/transform CSS). `npx hyperframes lint/check/preview/render` pendientes en máquina local (CLI no instalable en este sandbox).
- Anula la rebanada anterior "Editor real (opencut-classic)": el redirect a :3100 ya no existe.

## Editor real (opencut-classic) — 2026-09-02

- El editor mock de SolidJS (`EditorView` + `ProjectsView` en `src/App.jsx`) se elimina. El editor real es `opencut-classic/apps/web` (Next.js + motor Rust/WASM), que se arranca aparte con `cd opencut-classic/apps/web && bun run dev -- -p 3100`. La landing SolidJS (`npm run dev`, :3000) se conserva intacta y enlaza al editor vía `EDITOR_URL` (`http://localhost:3100`).
- Navegación: brand, nav, CTAs, `#editor` y fin de onboarding redirigen a `EDITOR_URL` con `window.location.href`. Ya no existe vista `editor` interna (`page` solo `landing`/`onboarding`).
- Entrada única UI+agente en el editor real: `CommandManager` (`opencut-classic/apps/web/src/core/managers/commands.ts`) — `editor.command.execute({ command })` con historial undo/redo. La UI entra vía managers (`timeline-manager`, `media-manager`, etc.); el agente IA debe emitir los mismos `Command` (`src/commands/{timeline,media,scene,project}`), sin caminos paralelos. Pendiente: exponer esa entrada al agente (siguiente rebanada).
- Verificación: `npm run build` ✅ (Vite, 25s). `bunx tsc --noEmit` en classic: 0 errores en app, 2 pre-existentes solo en `__tests__` (tipo `MediaTime`). `next dev`/`next build` no verificables en este sandbox (bloquea `listen`/puertos de Turbopack); pendiente correr el editor en máquina local.
- CSS huérfano `.editor-*`/`.projects-*` en `src/index.css` pendiente de limpieza (rebanada aparte).

## Reglas obligatorias

1. Antes de modificar una pantalla existente, conservar su estructura y estilos actuales.
2. No reemplazar `src/App.jsx` ni `src/index.css` completos para añadir una funcionalidad aislada.
3. Toda nueva pantalla debe vivir en un componente independiente.
4. La navegación entre landing y editor solo debe cambiar la vista; no debe reconstruir ni rediseñar el editor.
5. No añadir elementos visuales, secciones, iconos o textos que no estén en la referencia proporcionada.
6. Antes de cada cambio, revisar el CSS de referencia y comparar la captura resultante.
7. Después de cada cambio, ejecutar `npm run build`.
8. Los cambios de navegación no deben alterar dimensiones, posiciones, tipografías ni espaciados del editor.
9. Mantener los cambios visuales del usuario: sidebar ampliada, `Home`, `Projects`, `User`, eliminación de `Members`, chatbox aumentado un 7% y textarea multilínea.
10. No declarar una restauración exacta si solo se ha hecho una aproximación.

## Editor — toggle de modos (Editor/Creator/Motion)

- **2026-08-30 (icono Play en botón Edit it/Create it)**: El glifo "▶" del botón de acción se reemplaza por el icono `Play` de lucide (`<Play />`), ~10% más pequeño que el texto (14×14px frente al ▶ de ~16px). El botón pasa a `display:inline-flex;align-items:center;gap:7px` y el icono `stroke-width:2.5`. Verificado en Chrome: botón "Edit it" + `lucide-play` 14×14 centrado. Build ✅.

- **2026-08-30 (placeholder dinámico del chatbox por modo)**: El placeholder del textarea muestra el texto según el modo del toggle: Editor → "Describe what you want in your edit. → Edición"; Creator → "Describe what you want in your video. → Vídeo"; Motion → "Describe what you want in your motion graphics. → Motion graphics". Se liga a `editorMode()`. Verificado en Chrome: cada modo muestra su placeholder. Build ✅.

- **2026-08-30 (botón Edit it/Create it con estado desactivado)**: El botón de acción ahora aparece **desactivado** cuando el textarea del chatbox está vacío y en su estado normal cuando hay texto. Se liga al signal `prompt` (`disabled={!prompt().trim()}`) y con CSS `.editor-submit:disabled{opacity:.4;cursor:not-allowed;filter:saturate(.6)}`. Verificado en Chrome: sin texto → `disabled:true`, opacity .4, cursor not-allowed; con texto → `disabled:false`, opacity 1. Build ✅.

- **2026-08-30 (toolbar: margen/espaciado/tamaño según referencia)**: Se ajusta el `.editor-toolbar` para acercarse a la barra de referencia (solo métricas, manteniendo los botones actuales): texto de los 3 botones (Elements ▾, ▯ 9:16, @) en **blanco `#fff`** (antes `#E3E3E3`), `gap` de 16px → **22px**, y márgenes del bar `left 22→26px`, `right 20→24px`, `bottom 14→16px`. "Edit it▶"/"Create it▶" se mantiene anclado a la derecha con su tamaño. Verificado en Chrome: `left:26px`, `right:24px`, `bottom:16px`, `gap:22px`, botones `color rgb(255,255,255)`. Build ✅.

- **2026-08-30 (toolbar sin fondos grises y submit restaurado)**: Se eliminan los fondos/rectángulos grises (`#444457`) de los 3 botones (Elements ▾, ▯ 9:16, @) dejándolos como texto transparente (se mantiene su tamaño 12px). El botón "Edit it▶"/"Create it▶" se restaura a su tamaño original: font 16px, padding 9/13px, border-radius 13px (vuelve a 87×37; antes lo había encogido a 70×30 junto con el resto del toolbar), manteniendo `border:0`. Verificado en Chrome: 3 botones `bg rgba(0,0,0,0)` + border 0; submit 87×37 con `bg #141940`, `border 0`, font 16px. Build ✅.

- **2026-08-30 (toolbar -20% y sin borde en el botón de acción)**: Se reduce el toolbar del chatbox un ~20% (fuente 15→12px, padding 10/14→8/11px, radius 14→11px en los 3 botones; el submit pasa a font 13px, padding 7/10px). Además se corrige el botón "Edit it▶"/"Create it▶": al cambiar el selector a `:not(.editor-submit)`, el submit había perdido su `border:0` y mostraba el borde claro por defecto del navegador; se le añade `border:0` de nuevo. Verificado en Chrome: Elements 88×32, 9:16 56×32, @ 34×32 (antes 111×40/71×40/42×40); submit 70×30 con `border-top:0px`. Build ✅.

- **2026-08-30 (toolbar, botón de acción, label de Motion y sidebar fija)**: 1) El toolbar del chatbox agranda un ~40% sus 3 botones (Elements ▾, ▯ 9:16, @) y los unifica en cajas `#444457` con `border-radius:14px`, `font 15/20`, `padding 10px 14px` (antes "9:16" y "@" eran solo texto de 11px, diminutos y desalineados verticalmente). 2) El botón de acción cambia según el modo: Editor → "Edit it ▶", Creator → "Create it ▶", Motion → "Create it ▶". 3) El label "Reference" de la primera card en modo Motion se ajusta (`.resource-single` con `font-size:9px`, `white-space:nowrap`) para que quepa en una sola línea alineada sin pegarse a los bordes de la card de 45px. 4) La sidebar pasa a `position:fixed` (no se mueve al hacer scroll) y se añade hover sutil (`#1b1824`) + transición en los items de navegación. Verificado en Chrome: toolbar 111×40 / 71×40 / 42×40 alineados en top:480; `Edit it ▶` en editor y `Create it ▶` en creator/motion; span de Reference 45×11 en una línea; sidebar `fixed`. Build ✅.

- **2026-08-30 (eliminada la sección Inspiration y sin lag al reposicionar)**: Se elimina del editor la sección "Inspiration" y sus 4 cards/rectángulos (JSX `<section class="editor-inspiration">` y todo su CSS: `.editor-inspiration`, `.editor-inspiration h2`, `.editor-inspiration>div`, `.editor-inspiration article`, `.inspiration-placeholder`). Además se elimina el **lag del reposicionamiento** al ocultar la sidebar: se quitó la `transition` de `left`/`width` (propiedades de layout) de `.editor-main`, que al animarse durante 350 ms producía relayout contínuo y jank. Ahora el contenido se reposiciona al centro de forma instantánea. Verificado en Chrome: 0 nodos de `.editor-inspiration`; `main.left` pasa de 261 a 19 inmediatamente tras el click (muestras a 0-140 ms = 19, sin animación de 350 ms). Build ✅.

- **2026-08-30 (contenido se reposiciona al centro al ocultar la sidebar)**: Al pulsar el botón Hide de la sidebar, el contenido del editor (mode pill Editor/Creator/Motion, título, chatbox, sección Inspiration y las 4 cards de rectángulos) se **reposiciona al centro del espacio liberado**, sin escalar (se descarta el enfoque anterior de `scale(1.18)`). Implementación: `.editor-main` se expande de `left:261px` a `left:19px` (ancho `calc(100% - 261px)` → `calc(100% - 19px)`) con transición animada de `left`/`width`; como el pill, el título y el chatbox ya están centrados con `left:50%`, se recentran automáticamente al medio del nuevo ancho, y la fila de las 4 cards de Inspiration se centra con `justify-content:center`. Verificado en Chrome: `mainLeft 261→19`, `mainWidth 1179→1421`; centro X del contenido `851→730` (media del nuevo espacio). No hay wrapper extra ni transform escala. Build ✅.

- **2026-08-30 (revertido: contenido ya no se expande al ocultar la sidebar)**: Se revierte el cambio anterior de "reposicionar y aumentar tamaño" al ocultar la sidebar (pedido por el usuario). Se eliminó el wrapper `.editor-main-inner` del JSX y las reglas CSS asociadas (`.editor-main-inner`, el `transform:scale(1.18)`, la expansión de `.editor-main` a `left:19px` y el `overflow:auto` de la página). El contenido del editor vuelve a quedarse fijo (`left:261px`, ancho `calc(100% - 261px)`) al ocultar la barra. La funcionalidad de ocultar la sidebar se conserva (deslizamiento + botón flotante + icono contrario). Verificado en Chrome: tras Hide → `mainLeft:261px`, `mainWidth:1179px`, sin `hasInner`, sin escala; la sidebar sigue a opacity 0 y el botón en left:12. Build ✅.

- **2026-08-30 (separadores dinámicos del toggle)**: En el toggle de 3 modos (landing y editor), las líneas separadoras ahora dependen del modo activo: Editor → solo visible `Creator|Motion`; Creator → ninguna; Motion → solo visible `Editor|Creator`. Se implementa con una clase `hidden` (`visibility:hidden`) para no mover los botones; verificado en Chrome: las posiciones de los 3 botones quedan idénticas en todos los modos y la visibilidad coincide con la regla. Build ✅.

- **2026-08-30 (nav de la landing)**: En la barra de navegación de la landing se renombró "Use Cases" → "Features" y "Resources" → "Coin Stock". La navegación queda: Products · Features · Pricing · Coin Stock. Build ✅.

- **2026-08-30 (botón duplicado al ocultar sidebar)**: Al pulsar "Hide sidebar" en el editor se renderizaba un botón flotante `editor-show` (izquierda, `position:fixed`) para volver a mostrar la barra, que parecía un segundo botón idéntico espejado. Se eliminó el JSX y el CSS (`editor-show`). Ahora el botón Hide existe pero la clase `editor-sidebar-hidden` no tiene regla CSS (la barra no se oculta visualmente y no queda forma de mostrarla). Pendiente decisión del usuario: ocultar de verdad la barra o dejar el Hide sin efecto visual. Build ✅.
- **2026-08-30 (contenido usa el espacio al ocultar la sidebar)**: Al ocultar la sidebar, el contenido del editor ocupa el espacio liberado y crece proporcionalmente: `.editor-main` se expande de `left:261px` a `left:19px` (ancho completo) y el contenido (envuelto en `.editor-main-inner`) se escala **1.18×** con `transform-origin: 50% 22px` (crece re-centrado horizontalmente). Todo animado (`transition` en left/width/transform, cubic-bezier .35s). Si el contenido escalado supera los 900px, la página permite scroll (`.editor-sidebar-hidden{overflow:auto}`). Verificado en Chrome: tras Hide → `main-left:19px`, `innerTransform:matrix(1.18,…)`. Factor de escala a ajustar según criterio visual (1.18 elegido para llenar el +~20% de ancho). Build ✅.

- **2026-08-30 (botón Hide sidebar funcional)**: El botón Hide ahora oculta de verdad la barra lateral del editor: la `.editor-sidebar` se desliza fuera (translateX(-100%) + opacity 0, transición `cubic-bezier .35s`) y solo queda el botón. El botón se movió fuera del `aside` a `position:fixed`, se desliza de la esquina superior-derecha de la barra (`left:210px`) al borde izquierdo (`left:12px`) al ocultar, y alterna el icono lucide `PanelLeftClose` ↔ `PanelLeftOpen` (versión contraria). Animaciones: deslizamiento de la barra + del botón, y un *pop* del icono (`editorHintPop`) al pasar a estado oculto. Botón con hover (`#1C1C25`, scale 1.08) y active (scale .94). Verificado en Chrome: ocultar → barra fuera (opacity 0, x=-223) y botón en left:12; mostrar → restaura. Build ✅.

- **2026-08-30 (lag del toggle de la landing)**: El toggle de la landing se percibía como si **saltara** (no deslizara) mientras el del editor sí deslizaba, con CSS idéntico en ambos. Diagnóstico: las 6 transiciones existen y corren (Web Animations API), pero la **página de la landing es cara de pintar**: el h1 de la landing (60px) con `text-shadow` de **250px de desenfoque** crea un halo gigante que llega hasta ~y=450 y **envuelve el toggle** (top:308), saturando el raster al componer sobre él → frames perdidos → salto. En el editor el toggle está *encima* de su h1 (top:43 vs 195), por eso no chocaba.
  - Se probó `will-change: transform` en `.landing-switch` (promover capa): **empeoró** (el indicador quedaba clavado en 0), igual que había pasado antes con el indicador del editor; se descartó.
  - **Fix**: reducir el blur del glow del h1 de la landing de `250/142.8/71.4px` a `100/60/30px`. Umbral: el texto del h1 termina en y=200 y el toggle empieza en y=308 → un blur ≤ ~108px ya no toca el toggle. Medido en el dev server (Chrome headless): antes 1-4 pasos de interpolación (salto), después **11-13 pasos suaves** en varias pruebas, llegando al destino. Coste visual: el halo del título se ve más contenido (~9% de bytes distintos en la zona superior del landing, sobre fondo casi negro). Build ✅.

- **2026-08-30 (título dinámico de la landing)**: El h1 de la landing cambia según el modo seleccionado en el `ModeSwitch` (Editor → "The AI that edits your videos in one click"; Creator → "The AI that creates videos from a Script / Audio"; Motion → "The AI that creates motion graphics in one click"), en inglés correcto (se corrigió el "apartir de" → "from a"). Para reaccionar al modo, el estado del toggle se subió a `App` (`landingMode`) y se pasa a `<ModeSwitch mode setMode>`. Además se corrigió el placeholder del chatbox del editor ("im the de video" → "in your video"). Verificado en Chrome: cada modo muestra su título. Build ✅.

- **2026-08-30 (título dinámico)**: El h1 del editor ahora cambia según el modo activo del toggle: Editor → "What’s your next edit?", Creator → "What’s your next video?", Motion → "What’s your next motion graphics?". El texto de Motion (701px) desbordaba el contenedor fijo de 662px con `nowrap`, así que se añadió `.editor-main h1.editor-title.motion{font-size:37px}` (40px → 37px, apenas perceptible) para que quepa; verificado en Chrome: los tres modos caben (662px). El modo por defecto sigue siendo Editor. Build ✅.

## Editor — toggle de modos (Editor/Creator/Motion)

- **2026-08-30 (rendimiento)**: El deslizamiento del toggle del editor se percibía con lag en algunas direcciones aunque la landing iba fluida. Diagnóstico (Chrome headless + puppeteer):
  - Las 6 transiciones (Editor→Creator, Creator→Editor, Creator→Motion, Motion→Creator, Motion→Editor, Editor→Motion) son correctas en CSS y **corren las 6** (verificado con Web Animations API: `getAnimations()` con `currentTime` 0→50→…→217ms y destino exacto 0/83/167 en todos los casos). No falta ninguna animación.
  - La percepción de lag/sin-animación viene de la **pérdida de frames al renderizar**: la página del editor es cara de pintar (h1 con 6 `text-shadow` de 250px de desenfoque apilados, chatbox y gradiente), y bajo carga el raster/compositor pierde frames que ocultan los intermedios.
  - Se probó `will-change: transform` + capa de compositor en `.editor-mode-indicator`: empeoraba el arranque de la transición (con `will-change` la transición aún no había arrancado a los 650ms; sin él completaba), así que se **revertió** a CSS byte-idéntico al de la landing (solo `transition: transform .25s ease`, sin `will-change`). El bloqueo síncrono del clic es de ~1ms (0 long-tasks); el cuello de botella es el raster de la página, no el hilo principal.
  - **Fix aplicado (aprobado por el usuario)**: se redujo el glow del h1 del editor de 6 `text-shadow` apiladas a 3 (`0 0 250px #23223A, 0 0 142.8px #23223A, 0 0 71.4px #23223A`, misma estructura que el h1 de la landing). Medido con Chrome headless: el pico de bloqueo de frames pasó de **383ms a 34ms** (10 → 30 frames en la misma ventana) y la diferencia visual en la región del h1 es del **0.397%** de bytes (halo sutil ligeramente menos intenso). Se descartó la versión de 2 sombras (0.753% de diferencia) y el `will-change` (empeoraba el arranque de la transición). Build ✅.

## Onboarding (Frame 11)

- **2026-08-30 (corrección 2 — bug real en la app)**: El onboarding se veía roto en la app real (panel izquierdo y card negros, placa blanca vacía y play desplazado a ~1243,236). Dos causas:
  - **SolidJS ignora claves camelCase en estilos de objeto**: `style={{ backgroundImage }}` se aplica vía `style.setProperty("backgroundImage", …)`, que es inválido (requiere kebab-case), y se descartaba silenciosamente → `.onboarding-left` y `.onboarding-card-bg` quedaban sin `background-image`. Se cambió a style string: `style={`background-image:url(…)`}`. Verificado inspectando el DOM real: los divs renderizaban con `background: none`.
  - **`.onboarding-logo` estaba anidado dentro de `.onboarding-logo-plate`** (que es `position:absolute`), por lo que sus `left:187/top:33` se medían desde la placa (183,31) y el triángulo caía en (1243,236) en vez de (1060,205). Ahora el `<img>` es hermano de la placa dentro de `.onboarding-card` (igual que en `Group 24.svg`).
  - Assets re-verificados byte a byte contra los incrustados de los SVG: `left-panel.png` (md5 bd7181…) y `logo.png` (md5 ca35b2…) idénticos ✅; `editor-card.png` = recorte exacto (1760,288 → 800×1048) del incrustado de `Group 24.svg` (misma media/desv. de luminancia que la región visible del patrón) ✅.
  - Verificación end-to-end (Chrome headless + puppeteer-core, --no-save): flujo real landing → click "Get started" → onboarding, viewport 1440×900. Screenshots del build (`vite preview`) y del dev server byte-idénticos entre sí.
  - Comparación contra el render real de los SVG de referencia (Chrome, 1440×900): RMSE full 1.21, left 0.86, card 2.46, placa 3.32, logo 3.53 (escala 0–255; diferencias residuales = anti-aliasing de reescalado, no de posición). El triángulo del play coincide píxel a píxel en la grilla fina (5×5 de 14px sobre la placa).
  - `#editor` directo sigue saltando el onboarding ✅. Landing y editor sin cambios ✅. `npm run build` ✅.

- **2026-08-30 (corrección)**: Comparado contra los SVG de referencia originales (`Group 24.svg` y `ChatGPT Image 30 ago 2026, 07_13_27 1.svg`).
  - `editor-card.png` era una aproximación recompresa (86KB, 800×1047). Se sustituyó por la imagen exacta incrustada en `Group 24.svg` (2880×1624), recortada a la región visible del `matrix` (x1760,y288 → 800×1048).
  - `left-panel.png` y `logo.png` ya coinciden byte a byte (MD5 idéntico) con los PNG incrustados en los SVG de referencia, así que quedaron intactos.
  - Posición del logo corregida a `187,33` (antes flex-centrado en `185,33`) para coincidir exactamente con Rectangle 35/ChatGPT Image de Frame 11.
  - Corrección verificada: el recorte nuevo coincide con el render real del SVG (Chrome) fuera de la zona de la placa con RMSE ~0.009.
  - Componente independiente `OnboardingView.jsx` + `onboarding.css` (no se reemplazó `App.jsx`/`index.css`).
  - Compuesto: fondo `#060511`, panel izquierdo (721×900, `left-panel.png`), card con logo arriba derecha (425×556, `editor-card.png` recortada del SVG `Group 24`) y placa blanca con logo.
  - Assets en `src/assets/onboarding/`.
  - Flujo: el CTA "Get started" de la landing abre el onboarding; al terminar guarda `autoedit_onboarding_done` en `localStorage` y entra al editor. Solo se muestra la primera vez; `#editor` directo sigue saltando el onboarding.

## Historial visual confirmado

- **2026-08-29**: Ajustes CSS para alinear con Frame 4 de referencia:
  - Sidebar ampliada a 278px (original 241.5px + ~15%)
  - Posiciones de nav items ajustadas según Frame 4
  - Chatbox aumentado ~7% (677x246 → 724x263)
  - Textarea multilínea ampliada (145px → 155px)
  - Section title "Principal" → "Projects"
  - Placeholder del chatbox ajustado
  - Settings bottom position ajustada (25px → 46px)

- Se creó una landing page independiente.
- La landing debe llevar al editor mediante `#editor`.
- El editor previo a la landing usaba el layout de `Frame 4` a 1440×900.
- Sidebar base: 241.5px, separador en x=260.5px.
- El usuario pidió posteriormente ampliar la sidebar aproximadamente un 15%.
- Se añadió `Home` sobre `Projects`.
- `All Projects` pasó a llamarse `Projects`.
- `Creator` de la sidebar pasó a llamarse `User`.
- `Members` se eliminó.
- El chatbox se aumentó aproximadamente un 7%.
- El textarea debe permitir varias líneas y aprovechar el espacio central del chatbox.
- La landing tiene su propio fondo, navegación, botones y flecha SVG.
- La vista del editor debe conservarse al navegar desde la landing.
