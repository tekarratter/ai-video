// Node-only helpers shared by the server and tools/vedit.mjs: workspace paths, project IO, media probing.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { emptyProject, newId, normalizeProject } from './timeline.js';

const exec = promisify(execFile);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORKSPACE = path.resolve(process.env.AI_VIDEO_WORKSPACE || path.join(ROOT, 'workspace'));
export const PROJECT_FILE = path.join(WORKSPACE, 'project.json');
export const MEDIA_DIR = path.join(WORKSPACE, 'media');
export const EXPORT_DIR = path.join(WORKSPACE, 'exports');
export const CACHE_DIR = path.join(WORKSPACE, '.cache');

for (const d of [MEDIA_DIR, EXPORT_DIR, CACHE_DIR]) fs.mkdirSync(d, { recursive: true });

export const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');

export function readProject() {
  if (!fs.existsSync(PROJECT_FILE)) return emptyProject();
  try {
    return normalizeProject(JSON.parse(fs.readFileSync(PROJECT_FILE, 'utf8')));
  } catch (e) {
    throw new Error(`project.json is not valid JSON: ${e.message}`);
  }
}

/** Atomic write. Returns the serialized text (so callers can remember its hash). */
export function writeProject(project) {
  const text = JSON.stringify(normalizeProject(project), null, 2) + '\n';
  const tmp = `${PROJECT_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, PROJECT_FILE);
  return text;
}

export async function probe(file) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const dur = parseFloat(j.format?.duration || v?.duration || a?.duration || '0');
  const isImage = v && (!dur || /image2|png_pipe|jpeg_pipe|webp_pipe|gif/.test(j.format?.format_name || '') && dur < 0.2);
  let fps;
  if (v?.avg_frame_rate && v.avg_frame_rate !== '0/0') {
    const [n, d] = v.avg_frame_rate.split('/').map(Number);
    fps = d ? Math.round((n / d) * 100) / 100 : undefined;
  }
  return {
    type: isImage ? 'image' : v ? 'video' : a ? 'audio' : 'unknown',
    duration: isImage ? undefined : Math.round(dur * 1000) / 1000,
    width: v?.width,
    height: v?.height,
    fps: isImage ? undefined : fps,
    hasAudio: !!a,
    videoCodec: v?.codec_name,
    pixFmt: v?.pix_fmt,
    audioCodec: a?.codec_name,
  };
}

const safeName = (n) => n.normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '') || 'file';

export function uniqueMediaPath(name) {
  const ext = path.extname(name);
  const base = safeName(path.basename(name, ext));
  let candidate = `${base}${ext.toLowerCase()}`;
  for (let i = 2; fs.existsSync(path.join(MEDIA_DIR, candidate)); i++) candidate = `${base}-${i}${ext.toLowerCase()}`;
  return path.join(MEDIA_DIR, candidate);
}

/** Generate preview images for an asset: thumbnail, filmstrip (video) or waveform (audio). */
export async function makePreviews(asset) {
  const src = path.join(WORKSPACE, asset.path);
  const dir = path.join(CACHE_DIR, 'thumbs');
  await fsp.mkdir(dir, { recursive: true });
  const run = (args) => exec('ffmpeg', ['-v', 'error', '-y', ...args]).catch((e) => console.warn('[preview]', e.message));
  if (asset.type === 'image') {
    await run(['-i', src, '-vf', 'scale=320:-2', '-frames:v', '1', path.join(dir, `${asset.id}.jpg`)]);
  } else if (asset.type === 'video') {
    const d = asset.duration || 1;
    await run(['-ss', String(Math.min(1, d / 3)), '-i', src, '-vf', 'scale=320:-2', '-frames:v', '1', path.join(dir, `${asset.id}.jpg`)]);
    await run(['-i', src, '-vf', `fps=12/${d.toFixed(3)},scale=160:90:force_original_aspect_ratio=increase,crop=160:90,tile=12x1`, '-frames:v', '1', path.join(dir, `${asset.id}.strip.jpg`)]);
  }
  if (asset.type === 'audio' || asset.hasAudio) {
    await run(['-i', src, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1200x80:colors=#7dd3fc', '-frames:v', '1', path.join(dir, `${asset.id}.wave.png`)]);
  }
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;
const CONVERT_IMAGE_EXT = /\.(heic|heif|tiff?|bmp|dng)$/i;
const BROWSER_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
const BROWSER_AUDIO = new Set(['mp3', 'aac', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le']);
const MAX_VIDEO_SIDE = Number(process.env.MAX_VIDEO_SIDE || 1920);
const MAX_IMAGE_SIDE = Number(process.env.MAX_IMAGE_SIDE || 3840);

function replaceExt(file, ext) {
  const base = path.join(path.dirname(file), path.basename(file, path.extname(file)));
  let out = `${base}${ext}`;
  for (let i = 2; fs.existsSync(out); i++) out = `${base}-${i}${ext}`;
  return out;
}

function runFfmpeg(args, durationSec, onProgress, { nice = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const ff = ['ffmpeg', '-v', 'error', '-y', '-progress', 'pipe:1', '-nostats', ...args];
    const p = nice ? spawn('nice', ['-n', String(nice), ...ff]) : spawn(ff[0], ff.slice(1));
    let err = '';
    p.stdout.on('data', (d) => {
      const m = [...d.toString().matchAll(/out_time_ms=(\d+)/g)].pop();
      if (m && durationSec) onProgress?.(Math.min(1, Number(m[1]) / 1e6 / durationSec));
    });
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.slice(-300)}`))));
  });
}

/**
 * Make a media file usable in the browser preview and the renderer:
 * HEIC/TIFF → JPG, huge images downscaled, HEVC/ProRes/10-bit video → H.264 MP4, odd audio → M4A.
 * Returns the (possibly new) path; the original is removed when converted.
 */
export async function normalizeMedia(file, { onProgress, onStage } = {}) {
  const convertImage = async (maxSide) => {
    onStage?.('convert-image');
    const out = replaceExt(file, '.jpg');
    await exec('python3', [path.join(ROOT, 'tools', 'convert_image.py'), file, out, '--max', String(maxSide)]);
    await fsp.unlink(file);
    return out;
  };
  if (CONVERT_IMAGE_EXT.test(file)) return convertImage(MAX_IMAGE_SIDE);
  let info;
  try { info = await probe(file); } catch { info = null; }
  if (!info || info.type === 'unknown') {
    // ffmpeg could not read it — maybe an image Pillow understands.
    try { return await convertImage(MAX_IMAGE_SIDE); } catch { throw new Error('Định dạng không hỗ trợ'); }
  }
  if (info.type === 'image') {
    if (!IMAGE_EXT.test(file) || Math.max(info.width || 0, info.height || 0) > MAX_IMAGE_SIDE) return convertImage(MAX_IMAGE_SIDE);
    return file;
  }
  if (info.type === 'video') {
    const tenBit = /10|12/.test(info.pixFmt || '');
    const big = Math.max(info.width || 0, info.height || 0) > MAX_VIDEO_SIDE;
    const okContainer = /\.(mp4|webm|m4v)$/i.test(file);
    if (BROWSER_VIDEO.has(info.videoCodec) && !tenBit && !big && okContainer && (!info.audioCodec || BROWSER_AUDIO.has(info.audioCodec))) return file;
    onStage?.('transcode');
    const out = replaceExt(file, '.mp4');
    const s = MAX_VIDEO_SIDE;
    await runFfmpeg([
      '-i', file, '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', `scale='if(gte(iw,ih),min(${s},iw),-2)':'if(gte(iw,ih),-2,min(${s},ih))',format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out,
    ], info.duration, onProgress);
    await fsp.unlink(file);
    return out;
  }
  if (info.type === 'audio' && !BROWSER_AUDIO.has(info.audioCodec)) {
    onStage?.('transcode');
    const out = replaceExt(file, '.m4a');
    await runFfmpeg(['-i', file, '-vn', '-c:a', 'aac', '-b:a', '192k', out], info.duration, onProgress);
    await fsp.unlink(file);
    return out;
  }
  return file;
}

/* Light preview copies ("proxies") of heavy videos: ≤960 px, 30 fps, ~1 Mbps, a keyframe every second.
 * Only the browser preview uses them (phones / slow links can't stream 1080p60 originals); the renderer
 * always reads the original. Named by the source file's identity, so a replaced file gets a new one. */
export const PROXY_DIR = path.join(CACHE_DIR, 'proxy');
const PROXY_SIDE = 960;

export function proxyFile(asset) {
  if (asset?.type !== 'video' || !asset.path) return null;
  const src = path.join(WORKSPACE, asset.path);
  try {
    const st = fs.statSync(src);
    return path.join(PROXY_DIR, `${hash(`${fs.realpathSync(src)}|${st.size}|${st.mtimeMs}`).slice(0, 24)}.mp4`);
  } catch { return null; }
}

/** Worth a proxy: big frame, high frame rate or high bitrate. */
export function needsProxy(asset) {
  if (asset?.type !== 'video') return false;
  let bytesPerSec = 0;
  try { bytesPerSec = fs.statSync(path.join(WORKSPACE, asset.path)).size / Math.max(1, asset.duration || 1); } catch { return false; }
  return Math.max(asset.width || 0, asset.height || 0) > PROXY_SIDE || (asset.fps || 0) > 31 || bytesPerSec > 300_000;
}

export async function makeProxy(asset, onProgress) {
  const out = proxyFile(asset);
  if (!out || fs.existsSync(out)) return out;
  await fsp.mkdir(PROXY_DIR, { recursive: true });
  const tmp = out.replace(/\.mp4$/, '.part.mp4');
  const s = PROXY_SIDE;
  try {
    await runFfmpeg([
      '-i', path.join(WORKSPACE, asset.path), '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', `scale='if(gte(iw,ih),min(${s},iw),-2)':'if(gte(iw,ih),-2,min(${s},ih))',fps=30,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-g', '30', '-threads', String(Number(process.env.PROXY_THREADS || 0)),
      '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', tmp,
    ], asset.duration, onProgress, { nice: 15 });
    await fsp.rename(tmp, out);
  } catch (e) {
    await fsp.unlink(tmp).catch(() => {});
    throw e;
  }
  return out;
}

/** Copy/move a file into workspace/media and register it as an asset. Mutates `project`. */
export async function importMedia(project, srcFile, { move = false, name, onProgress, onStage } = {}) {
  let dest = uniqueMediaPath(name || path.basename(srcFile));
  if (move) await fsp.rename(srcFile, dest).catch(async () => { await fsp.copyFile(srcFile, dest); await fsp.unlink(srcFile); });
  else await fsp.copyFile(srcFile, dest);
  try {
    dest = await normalizeMedia(dest, { onProgress, onStage });
    const info = await probe(dest);
    if (info.type === 'unknown') throw new Error('Định dạng không hỗ trợ');
    const asset = {
      id: newId(info.type === 'audio' ? 'aud' : info.type === 'image' ? 'img' : 'vid'),
      name: path.basename(dest),
      path: path.relative(WORKSPACE, dest).split(path.sep).join('/'),
      ...info,
    };
    onStage?.('preview');
    await makePreviews(asset);
    project.assets.push(asset);
    return asset;
  } catch (e) {
    await fsp.unlink(dest).catch(() => {});
    throw new Error(`${name || path.basename(srcFile)}: ${e.message}`);
  }
}
