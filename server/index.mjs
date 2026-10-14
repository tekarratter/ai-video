import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import multer from 'multer';
import chokidar from 'chokidar';
import { WebSocketServer } from 'ws';
import {
  CACHE_DIR, EXPORT_DIR, MEDIA_DIR, PROJECT_FILE, ROOT, WORKSPACE,
  hash, importMedia, readProject, writeProject,
} from '../shared/store.mjs';
import { downloadUrl } from '../shared/download.mjs';
import { newId } from '../shared/timeline.js';
import { ClaudeBridge } from './claude.mjs';
import { renderProject, renderTimelineStill } from './render.mjs';

const PORT = Number(process.env.PORT || 3001);
const MEDIA_BASE = `http://localhost:${PORT}`;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

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
  broadcast({ type: 'project', project: JSON.parse(text), origin }, except);
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
  jobs.set(job.id, job);
  const update = (patch) => { Object.assign(job, patch); broadcast({ type: 'job', job }); persistJobs(); };
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
app.use('/media', express.static(MEDIA_DIR, { fallthrough: false }));
app.use('/exports', express.static(EXPORT_DIR));
app.use('/cache', express.static(CACHE_DIR));

app.get('/api/project', (req, res) => res.json(readProject()));
app.put('/api/project', (req, res) => {
  const clientId = req.get('x-client-id');
  const except = [...wss.clients].find((c) => c.clientId === clientId);
  saveProject(req.body, 'ui', except);
  res.json({ ok: true });
});

const upload = multer({ dest: path.join(CACHE_DIR, 'uploads'), limits: { fileSize: 8 * 1024 ** 3 } });
app.post('/api/upload', upload.array('files'), (req, res) => {
  const files = (req.files || []).map((f) => ({ path: f.path, name: Buffer.from(f.originalname, 'latin1').toString('utf8') }));
  if (!files.length) return res.status(400).json({ error: 'Không có file' });
  // Conversion (HEIC → JPG, HEVC → H.264…) can take minutes: run as a job, report progress over WS.
  const job = startJob('import', `Nhập ${files.length} file`, async (update) => {
    const ok = [], failed = [];
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
        saveProject(latest, 'ui');
        ok.push(asset.name);
      } catch (e) {
        console.warn('[upload]', e.message);
        failed.push(e.message);
        fs.rmSync(f.path, { force: true });
      }
    }
    if (failed.length) broadcast({ type: 'toast', level: 'error', text: `Lỗi nhập: ${failed.join('; ')}` });
    if (!ok.length) throw new Error(failed.join('; '));
    return { label: `Đã nhập ${ok.length}/${files.length} file` };
  });
  res.json({ job });
});

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
app.get('/api/exports', (req, res) => {
  const files = fs.readdirSync(EXPORT_DIR).filter((f) => f.endsWith('.mp4'))
    .map((f) => ({ name: f, url: `/exports/${encodeURIComponent(f)}`, size: fs.statSync(path.join(EXPORT_DIR, f)).size, mtime: fs.statSync(path.join(EXPORT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  res.json(files);
});

let rendering = null;
app.post('/api/render', (req, res) => {
  if (rendering && !['done', 'error'].includes(rendering.stage)) return res.status(409).json({ error: 'Đang render', job: rendering });
  const { quality, range } = req.body || {};
  rendering = startJob('render', quality === 'draft' ? 'Render nháp' : 'Render video', async (update) => {
    const r = await renderProject({ mediaBase: MEDIA_BASE, quality, range, onProgress: (p) => update(p) });
    return { file: r.file, url: `/${r.file.split('/').map(encodeURIComponent).join('/')}` };
  });
  res.json({ job: rendering });
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
});
claude.on('reset', (d) => broadcast({ type: 'chat-reset', ...d }));
claude.on('items', (d) => broadcast({ type: 'chat-items', ...d }));
claude.on('status', (status) => broadcast({ type: 'chat-status', status }));
claude.on('screen', (s) => {
  for (const c of wss.clients) if (c.terminal && c.readyState === 1) c.send(JSON.stringify({ type: 'terminal', ...s }));
});
claude.watch();
if (process.env.CLAUDE_AUTOSTART !== '0') claude.start({ resume: 'continue' }).catch((e) => console.warn('[claude] start failed:', e.message));

app.get('/api/chat', (req, res) => res.json(claude.snapshot()));
app.post('/api/chat/send', async (req, res) => {
  try { await claude.send(String(req.body.text || '')); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/chat/key', async (req, res) => { await claude.key(req.body.key); res.json({ ok: true }); });
app.post('/api/chat/restart', async (req, res) => {
  await claude.restart({ resume: req.body?.mode === 'new' ? undefined : req.body?.sessionId || 'continue' });
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
  ws.send(JSON.stringify({ type: 'hello', project: readProject(), chat: claude.snapshot(), jobs: [...jobs.values()].slice(-30) }));
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
  app.get(/^\/(?!api|media|exports|cache|ws).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

server.listen(PORT, () => {
  console.log(`[ai-video] server http://localhost:${PORT}  workspace=${WORKSPACE}`);
  console.log(`[ai-video] Claude Code CLI dùng chung: tmux attach -t ${claude.tmux}`);
});
