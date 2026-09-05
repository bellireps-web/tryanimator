# Spec: render MP4 100% en navegador (sin cloud, sin local)

## Objetivo

Convertir una composición HyperFrames del editor (`plan.json` + `index.html`) en un
fichero MP4 descargable ejecutando todo en el navegador: sin servidor, sin CLI,
sin cloud, sin instalaciones.

## Alcance del vocabulario (lo que el renderer sabe pintar)

- Voz: rangos kept (`audioClips` con `start/duration/mediaStart`).
- B-rolls: imágenes full-bleed con tiempos (`brolls`), Ken Burns (scale 1→1.08).
- Captions: una card por frase (`captions`), pill + entrada (y/opacity).
- Título: logo + titular + subtítulo (0→2 s).
- Fuera de alcance v1: transitions, effects, zooms, sounds, motion de catálogo
  (entran cuando el agente los emita como datos pintables; hoy quedan en `queued`).

## Arquitectura

```
plan.json → scene resolver (t) → canvas 1080×1920 → VideoFrame → VideoEncoder (H.264)
                                              ↘ drawImage / fillText por frame
voiceover.wav → decodeAudioData → corte por kept → AudioEncoder (AAC)
                                                     ↘ chunks ─→ mediabunny (MP4 fastStart) → Blob → descarga
```

1. **Reloj de render, no reproducción.** Frame `t = n/30`: se resuelve la escena
   desde `plan.json`; los transforms se recalculan como funciones puras de `t`.
   Determinista, inmune a pestaña oculta.
2. **Pintado.** Por frame y en orden: fondo → `drawImage` del b-roll (las `<img>`
   ya cargadas valen) o del video de usuario (seek + espera a `seeked`) → pill del
   caption (`roundRect` + `fillText`, fuentes de la página ya cargadas).
3. **Video.** `new VideoFrame(canvas, { timestamp })` → `VideoEncoder` con
   `avc1.42E01E`; timestamps del reloj (sin deriva A/V).
4. **Audio.** Sin reproducir nada: decode completo una vez, corte por kept ranges,
   `AudioEncoder` con `mp4a.40.2`.
5. **Muxado.** Mediabunny (`Mp4OutputFormat`, `fastStart`) → Blob →
   `animator-<dur>s.mp4`. En memoria para videos cortos; OPFS si crecen.
6. **Hilo.** Web Worker + `OffscreenCanvas` (UI libre + progreso real por frame).

## Sonda de codecs y fallbacks (cascada visible, sin silencios)

1. `VideoEncoder` + `AudioEncoder` existen y `isConfigSupported()` acepta
   H.264/AAC → vía offline (rápida).
2. Si no: captura de pestaña en tiempo real (`getDisplayMedia` + MediaRecorder).
3. Permiso denegado / sin soporte: mensaje claro y stop.
4. Formato de captura realtime según navegador (WebM donde no haya MP4;
   se etiqueta la extensión real).

## Dependencias

- `mediabunny` (sucesor de `mp4-muxer`, MPL-2.0 — pendiente de revisión de
  licencia según regla 19 antes de añadirla). Resto: APIs web estándar, cero deps.

## Límites asumidos

- Videos cortos (≤1–2 min): memoria del decode + seeks de video.
- H.264+AAC en Chrome/Edge; el gate elige solo en cada navegador.
- GSAP por CDN en la vista de captura (red necesaria para previsualizar;
  el render offline no depende del reloj de GSAP).
- No frame-accurate vs CLI por definición de captura; el offline es
  determinista por construcción (mismo plan → mismos frames).

## Validación

- Render del promo (26.4 s): el MP4 dura lo mismo ±1 frame, tiene audio e imagen,
  y los captions aparecen en sus tiempos (revisión manual contra `plan.json`).
- Denegar el permiso de captura → mensaje, nada roto.
- Repetir el render con el mismo plan → misma duración y contenido.
