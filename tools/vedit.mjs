#!/usr/bin/env node
// vedit — command line tools for the AI video editor. Run from the workspace: node ../tools/vedit.mjs <command>
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  CACHE_DIR, ROOT, WORKSPACE, importMedia, probe, readProject, writeProject,
} from '../shared/store.mjs';
import { downloadUrl } from '../shared/download.mjs';
import {
  assetById, clipDuration, fmtTime, layoutTrack, newId, projectDuration, sourceToTimeline,
} from '../shared/timeline.js';

const exec = promisify(execFile);
const SERVER = process.env.AI_VIDEO_SERVER || `http://localhost:${process.env.PORT || 3001}`;
const [, , cmd, ...rest] = process.argv;

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      opt[k] = v;
    } else pos.push(a);
  }
  return { pos, opt };
}
const { pos, opt } = parseArgs(rest);

function die(msg) { console.error(`Error: ${msg}`); process.exit(1); }

function resolveMedia(project, ref) {
  if (!ref) die('missing asset id or file');
  const a = assetById(project, ref);
  if (a) return { file: path.join(WORKSPACE, a.path), asset: a };
  const f = path.resolve(ref);
  if (fs.existsSync(f)) return { file: f, asset: null };
  die(`no asset or file "${ref}"`);
}

async function ffmpeg(args) {
  const { stderr } = await exec('ffmpeg', ['-hide_banner', '-nostats', ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stderr;
}

async function api(method, url, body) {
  const r = await fetch(SERVER + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .catch(() => die(`server not reachable at ${SERVER} (start it with: npm run dev)`));
  const j = await r.json();
  if (!r.ok) die(j.error || r.statusText);
  return j;
}

async function waitJob(id, label) {
  let last = '';
  for (;;) {
    const j = await api('GET', `/api/jobs/${id}`);
    const line = `${label}: ${j.stage} ${Math.round((j.progress || 0) * 100)}%`;
    if (line !== last) { console.error(line); last = line; }
    if (j.stage === 'done') return j;
    if (j.stage === 'error') die(j.error);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/* ---------------- silence detection ---------------- */
async function detectSilence(file, noise = -32, min = 0.5) {
  const err = await ffmpeg(['-i', file, '-af', `silencedetect=noise=${noise}dB:d=${min}`, '-f', 'null', '-']);
  const out = [];
  let s = null;
  for (const line of err.split('\n')) {
    let m = line.match(/silence_start: ([\d.]+)/);
    if (m) s = parseFloat(m[1]);
    m = line.match(/silence_end: ([\d.]+)/);
    if (m && s !== null) { out.push({ start: s, end: parseFloat(m[1]) }); s = null; }
  }
  if (s !== null) out.push({ start: s, end: Infinity });
  return out;
}

/* ---------------- transcription ---------------- */
async function transcribe(project, ref, { lang, model = process.env.WHISPER_MODEL || 'small', force } = {}) {
  const { file, asset } = resolveMedia(project, ref);
  const out = path.join(CACHE_DIR, 'transcripts', `${asset ? asset.id : path.basename(file)}.json`);
  if (fs.existsSync(out) && !force) return JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = [path.join(ROOT, 'tools', 'transcribe.py'), file, out, '--model', model];
  if (lang) args.push('--lang', lang);
  await new Promise((resolve, reject) => {
    const p = spawn('python3', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`transcribe failed (${c})`))));
  });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

/* ---------------- commands ---------------- */
const commands = {
  async info() {
    const p = readProject();
    const { width, height, fps } = p.settings;
    console.log(`Project "${p.name}"  ${width}x${height} @${fps}fps  duration ${projectDuration(p).toFixed(2)}s`);
    console.log('\nAssets:');
    for (const a of p.assets) console.log(`  ${a.id}  ${a.type.padEnd(5)}  ${a.duration ? a.duration.toFixed(2) + 's' : '     '}  ${a.width ? `${a.width}x${a.height}` : ''}  ${a.path}${a.source ? `  (${a.source})` : ''}`);
    for (const t of p.tracks) {
      console.log(`\nTrack ${t.id} [${t.type}] "${t.name}"${t.hidden ? ' (hidden)' : ''}`);
      for (const l of layoutTrack(t, p)) {
        const c = l.clip;
        const what = c.kind === 'text' ? `text "${(c.text || '').slice(0, 40)}"` : c.kind === 'component' ? `component ${c.component}` : c.kind === 'solid' ? `solid ${c.color}` : `${c.kind || 'audio'} ${c.assetId} src[${(c.in ?? 0).toFixed(2)}-${(c.out ?? assetById(p, c.assetId)?.duration ?? 0).toFixed(2)}]`;
        console.log(`  ${c.id}  ${l.start.toFixed(2)}-${l.end.toFixed(2)}s  ${what}${c.transition && c.transition.type !== 'none' ? `  → ${c.transition.type} ${c.transition.duration}s` : ''}`);
      }
    }
    console.log(`\nSubtitles: ${p.subtitles.cues.length} cues, ${p.subtitles.enabled ? 'enabled' : 'disabled'}`);
  },

  async probe() { console.log(JSON.stringify(await probe(resolveMedia(readProject(), pos[0]).file), null, 2)); },

  async import() {
    if (!pos.length) die('usage: import <file|url>... [--audio] [--section 10-40] [--add]');
    const p = readProject();
    for (const ref of pos) {
      let asset;
      if (/^https?:\/\//.test(ref)) {
        console.error(`Downloading ${ref} …`);
        const f = await downloadUrl(ref, { audioOnly: !!opt.audio, section: opt.section, onProgress: () => {} });
        asset = await importMedia(p, f, { move: true });
        asset.source = ref;
        fs.rmSync(path.dirname(f), { recursive: true, force: true });
      } else asset = await importMedia(p, path.resolve(ref));
      if (opt.add) addAssetToTimeline(p, asset);
      console.log(`${asset.id}  ${asset.type}  ${asset.duration ?? ''}  ${asset.path}`);
    }
    writeProject(p);
  },

  async frame() {
    const p = readProject();
    const { file, asset } = resolveMedia(p, pos[0]);
    const t = parseFloat(pos[1] || '0');
    const out = path.resolve(opt.out || path.join(CACHE_DIR, 'frames', `${asset?.id || 'f'}_${t.toFixed(2)}.jpg`));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await ffmpeg(['-y', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=960:-2', out]);
    console.log(out);
  },

  async frames() {
    const p = readProject();
    const { file, asset } = resolveMedia(p, pos[0]);
    const info = await probe(file);
    const n = Number(opt.count || 12), cols = Math.min(4, n), rows = Math.ceil(n / cols);
    const out = path.join(CACHE_DIR, 'frames', `${asset?.id || 'f'}_sheet.jpg`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const d = info.duration || 1;
    await ffmpeg(['-y', '-i', file, '-vf', `fps=${n}/${d.toFixed(3)},scale=480:-2,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='%{pts\\:hms}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6,tile=${cols}x${rows}`, '-frames:v', '1', out]);
    console.log(`${out}\n(${n} frames evenly spaced over ${d.toFixed(1)}s, timestamps drawn top-left; step ≈ ${(d / n).toFixed(2)}s)`);
  },

  async still() {
    const t = parseFloat(pos[0] || '0');
    const out = path.resolve(opt.out || path.join(CACHE_DIR, 'frames', `timeline_${t.toFixed(2)}.png`));
    const r = await api('POST', '/api/still', { time: t, out });
    console.log(r.file);
  },

  async transcribe() {
    const p = readProject();
    const tr = await transcribe(p, pos[0], { lang: opt.lang, model: opt.model, force: opt.force });
    console.log(`language=${tr.language} duration=${tr.duration?.toFixed?.(1)}s`);
    for (const s of tr.segments) console.log(`[${s.start.toFixed(2)}-${s.end.toFixed(2)}] ${s.text}`);
  },

  async silence() {
    const { file } = resolveMedia(readProject(), pos[0]);
    const list = await detectSilence(file, Number(opt.noise ?? -32), Number(opt.min ?? 0.5));
    for (const s of list) console.log(`${s.start.toFixed(2)}\t${Number.isFinite(s.end) ? s.end.toFixed(2) : 'end'}\t${Number.isFinite(s.end) ? (s.end - s.start).toFixed(2) : ''}`);
    console.log(`${list.length} silent ranges`);
  },

  async 'cut-silence'() {
    const p = readProject();
    const noise = Number(opt.noise ?? -32), min = Number(opt.min ?? 0.6), pad = Number(opt.pad ?? 0.12);
    const targets = opt.all || !pos.length ? null : new Set(pos);
    let removed = 0;
    for (const t of p.tracks.filter((x) => x.type === 'sequence')) {
      const next = [];
      for (const c of t.clips) {
        const asset = c.kind === 'video' && assetById(p, c.assetId);
        if (!asset || !asset.hasAudio || (targets && !targets.has(c.id))) { next.push(c); continue; }
        const sil = await detectSilence(path.join(WORKSPACE, asset.path), noise, min);
        const inn = c.in ?? 0, out = c.out ?? asset.duration;
        let cursor = inn; const parts = [];
        for (const s of sil) {
          const a = Math.max(inn, s.start + pad), b = Math.min(out, s.end - pad);
          if (b - a < 0.2 || b <= cursor) continue;
          if (a - cursor > 0.15) parts.push([cursor, a]);
          removed += b - a; cursor = b;
        }
        if (out - cursor > 0.15) parts.push([cursor, out]);
        parts.forEach(([a, b], i) => next.push({ ...structuredClone(c), id: i === 0 ? c.id : newId(), in: +a.toFixed(3), out: +b.toFixed(3), transition: i === parts.length - 1 ? c.transition : undefined }));
      }
      t.clips = next;
    }
    writeProject(p);
    console.log(`Removed ${removed.toFixed(2)}s of silence. New duration ${projectDuration(p).toFixed(2)}s`);
  },

  async subtitles() {
    const p = readProject();
    const maxChars = Number(opt['max-chars'] || 42), maxDur = Number(opt['max-duration'] || 4);
    const used = new Set(p.tracks.filter((t) => t.type === 'sequence').flatMap((t) => t.clips.filter((c) => c.kind === 'video').map((c) => c.assetId)));
    const ids = pos.length ? pos : [...used].filter((id) => assetById(p, id)?.hasAudio);
    const words = [];
    for (const id of ids) {
      const tr = await transcribe(p, id, { lang: opt.lang, model: opt.model });
      for (const s of tr.segments) for (const w of s.words) {
        const t0 = sourceToTimeline(p, id, w.start);
        if (t0 == null) continue;
        const t1 = sourceToTimeline(p, id, Math.max(w.start, w.end - 0.01)) ?? t0 + (w.end - w.start);
        words.push({ start: t0, end: Math.max(t0 + 0.05, t1), word: w.word.trim() });
      }
    }
    words.sort((a, b) => a.start - b.start);
    const cues = [];
    let cur = null;
    for (const w of words) {
      const breakNow = !cur || (cur.text + ' ' + w.word).length > maxChars || w.start - cur.end > 0.6 || w.end - cur.start > maxDur || /[.?!…]$/.test(cur.text);
      if (breakNow) { if (cur) cues.push(cur); cur = { start: w.start, end: w.end, text: w.word }; } else { cur.text += ' ' + w.word; cur.end = w.end; }
    }
    if (cur) cues.push(cur);
    p.subtitles.cues = cues.map((c) => ({ start: +c.start.toFixed(3), end: +c.end.toFixed(3), text: c.text }));
    p.subtitles.enabled = true;
    writeProject(p);
    console.log(`${cues.length} subtitle cues written to project.subtitles`);
    for (const c of cues.slice(0, 15)) console.log(`  ${fmtTime(c.start)} ${c.text}`);
  },

  async scenes() {
    const { file } = resolveMedia(readProject(), pos[0]);
    const th = Number(opt.threshold || 0.3);
    const err = await ffmpeg(['-i', file, '-vf', `select='gt(scene,${th})',showinfo`, '-f', 'null', '-']);
    const times = [...err.matchAll(/pts_time:([\d.]+)/g)].map((m) => parseFloat(m[1]));
    console.log(times.map((t) => t.toFixed(2)).join('\n') || 'no scene changes');
  },

  async add() {
    const p = readProject();
    const asset = assetById(p, pos[0]) || die(`no asset ${pos[0]}`);
    const clip = addAssetToTimeline(p, asset, opt);
    writeProject(p);
    console.log(`added ${clip.id}`);
  },

  async render() {
    const r = await api('POST', '/api/render', { quality: opt.draft ? 'draft' : 'final', range: opt.range ? opt.range.split('-').map(Number) : undefined });
    const j = await waitJob(r.job.id, 'render');
    console.log(path.join(WORKSPACE, j.file));
  },

  async validate() {
    const p = readProject();
    const problems = [];
    const ids = new Set();
    for (const t of p.tracks) for (const c of t.clips) {
      if (ids.has(c.id)) problems.push(`duplicate clip id ${c.id}`);
      ids.add(c.id);
      if (c.assetId && !assetById(p, c.assetId)) problems.push(`${c.id}: unknown asset ${c.assetId}`);
      const a = c.assetId && assetById(p, c.assetId);
      if (a?.duration && c.out > a.duration + 0.05) problems.push(`${c.id}: out ${c.out} > asset duration ${a.duration}`);
      if (c.in != null && c.out != null && c.out <= c.in) problems.push(`${c.id}: out <= in`);
      if (t.type === 'sequence' && c.kind === 'text') problems.push(`${c.id}: text clips belong on an overlay track`);
      if (clipDuration(c, p) <= 0) problems.push(`${c.id}: zero duration`);
      if (c.kind === 'component') {
        const idx = fs.readFileSync(path.join(WORKSPACE, 'custom', 'index.tsx'), 'utf8');
        if (!new RegExp(`\\b${c.component}\\b`).test(idx)) problems.push(`${c.id}: component ${c.component} not registered in custom/index.tsx`);
      }
    }
    console.log(problems.length ? problems.join('\n') : 'OK');
    if (problems.length) process.exit(2);
  },

  help() {
    console.log(`vedit commands (run from workspace/: node ../tools/vedit.mjs <cmd>)
  info                                   summary of project.json (ids, timeline positions)
  import <file|url>... [--audio] [--section 10-40] [--add]   import local file or URL (YouTube, …)
  add <assetId> [--track id] [--start s] [--in s] [--out s] [--duration s]   put an asset on the timeline
  probe <assetId|file>                   media info
  frame <assetId|file> <sec> [--out f]   extract one frame (jpg) — then Read it to look at it
  frames <assetId|file> [--count 12]     contact sheet of evenly spaced frames (jpg)
  still <timelineSec>                    render the composed timeline at a time (png, needs server)
  transcribe <assetId> [--lang vi] [--model small] [--force]   speech-to-text with word timestamps
  silence <assetId> [--noise -32] [--min 0.5]                  list silent ranges
  cut-silence [clipId...|--all] [--noise -32] [--min 0.6] [--pad 0.12]  remove silences from main track
  subtitles [assetId...] [--lang vi] [--max-chars 42]          build subtitle cues from speech
  scenes <assetId> [--threshold 0.3]     scene-change timestamps
  render [--draft] [--range 0-10]        export MP4 via Remotion (needs server)
  validate                               sanity-check project.json`);
  },
};

function addAssetToTimeline(p, asset, o = {}) {
  const trackType = asset.type === 'audio' ? 'audio' : 'sequence';
  let track = o.track ? p.tracks.find((t) => t.id === o.track) : p.tracks.find((t) => t.type === trackType);
  if (!track) { track = { id: trackType === 'audio' ? 'music' : 'main', name: trackType, type: trackType, clips: [] }; p.tracks.push(track); }
  const clip = { id: newId(), name: asset.name };
  if (asset.type === 'image') Object.assign(clip, { kind: 'image', assetId: asset.id, duration: Number(o.duration || 4) });
  else Object.assign(clip, { kind: asset.type === 'audio' ? 'audio' : 'video', assetId: asset.id, in: Number(o.in || 0), out: Number(o.out || asset.duration) });
  if (track.type !== 'sequence') clip.start = Number(o.start ?? 0);
  track.clips.push(clip);
  return clip;
}

const fn = commands[cmd] || commands.help;
Promise.resolve(fn()).catch((e) => die(e.message));
