#!/usr/bin/env bash
# Cài giọng đọc AI: VieNeu-TTS (tiếng Việt) + Kokoro (tiếng Anh) vào .venv-tts, model Kokoro vào models/kokoro.
set -e
cd "$(dirname "$0")/.."
python3 -m venv .venv-tts
.venv-tts/bin/pip install -q --upgrade pip
.venv-tts/bin/pip install -q vieneu kokoro-onnx soundfile
mkdir -p models/kokoro
base=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
[ -f models/kokoro/kokoro-v1.0.int8.onnx ] || curl -fSL -o models/kokoro/kokoro-v1.0.int8.onnx $base/kokoro-v1.0.int8.onnx
[ -f models/kokoro/voices-v1.0.bin ] || curl -fSL -o models/kokoro/voices-v1.0.bin $base/voices-v1.0.bin
.venv-tts/bin/python tools/tts.py --list | head -c 200; echo
echo "TTS OK"
