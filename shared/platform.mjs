// Cross-platform helpers (Linux / macOS / Windows): where the Python venvs and CLI tools live,
// zip/unzip without Info-ZIP on Windows, lowering a child's CPU priority without `nice`, tmux detection.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const IS_WIN = process.platform === 'win32';

/** Path of an executable inside a Python venv (bin/x on Unix, Scripts\x.exe on Windows). */
export const venvBin = (dir, name) => (IS_WIN ? path.join(dir, 'Scripts', `${name}.exe`) : path.join(dir, 'bin', name));

/** Is `cmd` on PATH? */
export function which(cmd) {
  const r = spawnSync(IS_WIN ? 'where' : 'which', [cmd], { stdio: 'ignore', windowsHide: true });
  return r.status === 0;
}

const firstExisting = (...files) => files.find((f) => f && fs.existsSync(f));

/** Python with faster-whisper + Pillow: $AI_VIDEO_PYTHON, else the repo's .venv, else python3 / python. */
export const PYTHON = process.env.AI_VIDEO_PYTHON
  || firstExisting(venvBin(path.join(ROOT, '.venv'), 'python'))
  || (IS_WIN ? 'python' : 'python3');

/** Python for text-to-speech (VieNeu / Kokoro): $TTS_PYTHON, else .venv-tts. */
export const TTS_PYTHON = process.env.TTS_PYTHON || venvBin(path.join(ROOT, '.venv-tts'), 'python');

/** yt-dlp: $YTDLP, ~/.local/bin, the repo's .venv, else PATH. */
export const YTDLP = process.env.YTDLP
  || firstExisting(path.join(os.homedir(), '.local', 'bin', IS_WIN ? 'yt-dlp.exe' : 'yt-dlp'), venvBin(path.join(ROOT, '.venv'), 'yt-dlp'))
  || 'yt-dlp';

/** tmux drives the shared Claude Code CLI. Windows has none: the chat panel is disabled there (MCP still works). */
export const HAS_TMUX = !IS_WIN && which('tmux');
export const NO_TMUX_MSG = IS_WIN
  ? 'Trên Windows không có tmux nên panel chat Claude bị tắt. Hãy mở Claude Code trong thư mục workspace\\ hoặc kết nối qua MCP (docs/MCP.md).'
  : 'Không tìm thấy tmux — cài tmux để dùng panel chat Claude.';

// Windows has no Info-ZIP, and its tar.exe (bsdtar) crashes on non-ASCII names such as "ảnh đẹp.jpg":
// zip/unzip there go through tools/ziputil.py (Python zipfile, UTF-8 names).
const ZIPUTIL = path.join(ROOT, 'tools', 'ziputil.py');
const PY_UTF8 = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };

/** Unpack a .zip into `dir`. Entries escaping `dir` (../, absolute paths) are refused on every platform.
 *  `strict`: reject on any error (default: tolerate warnings, like unzip exit 1). */
export function unzip(zipPath, dir, { strict = false } = {}) {
  const [cmd, args] = IS_WIN ? [PYTHON, [ZIPUTIL, 'unzip', zipPath, dir]] : ['unzip', ['-qq', '-o', zipPath, '-d', dir]];
  return new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 1 << 24, windowsHide: true, env: PY_UTF8 }, (err) => {
    if (err && strict && (IS_WIN || err.code > 1)) reject(new Error(`giải nén lỗi ${err.code}`));
    else resolve();
  }));
}

/** Zip the current folder `cwd` to stdout (symlinks/junctions followed). Already-compressed media is stored as is. */
export function zipToStdout(cwd) {
  if (IS_WIN) return spawn(PYTHON, [ZIPUTIL, 'zip', '.'], { cwd, windowsHide: true, env: PY_UTF8 });
  return spawn('zip', ['-r', '-q', '-n', '.mp4:.mov:.m4v:.webm:.mkv:.jpg:.jpeg:.png:.webp:.gif:.heic:.mp3:.m4a:.aac:.ogg:.flac:.wav:.zip', '-', '.'], { cwd });
}

/** Spawn with lower CPU priority (`nice -n` on Unix, BELOW_NORMAL on Windows) so the UI stays responsive. */
export function spawnNice(cmd, args, nice = 0, opts = {}) {
  if (!nice) return spawn(cmd, args, { windowsHide: true, ...opts });
  if (!IS_WIN) return spawn('nice', ['-n', String(nice), cmd, ...args], opts);
  const p = spawn(cmd, args, { windowsHide: true, ...opts });
  try { os.setPriority(p.pid, nice >= 15 ? os.constants.priority.PRIORITY_LOW : os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* exited */ }
  return p;
}

/** A TTF with Vietnamese glyphs for ffmpeg drawtext, escaped for use inside a filter graph. */
export const DRAWTEXT_FONT = (() => {
  const f = process.env.DRAWTEXT_FONT || firstExisting(
    ...(IS_WIN ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'Fonts', 'arial.ttf'), path.join(process.env.SystemRoot || 'C:\\Windows', 'Fonts', 'segoeui.ttf')] : []),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf',
  ) || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  // Filter-graph syntax: forward slashes, quoted, ':' escaped → 'C\:/Windows/Fonts/arial.ttf'.
  // (Unquoted, the graph parser eats one level of escaping and drawtext splits at the drive colon.)
  return `'${f.replace(/\\/g, '/').replace(/:/g, '\\:')}'`;
})();
