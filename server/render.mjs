// Export the timeline with Remotion (bundle -> selectComposition -> renderMedia per scene -> ffmpeg join).
import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { ensureBrowser, makeCancelSignal, openBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { CACHE_DIR, EXPORT_DIR, ROOT, WORKSPACE, readProject } from '../shared/store.mjs';
import { SAFE_ZONES, applySafeZone, layoutTrack } from '../shared/timeline.js';

const ENTRY = path.join(ROOT, 'remotion', 'index.ts');
let cached = { url: null, stamp: 0 };

function newestMtime(dirs) {
  let m = 0;
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else m = Math.max(m, fs.statSync(p).mtimeMs);
    }
  };
  for (const d of dirs) if (fs.existsSync(d)) walk(d);
  return m;
}

async function getBundle(onProgress) {
  const stamp = newestMtime([path.join(ROOT, 'remotion'), path.join(ROOT, 'shared'), path.join(WORKSPACE, 'custom')]);
  if (cached.url && cached.stamp === stamp) return cached.url;
  const url = await bundle({
    entryPoint: ENTRY,
    onProgress: (p) => onProgress?.(p / 100),
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: { ...(config.resolve?.alias || {}), '@custom': path.join(WORKSPACE, 'custom') },
      },
    }),
  });
  cached = { url, stamp };
  return url;
}

/** A stop handle for one render: stop() aborts it at the next step or kills the running renderMedia. */
export function renderStopper() {
  const { cancelSignal, cancel } = makeCancelSignal();
  const s = {
    stopped: false,
    cancelSignal,
    stop() { s.stopped = true; cancel(); },
    check() { if (s.stopped) throw new Error('Đã dừng render'); },
  };
  return s;
}

/**
 * @param {object} opts { mediaBase, quality: 'final'|'draft', range?: [startSec, endSec], onProgress(job), stopper? }
 */
export async function renderProject({ mediaBase, quality = 'final', range, outName, onProgress, stopper, projectId, target, continuous, project: snapshot, projectDir }) {
  // `snapshot`: the project as it was when Render was pressed, so the user can switch to another
  // project meanwhile; output goes to that project's own exports/ (not the active-project symlink).
  const src = snapshot || readProject();
  const exportDir = projectDir ? path.join(projectDir, 'exports') : EXPORT_DIR;
  assetRoot = projectDir || WORKSPACE;
  // target 'facebook' etc.: same timeline with overlays kept clear of that platform's mobile UI
  const project = SAFE_ZONES[target] ? applySafeZone(src, SAFE_ZONES[target]) : src;
  const job = { stage: 'bundle', progress: 0 };
  const report = (patch) => { if (!stopper?.stopped) { Object.assign(job, patch); onProgress?.({ ...job }); } };

  report({ stage: 'browser' });
  await ensureBrowser();
  stopper?.check();
  report({ stage: 'bundle', progress: 0 });
  const serveUrl = await getBundle((p) => report({ stage: 'bundle', progress: p }));
  stopper?.check();

  const inputProps = { project, mediaBase };
  const composition = await selectComposition({ serveUrl, id: 'Main', inputProps, timeoutInMilliseconds: 180000 });
  stopper?.check();
  const fps = composition.fps;
  const frameRange = range ? [Math.round(range[0] * fps), Math.min(composition.durationInFrames - 1, Math.round(range[1] * fps) - 1)] : null;

  const [f0, f1] = frameRange || [0, composition.durationInFrames - 1];

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const base = (outName || project.name || 'export').replace(/[^\p{L}\p{N}_-]+/gu, '_');
  fs.mkdirSync(exportDir, { recursive: true });
  const file = path.join(exportDir, `${base}${SAFE_ZONES[target] ? `-${target}` : ''}-${stamp}.mp4`);

  // Scene-by-scene render: every scene is rendered to its own (muted) file under .cache/render-parts,
  // named by a fingerprint of everything visible in it. A later render reuses unchanged scenes, and a
  // render that was stopped / crashed / interrupted by a restart continues where it left off.
  // Sound is rendered once for the whole range (voice-over and music stay continuous across cuts) and
  // also cached by its own fingerprint. Finally ffmpeg joins the scenes and adds the sound (no re-encode).
  const common = {
    serveUrl, composition, inputProps,
    cancelSignal: stopper?.cancelSignal,
    // Conservative defaults: this box has little free RAM and OffthreadVideo extraction is memory hungry.
    concurrency: Number(process.env.RENDER_CONCURRENCY || 1),
    // generous timeout: when the machine swaps, extracting one video frame can take minutes
    timeoutInMilliseconds: Number(process.env.RENDER_TIMEOUT_MS || 600000),
    offthreadVideoCacheSizeInBytes: Number(process.env.RENDER_VIDEO_CACHE_MB || 256) * 1024 * 1024,
    offthreadVideoThreads: 2,
  };
  const meta = { title: project.name || projectId || 'export', comment: `AI Video Studio · dự án: ${project.name || ''} (${projectId || '?'})` };
  if (continuous) {
    // one pass from start to end straight into the mp4 (no scene cache): the classic, simplest path
    report({ stage: 'render', progress: 0, current: 'liền một lượt' });
    try {
      await renderMedia({
        ...common, metadata: meta, codec: 'h264', outputLocation: file, frameRange,
        crf: quality === 'draft' ? 28 : 18,
        scale: quality === 'draft' ? 0.5 : 1,
        onProgress: ({ progress, renderedFrames, encodedFrames }) => report({ stage: 'render', progress, renderedFrames, encodedFrames }),
      });
    } catch (e) {
      fs.rmSync(file, { force: true });
      stopper?.check();
      throw e;
    }
    report({ stage: 'done', progress: 1, current: undefined, file: path.relative(WORKSPACE, file).split(path.sep).join('/') });
    return job;
  }
  const look = { quality, target: target || '', w: composition.width, h: composition.height, fps, bundle: cached.stamp };
  // every scene has a picture part (<key>.mp4, muted) and a sound part (<akey>.wav, PCM so the parts
  // join without gaps), each with its own fingerprint: changing only music/voice redoes only sound
  const segs = sceneSegments(project, fps, f0, f1).map((s) => {
    const key = hashOf({ v: 2, ...look, a: s.a, b: s.b, content: visibleIn(project, fps, s.a, s.b) });
    const akey = hashOf({ v: 2, fps, a: s.a, b: s.b, sound: soundOf(project, fps, s.a, s.b) });
    return { ...s, key, out: path.join(PARTS_DIR, `${key}.mp4`), aout: path.join(PARTS_DIR, `${akey}.wav`) };
  });
  fs.mkdirSync(PARTS_DIR, { recursive: true });

  const todo = segs.filter((s) => !fs.existsSync(s.out) || !fs.existsSync(s.aout));
  const frames = (s) => s.b - s.a + 1;
  // sound-only work (picture cached) walks the frames without screenshots: count it as ~1/3
  const work = (s) => frames(s) * (fs.existsSync(s.out) ? 0.33 : 1);
  const totalWork = todo.reduce((n, s) => n + work(s), 0) || 1;
  let doneWork = 0;
  const scenes = segs.map((s) => ({ label: s.label, start: s.a / fps, end: (s.b + 1) / fps, reused: !todo.includes(s) }));
  report({ stage: 'render', progress: 0, scenes, reused: segs.length - todo.length, sceneCount: segs.length });

  // one browser for all scenes instead of one per renderMedia call
  const browser = todo.length ? await openBrowser('chrome', { chromiumOptions: {} }) : null;
  try {
    for (const [i, s] of todo.entries()) {
      stopper?.check();
      const needPicture = !fs.existsSync(s.out), needSound = !fs.existsSync(s.aout);
      const tmp = `${s.out}.tmp.mp4`, atmp = `${s.aout}.tmp.wav`;
      const scale = needPicture ? 1 : 0.33;
      report({ stage: 'render', current: `${segs.indexOf(s) + 1}/${segs.length} · ${s.label}${needPicture ? '' : ' (âm thanh)'}` });
      const onProgress = ({ renderedFrames }) => report({ progress: Math.min(0.97, ((doneWork + renderedFrames * scale) / totalWork) * 0.97), renderedFrames: Math.round(doneWork + renderedFrames * scale) });
      const drop = (e) => { fs.rmSync(tmp, { force: true }); fs.rmSync(atmp, { force: true }); stopper?.check(); throw e; };
      if (needPicture) {
        await renderMedia({
          ...common, puppeteerInstance: browser, onProgress,
          codec: 'h264', outputLocation: tmp, frameRange: [s.a, s.b],
          // sound of the same pass goes to its own WAV (or nowhere when it is cached already)
          ...(needSound ? { audioCodec: 'pcm-16', separateAudioTo: atmp, enforceAudioTrack: true } : { muted: true }),
          crf: quality === 'draft' ? 28 : 18,
          scale: quality === 'draft' ? 0.5 : 1,
        }).catch(drop);
      } else {
        await renderMedia({ ...common, puppeteerInstance: browser, onProgress, codec: 'wav', enforceAudioTrack: true, outputLocation: atmp, frameRange: [s.a, s.b] }).catch(drop);
      }
      // only complete parts ever get their final name
      if (needSound) fs.renameSync(atmp, s.aout);
      if (needPicture) fs.renameSync(tmp, s.out);
      doneWork += work(s);
      scenes[segs.indexOf(s)].reused = false;
      scenes[segs.indexOf(s)].done = true;
      report({ scenes, progress: Math.min(0.97, (doneWork / totalWork) * 0.97) });
      void i;
    }
  } finally {
    await browser?.close({ silent: true }).catch(() => {});
  }
  stopper?.check();

  report({ stage: 'join', current: 'ghép cảnh', progress: 0.98 });
  const now = new Date();
  for (const s of segs) for (const p of [s.out, s.aout]) fs.utimesSync(p, now, now); // "last used", for cache pruning
  try {
    await joinParts(segs.map((s) => s.out), segs.map((s) => s.aout), file, meta);
  } catch (e) {
    fs.rmSync(file, { force: true }); // don't leave a half-written mp4 in exports/
    throw e;
  }
  pruneParts();
  report({ stage: 'done', progress: 1, current: undefined, file: path.relative(WORKSPACE, file).split(path.sep).join('/') });
  return job;
}

const PARTS_DIR = path.join(CACHE_DIR, 'render-parts');
let assetRoot = WORKSPACE; // folder that asset paths ("media/x.jpg") of the project being rendered are relative to
const hashOf = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 20);

/** Cut points: each clip of the main sequence is a scene; long scenes are split into ≤ MAX_SCENE_SEC pieces. */
function sceneSegments(project, fps, f0, f1) {
  const MAX = Math.max(2, Number(process.env.RENDER_MAX_SCENE_SEC || 15)) * fps;
  const MIN = Math.round(fps / 2);
  const main = project.tracks.find((t) => t.type === 'sequence' && !t.hidden);
  const cuts = new Map([[f0, 'Cảnh 1']]);
  if (main) {
    layoutTrack(main, project).forEach((l, i) => {
      const f = Math.round(l.start * fps);
      if (f > f0 && f <= f1) cuts.set(f, l.clip.name || l.clip.component || `Cảnh ${i + 1}`);
      else if (f <= f0) cuts.set(f0, l.clip.name || l.clip.component || `Cảnh ${i + 1}`);
    });
  }
  const starts = [...cuts.keys()].sort((a, b) => a - b);
  const out = [];
  starts.forEach((a, i) => {
    const end = (starts[i + 1] ?? f1 + 1) - 1;
    const label = cuts.get(a);
    if (out.length && end - a + 1 < MIN) { out[out.length - 1].b = end; return; } // tiny scene: glue to previous
    const n = Math.ceil((end - a + 1) / MAX);
    for (let k = 0; k < n; k++) {
      const sa = a + Math.round(((end - a + 1) * k) / n), sb = a + Math.round(((end - a + 1) * (k + 1)) / n) - 1;
      out.push({ a: sa, b: sb, label: n > 1 ? `${label} (${k + 1}/${n})` : label });
    }
  });
  return out;
}

/** Everything that can show up in frames a..b: clips overlapping them, subtitles, logo, look.
 *  Compared in whole frames, the way Remotion places sequences (seconds carry float noise). */
function visibleIn(project, fps, a, b) {
  const F = (t) => Math.round(t * fps);
  const hit = (s, e) => F(s) <= b && F(e) > a;
  const assets = new Map(project.assets.map((x) => [x.id, x]));
  const tracks = project.tracks.filter((t) => !t.hidden && t.type !== 'audio').map((t) => ({
    ...t,
    clips: layoutTrack(t, project).filter((l) => hit(l.start, l.end))
      .map((l) => ({ s: l.start, d: l.duration, tr: l.transition, c: l.clip, a: assetSig(assets.get(l.clip.assetId)) })),
  }));
  const st = project.subtitles || {};
  return {
    settings: project.settings, logo: project.logo, logoAsset: assetSig(assets.get(project.logo?.assetId)), tracks,
    subtitles: { enabled: st.enabled, style: st.style, cues: (st.cues || []).filter((c) => hit(c.start, c.end)) },
  };
}

const SOUNDY = /\.(mp3|wav|m4a|aac|ogg|flac|mp4|mov|webm|mkv)\b|"(audio|voice|music|sound|src)"/i;
/** What the sound of frames a..b depends on: audio tracks and every clip that can carry sound there, with timing. */
function soundOf(project, fps, a, b) {
  const F = (t) => Math.round(t * fps);
  const assets = new Map(project.assets.map((x) => [x.id, x]));
  return project.tracks.filter((t) => !t.hidden).map((t) => ({
    id: t.id, type: t.type, muted: t.muted, volume: t.volume,
    clips: layoutTrack(t, project).filter((l) => F(l.start) <= b && F(l.end) > a).filter((l) => t.type === 'audio' || l.clip.kind === 'video' || l.clip.kind === 'audio' || (l.clip.kind === 'component' && SOUNDY.test(JSON.stringify(l.clip.props || {})) && /\.(mp3|wav|m4a|aac|ogg|flac|mp4|mov|webm|mkv)/i.test(JSON.stringify(l.clip.props || {}))) || (!l.clip.kind && l.clip.assetId))
      .map((l) => ({ s: l.start, d: l.duration, c: l.clip, a: assetSig(assets.get(l.clip.assetId)) })),
  }));
}

/** An asset's identity incl. its file's size/mtime, so replacing a media file invalidates the scenes using it. */
function assetSig(a) {
  if (!a) return null;
  let st = null;
  try { const s = fs.statSync(path.join(assetRoot, a.path)); st = [s.size, Math.round(s.mtimeMs)]; } catch { /* missing */ }
  return { id: a.id, path: a.path, st };
}

/** Join picture parts (stream copy) and sound parts (PCM, encoded to AAC once) into the final mp4. */
function joinParts(videos, audios, out, meta) {
  const listOf = (files, name) => {
    const p = `${out}.${name}.txt`;
    fs.writeFileSync(p, files.map((v) => `file '${v.replace(/'/g, "'\\''")}'`).join('\n'));
    return p;
  };
  const vl = listOf(videos, 'video'), al = listOf(audios, 'audio');
  const args = ['-hide_banner', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', vl, '-f', 'concat', '-safe', '0', '-i', al,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart',
    '-metadata', `title=${meta.title}`, '-metadata', `comment=${meta.comment}`, out];
  return new Promise((resolve, reject) => execFile('ffmpeg', args, { maxBuffer: 1 << 24 }, (err, _o, stderr) => {
    fs.rmSync(vl, { force: true }); fs.rmSync(al, { force: true });
    if (err) reject(new Error(`ghép cảnh lỗi: ${String(stderr || err.message).trim().split('\n').pop()}`)); else resolve();
  }));
}

/** Keep the scene cache bounded: drop parts unused for RENDER_PARTS_DAYS (default 14) days and leftovers. */
function pruneParts() {
  const maxAge = Number(process.env.RENDER_PARTS_DAYS || 14) * 86400e3;
  for (const f of fs.readdirSync(PARTS_DIR)) {
    const p = path.join(PARTS_DIR, f);
    try { if (/\.tmp\./.test(f) || Date.now() - fs.statSync(p).mtimeMs > maxAge) fs.rmSync(p, { force: true }); } catch { /* gone */ }
  }
}

/** Render one frame of the timeline to a PNG (used by `vedit still` so Claude can look at its work). */
export async function renderTimelineStill({ mediaBase, time, out }) {
  const project = readProject();
  await ensureBrowser();
  const serveUrl = await getBundle();
  const inputProps = { project, mediaBase };
  const composition = await selectComposition({ serveUrl, id: 'Main', inputProps });
  const frame = Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(time * composition.fps)));
  await renderStill({ serveUrl, composition, frame, output: out, inputProps, scale: 0.5 });
  return out;
}
