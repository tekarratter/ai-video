// Reference-video analysis for "Clone video → template" (the method follows hypit's reference reading:
// watch the whole piece, read the speech in time, find the cuts and the beat, then look closely at the frames).
// Produces machine-readable evidence (analysis.json) plus images Claude Reads (shot sheets, word-labelled
// timeline pages). Claude turns that evidence into ANALYSIS.md / TIMELINE.md / RECIPE.md and a template.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, probe } from './store.mjs';

const exec = promisify(execFile);
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf']
  .find((f) => fs.existsSync(f));
const fontArg = FONT ? `fontfile=${FONT}` : 'font=Sans';

async function ffmpeg(args) {
  const { stderr } = await exec('ffmpeg', ['-hide_banner', '-nostats', ...args], { maxBuffer: 256 * 1024 * 1024 });
  return stderr;
}

/** Run async jobs with a small concurrency limit. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/* ---------------- cuts ---------------- */
export async function detectCuts(file, threshold = 0.3) {
  const err = await ffmpeg(['-i', file, '-an', '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-']);
  const times = [...err.matchAll(/pts_time:([\d.]+)/g)].map((m) => parseFloat(m[1]));
  // a flash or a fast whip can trigger several detections in a row: keep the first of a 0.2 s cluster
  return times.filter((t, i) => i === 0 || t - times[i - 1] > 0.2).map(r3);
}

/* ---------------- audio: loudness, silences, tempo ---------------- */
export async function detectSilences(file, noise = -35, min = 0.4) {
  const err = await ffmpeg(['-i', file, '-vn', '-af', `silencedetect=noise=${noise}dB:d=${min}`, '-f', 'null', '-']);
  const out = [];
  let s = null;
  for (const line of err.split('\n')) {
    let m = line.match(/silence_start: (-?[\d.]+)/);
    if (m) s = Math.max(0, parseFloat(m[1]));
    m = line.match(/silence_end: ([\d.]+)/);
    if (m && s !== null) { out.push({ start: r3(s), end: r3(parseFloat(m[1])) }); s = null; }
  }
  if (s !== null) out.push({ start: r3(s), end: null });
  return out;
}

/** Mono 8 kHz PCM → loudness per second, onset envelope, tempo (autocorrelation) and a beat grid. */
export async function audioProfile(file, duration) {
  const SR = 8000, HOP = 400; // 50 ms frames
  const pcm = await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 's16le', '-']);
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg pcm exit ${code}`))));
  });
  const n = Math.floor(pcm.length / 2);
  if (n < SR) return null;
  const frames = Math.floor(n / HOP);
  const energy = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * HOP, e = i + HOP; i < e; i++) { const v = pcm.readInt16LE(i * 2) / 32768; s += v * v; }
    energy[f] = Math.sqrt(s / HOP);
  }
  // loudness per second (dBFS) — shows drops, builds and quiet passages
  const perSec = [];
  for (let s = 0; s * 20 < frames; s++) {
    const seg = energy.slice(s * 20, s * 20 + 20);
    const rms = Math.sqrt(seg.reduce((a, v) => a + v * v, 0) / seg.length);
    perSec.push(Math.round(20 * Math.log10(rms + 1e-6)));
  }
  // onset strength: positive change of log energy, minus a local mean
  const logE = Array.from(energy, (v) => Math.log(1e-4 + v));
  const onset = new Float64Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, logE[f] - logE[f - 1]);
  const W = 20;
  const flux = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let m = 0, c = 0;
    for (let k = Math.max(0, f - W); k < Math.min(frames, f + W); k++) { m += onset[k]; c++; }
    flux[f] = Math.max(0, onset[f] - m / c);
  }
  // autocorrelation over 60–180 BPM (lag 6.7–20 frames at 20 frames/s); 0.5 frame resolution through interpolation
  const fps = SR / HOP;
  let best = null;
  const ac = (lag) => {
    const l0 = Math.floor(lag), fr = lag - l0;
    let s = 0;
    for (let f = 0; f + l0 + 1 < frames; f++) s += flux[f] * (flux[f + l0] * (1 - fr) + flux[f + l0 + 1] * fr);
    return s;
  };
  const zero = ac(0) || 1;
  const scores = [];
  for (let bpm = 60; bpm <= 180; bpm += 1) {
    const lag = (60 / bpm) * fps;
    // the period itself plus its double (bar-level support), weighted by a prior around 120 BPM so that
    // a steady pulse is read at its natural tempo instead of half or double time
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.7) ** 2);
    const s = (ac(lag) + 0.5 * ac(lag * 2)) * prior;
    scores.push(s);
    if (!best || s > best.s) best = { bpm, s, lag };
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const confidence = best ? Math.min(1, Math.max(0, (best.s - mean) / (zero * 0.6))) : 0;
  let beats = [];
  if (best) {
    // phase: offset with the most onset energy on the grid
    let phase = 0, ps = -1;
    for (let o = 0; o < best.lag; o += 0.5) {
      let s = 0;
      for (let t = o; t < frames; t += best.lag) s += flux[Math.round(t)] || 0;
      if (s > ps) { ps = s; phase = o; }
    }
    for (let t = phase; t < frames; t += best.lag) beats.push(r3(t / fps));
    beats = beats.filter((b) => b <= (duration || Infinity));
  }
  // strongest onsets (hits, drops, sound effects) — top peaks at least 0.25 s apart
  const peaks = [];
  for (let f = 1; f < frames - 1; f++) if (flux[f] > flux[f - 1] && flux[f] >= flux[f + 1] && flux[f] > 0) peaks.push([f, flux[f]]);
  peaks.sort((a, b) => b[1] - a[1]);
  const hits = [];
  for (const [f] of peaks) {
    const t = f / fps;
    if (hits.every((h) => Math.abs(h - t) > 0.25)) hits.push(t);
    if (hits.length >= Math.max(8, Math.round((duration || 30) / 2))) break;
  }
  return { loudnessPerSecond: perSec, tempo: best ? { bpm: best.bpm, confidence: r2(confidence) } : null, beats, hits: hits.sort((a, b) => a - b).map(r3) };
}

/* ---------------- speech ---------------- */
export async function transcribeFile(file, out, { lang, model = process.env.WHISPER_MODEL || 'small', onLine } = {}) {
  if (fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = [path.join(ROOT, 'tools', 'transcribe.py'), file, out, '--model', model];
  if (lang && lang !== 'auto') args.push('--lang', lang);
  await new Promise((resolve, reject) => {
    const p = spawn('python3', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; for (const l of String(d).split('\n')) if (l.trim()) onLine?.(l.trim()); });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(/No module named 'faster_whisper'/.test(err) ? 'chưa cài faster-whisper (pip install --user faster-whisper)' : `transcribe lỗi (${c}): ${err.trim().split('\n').pop() || ''}`))));
  });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

export const wordsOf = (tr) => (tr?.segments || []).flatMap((s) => (s.words || []).map((w) => ({ start: w.start, end: w.end, word: String(w.word).trim() }))).filter((w) => w.word);
const wordsIn = (words, a, b) => words.filter((w) => w.end > a && w.start < b).map((w) => w.word).join(' ');

/* ---------------- frames & tiles ---------------- */
function wrap(text, width, maxLines) {
  const lines = [];
  let cur = '';
  for (const w of String(text || '').split(/\s+/).filter(Boolean)) {
    if ((cur + ' ' + w).trim().length > width) { if (cur) lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.join('\n');
}
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

/** One labelled frame: time on top, the words spoken around it in a band below (the picture itself stays clean). */
async function labelledFrame(file, t, out, { cell, label, words, band }) {
  const tmp = `${out}.txt`;
  const vf = [`scale=${cell}:-2`];
  if (band) {
    fs.writeFileSync(tmp, wrap(words || '—', Math.floor(cell / 11), 3));
    vf.push(`pad=iw:ih+${band}:0:0:0x111111`, `drawtext=${fontArg}:textfile='${tmp}':expansion=none:x=8:y=h-${band - 6}:fontsize=17:fontcolor=0xf5f5f5:line_spacing=3`);
  }
  vf.push(`drawtext=${fontArg}:text='${label.replace(/[:'\\%]/g, (c) => `\\${c}`)}':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4`);
  await ffmpeg(['-y', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', vf.join(','), '-q:v', '3', out]);
  fs.rmSync(tmp, { force: true });
  return out;
}

/** Arrange already-extracted same-size frames into pages of columns × rows. */
async function tilePages(frames, outDir, prefix, { columns, rows }) {
  const per = columns * rows, pages = [];
  for (let p = 0; p * per < frames.length; p++) {
    const list = frames.slice(p * per, p * per + per);
    const out = path.join(outDir, `${prefix}-${String(p + 1).padStart(2, '0')}.jpg`);
    const inputs = list.flatMap((f) => ['-i', f]);
    const cols = Math.min(columns, list.length), rws = Math.ceil(list.length / cols);
    // xstack layout: cell i at (col × w0, row × h0)
    const layout = list.map((_, i) => `${i % cols === 0 ? '0' : Array.from({ length: i % cols }, () => 'w0').join('+')}_${Math.floor(i / cols) === 0 ? '0' : Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+')}`).join('|');
    const filter = list.length === 1 ? 'null' : `xstack=inputs=${list.length}:layout=${layout}:fill=0x111111`;
    await ffmpeg(['-y', ...inputs, '-filter_complex', filter, '-frames:v', '1', '-q:v', '3', out]);
    pages.push({ file: out, from: p * per, count: list.length, grid: `${cols}x${rws}` });
  }
  return pages;
}

/**
 * Time-labelled frame grids of a passage, optionally with the words spoken at each frame (hypit `media tiles`).
 * every: seconds between samples, or 'frame' for every original frame.
 */
export async function tiles(file, { start = 0, end, every = 1, fps, columns = 4, rows = 3, cell = 480, words = [], outDir, prefix = 'tiles' } = {}) {
  if (!end) end = (await probe(file)).duration;
  const step = every === 'frame' ? 1 / (fps || (await probe(file)).fps || 30) : Math.max(0.02, Number(every) || 1);
  const times = [];
  for (let k = 0, t = start; t < end - Math.min(0.05, step / 2) && times.length < 240; t = start + ++k * step) times.push(r3(t));
  fs.mkdirSync(outDir, { recursive: true });
  const fdir = path.join(outDir, `.${prefix}-frames`);
  fs.mkdirSync(fdir, { recursive: true });
  const band = words.length ? 64 : 0;
  const frames = await pool(times, 4, (t, i) => labelledFrame(file, t, path.join(fdir, `${String(i).padStart(4, '0')}.jpg`), {
    cell, band, label: fmt(t), words: wordsIn(words, t - Math.max(step / 2, 0.35), t + Math.max(step / 2, 0.35)),
  }));
  const pages = await tilePages(frames, outDir, prefix, { columns, rows });
  fs.rmSync(fdir, { recursive: true, force: true });
  return { times, step, pages: pages.map((p) => ({ ...p, start: times[p.from], end: times[p.from + p.count - 1] })) };
}

/** Find a spoken phrase in word timings: [start, end] of its n-th occurrence. */
export function findPhrase(words, phrase, occurrence = 1) {
  const norm = (s) => String(s).toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '');
  const target = norm(phrase);
  if (!target) return null;
  let seen = 0;
  for (let i = 0; i < words.length; i++) {
    let acc = '';
    for (let j = i; j < words.length && acc.length < target.length; j++) {
      acc += norm(words[j].word);
      if (acc.startsWith(target)) { if (++seen === occurrence) return [words[i].start, words[j].end]; break; }
      if (!target.startsWith(acc)) break;
    }
  }
  return null;
}

/* ---------------- the whole analysis ---------------- */
/**
 * analyzeVideo(file, outDir) → analysis.json, overview.md, poster.jpg, shots/sheet-NN.jpg, timeline/page-NN.jpg
 * Never throws for a missing optional part (no audio, no faster-whisper): the gap is recorded in `warnings`.
 */
export async function analyzeVideo(file, outDir, { lang, transcriptFile, threshold = 0.3, onProgress = () => {} } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const warnings = [];
  const step = (stage, progress) => onProgress({ stage, progress });

  step('đọc thông tin video', 0.01);
  const info = await probe(file);
  if (info.type !== 'video') throw new Error('File không phải video');
  const duration = info.duration || 0;
  const portrait = (info.height || 0) > (info.width || 0);
  const cell = portrait ? 300 : 480;

  step('tìm điểm cắt cảnh', 0.05);
  const cuts = await detectCuts(file, threshold).catch((e) => { warnings.push(`cắt cảnh: ${e.message}`); return []; });

  let audio = null, silences = [], transcript = null;
  if (info.hasAudio) {
    step('phân tích âm thanh, nhịp nhạc', 0.15);
    audio = await audioProfile(file, duration).catch((e) => { warnings.push(`âm thanh: ${e.message}`); return null; });
    silences = await detectSilences(file).catch(() => []);
    step('nghe lời thoại (Whisper)', 0.25);
    try {
      transcript = await transcribeFile(file, transcriptFile || path.join(outDir, 'transcript.json'), {
        lang, onLine: (l) => { const m = l.match(/->\s*([\d.]+)\]/); if (m && duration) step('nghe lời thoại (Whisper)', 0.25 + 0.4 * Math.min(1, parseFloat(m[1]) / duration)); },
      });
      if (transcriptFile && transcriptFile !== path.join(outDir, 'transcript.json')) fs.copyFileSync(transcriptFile, path.join(outDir, 'transcript.json'));
    } catch (e) { warnings.push(`lời thoại: ${e.message}`); }
  } else warnings.push('video không có tiếng');
  const words = wordsOf(transcript);

  // shots from the cuts
  const bounds = [0, ...cuts.filter((t) => t > 0.05 && t < duration - 0.05), duration];
  const shots = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i], b = bounds[i + 1];
    shots.push({ i: i + 1, start: r3(a), end: r3(b), duration: r3(b - a), words: wordsIn(words, a, b) });
  }

  step('khung hình đại diện từng cảnh', 0.68);
  const shotDir = path.join(outDir, 'shots');
  fs.rmSync(shotDir, { recursive: true, force: true });
  fs.mkdirSync(shotDir, { recursive: true });
  const shotFrames = await pool(shots, 4, (s) => labelledFrame(file, s.start + Math.min(s.duration / 2, Math.max(0.15, s.duration * 0.4)),
    path.join(shotDir, `.shot-${String(s.i).padStart(3, '0')}.jpg`), { cell, band: words.length ? 64 : 0, label: `#${s.i} ${fmt(s.start)}–${fmt(s.end)}`, words: s.words }));
  const shotPages = await tilePages(shotFrames, shotDir, 'sheet', { columns: portrait ? 6 : 4, rows: portrait ? 2 : 3 });
  for (const f of shotFrames) fs.rmSync(f, { force: true });

  step('lưới khung hình theo thời gian', 0.8);
  const every = duration <= 20 ? 0.5 : duration <= 60 ? 1 : duration <= 180 ? 2 : Math.ceil(duration / 90);
  const tl = await tiles(file, { start: 0, end: duration, every, columns: portrait ? 6 : 4, rows: portrait ? 2 : 3, cell, words, outDir: path.join(outDir, 'timeline'), prefix: 'page' });

  step('ảnh bìa', 0.95);
  const poster = path.join(outDir, 'poster.jpg');
  const posterAt = shots.length > 1 ? Math.min(duration * 0.3, shots[Math.min(1, shots.length - 1)].start + 0.3) : duration * 0.3;
  await ffmpeg(['-y', '-ss', String(posterAt), '-i', file, '-frames:v', '1', '-vf', `scale=${portrait ? 540 : 960}:-2`, '-q:v', '3', poster]).catch(() => {});

  // pacing facts
  const shotLens = shots.map((s) => s.duration).sort((a, b) => a - b);
  const median = shotLens.length ? shotLens[Math.floor(shotLens.length / 2)] : 0;
  const speechTime = words.reduce((a, w) => a + Math.max(0, w.end - w.start), 0);
  const onBeat = audio?.beats?.length && cuts.length
    ? cuts.filter((c) => audio.beats.some((b) => Math.abs(b - c) < 0.09)).length / cuts.length : null;
  const firstWord = words[0]?.start ?? null;
  const pacing = {
    shots: shots.length,
    medianShot: r2(median),
    cutsPerMinute: duration ? r2((cuts.length / duration) * 60) : 0,
    firstCut: cuts[0] ?? null,
    firstWord,
    wordsPerSecond: speechTime ? r2(words.length / Math.max(1, (words.at(-1).end - words[0].start))) : 0,
    speechCoverage: duration ? r2(speechTime / duration) : 0,
    cutsOnBeat: onBeat == null ? null : r2(onBeat),
  };

  const rel = (f) => path.relative(outDir, f).split(path.sep).join('/');
  const analysis = {
    version: 1,
    createdAt: Date.now(),
    source: { file: path.basename(file), duration, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio, orientation: portrait ? 'portrait' : info.width === info.height ? 'square' : 'landscape' },
    pacing,
    cuts,
    shots,
    speech: transcript ? { language: transcript.language, segments: transcript.segments.map((s) => ({ start: s.start, end: s.end, text: s.text })), words: words.length, transcript: 'transcript.json' } : null,
    audio: audio ? { tempo: audio.tempo, beats: audio.beats.slice(0, 400), hits: audio.hits, loudnessPerSecond: audio.loudnessPerSecond, silences } : null,
    images: { poster: 'poster.jpg', shotSheets: shotPages.map((p) => rel(p.file)), timeline: tl.pages.map((p) => ({ file: rel(p.file), start: p.start, end: p.end })), timelineEvery: tl.step },
    warnings,
  };
  fs.writeFileSync(path.join(outDir, 'analysis.json'), JSON.stringify(analysis, null, 1));
  fs.writeFileSync(path.join(outDir, 'overview.md'), overviewMd(analysis));
  step('xong', 1);
  return analysis;
}

/** Human-readable digest Claude reads first. */
export function overviewMd(a) {
  const s = a.source, p = a.pacing;
  const L = [];
  L.push(`# Phân tích tự động: ${s.file}`, '');
  L.push(`- ${s.width}×${s.height} (${s.orientation}), ${s.fps || '?'} fps, ${s.duration.toFixed(2)} s, ${s.hasAudio ? 'có tiếng' : 'không tiếng'}`);
  L.push(`- ${p.shots} cảnh, cảnh trung vị ${p.medianShot} s, ${p.cutsPerMinute} cắt/phút, cắt đầu tiên ${p.firstCut ?? '—'} s`);
  if (a.speech) L.push(`- Lời thoại (${a.speech.language}): ${a.speech.words} từ, ${p.wordsPerSecond} từ/s, phủ ${Math.round(p.speechCoverage * 100)}% thời lượng, từ đầu tiên ở ${p.firstWord?.toFixed(2)} s`);
  if (a.audio?.tempo) L.push(`- Nhịp ước lượng ${a.audio.tempo.bpm} BPM (độ tin ${a.audio.tempo.confidence})${p.cutsOnBeat != null ? `, ${Math.round(p.cutsOnBeat * 100)}% điểm cắt trùng nhịp` : ''}`);
  if (a.audio?.hits?.length) L.push(`- Tiếng nhấn mạnh (hit/drop/SFX) quanh: ${a.audio.hits.map((h) => h.toFixed(2)).join(', ')} s`);
  if (a.warnings.length) L.push(`- Cảnh báo: ${a.warnings.join('; ')}`);
  L.push('', '## Ảnh để xem (Read từng file)', '');
  L.push(`- Ảnh bìa: \`${a.images.poster}\``);
  for (const f of a.images.shotSheets) L.push(`- Khung đại diện các cảnh: \`${f}\``);
  for (const t of a.images.timeline) L.push(`- Dòng thời gian ${t.start.toFixed(1)}–${t.end.toFixed(1)} s (mỗi ${a.images.timelineEvery} s): \`${t.file}\``);
  L.push('', '## Các cảnh', '', '| # | Bắt đầu | Kết thúc | Dài | Lời nói trong cảnh |', '|---|---|---|---|---|');
  for (const sh of a.shots) L.push(`| ${sh.i} | ${sh.start.toFixed(2)} | ${sh.end.toFixed(2)} | ${sh.duration.toFixed(2)} | ${(sh.words || '').replace(/\|/g, '/').slice(0, 160)} |`);
  if (a.speech) {
    L.push('', '## Lời thoại theo câu', '');
    for (const sg of a.speech.segments) L.push(`- [${sg.start.toFixed(2)}–${sg.end.toFixed(2)}] ${sg.text}`);
  }
  if (a.audio?.loudnessPerSecond?.length) L.push('', '## Độ lớn âm thanh mỗi giây (dBFS)', '', a.audio.loudnessPerSecond.map((v, i) => `${i}s:${v}`).join(' '));
  return L.join('\n') + '\n';
}
