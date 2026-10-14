// Voice-over: runs tools/tts.py (VieNeu-TTS for Vietnamese, Kokoro for English) in .venv-tts.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CACHE_DIR, ROOT, hash } from './store.mjs';

const PY = process.env.TTS_PYTHON || path.join(ROOT, '.venv-tts', 'bin', 'python');
const SCRIPT = path.join(ROOT, 'tools', 'tts.py');
const TTS_DIR = path.join(CACHE_DIR, 'tts');

export const ttsInstalled = () => fs.existsSync(PY);

function run(args, onLine) {
  return new Promise((resolve, reject) => {
    if (!ttsInstalled()) return reject(new Error('Chưa cài TTS: chạy scripts/install-tts.sh'));
    const p = spawn(PY, [SCRIPT, ...args], { env: { ...process.env, HF_HUB_DISABLE_PROGRESS_BARS: '1' } });
    let out = '', err = '';
    p.stdout.on('data', (d) => {
      out += d;
      for (const l of String(d).split('\n')) if (l.trim()) onLine?.(l.trim());
    });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `tts exit ${code}`))));
  });
}

let voicesCache = null;
export async function listVoices() {
  voicesCache ??= run(['--list']).then((s) => JSON.parse(s)).catch((e) => { voicesCache = null; throw e; });
  return voicesCache;
}

// One synthesis at a time: each run loads a ~1.3 GB model and the machine is short on RAM.
let queue = Promise.resolve();

/** Synthesize `text` → wav file (cached by text+voice+speed). */
export function synthesize({ text, voice = 'vi:Trúc Ly', speed = 1 }, { onStage } = {}) {
  text = String(text || '').trim();
  if (!text) return Promise.reject(new Error('Thiếu nội dung cần đọc'));
  const key = hash(JSON.stringify([text, voice, Number(speed)])).slice(0, 16);
  fs.mkdirSync(TTS_DIR, { recursive: true });
  const out = path.join(TTS_DIR, `${key}.wav`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  const job = queue.then(async () => {
    const txt = path.join(TTS_DIR, `${key}.txt`);
    fs.writeFileSync(txt, text);
    try {
      await run(['--voice', voice, '--speed', String(speed), '--text-file', txt, '--out', `${out}.part.wav`],
        (l) => l.startsWith('stage:') && onStage?.(l.slice(6)));
      fs.renameSync(`${out}.part.wav`, out);
    } finally {
      fs.rmSync(txt, { force: true });
      fs.rmSync(`${out}.part.wav`, { force: true });
    }
    return out;
  });
  queue = job.catch(() => {});
  return job;
}

/** Short readable file name for a voice-over asset. */
export function ttsFileName(text, voice) {
  const slug = text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32).toLowerCase() || 'voice';
  return `voice-${voice.split(':').pop().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '')}-${slug}.wav`;
}
