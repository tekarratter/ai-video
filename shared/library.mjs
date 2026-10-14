// Background-music library: the Incompetech catalog (Kevin MacLeod, CC BY 4.0, ~1400 tracks)
// plus the user's own tracks in <ROOT>/library/music. Tracks are downloaded on first use and cached.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CACHE_DIR, ROOT, hash, importMedia, probe } from './store.mjs';

const INC = 'https://incompetech.com/music/royalty-free';
const LIB_CACHE = path.join(CACHE_DIR, 'library');
export const LOCAL_MUSIC_DIR = path.join(ROOT, 'library', 'music');
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i;
const WEEK = 7 * 24 * 3600 * 1000;

async function cachedJson(name, url) {
  const file = path.join(LIB_CACHE, name);
  try {
    if (Date.now() - fs.statSync(file).mtimeMs < WEEK) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* not cached yet */ }
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}`);
    const j = await r.json();
    fs.mkdirSync(LIB_CACHE, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(j));
    return j;
  } catch (e) {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); // stale is better than nothing
    throw new Error(`Không tải được thư viện nhạc: ${e.message}`);
  }
}

const toSec = (hms) => String(hms || '0').split(':').reduce((a, b) => a * 60 + Number(b || 0), 0);
const split = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

let catalog = null;
async function incompetech() {
  if (catalog) return catalog;
  const [pieces, genres] = await Promise.all([
    cachedJson('incompetech-pieces.json', `${INC}/pieces.json`),
    cachedJson('incompetech-genres.json', `${INC}/genre.json`).catch(() => []),
  ]);
  const gname = Object.fromEntries(genres.map((g) => [String(g.id), g.genre]));
  catalog = pieces.filter((p) => p.filename).map((p) => ({
    id: `inc:${p.filename}`,
    source: 'incompetech',
    title: p.title,
    artist: 'Kevin MacLeod',
    duration: toSec(p.length),
    bpm: Number(p.bpm) || null,
    genre: gname[String(p.genre)] || null,
    feel: split(p.feel),
    instruments: p.instruments || '',
    description: p.description || '',
    url: `${INC}/mp3-royaltyfree/${encodeURIComponent(p.filename)}`,
    license: 'CC BY 4.0',
    attribution: `"${p.title}" Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttp://creativecommons.org/licenses/by/4.0/`,
  }));
  setTimeout(() => { catalog = null; }, WEEK).unref?.();
  return catalog;
}

async function localTracks() {
  let files = [];
  try { files = (await fsp.readdir(LOCAL_MUSIC_DIR, { recursive: true })).filter((f) => AUDIO_EXT.test(f)); } catch { return []; }
  return Promise.all(files.map(async (f) => {
    const abs = path.join(LOCAL_MUSIC_DIR, f);
    let duration = 0;
    try { duration = (await probe(abs)).duration || 0; } catch { /* unreadable */ }
    const title = path.basename(f).replace(AUDIO_EXT, '').replace(/[_-]+/g, ' ');
    const folder = path.dirname(f) === '.' ? [] : path.dirname(f).split(path.sep);
    return {
      id: `local:${f}`, source: 'local', title, artist: '', duration, bpm: null, genre: folder[0] || null, feel: folder.slice(1),
      instruments: '', description: '', url: `/library/music/${f.split(path.sep).map(encodeURIComponent).join('/')}`, license: '', attribution: '',
    };
  }));
}

/** Search tracks. q matches title/feel/genre/instruments/description; all words must match. */
export async function searchMusic({ q = '', genre, feel, minDuration, maxDuration, source, limit = 60 } = {}) {
  const lists = await Promise.all([
    source === 'incompetech' ? [] : localTracks(),
    source === 'local' ? [] : incompetech().catch(() => []),
  ]);
  // loose matching: "relaxing" finds "Relaxed"; rank by how many words match, title hits first
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean).map((w) => (w.length > 5 ? w.slice(0, -3) : w));
  const scored = [];
  for (const t of lists.flat()) {
    if (genre && t.genre !== genre) continue;
    if (feel && !t.feel.some((f) => f.toLowerCase() === String(feel).toLowerCase())) continue;
    if (minDuration && t.duration < Number(minDuration)) continue;
    if (maxDuration && t.duration > Number(maxDuration)) continue;
    const title = t.title.toLowerCase();
    const hay = `${title} ${t.genre} ${t.feel.join(' ')} ${t.instruments} ${t.description}`.toLowerCase();
    const hits = words.filter((w) => hay.includes(w)).length;
    if (words.length && !hits) continue;
    const score = hits * 10 + words.filter((w) => title.includes(w)).length * 3 + (t.source === 'local' ? 1 : 0);
    scored.push([score, t]);
  }
  scored.sort((x, y) => y[0] - x[0]);
  const res = scored.map(([, t]) => t);
  return res.slice(0, Number(limit) || 60);
}

export async function musicFacets() {
  const all = [...(await localTracks()), ...(await incompetech().catch(() => []))];
  const count = (arr) => Object.entries(arr.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { genres: count(all.map((t) => t.genre).filter(Boolean)), feels: count(all.flatMap((t) => t.feel)).slice(0, 40), total: all.length };
}

export async function trackById(id) {
  const hit = (await searchMusic({ limit: 1e9, source: id.startsWith('local:') ? 'local' : 'incompetech' })).find((t) => t.id === id);
  if (!hit) throw new Error(`Không tìm thấy bài nhạc ${id}`);
  return hit;
}

/** Download (if needed) and import a library track as an audio asset. Returns the asset (already pushed to project.assets). */
export async function importTrack(project, id, { onProgress } = {}) {
  const t = await trackById(id);
  const existing = project.assets.find((a) => a.libraryId === id);
  if (existing) return existing;
  let file;
  if (t.source === 'local') file = path.join(LOCAL_MUSIC_DIR, id.slice('local:'.length));
  else {
    const dir = path.join(LIB_CACHE, 'mp3');
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, `${hash(id).slice(0, 12)}.mp3`);
    if (!fs.existsSync(file)) {
      // curl: retries + long timeouts (the host is sometimes slow to accept connections)
      await new Promise((resolve, reject) => {
        const p = spawn('curl', ['-SfL', '--retry', '4', '--retry-all-errors', '--connect-timeout', '30', '--max-time', '600',
          '-o', `${file}.part`, '-w', '%{http_code}', '--progress-bar', t.url], { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        p.stderr.on('data', (d) => {
          err += d;
          const m = String(d).match(/([\d.]+)%/g);
          if (m) onProgress?.(parseFloat(m.at(-1)) / 100);
        });
        p.on('error', reject);
        p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Tải nhạc lỗi (curl ${code}): ${err.replace(/[#\s]+[\d.]+%/g, '').trim().slice(-200)}`))));
      });
      fs.renameSync(`${file}.part`, file);
    }
  }
  const asset = await importMedia(project, file, { name: `${t.title}${path.extname(file)}` });
  Object.assign(asset, { libraryId: id, ...(t.attribution ? { license: t.license, attribution: t.attribution } : {}) });
  return asset;
}

export { creditsFor } from './timeline.js';
