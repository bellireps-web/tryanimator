# Plan: harness del agente HyperFrames + captura en web (solo web, sin servidor)

## Goal

El agente (prompt + media + ratio) produce video con un circuito auditable: el modelo
propone el plan (cortes/captions/b-rolls), el humano lo aprueba, y la web captura el
resultado en el propio navegador (botón Export), sin servidor local, sin CLI y sin
instalaciones.

## Success Criteria

- `editor/agent.sh --dry-run` imprime el circuito completo sin ejecutar nada.
- `editor/agent.sh propose` escribe `editor/plan.proposed.json` (con el modelo) sin
  tocar `plan.json`; `promote` lo adopta tras revisión humana del diff.
- En el Studio, Export graba la composición sonando en una vista de captura y al
  terminar ofrece el fichero de video para ver/descargar, con audio incluido.
- Nada se graba sin acción explícita. Ningún error se oculta.

## Context And Current Facts

- No existe harness (sin `.agents/`, `agents/`, `scripts/` ni `harness/` en el repo).
- Motor actual: `editor/` con `generate.py` (transcript → `plan.json` + `index.html`
  1080×1920), `media/` y copia servida `public/plan.json`. Fuente de verdad: `plan.json`.
- Export del Studio hoy solo navega al mock (`onExport={() => navigate("editor")}` en
  `src/App.jsx`); no hay vía de salida de video.
- Decisión del usuario: solo web. No hay servidor local ni render por CLI en este plan.
- Habilidades HyperFrames ya leídas en esta sesión: contrato de composición
  (`hyperframes-core`), recetas de edición y loop del CLI (`hyperframes-cli`, que
  aquí solo se usa como referencia de validación, no se ejecuta).
- Límite del sandbox: aquí no se puede abrir navegador ni instalar nada; la
  validación manual se hace en la máquina del usuario.

## Constraints And Non-goals

- Restricción vigente del usuario: nada destructivo sin palabra explícita. Todo es
  aditivo; ningún fichero existente se borra o reescribe salvo añadidos puntuales.
- La vista plan no resucita (orden explícita anterior).
- No-goals: servidor local, CLI HyperFrames, render cloud, batch, auth/pagos,
  auto-grabación, cambios en landing/mock/onboarding, nuevos deps.

## Key Decisions

- **D1 — Harness en `editor/agent.sh` (shell + python3, cero deps).** Compone piezas
  existentes (`generate.py`) y deja log JSONL en `editor/runs/`. La parte de
  validación del CLI (`lint`/`check`) queda como paso opcional documentado para
  quien tenga el CLI, fuera del circuito obligatorio.
- **D2 — Captura 100% en navegador (MediaRecorder).** Sin servidor no hay quien
  lance procesos: la salida de video se graba en el Studio con `getDisplayMedia`
  (pestaña) o stream del elemento, más audio, y se descarga. Alternativa rechazada:
  servidor local de render (el usuario quiere solo web).
- **D3 — Tradeoff declarado:** la captura es en tiempo real (no frame-accurate como
  el CLI) y el formato depende del navegador (WebM donde no haya MP4 en
  MediaRecorder; se detecta y se etiqueta honestamente). La pestaña debe permanecer
  visible durante la grabación.
- **D4 — Doble gesto con puerta.** Export abre la vista de captura con resumen del
  plan; grabar exige pulsar Grabar. Sin auto-grabación.
- **D5 — Etapa LLM por `curl` (stdlib, sin SDK).** Igual que antes: `propose` →
  `plan.proposed.json` con el esquema de `plan.json`; `promote` exige diff revisado.
  Clave solo por entorno (`META_API_KEY`), jamás en repo ni logs. Aviso vigente: el
  tier contributor permite a Meta usar inputs/outputs para entrenar.
- **Supuestos reversibles:** harness vive en `editor/`; env `META_API_KEY`; la
  composición a capturar es `editor/index.html` embebida en vista de captura.

## Recommended Approach

Circuito único UI = agente hasta el plan (`plan.json` → composición). La salida de
video sale del navegador por captura explícita. Commits separados por unidad de
trabajo, push solo si se pide.

## Work Plan

- **U1 — `editor/agent.sh`.** Subcomandos: `--dry-run`; `propose` (LLM →
  `plan.proposed.json`, valida modelo al arrancar); `promote --yes` (adopta tras
  diff revisado → `plan.json` + regenera composición). Paso `check` del CLI solo
  documentado como opcional.
- **U2 — Vista de captura en el Studio.** Ruta/panel con la composición embebida,
  botón Grabar (pide compartir pestaña + audio), cronómetro y parada, y al terminar
  `<video>` con lo grabado + descarga con nombre por ratio/fecha. Si el navegador
  no soporta captura o el usuario la deniega: mensaje claro, sin reintentos ocultos.
- **U3 — Trazabilidad.** Entradas en `CHANGELOG.md` + `--help` del harness;
  `.env*` a `.gitignore` (blindaje anti-claves).
  Lectura obligatoria al ejecutar: `hyperframes-core/references/variables-and-media.md`
  si cambia placement de media.

## Validation Plan

- U1: `sh -n editor/agent.sh` y `--dry-run` aquí (sandbox-safe); en local:
  `propose` sin clave debe fallar visible; con clave, `propose` → diff revisado →
  `promote --yes` → `plan.json` actualizado + composición regenerada.
- U2: `npm run build` aquí; en local: Export → grabar 5 s → el fichero se reproduce
  con imagen y audio, y el cronómetro coincide con su duración ±1 s. Probar denegar
  el permiso: debe salir el mensaje, nada roto.
- E2E (paso de mayor riesgo): prompt de prueba → propuesta → promote → captura →
  fichero final visible y descargable.

## Risks / Rollback

- Formato de salida varía por navegador (WebM vs MP4): se detecta `mimeType`
  soportado y se etiqueta el fichero con su extensión real, sin prometer MP4.
- La pestaña debe permanecer visible y con audio compartido; si no, la grabación
  sale muda o pausada: se avisa antes de grabar.
- Calidad/tiempo-real: no es render frame-accurate; documentado como tradeoff
  aceptado, no como bug.
- Clave ausente / modelo inválido / timeouts y 4xx/5xx de la API: error visible en
  el primer paso, sin efectos laterales ni reintentos ocultos.
- Rollback: todo aditivo; commits separados permiten revertir por unidad.

## Open Questions

None. Supuestos reversibles declarados arriba.
