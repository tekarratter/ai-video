#!/usr/bin/env python3
"""Voice-over track for dubbing: read every translated segment with one TTS model load, fit each line
into its time slot (speed up a little when needed, push later lines when they would overlap), mix
everything into one mono 48 kHz WAV.

  dub.py job.json
job.json: {"segments": [{"id", "start", "end", "text"}], "voice": "vi:Trúc Ly", "speed": 1.0,
           "duration": 123.4, "out": "dub.wav", "report": "report.json", "work": "/tmp/dir", "maxTempo": 1.5}
Progress lines on stdout: "progress <done> <total>".
report.json: [{"id", "start", "end", "tempo", "text"}] — where each line actually landed (for subtitles).
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tts  # noqa: E402  (KOKORO_DIR, voice handling)

SR = 48000


def make_engine(voice):
    engine, _, name = voice.partition(':')
    if not name:
        engine, name = 'vi', engine
    if engine == 'en':
        from kokoro_onnx import Kokoro
        model = next((tts.KOKORO_DIR / f for f in ('kokoro-v1.0.int8.onnx', 'kokoro-v1.0.onnx') if (tts.KOKORO_DIR / f).exists()), None)
        k = Kokoro(str(model), str(tts.KOKORO_DIR / 'voices-v1.0.bin'))
        lang = 'en-gb' if name.startswith('b') else 'en-us'
        return lambda text: k.create(text, voice=name, speed=1.0, lang=lang)
    from vieneu import Vieneu
    v = Vieneu()
    return lambda text: (v.infer(text, voice=name), v.sample_rate)


def ffmpeg(args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True)


def main():
    job = json.loads(Path(sys.argv[1]).read_text())
    work = Path(job['work'])
    work.mkdir(parents=True, exist_ok=True)
    segs = [s for s in job['segments'] if s['text'].strip()]
    base_speed = float(job.get('speed') or 1.0)
    max_tempo = float(job.get('maxTempo') or 1.5)
    duration = float(job['duration'])

    print('stage load', flush=True)
    synth = make_engine(job['voice'])

    # 1) synthesize + trim silence + resample, measure each line
    clips = []
    for i, s in enumerate(segs):
        wav, sr = synth(s['text'].strip())
        raw = work / f"{i:05d}_raw.wav"
        sf.write(raw, wav, sr)
        trimmed = work / f"{i:05d}.wav"
        trim = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse'
        ffmpeg(['-i', str(raw), '-af', trim, '-ar', str(SR), '-ac', '1', str(trimmed)])
        raw.unlink()
        clips.append(trimmed)
        print(f'progress {i + 1} {len(segs)}', flush=True)

    # 2) place lines: start at the original time, never overlap the previous line, speed up to fit the slot
    print('stage mix', flush=True)
    placed, cursor_end = [], 0.0
    for i, (s, f) in enumerate(zip(segs, clips)):
        data, _ = sf.read(f, dtype='float32')
        d1 = len(data) / SR  # length at normal speed
        start = max(float(s['start']), cursor_end + 0.08)
        nxt = float(segs[i + 1]['start']) if i + 1 < len(segs) else min(duration, float(s['end']) + 2.0)
        window = max(0.4, max(nxt, float(s['end'])) - start - 0.05)
        # base speed, faster only as much as needed to fit, never above max_tempo (unless the base speed already is)
        tempo = min(max(base_speed, d1 / window), max(max_tempo, base_speed))
        if abs(tempo - 1.0) > 0.01:
            fitted = work / f"{i:05d}_fit.wav"
            # atempo accepts 0.5..2.0 per filter
            ffmpeg(['-i', str(f), '-af', f'atempo={tempo:.4f}', '-ar', str(SR), '-ac', '1', str(fitted)])
            data, _ = sf.read(fitted, dtype='float32')
            fitted.unlink()
        end = start + len(data) / SR
        placed.append({'id': s['id'], 'start': round(start, 3), 'end': round(end, 3), 'tempo': round(tempo, 3), 'text': s['text'], 'data': data})
        cursor_end = end

    total = max(duration, placed[-1]['end'] if placed else 0) + 0.2
    mix = np.zeros(int(total * SR) + 1, dtype=np.float32)
    for p in placed:
        a = int(p['start'] * SR)
        mix[a:a + len(p['data'])] += p.pop('data')
    peak = float(np.max(np.abs(mix))) if len(mix) else 0
    if peak > 0:
        mix *= 0.89 / peak  # about -1 dBFS
    sf.write(job['out'], mix, SR)
    Path(job['report']).write_text(json.dumps(placed, ensure_ascii=False))
    for f in clips:
        f.unlink(missing_ok=True)
    print('stage done', flush=True)


if __name__ == '__main__':
    main()
