#!/usr/bin/env python3
"""Transcribe a media file with faster-whisper (word timestamps). Usage:
   transcribe.py <input> <output.json> [--model small] [--lang vi]"""
import argparse, json, sys

ap = argparse.ArgumentParser()
ap.add_argument("input")
ap.add_argument("output")
ap.add_argument("--model", default="small")
ap.add_argument("--lang", default=None)
a = ap.parse_args()

from faster_whisper import WhisperModel

model = WhisperModel(a.model, device="cpu", compute_type="int8")
segments, info = model.transcribe(a.input, language=a.lang, word_timestamps=True, vad_filter=True, beam_size=5)
out = {"language": info.language, "duration": info.duration, "segments": []}
for s in segments:
    out["segments"].append({
        "start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip(),
        "words": [{"start": round(w.start, 3), "end": round(w.end, 3), "word": w.word} for w in (s.words or [])],
    })
    print(f"[{s.start:7.2f} -> {s.end:7.2f}] {s.text.strip()}", file=sys.stderr, flush=True)
with open(a.output, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
