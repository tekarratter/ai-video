// Export the timeline with Remotion (bundle -> selectComposition -> renderMedia).
import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, makeCancelSignal, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { EXPORT_DIR, ROOT, WORKSPACE, readProject } from '../shared/store.mjs';

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
export async function renderProject({ mediaBase, quality = 'final', range, outName, onProgress, stopper, projectId }) {
  const project = readProject();
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

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const base = (outName || project.name || 'export').replace(/[^\p{L}\p{N}_-]+/gu, '_');
  const file = path.join(EXPORT_DIR, `${base}-${stamp}.mp4`);
  report({ stage: 'render', progress: 0 });
  try {
  await renderMedia({
    cancelSignal: stopper?.cancelSignal,
    // tag the mp4 so a downloaded file still says which project it came from
    metadata: { title: project.name || projectId || 'export', comment: `AI Video Studio · dự án: ${project.name || ''} (${projectId || '?'})` },
    serveUrl,
    composition,
    codec: 'h264',
    outputLocation: file,
    inputProps,
    frameRange,
    crf: quality === 'draft' ? 28 : 18,
    scale: quality === 'draft' ? 0.5 : 1,
    // Conservative defaults: this box has little free RAM and OffthreadVideo extraction is memory hungry.
    concurrency: Number(process.env.RENDER_CONCURRENCY || 1),
    // generous timeout: when the machine swaps, extracting one video frame can take minutes
    timeoutInMilliseconds: Number(process.env.RENDER_TIMEOUT_MS || 600000),
    offthreadVideoCacheSizeInBytes: Number(process.env.RENDER_VIDEO_CACHE_MB || 256) * 1024 * 1024,
    offthreadVideoThreads: 2,
    onProgress: ({ progress, renderedFrames, encodedFrames }) => report({ stage: 'render', progress, renderedFrames, encodedFrames }),
  });
  } catch (e) {
    fs.rmSync(file, { force: true }); // don't leave a half-written mp4 in exports/
    stopper?.check();
    throw e;
  }
  report({ stage: 'done', progress: 1, file: path.relative(WORKSPACE, file).split(path.sep).join('/') });
  return job;
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
