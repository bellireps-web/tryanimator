#!/usr/bin/env python3
"""Transcripción local para el modo Editor (whisper-x / faster-whisper).

No descarga nada solo. Uso:

  pip install faster-whisper
  python3 editor/transcribe_local.py --audio media/voiceover.wav --out transcript.json
  python3 editor/generate.py  # ya lee transcript.json

- Modelo por defecto: large-v3, int8 (rápido en CPU).
- Salida: [{text, start, end}] por palabra, mismo contrato que transcript.json.
- Silencios/captions se derivan en generate.py (SILENCE_MIN=0.30s).
- Si no hay GPU, usa --model medium --device cpu.
"""
import argparse
import json


def main():
    ap = argparse.ArgumentParser(description="Transcribe local a transcript.json")
    ap.add_argument("--audio", required=True, help="wav/mp3/mp4 fuente")
    ap.add_argument("--out", default="transcript.json")
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    ap.add_argument("--language", default="auto", help="es, en o auto")
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise SystemExit("falta faster-whisper: pip install faster-whisper")

    device = "cuda" if args.device == "auto" else args.device
    try:
        model = WhisperModel(args.model, device=device, compute_type="int8_float16" if device == "cuda" else "int8")
    except Exception:
        # CPU sin CUDA: reintento CPU puro
        model = WhisperModel(args.model, device="cpu", compute_type="int8")

    kwargs = {"beam_size": 5, "word_timestamps": True}
    if args.language != "auto":
        kwargs["language"] = args.language
    segments, _ = model.transcribe(args.audio, **kwargs)

    words = []
    for seg in segments:
        for w in (seg.words or []):
            words.append({"text": w.word.strip(), "start": round(float(w.start), 3), "end": round(float(w.end), 3)})
    words = [w for w in words if w["text"]]
    if not words:
        raise SystemExit("transcripción vacía: revisa el audio")

    json.dump(words, open(args.out, "w"), indent=2, ensure_ascii=False)
    print(f"palabras: {len(words)} -> {args.out} ({words[0]['start']}s..{words[-1]['end']}s)")


if __name__ == "__main__":
    main()
