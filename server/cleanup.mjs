// Disk cleanup: list rendered videos of every project plus temporary caches, and delete the chosen ones.
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR } from '../shared/store.mjs';
import { PROJECTS_DIR, list as listProjects } from './projects.mjs';

const TRASH_DIR = path.join(PROJECTS_DIR, '.trash');
const UPLOAD_DIR = path.join(CACHE_DIR, 'uploads');
const DAY = 86400e3;

/** Size of a file or folder (symlinks not followed). */
function du(p) {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) return 0;
    if (!st.isDirectory()) return st.size;
    let n = 0;
    for (const f of fs.readdirSync(p)) n += du(path.join(p, f));
    return n;
  } catch { return 0; }
}
const children = (dir) => { try { return fs.readdirSync(dir).map((f) => path.join(dir, f)); } catch { return []; } };
// chunked uploads nobody finished (the browser was closed mid-upload)
const staleUploads = () => children(UPLOAD_DIR).filter((p) => { try { return Date.now() - fs.statSync(p).mtimeMs > DAY; } catch { return false; } });

const EXTRAS = {
  frames: { label: 'Ảnh khung hình tạm (Claude chụp để xem lại timeline)', paths: () => children(path.join(CACHE_DIR, 'frames')) },
  uploads: { label: 'File tải lên dở dang (quá 1 ngày)', paths: staleUploads },
  trash: { label: 'Dự án đã xoá (thùng rác)', paths: () => children(TRASH_DIR) },
  parts: { label: 'Cảnh đã render sẵn (giúp lần render sau chỉ làm lại cảnh thay đổi)', paths: () => children(path.join(CACHE_DIR, 'render-parts')) },
};

/**
 * @param {(project: string, name: string, mtime: number) => boolean} isBusy  file used by a running job
 */
export function scan(isBusy = () => false) {
  const exports = [];
  for (const p of listProjects()) {
    const dir = path.join(PROJECTS_DIR, p.id, 'exports');
    for (const file of children(dir)) {
      const name = path.basename(file);
      if (!name.endsWith('.mp4')) continue;
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      const srt = file.replace(/\.mp4$/, '.srt');
      exports.push({
        project: p.id, projectName: p.name, name, mtime: st.mtimeMs,
        size: st.size + (fs.existsSync(srt) ? fs.statSync(srt).size : 0),
        url: `/api/projects/${encodeURIComponent(p.id)}/exports/${encodeURIComponent(name)}`,
        busy: isBusy(p.id, name, st.mtimeMs),
      });
    }
  }
  exports.sort((a, b) => b.mtime - a.mtime);
  const extras = Object.entries(EXTRAS).map(([key, x]) => {
    const paths = x.paths();
    return { key, label: x.label, count: paths.length, size: paths.reduce((n, p) => n + du(p), 0) };
  });
  let disk = null;
  try { const s = fs.statfsSync(PROJECTS_DIR); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { /* old node */ }
  return { disk, exports, extras };
}

/** Delete the chosen exports ({project, name}) and extra groups; returns bytes freed and what was skipped. */
export function remove({ exports = [], extras = [] } = {}, isBusy = () => false) {
  const ids = new Set(listProjects().map((p) => p.id));
  let freed = 0;
  const skipped = [];
  for (const e of exports) {
    const name = String(e?.name || '');
    if (!ids.has(e?.project) || name !== path.basename(name) || !name.endsWith('.mp4')) { skipped.push(`${name}: không hợp lệ`); continue; }
    const file = path.join(PROJECTS_DIR, e.project, 'exports', name);
    let st;
    try { st = fs.statSync(file); } catch { continue; } // already gone
    if (isBusy(e.project, name, st.mtimeMs)) { skipped.push(`${name}: đang được dùng`); continue; }
    for (const f of [file, file.replace(/\.mp4$/, '.srt')]) {
      const n = du(f);
      try { fs.rmSync(f, { force: true }); freed += n; } catch (err) { skipped.push(`${path.basename(f)}: ${err.message}`); }
    }
  }
  for (const key of extras) {
    const x = EXTRAS[key];
    if (!x) continue;
    for (const p of x.paths()) {
      const n = du(p);
      try { fs.rmSync(p, { recursive: true, force: true }); freed += n; } catch (err) { skipped.push(`${path.basename(p)}: ${err.message}`); }
    }
  }
  return { freed, skipped };
}
