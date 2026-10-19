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
import { importTrack, musicFacets, searchMusic } from '../shared/library.mjs';
import { listVoices, synthesize, ttsFileName } from '../shared/tts.mjs';
import { articleKey, downloadImage, extractArticle, searchImages } from './article.mjs';
import {
  addAudioClip, assetById, clipDuration, creditsFor, fmtTime, layoutTrack, LOGO_DEFAULTS, LOGO_POSITIONS, newId, projectDuration, sourceToTimeline,
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

  async youtube() {
    const st = await api('GET', '/api/youtube/status');
    if (!st.connected) die('YouTube chưa kết nối — mở editor: Jobs → Exports → ▶ YouTube để thiết lập');
    if (!pos[0]) die('usage: youtube <exports/file.mp4> --title "…" [--description "…"] [--tags a,b] [--privacy private|unlisted|public] [--shorts]');
    let description = opt.description && opt.description !== true ? String(opt.description) : '';
    const credits = creditsFor(readProject()).filter((c) => !description.includes(c));
    if (credits.length) description = `${description}\n\nMusic:\n${credits.join('\n\n')}`.trim();
    if (opt.shorts && !/#shorts/i.test(description)) description = `${description}\n\n#Shorts`.trim();
    const r = await api('POST', '/api/youtube/upload', {
      file: pos[0], title: opt.title === true ? undefined : opt.title, description,
      tags: opt.tags && opt.tags !== true ? String(opt.tags).split(',').map((s) => s.trim()) : [],
      privacy: opt.privacy && opt.privacy !== true ? opt.privacy : 'private',
    });
    const j = await waitJob(r.job.id, 'youtube');
    console.log(j.url);
  },

  async music() {
    const sub = pos.shift();
    if (sub === 'search' || sub === 'find') {
      const res = await searchMusic({ q: pos.join(' '), genre: opt.genre, feel: opt.feel, maxDuration: opt.max, minDuration: opt.min, limit: opt.limit || 20 });
      for (const t of res) console.log(`${t.id}\t${fmtTime(t.duration)}\t${t.genre || ''}\t${t.feel.join(',')}\t${t.bpm || ''}bpm\t${t.description.slice(0, 90)}`);
      if (!res.length) console.log('no match — try fewer words, or: music genres');
    } else if (sub === 'genres') {
      const f = await musicFacets();
      console.log(`genres: ${f.genres.join(', ')}\nfeels: ${f.feels.join(', ')}\n(${f.total} tracks)`);
    } else if (sub === 'add') {
      if (!pos[0]) die('usage: music add <trackId> [--start s] [--volume 0.35] [--no-add]');
      const p = readProject();
      const asset = await importTrack(p, pos[0]);
      if (!p.assets.includes(asset) && !p.assets.some((a) => a.id === asset.id)) p.assets.push(asset);
      if (!opt['no-add']) {
        const c = addAudioClip(p, asset, { trackId: opt.track || 'music', trackName: 'Music', start: Number(opt.start || 0), volume: Number(opt.volume ?? 0.35), fadeIn: 1, fadeOut: 2, fitToVideo: true });
        console.log(`added clip ${c.id} on track ${opt.track || 'music'}`);
      }
      writeProject(p);
      console.log(`${asset.id}  ${asset.duration?.toFixed(1)}s  ${asset.path}${asset.attribution ? '  (CC BY — credit is added to YouTube description automatically)' : ''}`);
    } else die('usage: music search <words> [--genre G] [--feel F] [--max 60] | music genres | music add <trackId>');
  },

  async voices() {
    const v = await listVoices();
    for (const x of v.filter((x) => !opt.lang || x.lang === opt.lang)) console.log(`${x.id.padEnd(22)} ${x.featured ? '*' : ' '} ${x.description}`);
  },

  async tts() {
    const text = opt.file ? fs.readFileSync(opt.file, 'utf8') : pos.join(' ');
    if (!text.trim()) die('usage: tts "text" [--voice "vi:Trúc Ly"|en:af_heart] [--speed 1] [--start s] [--no-add]  (or --file script.txt)');
    const voice = opt.voice && opt.voice !== true ? String(opt.voice) : 'vi:Trúc Ly';
    console.error(`synthesizing with ${voice} …`);
    const wav = await synthesize({ text, voice, speed: Number(opt.speed || 1) });
    const p = readProject();
    const asset = await importMedia(p, wav, { name: ttsFileName(text, voice) });
    asset.tts = { text, voice, speed: Number(opt.speed || 1) };
    let clip = null;
    if (!opt['no-add']) clip = addAudioClip(p, asset, { trackId: opt.track || 'voice', trackName: 'Giọng đọc', start: Number(opt.start || 0), volume: Number(opt.volume || 1) });
    writeProject(p);
    console.log(`${asset.id}  ${asset.duration.toFixed(2)}s${clip ? `  clip ${clip.id} at ${clip.start}s on track ${opt.track || 'voice'}` : ''}`);
  },

  async projects() {
    const sub = pos.shift();
    if (!sub || sub === 'list') {
      const r = await api('GET', '/api/projects');
      for (const p of r.projects) console.log(`${p.active ? '*' : ' '} ${p.id.padEnd(32)} ${`${p.width}x${p.height}`.padEnd(10)} ${p.duration.toFixed(1).padStart(6)}s  ${p.assets} assets  "${p.name}"`);
    } else if (sub === 'new') {
      if (!pos[0]) die('usage: projects new "Name" [--size 1080x1920] [--no-open]');
      const [w, h] = String(opt.size || '1920x1080').split('x').map(Number);
      const r = await api('POST', '/api/projects', { name: pos.join(' '), width: w, height: h, open: !opt['no-open'] });
      console.log(`active: ${r.active}`);
    } else if (sub === 'open') {
      const r = await api('POST', `/api/projects/${encodeURIComponent(pos[0] || '')}/open`);
      console.log(`active: ${r.active}`);
    } else die('usage: projects [list] | projects new "Name" [--size WxH] | projects open <id>');
  },

  async dub() {
    if (!pos[0]) die('usage: dub <assetId|url> [--to vi|en] [--from en] [--voice "vi:Trúc Ly"] [--speed 1] [--original 0.15] [--no-video] [--no-timeline] [--subtitles] [--context "…"]');
    const isUrl = /^https?:\/\//.test(pos[0]);
    const r = await api('POST', '/api/dub', {
      ...(isUrl ? { url: pos[0] } : { assetId: pos[0] }),
      to: opt.to || 'vi', from: opt.from && opt.from !== true ? opt.from : undefined,
      voice: opt.voice && opt.voice !== true ? String(opt.voice) : undefined, speed: Number(opt.speed || 1),
      originalVolume: opt.original != null ? Number(opt.original) : 0.15,
      exportVideo: !opt['no-video'], addToTimeline: !opt['no-timeline'], subtitles: !!opt.subtitles,
      context: opt.context && opt.context !== true ? String(opt.context) : undefined,
    });
    const j = await waitJob(r.job.id, 'dub');
    console.log(j.label);
    if (j.file) console.log(path.join(WORKSPACE, j.file));
  },

  /** Article (news / blog / forum) → text + its images, for "video from an article". */
  async article() {
    const url = pos[0];
    if (!/^https?:\/\//.test(url || '')) die('usage: article <url> [--import [all|1,3,5]] [--max 20] [--refresh] [--json]');
    const cacheFile = path.join(CACHE_DIR, 'articles', `${articleKey(url)}.json`);
    let a = !opt.refresh && fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : null;
    if (!a) {
      console.error(`Đang đọc ${url} …`);
      a = await extractArticle(url).catch((e) => die(/HTTP 40[13]/.test(e.message) ? `${e.message} — trang chặn tải tự động (Cloudflare/đăng nhập). Hãy copy nội dung + lưu ảnh rồi tải lên thay thế.` : e.message));
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(a, null, 1));
    }
    const imgs = a.blocks.filter((b) => b.type === 'img');
    imgs.forEach((b, i) => { b.n = i + 1; });
    if (opt.import) {
      const want = opt.import === true || opt.import === 'all' ? null : new Set(String(opt.import).split(',').map(Number));
      const max = Number(opt.max || 24);
      const p = readProject();
      const tmp = path.join(CACHE_DIR, 'articles', 'dl', articleKey(url));
      let added = 0;
      for (const b of imgs) {
        if ((want && !want.has(b.n)) || added >= max) continue;
        const have = p.assets.find((x) => x.source === b.url);
        if (have) { b.assetId = have.id; continue; }
        try {
          const f = await downloadImage(b.url, tmp, { referer: a.url });
          const info = await probe(f);
          if (info.type !== 'image' || Math.min(info.width || 0, info.height || 0) < 250) { fs.rmSync(f, { force: true }); b.skip = 'quá nhỏ'; continue; }
          const asset = await importMedia(p, f, { move: true });
          Object.assign(asset, { source: b.url, attribution: `Ảnh: ${a.site}` + (b.caption ? ` — ${b.caption.slice(0, 80)}` : '') });
          b.assetId = asset.id; added++;
          writeProject(p); // after each image so the editor shows them as they arrive
          console.error(`  #${b.n} → ${asset.id} ${asset.width}x${asset.height}`);
        } catch (e) { b.skip = e.message; console.error(`  #${b.n} bỏ qua: ${e.message}`); }
      }
      fs.rmSync(tmp, { recursive: true, force: true });
      for (const b of imgs) { const x = p.assets.find((y) => y.id === b.assetId); if (x) Object.assign(b, { width: x.width, height: x.height }); }
      fs.writeFileSync(cacheFile, JSON.stringify(a, null, 1));
    }
    if (opt.json) { console.log(JSON.stringify(a, null, 1)); return; }
    console.log(`TITLE: ${a.title}`);
    console.log(`SITE: ${a.site}${a.published ? ` | ${a.published}` : ''}${a.author ? ` | ${a.author}` : ''}\nURL: ${a.url}`);
    if (a.excerpt) console.log(`SAPO: ${a.excerpt}`);
    console.log(`WORDS: ${a.words}  IMAGES: ${imgs.length}${imgs.some((b) => b.assetId) ? ` (imported: ${imgs.filter((b) => b.assetId).length})` : ' (not imported yet — add --import)'}\n---`);
    for (const b of a.blocks) {
      if (b.type === 'img') console.log(`[IMG #${b.n}${b.assetId ? ` ${b.assetId}` : ''}${b.width ? ` ${b.width}x${b.height}` : ''}${b.skip ? ` (bỏ qua: ${b.skip})` : ''}] ${b.caption || ''}`);
      else console.log(`${b.type === 'h' ? '## ' : b.type === 'quote' ? '> ' : b.type === 'li' ? '- ' : ''}${b.text}`);
    }
  },

  /** Free CC-licensed illustration photos (Openverse → Wikimedia Commons). */
  async images() {
    const q = pos.join(' ');
    if (!q) die('usage: images <english keywords> [--count 8] [--orientation landscape|portrait] [--import 1,3|all]');
    const cacheFile = path.join(CACHE_DIR, 'imgsearch', `${articleKey(`${q}|${opt.orientation || ''}|${opt.count || 8}`)}.json`);
    let list = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : null;
    if (!list) {
      list = await searchImages(q, { count: Number(opt.count || 8), orientation: opt.orientation });
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(list));
    }
    if (!list.length) die(`không tìm thấy ảnh cho "${q}" — thử từ khoá tiếng Anh khác, ngắn hơn`);
    const p = opt.import ? readProject() : null;
    const want = opt.import && opt.import !== true && opt.import !== 'all' ? new Set(String(opt.import).split(',').map(Number)) : null;
    for (const [i, x] of list.entries()) {
      let id = '';
      if (p && (!want || want.has(i + 1))) {
        const have = p.assets.find((a) => a.source === x.url);
        if (have) id = have.id;
        else {
          try {
            const tmp = path.join(CACHE_DIR, 'imgsearch', 'dl');
            const f = await downloadImage(x.url, tmp);
            const asset = await importMedia(p, f, { move: true });
            Object.assign(asset, { source: x.url, attribution: `Ảnh: ${x.attribution}` });
            writeProject(p);
            id = asset.id;
          } catch (e) { id = `(lỗi: ${e.message})`; }
        }
      }
      console.log(`#${i + 1} ${id ? `${id} ` : ''}${x.width}x${x.height}  ${x.title.slice(0, 70)}  [${x.source}]\n    ${x.thumb || x.url}`);
    }
    if (!p) console.log('\nXem thử: tải thumbnail rồi Read, hoặc import luôn: --import 1,3');
  },

  async logo() {
    const p = readProject();
    if (opt.remove) { delete p.logo; writeProject(p); return console.log('logo removed'); }
    const patch = {};
    if (pos[0]) {
      let asset = assetById(p, pos[0]);
      if (!asset) asset = await importMedia(p, path.resolve(pos[0]));
      if (asset.type !== 'image') die(`${asset.id} is not an image`);
      patch.assetId = asset.id;
    }
    if (opt.position) {
      if (!LOGO_POSITIONS.includes(opt.position)) die(`--position must be one of ${LOGO_POSITIONS.join(', ')}`);
      patch.position = opt.position;
    }
    for (const k of ['size', 'margin', 'opacity']) if (opt[k] != null && opt[k] !== true) patch[k] = Number(opt[k]);
    if (opt.off) patch.enabled = false;
    if (opt.on) patch.enabled = true;
    if (!p.logo && !patch.assetId) {
      if (Object.keys(patch).length) die('no logo yet: logo <assetId|file> first');
      return console.log('no logo');
    }
    p.logo = { ...LOGO_DEFAULTS, ...(p.logo || {}), ...patch };
    if (Object.keys(patch).length) writeProject(p);
    console.log(JSON.stringify(p.logo));
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
        const tplIdx = path.join(WORKSPACE, 'custom', 'tpl', 'index.ts');
        const idx = fs.readFileSync(path.join(WORKSPACE, 'custom', 'index.tsx'), 'utf8') + (fs.existsSync(tplIdx) ? fs.readFileSync(tplIdx, 'utf8') : '');
        if (!new RegExp(`\\b${c.component}\\b`).test(idx)) problems.push(`${c.id}: component ${c.component} not registered in custom/index.tsx`);
      }
    }
    if (p.logo?.assetId && assetById(p, p.logo.assetId)?.type !== 'image') problems.push(`logo: ${p.logo.assetId} is not an image asset`);
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
  youtube <exports/x.mp4> --title t [--description d] [--tags a,b] [--privacy private] [--shorts]   upload to YouTube
  article <url> [--import [all|1,3]] [--max 24] [--refresh] [--json]
                                         read a news/blog/forum article: title, text, images in order; --import adds its images as assets
  images <english words> [--count 8] [--orientation landscape|portrait] [--import 1,3|all]
                                         free CC illustration photos (Openverse / Wikimedia), credits kept in asset.attribution
  music search <words> [--genre G] [--feel F] [--max 60]   search the background-music library (Incompetech CC BY + library/music)
  music genres                           list genres / feels
  music add <trackId> [--start s] [--volume 0.35] [--no-add]   import a track, put it on the music track (trimmed + faded)
  voices [--lang vi|en]                  list TTS voices
  tts "text" [--voice "vi:Trúc Ly"] [--speed 1] [--start s] [--file f.txt] [--no-add]   voice-over → track "voice"
  projects [list] | projects new "Name" [--size 1080x1920] | projects open <id>   manage projects (needs server)
  dub <assetId|url> [--to vi|en] [--from en] [--voice "vi:Trúc Ly"] [--original 0.15] [--subtitles] [--no-video] [--no-timeline]
                                         dubbing: transcript → Claude translation → TTS → exports/<name>-thuyet-minh-<to>.mp4 (+ track "dub")
  logo [assetId|file] [--position top-right] [--size 0.18] [--margin 0.04] [--opacity 0.9] [--off|--on|--remove]
                                         logo/watermark over the whole video (no args: show current)
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
