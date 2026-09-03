/**
 * Browser adapters for runMotionJob (Slice 6): the real UI path.
 *
 * - ai: ProxyAiAdapter (server keys stay in the worker; the browser only
 *   holds the app token, sent as x-app-token).
 * - cache: MotionCache over IndexedDB (content-addressed plan/segment/final).
 * - docs/images: in-memory docs + proxy stock search + element loading.
 * - renderer: segment encode via WebCodecs with per-segment cache reuse.
 * - mux: mediabunny MP4 (MPL-2.0, used unmodified as a library) over
 *   pre-encoded AVC packets + AAC from the OfflineAudioContext mix.
 *
 * Everything browser-only is injected (encode, createCanvas, loadElement,
 * media, encodeAudio) so the orchestration is unit-testable in Node.
 */
import { ProxyAiAdapter } from "./jobs.js";
import { MotionCache, IndexedDBBackend } from "../cache/store.js";
import { segmentKey } from "../cache/keys.js";
import { encodeSegment } from "../../web-render/src/index.js";
import { proxyError, fetchTracks, fetchSfx, buildAudioTimeline, renderAudioBuffer } from "./audio.js";
import * as mediabunny from "mediabunny";

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** First usable image URL from a stock payload (Pixabay or normalized). */
export function pickStockUrl(body) {
  const hits = Array.isArray(body && body.hits)
    ? body.hits
    : Array.isArray(body && body.items)
      ? body.items
      : [];
  for (const hit of hits) {
    const url = hit && (hit.previewURL || hit.largeImageURL || hit.url);
    if (typeof url === "string" && url) return url;
  }
  return null;
}

function defaultLoadElement(url, ImageImpl) {
  return new Promise((resolve, reject) => {
    let img;
    try {
      img = new ImageImpl();
    } catch (error) {
      reject(codedError("image_failed", `cannot create image: ${error && error.message}`));
      return;
    }
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(codedError("image_failed", `could not load image: ${url}`));
    img.src = url;
  });
}

/**
 * Load a drawable for a paint image ref. `stock:<query>` searches the
 * proxy; anything else loads as a direct URL (uploader object URLs).
 */
export function createImageLoader({ proxyBase, appToken, fetchImpl = fetch, loadElement, ImageImpl } = {}) {
  const load = loadElement || ((url) => defaultLoadElement(url, ImageImpl || Image));
  return {
    async load(ref) {
      if (typeof ref === "string" && ref.startsWith("stock:")) {
        if (!proxyBase) throw codedError("proxy_not_configured", "stock search needs the proxy URL");
        const query = ref.slice("stock:".length).trim();
        if (!query) throw codedError("bad_request", "empty stock query");
        const response = await fetchImpl(
          `${proxyBase}/stock/images?q=${encodeURIComponent(query)}&per_page=3`,
          { headers: { "x-app-token": appToken } },
        );
        const body = await response.json().catch(() => null);
        if (!response.ok) throw proxyError(response.status, body);
        const url = pickStockUrl(body);
        if (!url) throw codedError("stock_empty", `no stock image for: ${query}`);
        return load(url);
      }
      return load(ref);
    },
  };
}

function defaultCreateCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/**
 * Segment renderer with per-segment cache reuse. Returns
 * { segments: [stats], packets: [serializable packets in order], dims }.
 * The mux rebuilds EncodedVideoChunks from packets.
 */
export function createSegmentRenderer({ encode = encodeSegment, createCanvas = defaultCreateCanvas } = {}) {
  return {
    async renderSegments(plan, { dims, images, segments: segmentList, cache, planKey, onProgress } = {}) {
      if (!Array.isArray(segmentList) || !segmentList.length) {
        throw codedError("bad_segment", "no segments to render");
      }
      const [w, h] = dims || [];
      if (!Number.isFinite(w) || !Number.isFinite(h)) {
        throw codedError("bad_dims", "renderer needs [w, h] dims");
      }
      const canvas = createCanvas(w, h);
      const stats = [];
      const packets = [];
      for (let done = 0; done < segmentList.length; done++) {
        const seg = segmentList[done];
        const key = segmentKey(planKey, seg.index, seg.startFrame, seg.frameCount);
        let record = cache ? await cache.get(key) : null;
        if (!record) {
          const encoded = await encode(plan, seg, canvas, images);
          const segPackets = (encoded.chunks || []).map((chunk) => ({
            data: chunk.data,
            type: chunk.type,
            timestamp: chunk.timestamp,
            duration: chunk.duration,
          }));
          const bytes = segPackets.reduce((sum, packet) => sum + (packet.data ? packet.data.byteLength : 0), 0);
          record = {
            stats: { index: seg.index, chunks: segPackets.length, keyframes: encoded.keyframes || 0, bytes },
            packets: segPackets,
          };
          if (cache) await cache.put(key, record, Math.max(bytes, 1));
        }
        stats.push(record.stats);
        for (const packet of record.packets || []) packets.push(packet);
        if (onProgress) onProgress(done + 1, segmentList.length);
      }
      return { segments: stats, packets, dims: [w, h] };
    },
  };
}

/** Encode an AudioBuffer to AAC packets via WebCodecs (browser-only). */
export async function encodeAudioPackets(audioBuffer) {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") {
    throw codedError("no_audio_encoder", "AudioEncoder unavailable in this browser");
  }
  const sampleRate = audioBuffer.sampleRate;
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const packets = [];
  const encoder = new AudioEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ data, type: chunk.type, timestamp: chunk.timestamp, duration: chunk.duration });
    },
    error: (error) => {
      throw error;
    },
  });
  encoder.configure({ codec: "mp4a.40.2", sampleRate, numberOfChannels: channels, bitrate: 128_000 });
  const FRAME_SAMPLES = 1024;
  const planes = [];
  for (let channel = 0; channel < channels; channel++) {
    planes.push(new Float32Array(audioBuffer.getChannelData(channel)));
  }
  const total = audioBuffer.length;
  for (let start = 0; start < total; start += FRAME_SAMPLES) {
    const count = Math.min(FRAME_SAMPLES, total - start);
    const interleaved = new Float32Array(count * channels);
    for (let channel = 0; channel < channels; channel++) {
      interleaved.set(planes[channel].subarray(start, start + count), channel * count);
    }
    const frame = new AudioData({
      format: "f32-planar",
      sampleRate,
      numberOfFrames: count,
      numberOfChannels: channels,
      timestamp: Math.round((start * 1e6) / sampleRate),
      data: interleaved,
    });
    encoder.encode(frame);
    frame.close();
  }
  await encoder.flush();
  encoder.close();
  return packets;
}

/**
 * MP4 mux over pre-encoded packets. Video packets come from the segment
 * renderer; audio is mixed from the plan schedule when the plan names
 * music/sfx. Resolves with the MP4 bytes (Uint8Array).
 */
export function createMuxer(
  { media = mediabunny, proxyBase, appToken, fetchImpl = fetch, encodeAudio = encodeAudioPackets } = {},
) {
  return {
    async mux({ plan, segmentStats }) {
      const videoPackets = (segmentStats && segmentStats.packets) || [];
      if (!videoPackets.length) throw codedError("empty_render", "no video packets to mux");
      const output = new media.Output({
        format: new media.Mp4OutputFormat({ fastStart: "in-memory" }),
        target: new media.BufferTarget(),
      });
      const videoSource = new media.EncodedVideoPacketSource("avc");
      output.addVideoTrack(videoSource, { frameRate: (plan && plan.fps) || 30 });
      const audioPackets = await collectAudioPackets(plan, { proxyBase, appToken, fetchImpl, encodeAudio });
      let audioSource = null;
      if (audioPackets.length) {
        audioSource = new media.EncodedAudioPacketSource("aac");
        output.addAudioTrack(audioSource);
      }
      await output.start();
      for (const packet of videoPackets) {
        const chunk = new EncodedVideoChunk({
          type: packet.type,
          timestamp: packet.timestamp,
          duration: packet.duration,
          data: packet.data,
        });
        await videoSource.add(media.EncodedPacket.fromEncodedChunk(chunk));
      }
      if (audioSource) {
        for (const packet of audioPackets) {
          const chunk = new EncodedAudioChunk({
            type: packet.type,
            timestamp: packet.timestamp,
            duration: packet.duration,
            data: packet.data,
          });
          await audioSource.add(media.EncodedPacket.fromEncodedChunk(chunk));
        }
      }
      await output.finalize();
      return new Uint8Array(output.target.buffer);
    },
  };
}

async function collectAudioPackets(plan, { proxyBase, appToken, fetchImpl, encodeAudio }) {
  const cues = (plan && plan.audio && (plan.audio.music_track_id || (plan.audio.sfx || []).length)) || null;
  if (!cues) return [];
  if (!proxyBase) throw codedError("proxy_not_configured", "audio fetch needs the proxy URL");
  const music = plan.audio.music_track_id
    ? await fetchTracks(proxyBase, appToken, (plan.style && plan.style.id) || "ambient", fetchImpl).then((tracks) =>
        tracks.find((track) => track.id === plan.audio.music_track_id),
      )
    : null;
  if (plan.audio.music_track_id && !music) {
    throw codedError("missing_track", `music track not found: ${plan.audio.music_track_id}`);
  }
  const library = { music: music ? [music] : [], sfx: [] };
  for (const cue of plan.audio.sfx || []) {
    const found = await fetchSfx(proxyBase, appToken, cue.id, fetchImpl).then((tracks) =>
      tracks.find((track) => track.id === cue.id),
    );
    if (!found) throw codedError("missing_track", `sfx not found: ${cue.id}`);
    library.sfx.push(found);
  }
  const total = (plan.scenes || []).reduce((sum, scene) => sum + (scene.duration_secs || 0), 0);
  const schedule = buildAudioTimeline(plan, library);
  const buffer = await renderAudioBuffer(schedule, total);
  return encodeAudio(buffer);
}

/**
 * Full browser adapter set for runMotionJob. proxyBase/appToken come from
 * build-time env (VITE_MOTION_PROXY / VITE_MOTION_APP_TOKEN); when absent
 * the AI adapter throws proxy_not_configured visibly instead of guessing.
 */
export function createBrowserAdapters(options = {}) {
  const { proxyBase, appToken, model, fetchImpl = fetch } = options;
  return {
    ai: new ProxyAiAdapter({ proxyBase, appToken, model, fetchImpl }),
    docs: new Map(),
    images: createImageLoader({ proxyBase, appToken, fetchImpl, loadElement: options.loadElement }),
    cache: options.cache || new MotionCache(new IndexedDBBackend()),
    renderer: createSegmentRenderer({ encode: options.encode, createCanvas: options.createCanvas }),
    mux: createMuxer({
      media: options.media || mediabunny,
      proxyBase,
      appToken,
      fetchImpl,
      encodeAudio: options.encodeAudio,
    }),
    validate: null,
  };
}
