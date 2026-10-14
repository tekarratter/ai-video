#!/usr/bin/env python3
"""Text-to-speech for the AI video editor. Runs inside .venv-tts.

  tts.py --list                                   JSON list of voices of all engines
  tts.py --voice "vi:Trúc Ly" --out a.wav --text "…"   (or --text-file f.txt)

Voice ids are "<engine>:<name>":
  vi:<name>  VieNeu-TTS v3 Turbo (Vietnamese, also reads mixed English), 48 kHz
  en:<name>  Kokoro-82M (native English, American a*/British b*), 24 kHz
Speed is applied afterwards with ffmpeg atempo (keeps pitch).
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KOKORO_DIR = Path(os.environ.get('KOKORO_DIR') or ROOT / 'models' / 'kokoro')

# Kokoro voice names → friendly labels (prefix: a=American, b=British; f/m = female/male)
KOKORO_LABEL = {'a': 'Mỹ', 'b': 'Anh'}


def vieneu_voices():
    import vieneu
    data = json.loads((Path(vieneu.__file__).parent / 'assets' / 'voices_v3_turbo.json').read_text())
    out = []
    for name, v in sorted(data['presets'].items(), key=lambda kv: (kv[1].get('featured') is None, kv[1].get('featured') or 0)):
        out.append({'id': f'vi:{name}', 'engine': 'vieneu', 'lang': 'vi', 'name': name,
                    'gender': v.get('gender'), 'description': v.get('description', ''), 'featured': v.get('featured') is not None})
    return out


def kokoro_voices():
    if not (KOKORO_DIR / 'voices-v1.0.bin').exists():
        return []
    import numpy as np
    names = sorted(np.load(KOKORO_DIR / 'voices-v1.0.bin').keys())
    out = []
    for n in names:
        if n[0] not in KOKORO_LABEL:
            continue  # other languages: keep the list focused on English
        gender = 'female' if n[1] == 'f' else 'male'
        pretty = n.split('_', 1)[1].capitalize()
        out.append({'id': f'en:{n}', 'engine': 'kokoro', 'lang': 'en', 'name': pretty, 'gender': gender,
                    'description': f"{'Nữ' if gender == 'female' else 'Nam'} · English {KOKORO_LABEL[n[0]]}",
                    'featured': n in ('af_heart', 'af_bella', 'am_michael', 'am_fenrir', 'bf_emma', 'bm_george')})
    out.sort(key=lambda v: not v['featured'])
    return out


def synth_vieneu(text, name):
    from vieneu import Vieneu
    tts = Vieneu()
    return tts.infer(text, voice=name), tts.sample_rate


def synth_kokoro(text, name):
    from kokoro_onnx import Kokoro
    model = next((KOKORO_DIR / f for f in ('kokoro-v1.0.int8.onnx', 'kokoro-v1.0.onnx') if (KOKORO_DIR / f).exists()), None)
    if not model:
        raise SystemExit('Kokoro model missing in models/kokoro')
    k = Kokoro(str(model), str(KOKORO_DIR / 'voices-v1.0.bin'))
    return k.create(text, voice=name, speed=1.0, lang='en-gb' if name.startswith('b') else 'en-us')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--voice', default='vi:Trúc Ly')
    ap.add_argument('--text')
    ap.add_argument('--text-file')
    ap.add_argument('--out')
    ap.add_argument('--speed', type=float, default=1.0)
    a = ap.parse_args()

    if a.list:
        voices = []
        for fn in (vieneu_voices, kokoro_voices):
            try:
                voices += fn()
            except Exception as e:  # engine not installed
                print(f'{fn.__name__}: {e}', file=sys.stderr)
        print(json.dumps(voices, ensure_ascii=False))
        return

    text = Path(a.text_file).read_text() if a.text_file else a.text
    if not text or not text.strip() or not a.out:
        raise SystemExit('need --text/--text-file and --out')
    engine, _, name = a.voice.partition(':')
    if not name:
        engine, name = 'vi', engine
    print('stage:load', flush=True)
    import soundfile as sf
    synth = synth_kokoro if engine == 'en' else synth_vieneu
    print('stage:synth', flush=True)
    wav, sr = synth(text.strip(), name)

    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        sf.write(tmp.name, wav, sr)
    try:
        filters = ['silenceremove=start_periods=1:start_threshold=-50dB']  # trim leading silence
        speed = max(0.5, min(2.0, a.speed))
        if abs(speed - 1) > 0.01:
            filters.append(f'atempo={speed}')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp.name, '-af', ','.join(filters), '-ar', '48000', a.out], check=True)
    finally:
        os.unlink(tmp.name)
    print('stage:done', flush=True)


if __name__ == '__main__':
    main()
