import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import express from 'express';
import multer from 'multer';
import chokidar from 'chokidar';
import { WebSocketServer } from 'ws';
import {
  CACHE_DIR, EXPORT_DIR, MEDIA_DIR, PROJECT_FILE, ROOT, WORKSPACE,
  hash, importMedia, readProject, writeProject,
} from '../shared/store.mjs';
import { downloadUrl } from '../shared/download.mjs';
import { LOGO_DEFAULTS, addAudioClip, findClip, layoutTrack, newId } from '../shared/timeline.js';
import { LOCAL_MUSIC_DIR, importTrack, musicFacets, searchMusic } from '../shared/library.mjs';
import { listVoices, synthesize, ttsFileName } from '../shared/tts.mjs';
import { LANGS, TTS_LANGS, dubAsset } from '../shared/dub.mjs';
import { ClaudeBridge } from './claude.mjs';
import { renderProject, renderStopper, renderTimelineStill } from './render.mjs';
import * as youtube from './youtube.mjs';
import * as auth from './auth.mjs';
import * as projects from './projects.mjs';
import * as claudeAuth from './claudeauth.mjs';

const PORT = Number(process.env.PORT || 3001);
const MEDIA_BASE = `http://localhost:${PORT}`;
const app = express();
const server = http.createServer(app);
// large uploads over slow links take longer than Node's default 5-minute request timeout
server.requestTimeout = 0;
server.headersTimeout = 120_000;
// WebSocket needs a login too (same cookie as the HTTP API)
const wss = new WebSocketServer({ server, path: '/ws', verifyClient: ({ req }) => !!auth.userOf(req) });

projects.init();

if (!fs.existsSync(PROJECT_FILE)) writeProject(readProject());
let lastHash = hash(fs.readFileSync(PROJECT_FILE, 'utf8'));

/* ---------------- websocket ---------------- */
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c !== except && c.readyState === 1) c.send(s);
}

/* ---------------- project ---------------- */
function saveProject(project, origin, except) {
  const text = writeProject(project);
  lastHash = hash(text);
  mirrorSoon();
  broadcast({ type: 'project', project: JSON.parse(text), origin }, except);
}
let mirrorTimer;
function mirrorSoon() {
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => { try { projects.mirror(); } catch (e) { console.warn('[projects] mirror', e.message); } }, 400);
}

chokidar.watch(PROJECT_FILE, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 } })
  .on('all', () => {
    let text;
    try { text = fs.readFileSync(PROJECT_FILE, 'utf8'); } catch { return; }
    const h = hash(text);
    if (h === lastHash) return;
    try {
      const project = JSON.parse(text);
      lastHash = h;
      mirrorSoon();
      broadcast({ type: 'project', project, origin: 'external' });
    } catch (e) {
      broadcast({ type: 'toast', level: 'error', text: `project.json lỗi JSON: ${e.message}` });
    }
  });

// Custom component changes: tell clients (Vite HMR also reloads them, this keeps the list fresh).
chokidar.watch(path.join(WORKSPACE, 'custom'), { ignoreInitial: true }).on('all', () => broadcast({ type: 'custom-changed' }));

/* ---------------- jobs ---------------- */
const JOBS_FILE = path.join(CACHE_DIR, 'jobs.json');
const jobs = new Map();
try {
  for (const j of JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'))) {
    // jobs that were running when the server stopped can't be resumed
    if (!['done', 'error'].includes(j.stage)) Object.assign(j, { stage: 'error', error: 'Server đã khởi động lại khi tác vụ đang chạy — hãy chạy lại' });
    jobs.set(j.id, j);
  }
} catch { /* first run */ }
let persistTimer;
function persistJobs() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => fs.writeFileSync(JOBS_FILE, JSON.stringify([...jobs.values()].slice(-50), null, 1)), 500);
}
function startJob(type, label, fn) {
  const job = { id: newId('job'), type, label, stage: 'queued', progress: 0, startedAt: Date.now() };
  Object.defineProperty(job, 'stopper', { writable: true, enumerable: false });
  jobs.set(job.id, job);
  const update = (patch) => {
    if (job.finishedAt && !('finishedAt' in patch)) return;
    Object.assign(job, patch); broadcast({ type: 'job', job }); persistJobs();
  };
  update({});
  Promise.resolve()
    .then(() => fn(update))
    .then((res) => update({ stage: 'done', progress: 1, ...(res || {}), finishedAt: Date.now() }))
    .catch((e) => {
      console.error(`[job ${type}]`, e);
      const msg = String(e.message || e).split('\n')[0];
      const hint = /delayRender|timeout|Request closed|Target closed/i.test(msg) ? ' (thiếu RAM hoặc video nặng — thử Render nháp / đóng bớt ứng dụng)' : '';
      update({ stage: 'error', error: msg.slice(0, 400) + hint, finishedAt: Date.now() });
    });
  return job;
}

/* ---------------- http ---------------- */
app.use(express.json({ limit: '50mb' }));
app.use(auth.requireAuth);
auth.registerRoutes(app);
app.use('/media', express.static(MEDIA_DIR, { fallthrough: false }));
app.use('/exports', express.static(EXPORT_DIR));
app.use('/cache', express.static(CACHE_DIR));
app.use('/library/music', express.static(LOCAL_MUSIC_DIR));

app.get('/api/project', (req, res) => res.json(readProject()));
app.put('/api/project', (req, res) => {
  const clientId = req.get('x-client-id');
  const except = [...wss.clients].find((c) => c.clientId === clientId);
  saveProject(req.body, 'ui', except);
  res.json({ ok: true });
});

const UPLOAD_DIR = path.join(CACHE_DIR, 'uploads');
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 8 * 1024 ** 3 } });
app.post('/api/upload', upload.array('files'), (req, res) => {
  const raw = (req.files || []).map((f) => ({ path: f.path, name: Buffer.from(f.originalname, 'latin1').toString('utf8') }));
  if (!raw.length) return res.status(400).json({ error: 'Không có file' });
  res.json({ job: startImport(raw, req.query.logo === '1') });
});

// Chunked upload: proxies such as Cloudflare buffer whole requests and reject bodies > 100 MB,
// so the browser sends each file in small parts (resumable: the server reports how much it has).
const partPath = (id) => {
  if (!/^[a-z0-9_-]{8,64}$/i.test(id || '')) throw new Error('upload id không hợp lệ');
  return path.join(UPLOAD_DIR, `${id}.part`);
};
const partSize = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
app.get('/api/upload/part/:id', (req, res) => {
  try { res.json({ size: partSize(partPath(req.params.id)) }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/upload/part/:id', (req, res) => {
  let p;
  try { p = partPath(req.params.id); } catch (e) { return res.status(400).json({ error: e.message }); }
  const offset = Number(req.query.offset) || 0;
  const have = partSize(p);
  if (offset !== have) { req.resume(); return res.status(409).json({ size: have }); } // client resumes from `size`
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const out = fs.createWriteStream(p, { flags: 'a' });
  let failed = false;
  const fail = (e) => {
    if (failed) return; failed = true;
    out.destroy();
    try { fs.truncateSync(p, have); } catch { /* gone */ } // drop the partial chunk so a retry starts clean
    if (!res.headersSent) res.status(500).json({ error: e?.message || 'upload bị ngắt' });
  };
  req.on('aborted', () => fail(new Error('aborted')));
  req.on('error', fail);
  out.on('error', fail);
  out.on('finish', () => { if (!failed) res.json({ size: partSize(p) }); });
  req.pipe(out);
});
app.delete('/api/upload/part/:id', (req, res) => {
  try { fs.rmSync(partPath(req.params.id), { force: true }); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/upload/finish', (req, res) => {
  const list = req.body?.files || [];
  try {
    const raw = list.map((f) => {
      const p = partPath(f.id);
      if (partSize(p) !== Number(f.size)) throw new Error(`${f.name}: chưa tải đủ (${partSize(p)}/${f.size} byte)`);
      return { path: p, name: String(f.name || 'file').replace(/[/\\]/g, '_') };
    });
    if (!raw.length) return res.status(400).json({ error: 'Không có file' });
    res.json({ job: startImport(raw, !!req.body.logo) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

const MEDIA_RE = /\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?|bmp|mp4|mov|m4v|webm|mkv|avi|mp3|m4a|wav|aac|ogg|flac)$/i;
/** Unpack a .zip (Google Drive / Takeout download, a folder zipped on the phone…) and list the media
 *  inside, sub-folders and zips-inside-the-zip included. Folder structure is kept while unpacking so
 *  same-named files in different folders don't overwrite each other; media/ dedupes names on import. */
async function unpackZip(zipPath, dir, depth = 0) {
  fs.mkdirSync(dir, { recursive: true });
  // exit 1 = warnings only; unzip itself refuses entries escaping `dir` (../, absolute paths)
  await new Promise((resolve) => execFile('unzip', ['-qq', '-o', zipPath, '-d', dir], { maxBuffer: 1 << 24 }, () => resolve()));
  const out = [];
  const walk = async (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      if (e.name.startsWith('.') || e.name === '__MACOSX') continue;
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue; // never follow links planted in an archive
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && /\.zip$/i.test(e.name) && depth < 2) out.push(...(await unpackZip(p, `${p}-unzip`, depth + 1)));
      else if (e.isFile() && MEDIA_RE.test(e.name)) out.push({ path: p, name: e.name, tmpDir: dir });
    }
  };
  await walk(dir);
  return out;
}

function startImport(raw, asLogo) {
  // Conversion (HEIC → JPG, HEVC → H.264…) can take minutes: run as a job, report progress over WS.
  const job = startJob('import', `Nhập ${raw.length === 1 ? raw[0].name : `${raw.length} file`}`, async (update) => {
    // .zip: unpack and import the media inside
    const files = [];
    for (const f of raw) {
      if (!/\.zip$/i.test(f.name)) { files.push(f); continue; }
      update({ stage: `giải nén ${f.name}` });
      const dir = `${f.path}-unzip`;
      const found = await unpackZip(f.path, dir);
      fs.rmSync(f.path, { force: true });
      if (!found.length) {
        fs.rmSync(dir, { recursive: true, force: true });
        broadcast({ type: 'toast', level: 'error', text: `${f.name}: không có ảnh/video/nhạc bên trong` });
      }
      for (const x of found) files.push({ ...x, tmpDir: dir });
    }
    if (!files.length) throw new Error('Không có file media nào để nhập');
    update({ label: `Nhập ${files.length} file` });
    const ok = [], failed = [], paths = [];
    for (const [i, f] of files.entries()) {
      const base = i / files.length;
      update({ stage: `${i + 1}/${files.length} ${f.name}`, progress: base });
      try {
        const project = readProject();
        const asset = await importMedia(project, f.path, {
          move: true, name: f.name,
          onStage: (st) => update({ stage: `${i + 1}/${files.length} ${st === 'transcode' ? 'chuyển mã' : st === 'convert-image' ? 'chuyển ảnh' : 'xử lý'} ${f.name}` }),
          onProgress: (p) => update({ progress: base + p / files.length }),
        });
        // merge into the latest project (Claude may have edited it meanwhile)
        const latest = readProject();
        latest.assets.push(asset);
        if (asLogo && asset.type === 'image') latest.logo = { ...LOGO_DEFAULTS, ...(latest.logo || {}), assetId: asset.id, enabled: true };
        saveProject(latest, 'ui');
        ok.push(asset.name);
        paths.push(asset.path);
      } catch (e) {
        console.warn('[upload]', e.message);
        failed.push(e.message);
        fs.rmSync(f.path, { force: true });
      }
    }
    for (const d of new Set(files.map((f) => f.tmpDir).filter(Boolean))) fs.rmSync(d, { recursive: true, force: true });
    if (failed.length) broadcast({ type: 'toast', level: 'error', text: `Lỗi nhập: ${failed.join('; ')}` });
    if (!ok.length) throw new Error(failed.join('; '));
    return { label: `Đã nhập ${ok.length}/${files.length} file`, paths };
  });
  return job;
}

app.post('/api/import-url', (req, res) => {
  const { url, audioOnly, section } = req.body || {};
  if (!/^https?:\/\//.test(url || '')) return res.status(400).json({ error: 'URL không hợp lệ' });
  const job = startJob('download', `Tải ${url}`, async (update) => {
    update({ stage: 'download' });
    const file = await downloadUrl(url, { audioOnly, section, onProgress: (p) => update({ progress: p * 0.9 }) });
    update({ stage: 'import', progress: 0.92 });
    const project = readProject();
    const asset = await importMedia(project, file, { move: true });
    asset.source = url;
    saveProject(project, 'ui');
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    return { assetId: asset.id, label: `Đã tải ${asset.name}` };
  });
  res.json({ job });
});

app.delete('/api/assets/:id', (req, res) => {
  const project = readProject();
  const asset = project.assets.find((a) => a.id === req.params.id);
  if (!asset) return res.status(404).json({ error: 'not found' });
  const used = project.tracks.some((t) => t.clips.some((c) => c.assetId === asset.id));
  if (used && !req.query.force) return res.status(409).json({ error: 'Asset đang được dùng trên timeline' });
  for (const t of project.tracks) t.clips = t.clips.filter((c) => c.assetId !== asset.id);
  project.assets = project.assets.filter((a) => a.id !== asset.id);
  fs.rmSync(path.join(WORKSPACE, asset.path), { force: true });
  saveProject(project, 'ui');
  res.json({ ok: true });
});

app.get('/api/custom-components', (req, res) => {
  const dir = path.join(WORKSPACE, 'custom');
  const files = fs.readdirSync(dir).filter((f) => /\.(tsx|jsx)$/.test(f) && f !== 'index.tsx');
  res.json({ files });
});

app.get('/api/jobs', (req, res) => res.json([...jobs.values()].slice(-30)));
const exportInfo = new Map(); // name|mtime → { duration, width, height }
function probeExport(file) {
  return new Promise((resolve) => execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], (err, out) => {
    try { const j = JSON.parse(out); resolve({ duration: Number(j.format?.duration) || null, width: j.streams?.[0]?.width, height: j.streams?.[0]?.height }); } catch { resolve({}); }
  }));
}
app.get('/api/exports', async (req, res) => {
  const files = fs.readdirSync(EXPORT_DIR).filter((f) => f.endsWith('.mp4'))
    .map((f) => { const st = fs.statSync(path.join(EXPORT_DIR, f)); return { name: f, url: `/exports/${encodeURIComponent(f)}`, size: st.size, mtime: st.mtimeMs }; })
    .sort((a, b) => b.mtime - a.mtime);
  const busy = rendering && [...jobs.values()].some((j) => j.type === 'render' && !['done', 'error'].includes(j.stage));
  for (const f of files) {
    const key = `${f.name}|${f.mtime}`;
    if (!exportInfo.has(key) && !(busy && Date.now() - f.mtime < 60e3)) exportInfo.set(key, await probeExport(path.join(EXPORT_DIR, f.name)));
    Object.assign(f, exportInfo.get(key) || {});
    const srt = f.name.replace(/\.mp4$/, '.srt');
    if (fs.existsSync(path.join(EXPORT_DIR, srt))) f.srtUrl = `/exports/${encodeURIComponent(srt)}`;
  }
  res.json(files);
});
app.delete('/api/exports/:name', (req, res) => {
  const name = path.basename(String(req.params.name));
  const file = path.join(EXPORT_DIR, name);
  if (!name.endsWith('.mp4') || !fs.existsSync(file)) return res.status(404).json({ error: 'Không tìm thấy file' });
  if ([...jobs.values()].some((j) => !['done', 'error'].includes(j.stage) && String(j.file || '').endsWith(name))) return res.status(409).json({ error: 'File đang được dùng' });
  fs.rmSync(file);
  fs.rmSync(file.replace(/\.mp4$/, '.srt'), { force: true });
  res.json({ ok: true });
});

let rendering = null;
/* ---- front-end errors → server log ---- */
app.post('/api/client-error', express.text({ type: '*/*', limit: '64kb' }), (req, res) => {
  let e = {};
  try { e = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { /* ignore */ }
  console.warn(`[client-error] ${req.user?.username || '?'} ${e.kind}: ${e.message}\n${String(e.stack || '').split('\n').slice(0, 12).join('\n')}`);
  res.status(204).end();
});

/* ---- projects ---- */
const busyJobs = () => [...jobs.values()].filter((j) => !['done', 'error'].includes(j.stage));
const projectsPayload = () => ({ active: projects.activeId(), projects: projects.list() });
app.get('/api/projects', (req, res) => res.json(projectsPayload()));
function openProject(id) {
  const busy = busyJobs();
  if (busy.length) throw Object.assign(new Error(`Đang có tác vụ chạy (${busy.map((j) => j.label).join(', ')}) — đợi xong rồi chuyển project`), { status: 409 });
  const from = projects.activeId();
  if (from === id) return;
  if (claude.status.busy) throw Object.assign(new Error('Claude đang làm việc — đợi xong (hoặc bấm Dừng) rồi chuyển dự án'), { status: 409 });
  if (from && claude.status.sessionId) projects.setClaudeSession(from, claude.status.sessionId);
  projects.open(id);
  const text = fs.readFileSync(PROJECT_FILE, 'utf8');
  lastHash = hash(text);
  broadcast({ type: 'project-switched', project: readProject(), ...projectsPayload() });
  // each project keeps its own Claude conversation: resume this one's (a fresh one if it never had one)
  claude.isRunning().then((running) => {
    if (running) return claude.restart({ resume: projects.claudeSession(id) || undefined });
  }).catch((e) => console.warn('[claude] switch session', e.message));
}
const handle = (fn) => (req, res) => {
  try { res.json(fn(req) ?? projectsPayload()); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
};
app.post('/api/projects', handle((req) => {
  const id = projects.create(req.body || {});
  if (req.body?.open !== false) openProject(id);
  else broadcast({ type: 'projects', ...projectsPayload() });
}));
app.post('/api/projects/:id/open', handle((req) => { openProject(req.params.id); }));
// Backup: one .zip with project.json, media, exports (?exports=0 to skip), motion components and the Claude conversation.
app.get('/api/projects/:id/backup', (req, res) => {
  let dir;
  try { dir = projects.backupStage(req.params.id, { exports: req.query.exports !== '0', claudeDir: claude.projectDir }); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${projects.backupName(req.params.id)}"`);
  // already-compressed media is stored as is (fast, no CPU burn); JSON/TSX get deflated
  const zip = spawn('zip', ['-r', '-q', '-n', '.mp4:.mov:.m4v:.webm:.mkv:.jpg:.jpeg:.png:.webp:.gif:.heic:.mp3:.m4a:.aac:.ogg:.flac:.wav:.zip', '-', '.'], { cwd: dir });
  zip.stdout.pipe(res);
  zip.stderr.on('data', (d) => console.warn('[backup]', String(d).trim()));
  zip.on('error', (e) => { console.warn('[backup]', e.message); cleanup(); res.destroy(e); });
  zip.on('close', (code) => { cleanup(); if (code) { console.warn('[backup] zip exit', code); res.destroy(new Error(`zip exit ${code}`)); } });
  res.on('close', () => { if (zip.exitCode === null) zip.kill(); });
});
// Restore: the .zip arrives through the chunked upload above, then is unpacked into a NEW project.
app.post('/api/projects/restore', (req, res) => {
  let part;
  try { part = partPath(req.body?.uploadId); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (partSize(part) !== Number(req.body?.size)) return res.status(400).json({ error: 'File sao lưu chưa tải lên đủ' });
  const job = startJob('restore', `Khôi phục ${req.body?.fileName || 'bản sao lưu'}`, async (update) => {
    const dir = path.join(projects.PROJECTS_DIR, `.restore-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    try {
      update({ stage: 'giải nén' });
      await new Promise((resolve, reject) => execFile('unzip', ['-qq', '-o', part, '-d', dir], { maxBuffer: 1 << 24 }, (err) => (err && err.code > 1 ? reject(new Error(`unzip lỗi ${err.code}`)) : resolve())));
      update({ stage: 'tạo dự án', progress: 0.8 });
      const r = projects.restoreUnpacked(dir, { name: req.body?.name, claudeDir: claude.projectDir });
      broadcast({ type: 'projects', ...projectsPayload() });
      broadcast({ type: 'toast', text: `Đã khôi phục dự án "${r.name}"${r.notes.length ? ` (${r.notes.join(', ')})` : ''} — mở trong danh sách Dự án` });
      return { label: `Đã khôi phục "${r.name}"` };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(part, { force: true });
    }
  });
  res.json({ job });
});
app.post('/api/projects/:id/duplicate', handle((req) => { projects.duplicate(req.params.id); broadcast({ type: 'projects', ...projectsPayload() }); }));
app.patch('/api/projects/:id', handle((req) => {
  projects.rename(req.params.id, req.body?.name);
  if (req.params.id === projects.activeId()) { const text = fs.readFileSync(PROJECT_FILE, 'utf8'); lastHash = hash(text); broadcast({ type: 'project', project: JSON.parse(text), origin: 'ui' }); }
  broadcast({ type: 'projects', ...projectsPayload() });
}));
app.delete('/api/projects/:id', handle((req) => { projects.remove(req.params.id); broadcast({ type: 'projects', ...projectsPayload() }); }));

/* ---- voice-over (TTS) ---- */
app.get('/api/tts/voices', async (req, res) => {
  try { res.json(await listVoices()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/tts', (req, res) => {
  const { text, voice = 'vi:Trúc Ly', speed = 1, start, add = true } = req.body || {};
  if (!String(text || '').trim()) return res.status(400).json({ error: 'Thiếu nội dung cần đọc' });
  const job = startJob('tts', `Giọng đọc: ${String(text).slice(0, 40)}`, async (update) => {
    update({ stage: 'chờ lượt', progress: 0.05 });
    const wav = await synthesize({ text, voice, speed }, {
      onStage: (st) => update({ stage: st === 'load' ? 'nạp model' : st === 'synth' ? 'đang đọc' : st === 'done' ? 'lưu file' : st, progress: st === 'synth' ? 0.4 : 0.2 }),
    });
    if (!add) return { label: 'Bản nghe thử', previewUrl: `/cache/${path.relative(CACHE_DIR, wav).split(path.sep).join('/')}` };
    update({ stage: 'nhập', progress: 0.9 });
    const tmp = readProject();
    const asset = await importMedia(tmp, wav, { name: ttsFileName(text, voice) });
    Object.assign(asset, { tts: { text, voice, speed } });
    const latest = readProject();
    latest.assets.push(asset);
    const clip = addAudioClip(latest, asset, { trackId: 'voice', trackName: 'Giọng đọc', start: Number(start) || 0 });
    saveProject(latest, 'ui');
    return { label: `Giọng đọc ${asset.duration?.toFixed(1)}s`, assetId: asset.id, clipId: clip.id };
  });
  res.json({ job });
});

// re-read voice-over clips with another voice (and/or speed/text); the clips keep their position, volume and fades
app.post('/api/tts/revoice', (req, res) => {
  const { clipIds, voice, speed, text } = req.body || {};
  const ids = Array.isArray(clipIds) ? clipIds.map(String) : [];
  const p0 = readProject();
  const todo = ids.map((id) => findClip(p0, id)?.clip).filter(Boolean)
    .map((c) => ({ id: c.id, tts: p0.assets.find((a) => a.id === c.assetId)?.tts })).filter((x) => x.tts);
  if (!todo.length) return res.status(400).json({ error: 'Không có clip giọng đọc nào để đọc lại' });
  if (text != null && todo.length !== 1) return res.status(400).json({ error: 'Chỉ sửa lời được cho một clip' });
  const job = startJob('tts', `Đổi giọng ${todo.length} clip → ${String(voice || '').split(':').pop() || 'giữ giọng'}`, async (update) => {
    let n = 0;
    for (const [i, x] of todo.entries()) {
      const opts = { text: text != null ? String(text) : x.tts.text, voice: voice || x.tts.voice, speed: Number(speed || x.tts.speed || 1) };
      if (!opts.text.trim()) continue;
      const base = i / todo.length;
      update({ stage: `đọc ${i + 1}/${todo.length}`, progress: base });
      const wav = await synthesize(opts, { onStage: (st) => update({ stage: st === 'load' ? 'nạp model' : `đọc ${i + 1}/${todo.length}`, progress: base + 0.5 / todo.length }) });
      const tmp = readProject();
      const asset = await importMedia(tmp, wav, { name: ttsFileName(opts.text, opts.voice) });
      asset.tts = opts;
      const latest = readProject();
      const c = findClip(latest, x.id)?.clip;
      if (!c) continue; // deleted meanwhile
      latest.assets.push(asset);
      Object.assign(c, { assetId: asset.id, name: asset.name, in: 0, out: asset.duration });
      saveProject(latest, 'ui');
      n++;
    }
    return { label: `Đã đọc lại ${n} clip bằng giọng ${String(voice || '').split(':').pop() || 'cũ'}` };
  });
  res.json({ job });
});

/* ---- dubbing (thuyết minh) ---- */
app.get('/api/dub/languages', (req, res) => res.json({ languages: LANGS, tts: TTS_LANGS }));
app.post('/api/dub', (req, res) => {
  const b = req.body || {};
  const to = String(b.to || 'vi');
  if (!TTS_LANGS.includes(to)) return res.status(400).json({ error: `Chưa có giọng đọc cho ngôn ngữ ${to}` });
  if (!b.assetId && !b.url) return res.status(400).json({ error: 'Chọn video hoặc dán link' });
  const voice = String(b.voice || (to === 'vi' ? 'vi:Trúc Ly' : 'en:af_heart'));
  if (voice.split(':')[0] !== to) return res.status(400).json({ error: 'Giọng đọc không khớp ngôn ngữ đích' });
  const originalVolume = Math.max(0, Math.min(1, Number(b.originalVolume ?? 0.15)));
  const name = b.url ? b.url : (readProject().assets.find((a) => a.id === b.assetId)?.name || b.assetId);
  const job = startJob('dub', `Thuyết minh ${LANGS[to] ? to.toUpperCase() : to}: ${String(name).slice(0, 50)}`, async (update) => {
    let asset;
    if (b.url) {
      update({ stage: 'tải video từ link', progress: 0 });
      const f = await downloadUrl(b.url, { onProgress: (p) => update({ progress: p * 0.05 }) });
      const tmp = readProject();
      asset = await importMedia(tmp, f, { move: true });
      asset.source = b.url;
      fs.rmSync(path.dirname(f), { recursive: true, force: true });
      const latest = readProject();
      latest.assets.push(asset);
      saveProject(latest, 'ui');
    } else {
      asset = readProject().assets.find((a) => a.id === b.assetId);
      if (!asset) throw new Error('Không tìm thấy asset');
    }
    if (!['video', 'audio'].includes(asset.type)) throw new Error('Chỉ thuyết minh được video hoặc audio');

    const r = await dubAsset(asset, {
      to, from: b.from || undefined, voice, speed: Number(b.speed) || 1, originalVolume,
      source: b.source || 'auto', context: b.context, exportVideo: b.exportVideo !== false, env: claudeAuth.env(),
    }, update);

    let clips = 0;
    if (b.addToTimeline !== false || b.subtitles) {
      update({ stage: 'thêm vào timeline', progress: 0.97 });
      const tmp = readProject();
      const dubAssetRec = await importMedia(tmp, r.dubWav, { name: `thuyet-minh-${to}-${asset.name.replace(/\.[^.]+$/, '')}.wav` });
      dubAssetRec.dubOf = asset.id;
      const p = readProject();
      p.assets.push(dubAssetRec);
      // every place the source is used on the timeline (append it to the main track when it isn't there yet)
      const uses = () => p.tracks.filter((t) => t.type !== 'audio').flatMap((t) => layoutTrack(t, p).filter((l) => l.clip.assetId === asset.id));
      if (!uses().length && asset.type === 'video') {
        let main = p.tracks.find((t) => t.type === 'sequence');
        if (!main) { main = { id: 'main', name: 'Main', type: 'sequence', clips: [] }; p.tracks.unshift(main); }
        main.clips.push({ id: newId(), name: asset.name, kind: 'video', assetId: asset.id, in: 0, out: asset.duration });
      }
      for (const l of uses()) {
        const cin = l.clip.in ?? 0, cout = l.clip.out ?? asset.duration;
        if (b.addToTimeline !== false) {
          const c = addAudioClip(p, dubAssetRec, { trackId: 'dub', trackName: 'Thuyết minh', start: l.start, volume: 1 });
          c.in = Math.min(cin, dubAssetRec.duration);
          c.out = Math.min(cout, dubAssetRec.duration);
          l.clip.volume = originalVolume;
          clips++;
        }
        if (b.subtitles) {
          for (const q of r.cues) {
            if (q.end <= cin || q.start >= cout) continue;
            p.subtitles.cues.push({ start: +(l.start + Math.max(q.start, cin) - cin).toFixed(3), end: +(l.start + Math.min(q.end, cout) - cin).toFixed(3), text: q.text });
          }
          p.subtitles.cues.sort((x, y) => x.start - y.start);
          p.subtitles.enabled = true;
        }
      }
      saveProject(p, 'ui');
    }
    const url = r.video ? `/exports/${encodeURIComponent(path.basename(r.video))}` : null;
    return {
      label: `Thuyết minh xong: ${r.lines.length} câu (${r.sourceLang} → ${to})${clips ? `, thêm ${clips} clip vào timeline` : ''}`,
      url, file: r.video ? `exports/${path.basename(r.video)}` : null,
      srtUrl: r.video ? url.replace(/\.mp4$/, '.srt') : null,
    };
  });
  res.json({ job });
});

/* ---- music library ---- */
app.get('/api/music/search', async (req, res) => {
  try { res.json(await searchMusic(req.query)); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/music/facets', async (req, res) => {
  try { res.json(await musicFacets()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/music/add', (req, res) => {
  const { id, start = 0, add = true, volume = 0.35 } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Thiếu id bài nhạc' });
  const job = startJob('music', `Nhạc: ${String(id).replace(/^\w+:/, '')}`, async (update) => {
    update({ stage: 'tải nhạc' });
    const tmp = readProject();
    const asset = await importTrack(tmp, id, { onProgress: (p) => update({ progress: p * 0.9 }) });
    const latest = readProject();
    if (!latest.assets.some((a) => a.id === asset.id)) latest.assets.push(asset);
    if (add) addAudioClip(latest, asset, { trackId: 'music', trackName: 'Music', start: Number(start) || 0, volume: Number(volume), fadeIn: 1, fadeOut: 2, fitToVideo: true });
    saveProject(latest, 'ui');
    return { label: `Đã thêm nhạc: ${asset.name}`, assetId: asset.id };
  });
  res.json({ job });
});

app.post('/api/render', (req, res) => {
  if (rendering && !['done', 'error'].includes(rendering.stage)) return res.status(409).json({ error: 'Đang render', job: rendering });
  const { quality, range, target } = req.body || {};
  const stopper = renderStopper();
  const projectId = projects.activeId();
  const projectName = readProject().name || projectId;
  const kind = target === 'facebook' ? 'Render Facebook di động' : quality === 'draft' ? 'Render nháp' : 'Render video';
  rendering = startJob('render', `${kind} · ${projectName}`, async (update) => {
    update({ projectId, projectName });
    const r = await renderProject({ mediaBase: MEDIA_BASE, quality, range, onProgress: (p) => update(p), stopper, projectId, target });
    // link through the project id: /exports follows whichever project is open now
    return { file: r.file, url: `/api/projects/${encodeURIComponent(projectId)}/exports/${encodeURIComponent(path.basename(r.file))}` };
  });
  rendering.stopper = stopper;
  res.json({ job: rendering });
});
app.get('/api/projects/:id/exports/:name', (req, res) => {
  const { id, name } = req.params;
  if (!/^[\w.-]+$/.test(id) || id.startsWith('.') || name !== path.basename(name)) return res.status(400).end();
  res.sendFile(path.join(projects.PROJECTS_DIR, id, 'exports', name), (e) => { if (e && !res.headersSent) res.status(404).end(); });
});
app.post('/api/render/stop', (req, res) => {
  const job = rendering;
  if (!job || ['done', 'error'].includes(job.stage)) return res.status(409).json({ error: 'Không có render nào đang chạy' });
  job.stopper.stop();
  Object.assign(job, { stage: 'stopping', cancelled: true });
  broadcast({ type: 'job', job }); persistJobs();
  // bundling/selectComposition can't be interrupted; give up waiting on it so the user can render again
  setTimeout(() => {
    if (job.finishedAt) return;
    Object.assign(job, { stage: 'error', error: 'Đã dừng render', finishedAt: Date.now() });
    broadcast({ type: 'job', job }); persistJobs();
  }, 20000);
  res.json({ ok: true });
});
/* ---------------- youtube ---------------- */
// Desktop-app OAuth clients may redirect to any loopback port without registering it.
const YT_REDIRECT = `http://localhost:${PORT}/api/youtube/callback`;
const yt = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) { res.status(400).json({ error: e.message }); }
};
app.get('/api/youtube/status', yt(() => youtube.status()));
app.post('/api/youtube/client', yt((req) => { youtube.setClient(req.body || {}); return youtube.status(); }));
app.post('/api/youtube/auth-url', yt(() => ({ url: youtube.authUrl(YT_REDIRECT), redirectUri: YT_REDIRECT })));
app.post('/api/youtube/code', yt(async (req) => { const s = await youtube.exchangeCode(req.body?.input); broadcast({ type: 'youtube', status: s }); return s; }));
app.post('/api/youtube/disconnect', yt(() => { youtube.disconnect(); return youtube.status(); }));
app.get('/api/youtube/callback', async (req, res) => {
  try {
    const s = await youtube.exchangeCode(`${YT_REDIRECT}?${new URLSearchParams(req.query)}`);
    broadcast({ type: 'youtube', status: s });
    res.send(`<meta charset="utf-8"><body style="font:16px system-ui;background:#111;color:#eee;padding:40px">✅ Đã kết nối YouTube${s.channel ? ` (${s.channel.title})` : ''}. Bạn có thể đóng tab này.</body>`);
  } catch (e) {
    res.status(400).send(`<meta charset="utf-8"><body style="font:16px system-ui;padding:40px">❌ ${e.message}</body>`);
  }
});
app.post('/api/youtube/upload', (req, res) => {
  const { file, ...meta } = req.body || {};
  const abs = path.resolve(WORKSPACE, String(file || ''));
  if (!abs.startsWith(EXPORT_DIR + path.sep) && !abs.startsWith(MEDIA_DIR + path.sep)) return res.status(400).json({ error: 'File phải nằm trong exports/ hoặc media/' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Không tìm thấy file' });
  if (!youtube.status().connected) return res.status(400).json({ error: 'Chưa kết nối YouTube' });
  const job = startJob('youtube', `YouTube: ${meta.title || path.basename(abs)}`, async (update) => {
    update({ stage: 'upload' });
    const r = await youtube.upload(abs, meta, (p) => update({ progress: p }));
    return { url: r.url, studio: r.studio, videoId: r.id, label: `Đã đăng YouTube (${r.privacy})` };
  });
  res.json({ job });
});

app.post('/api/still', async (req, res) => {
  try {
    const out = path.resolve(req.body.out || path.join(CACHE_DIR, 'frames', `timeline_${Date.now()}.png`));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await renderTimelineStill({ mediaBase: MEDIA_BASE, time: Number(req.body.time || 0), out });
    res.json({ file: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  return j ? res.json(j) : res.status(404).json({ error: 'not found' });
});

/* ---------------- claude bridge ---------------- */
const claude = new ClaudeBridge({
  cwd: WORKSPACE,
  session: process.env.TMUX_SESSION || 'ai-video',
  claudeArgs: process.env.CLAUDE_ARGS || '',
  env: claudeAuth.env,
});
claude.on('reset', (d) => { projects.setClaudeSession(projects.activeId(), d.sessionId); broadcast({ type: 'chat-reset', ...d }); });
claude.on('items', (d) => broadcast({ type: 'chat-items', ...d }));
claude.on('status', (status) => broadcast({ type: 'chat-status', status }));
claude.on('screen', (s) => {
  for (const c of wss.clients) if (c.terminal && c.readyState === 1) c.send(JSON.stringify({ type: 'terminal', ...s }));
});
claude.watch();
// Only start Claude when it is signed in — otherwise it would sit on its login screen; the admin signs in from the UI.
if (process.env.CLAUDE_AUTOSTART !== '0') {
  claudeAuth.status({ fresh: true }).then((s) => {
    if (s.loggedIn) return claude.start({ resume: projects.claudeSession() || 'continue' });
    console.warn('[claude] Claude Code chưa đăng nhập — vào editor: menu tài khoản → Claude Code');
  }).catch((e) => console.warn('[claude] start failed:', e.message));
}

/* ---- Claude Code account (admin) ---- */
const adminOnly = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Chỉ admin được cấu hình Claude Code' }));
const authRoute = (fn) => async (req, res) => {
  try {
    const r = await fn(req);
    const st = await claudeAuth.status({ fresh: true });
    broadcast({ type: 'claude-auth', status: st });
    res.json({ ...st, ...(r || {}) });
  } catch (e) { res.status(400).json({ error: e.message }); }
};
// after credentials change, restart the Claude session so it picks them up (keeps the conversation)
const restartClaude = async () => { const s = await claudeAuth.status({ fresh: true }); if (s.loggedIn) await claude.restart({ resume: projects.claudeSession() || 'continue' }); else await claude.stop(); };
app.get('/api/claude-auth', async (req, res) => res.json(await claudeAuth.status()));
app.post('/api/claude-auth/login', adminOnly, authRoute((req) => claudeAuth.startLogin({ console: !!req.body?.console })));
app.post('/api/claude-auth/code', adminOnly, authRoute(async (req) => { await claudeAuth.submitCode(req.body?.code); await restartClaude(); }));
app.post('/api/claude-auth/apikey', adminOnly, authRoute(async (req) => { claudeAuth.setApiKey(req.body?.key); await restartClaude(); }));
app.post('/api/claude-auth/token', adminOnly, authRoute(async (req) => { claudeAuth.setToken(req.body?.token); await restartClaude(); }));
app.post('/api/claude-auth/logout', adminOnly, authRoute(async () => { await claudeAuth.logout(); await claude.stop(); }));

app.get('/api/chat', (req, res) => res.json(claude.snapshot()));
app.post('/api/chat/send', async (req, res) => {
  try { await claude.send(String(req.body.text || '')); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/chat/key', async (req, res) => { await claude.key(req.body.key); res.json({ ok: true }); });
app.post('/api/chat/restart', async (req, res) => {
  await claude.restart({ resume: req.body?.mode === 'new' ? undefined : req.body?.sessionId || projects.claudeSession() || 'continue' });
  res.json({ ok: true });
});
app.post('/api/chat/attach', upload.array('files'), async (req, res) => {
  // Files dropped into the chat: store in media/ (as assets) and return their workspace paths.
  const paths = [];
  for (const f of req.files) {
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    try {
      const project = readProject();
      const asset = await importMedia(project, f.path, { move: true, name });
      saveProject(project, 'ui');
      paths.push(asset.path);
    } catch (e) {
      fs.rmSync(f.path, { force: true });
      broadcast({ type: 'toast', level: 'error', text: e.message });
    }
  }
  res.json({ paths });
});

wss.on('connection', (ws, req) => {
  ws.clientId = new URL(req.url, 'http://x').searchParams.get('id');
  ws.send(JSON.stringify({ type: 'hello', project: readProject(), activeProject: projects.activeId(), chat: claude.snapshot(), jobs: [...jobs.values()].slice(-30) }));
  ws.on('message', async (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'terminal-open') { ws.terminal = true; claude.terminalWatchers++; if (m.cols) await claude.resize(m.cols, m.rows); claude.pollScreen(true); }
    if (m.type === 'terminal-close' && ws.terminal) { ws.terminal = false; claude.terminalWatchers--; }
    if (m.type === 'terminal-input') claude.input(m.data);
    if (m.type === 'terminal-resize') claude.resize(m.cols, m.rows);
  });
  ws.on('close', () => { if (ws.terminal) claude.terminalWatchers--; });
});

/* ---------------- static web (production) ---------------- */
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|media|exports|cache|library|ws).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

server.listen(PORT, () => {
  console.log(`[ai-video] server http://localhost:${PORT}  workspace=${WORKSPACE}`);
  console.log(`[ai-video] Claude Code CLI dùng chung: tmux attach -t ${claude.tmux}`);
});

