// Dubbing ("thuyết minh"): speech in a video → transcript → translation (Claude) → TTS voice-over
// → new MP4 (original audio ducked + voice-over + translated soft subtitles) and/or a timeline track.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { CACHE_DIR, EXPORT_DIR, ROOT, WORKSPACE, hash } from './store.mjs';

const exec = promisify(execFile);
const TTS_PY = process.env.TTS_PYTHON || path.join(ROOT, '.venv-tts', 'bin', 'python');
const WHISPER_PY = process.env.WHISPER_PYTHON || 'python3';
const YTDLP = process.env.YTDLP || (fs.existsSync(path.join(process.env.HOME || '', '.local/bin/yt-dlp')) ? path.join(process.env.HOME, '.local/bin/yt-dlp') : 'yt-dlp');

export const LANGS = { vi: 'Vietnamese', en: 'English', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', fr: 'French', de: 'German', es: 'Spanish', th: 'Thai' };
export const TTS_LANGS = ['vi', 'en'];

/* ---------- transcript ---------- */

function run(cmd, args, { onLine, env } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env } });
    let err = '';
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) if (l.trim()) onLine?.(l.trim());
    });
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} lỗi (${c}): ${err.trim().split('\n').slice(-3).join(' ')}`))));
  });
}

/** Whisper transcript, cached like `vedit transcribe` (.cache/transcripts/<assetId>.json). */
export async function transcribe(asset, { lang, model = process.env.WHISPER_MODEL || 'small' } = {}) {
  const out = path.join(CACHE_DIR, 'transcripts', `${asset.id}.json`);
  if (fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = [path.join(ROOT, 'tools', 'transcribe.py'), path.join(WORKSPACE, asset.path), out, '--model', model];
  if (lang) args.push('--lang', lang);
  await run(WHISPER_PY, args);
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

const vttTime = (t) => { const p = t.trim().split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };

/** Human-made YouTube subtitles in `lang` (not auto captions — those are messy). null when there are none. */
export async function youtubeSubtitles(url, lang) {
  const dir = path.join(CACHE_DIR, 'ytsubs', hash(url + lang).slice(0, 12));
  fs.mkdirSync(dir, { recursive: true });
  try {
    await exec(YTDLP, ['--js-runtimes', 'node', '--remote-components', 'ejs:github', '--skip-download', '--write-subs', '--no-write-auto-subs', '--sub-langs', `${lang}.*,${lang}`, '--sub-format', 'vtt', '-o', path.join(dir, 'sub.%(ext)s'), url], { timeout: 120_000 });
  } catch { return null; }
  const f = fs.readdirSync(dir).find((x) => x.endsWith('.vtt'));
  if (!f) return null;
  const segs = [];
  for (const block of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const text = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) segs.push({ start: vttTime(a), end: vttTime(b.trim().split(' ')[0]), text });
  }
  return segs.length ? { language: lang, segments: segs } : null;
}

/** Join Whisper fragments into sentence-sized lines that read naturally when dubbed. */
export function toSentences(segments, { maxDur = 12, maxGap = 0.8 } = {}) {
  const out = [];
  let cur = null;
  for (const s of segments) {
    const text = String(s.text || '').trim();
    if (!text) continue;
    if (cur && s.start - cur.end < maxGap && s.end - cur.start <= maxDur && !/[.!?…。！？]["')\]]?$/.test(cur.text)) {
      cur.text += ` ${text}`;
      cur.end = s.end;
    } else {
      if (cur) out.push(cur);
      cur = { start: s.start, end: s.end, text };
    }
  }
  if (cur) out.push(cur);
  return out.map((s, i) => ({ id: i + 1, start: +s.start.toFixed(3), end: +s.end.toFixed(3), text: s.text }));
}

/* ---------- translation (Claude Code, print mode, no tools) ---------- */

const SYSTEM = `You translate video subtitle lines for a voice-over (dubbing).
Rules: output ONLY a JSON array [{"id": number, "text": string}] with exactly the same ids, no commentary, no code fence.
Translate naturally for speech, keep each line about as long as the original so it fits the same time slot,
keep names/brands, write numbers the way a narrator would read them.`;

export async function translate(lines, { to, from, context = '', env = {}, onProgress } = {}) {
  const target = LANGS[to] || to;
  const out = new Map();
  const BATCH = 60;
  for (let i = 0; i < lines.length; i += BATCH) {
    const batch = lines.slice(i, i + BATCH).map(({ id, text }) => ({ id, text }));
    const prompt = `Translate these subtitle lines${from ? ` from ${LANGS[from] || from}` : ''} to ${target}.${context ? ` Video context: ${context}.` : ''}
Previous lines for context: ${JSON.stringify(lines.slice(Math.max(0, i - 3), i).map((l) => out.get(l.id) || l.text))}
Lines:
${JSON.stringify(batch)}`;
    let parsed = null, lastErr = '';
    for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
      try {
        const { stdout } = await exec('claude', ['-p', '--no-session-persistence', '--tools', '', '--output-format', 'json', '--system-prompt', SYSTEM, prompt],
          { cwd: CACHE_DIR, env: { ...process.env, ...env }, timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
        const r = JSON.parse(stdout);
        if (r.is_error) throw new Error(r.result || 'Claude lỗi');
        const m = String(r.result).match(/\[[\s\S]*\]/);
        const arr = JSON.parse(m ? m[0] : r.result);
        if (!Array.isArray(arr)) throw new Error('kết quả không phải mảng');
        parsed = arr;
      } catch (e) { lastErr = e.message; }
    }
    if (!parsed) throw new Error(`Dịch thất bại: ${lastErr.slice(0, 300)} (Claude Code đã đăng nhập chưa?)`);
    for (const x of parsed) if (x && x.id != null && typeof x.text === 'string') out.set(Number(x.id), x.text.trim());
    onProgress?.(Math.min(lines.length, i + BATCH) / lines.length);
  }
  return lines.map((l) => ({ ...l, original: l.text, text: out.get(l.id) ?? l.text }));
}

/* ---------- output helpers ---------- */

const srtTime = (t) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
export const toSrt = (cues) => cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');

/**
 * Full pipeline for one video/audio asset.
 * opts: { to, from, voice, speed, originalVolume (0..1), source ('auto'|'whisper'|'youtube'), context, exportVideo, env }
 * update(patch): job progress. Returns { dubWav, srt, video?, lines, placed, sourceLang }.
 */
export async function dubAsset(asset, opts, update = () => {}) {
  const { to = 'vi', voice = 'vi:Trúc Ly', speed = 1, originalVolume = 0.15, exportVideo = true, env = {} } = opts;
  if (!TTS_LANGS.includes(voice.split(':')[0])) throw new Error('Giọng đọc không hợp lệ');
  const file = path.join(WORKSPACE, asset.path);
  const key = hash(JSON.stringify([asset.id, to, voice, speed])).slice(0, 10);
  const work = path.join(CACHE_DIR, 'dub', `${asset.id}-${key}`);
  fs.mkdirSync(work, { recursive: true });

  // 1. transcript
  let tr = null;
  if (asset.source && opts.source !== 'whisper' && /youtube\.com|youtu\.be/.test(asset.source) && opts.from) {
    update({ stage: 'lấy phụ đề YouTube', progress: 0.02 });
    tr = await youtubeSubtitles(asset.source, opts.from);
  }
  if (!tr) {
    update({ stage: 'nhận dạng giọng nói (Whisper)', progress: 0.05 });
    tr = await transcribe(asset, { lang: opts.from || undefined });
  }
  const lines = toSentences(tr.segments || []);
  if (!lines.length) throw new Error('Không nghe thấy lời thoại nào trong clip');
  const sourceLang = tr.language || opts.from || '?';

  // 2. translation (skip when the speech is already in the target language)
  let translated;
  if (sourceLang === to) translated = lines.map((l) => ({ ...l, original: l.text }));
  else {
    update({ stage: `dịch ${lines.length} câu (${sourceLang} → ${to})`, progress: 0.2 });
    translated = await translate(lines, { to, from: sourceLang, context: opts.context || asset.name, env, onProgress: (p) => update({ progress: 0.2 + p * 0.15 }) });
  }
  fs.writeFileSync(path.join(work, 'lines.json'), JSON.stringify(translated, null, 1));

  // 3. voice-over
  update({ stage: 'nạp giọng đọc', progress: 0.36 });
  const dubWav = path.join(work, 'dub.wav');
  const report = path.join(work, 'placed.json');
  fs.writeFileSync(path.join(work, 'job.json'), JSON.stringify({
    segments: translated.map(({ id, start, end, text }) => ({ id, start, end, text })),
    voice, speed, duration: asset.duration || translated.at(-1).end + 2, out: dubWav, report, work: path.join(work, 'tmp'), maxTempo: 1.5,
  }));
  await run(TTS_PY, [path.join(ROOT, 'tools', 'dub.py'), path.join(work, 'job.json')], {
    env: { HF_HUB_DISABLE_PROGRESS_BARS: '1' },
    onLine: (l) => {
      const m = l.match(/^progress (\d+) (\d+)/);
      if (m) update({ stage: `đọc ${m[1]}/${m[2]} câu`, progress: 0.38 + (m[1] / m[2]) * 0.47 });
      else if (l === 'stage mix') update({ stage: 'ghép giọng đọc', progress: 0.86 });
    },
  });
  const placed = JSON.parse(fs.readFileSync(report, 'utf8'));
  const cues = placed.map((p) => ({ start: p.start, end: Math.max(p.end, p.start + 0.8), text: p.text }));
  const srtPath = path.join(work, `${to}.srt`);
  fs.writeFileSync(srtPath, toSrt(cues));

  // 4. new video file: original picture, original audio ducked under the voice-over, soft subtitles
  let video = null;
  if (exportVideo && asset.type === 'video') {
    update({ stage: 'xuất video thuyết minh', progress: 0.9 });
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const base = path.basename(asset.path, path.extname(asset.path));
    video = path.join(EXPORT_DIR, `${base}-thuyet-minh-${to}.mp4`);
    const vol = Math.max(0, Math.min(1, Number(originalVolume)));
    const audio = asset.hasAudio && vol > 0
      ? ['-filter_complex', `[0:a]volume=${vol}[bg];[bg][1:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`, '-map', '0:v:0', '-map', '[a]']
      : ['-map', '0:v:0', '-map', '1:a:0', '-shortest'];
    const lang3 = { vi: 'vie', en: 'eng' }[to] || to;
    await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-i', dubWav, '-i', srtPath, ...audio, '-map', '2:s:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-c:s', 'mov_text', `-metadata:s:s:0`, `language=${lang3}`, `-metadata:s:a:0`, `language=${lang3}`,
      '-movflags', '+faststart', video]);
    fs.copyFileSync(srtPath, video.replace(/\.mp4$/, '.srt'));
  }
  return { dubWav, srt: srtPath, video, lines: translated, placed, sourceLang, cues };
}
