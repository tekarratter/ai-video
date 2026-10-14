// Download media from a URL (YouTube, Vimeo, TikTok… via yt-dlp, or a direct file link) into workspace/media.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CACHE_DIR } from './store.mjs';

const YTDLP = process.env.YTDLP || (fs.existsSync(path.join(os.homedir(), '.local/bin/yt-dlp')) ? path.join(os.homedir(), '.local/bin/yt-dlp') : 'yt-dlp');

/**
 * @returns {Promise<string>} path of the downloaded temp file
 * opts: { audioOnly, maxHeight, section: "start-end" seconds, onProgress(0..1) }
 */
export function downloadUrl(url, { audioOnly = false, maxHeight = 1080, section, onProgress } = {}) {
  const dir = fs.mkdtempSync(path.join(CACHE_DIR, 'dl-'));
  const fmt = audioOnly
    ? 'bestaudio[ext=m4a]/bestaudio'
    : `bv*[height<=${maxHeight}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/b`;
  // YouTube needs a JS runtime + challenge solver now (yt-dlp EJS): use node, fetch the solver script
  const args = ['--js-runtimes', 'node', '--remote-components', 'ejs:github', '--no-playlist', '--newline', '-f', fmt, '-o', path.join(dir, '%(title).80s.%(ext)s'), '--restrict-filenames'];
  if (!audioOnly) args.push('--merge-output-format', 'mp4');
  if (section) args.push('--download-sections', `*${section}`, '--force-keyframes-at-cuts');
  args.push(url);
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, args);
    let err = '';
    const onData = (d) => {
      const s = d.toString();
      err += s;
      const m = [...s.matchAll(/\[download\]\s+([\d.]+)%/g)].pop();
      if (m) onProgress?.(parseFloat(m[1]) / 100);
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => reject(new Error(`yt-dlp not available: ${e.message}`)));
    p.on('close', (code) => {
      const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.part') && !f.endsWith('.ytdl'));
      if (code !== 0 || !files.length) return reject(new Error(`Download failed (${code}): ${err.split('\n').filter((l) => /ERROR/.test(l)).join(' ') || err.slice(-400)}`));
      resolve(path.join(dir, files[0]));
    });
  });
}
