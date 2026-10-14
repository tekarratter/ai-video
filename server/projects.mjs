// Multiple projects. Each lives in workspace/projects/<id>/ { project.json, media/, exports/ }.
// The OPEN project is what everything else (Claude, vedit, renderer) sees at the usual paths:
//   workspace/media   → symlink to projects/<id>/media
//   workspace/exports → symlink to projects/<id>/exports
//   workspace/project.json  working copy (a real file, so atomic writes by any tool keep working),
//                           mirrored back to projects/<id>/project.json on every change.
// Motion components (workspace/custom) and the cache are shared by all projects.
import fs from 'node:fs';
import path from 'node:path';
import { EXPORT_DIR, MEDIA_DIR, PROJECT_FILE, WORKSPACE } from '../shared/store.mjs';
import { emptyProject, normalizeProject, projectDuration } from '../shared/timeline.js';

export const PROJECTS_DIR = path.join(WORKSPACE, 'projects');
const ACTIVE_FILE = path.join(PROJECTS_DIR, 'active.json');
const TRASH_DIR = path.join(PROJECTS_DIR, '.trash');

const dirOf = (id) => path.join(PROJECTS_DIR, id);
const validId = (id) => /^[a-z0-9][a-z0-9-]{0,60}$/.test(String(id || ''));

function slug(name) {
  const s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return s || 'project';
}
function uniqueId(name) {
  const base = slug(name);
  let id = base;
  for (let i = 2; fs.existsSync(dirOf(id)); i++) id = `${base}-${i}`;
  return id;
}

export function activeId() {
  try { return JSON.parse(fs.readFileSync(ACTIVE_FILE, 'utf8')).id; } catch { return null; }
}
function setActive(id) {
  fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ id, openedAt: Date.now() }));
}

/** Point workspace/<name> at target atomically (tmp symlink + rename). */
function relink(linkPath, target) {
  const tmp = `${linkPath}.lnk-${process.pid}`;
  fs.rmSync(tmp, { force: true });
  fs.symlinkSync(path.relative(path.dirname(linkPath), target), tmp);
  fs.renameSync(tmp, linkPath);
}

const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

/** Copy the working project.json into the open project's folder. */
export function mirror() {
  const id = activeId();
  if (!id || !fs.existsSync(PROJECT_FILE)) return;
  const dst = path.join(dirOf(id), 'project.json');
  fs.copyFileSync(PROJECT_FILE, `${dst}.tmp`);
  fs.renameSync(`${dst}.tmp`, dst);
}

function writeJson(file, obj) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(normalizeProject(obj), null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}

/** First start with this feature: move the existing single project into projects/<id>. */
export function init() {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const id = activeId();
  if (id && fs.existsSync(dirOf(id)) && isLink(MEDIA_DIR) && isLink(EXPORT_DIR)) return;

  let project;
  try { project = JSON.parse(fs.readFileSync(PROJECT_FILE, 'utf8')); } catch { project = emptyProject('Dự án đầu tiên'); }
  const newId = id && fs.existsSync(dirOf(id)) ? id : uniqueId(project.name);
  const dir = dirOf(newId);
  fs.mkdirSync(dir, { recursive: true });
  for (const [link, name] of [[MEDIA_DIR, 'media'], [EXPORT_DIR, 'exports']]) {
    const target = path.join(dir, name);
    if (fs.existsSync(link) && !isLink(link)) {
      if (fs.existsSync(target)) throw new Error(`${target} đã tồn tại, không thể chuyển ${link}`);
      fs.renameSync(link, target); // same filesystem → instant
    }
    fs.mkdirSync(target, { recursive: true });
    relink(link, target);
  }
  if (!fs.existsSync(path.join(dir, 'project.json'))) writeJson(path.join(dir, 'project.json'), project);
  if (!fs.existsSync(PROJECT_FILE)) fs.copyFileSync(path.join(dir, 'project.json'), PROJECT_FILE);
  setActive(newId);
  console.log(`[projects] project đang mở: ${newId}`);
}

export function list() {
  const active = activeId();
  const out = [];
  for (const id of fs.readdirSync(PROJECTS_DIR)) {
    if (!validId(id)) continue;
    const file = id === active ? PROJECT_FILE : path.join(dirOf(id), 'project.json');
    let p;
    try { p = normalizeProject(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { continue; }
    const st = fs.statSync(file);
    const firstVisual = p.assets.find((a) => a.type !== 'audio');
    let exportsCount = 0;
    try { exportsCount = fs.readdirSync(path.join(dirOf(id), 'exports')).filter((f) => f.endsWith('.mp4')).length; } catch { /* none */ }
    out.push({
      id, name: p.name, width: p.settings.width, height: p.settings.height, fps: p.settings.fps,
      duration: projectDuration(p), assets: p.assets.length, exports: exportsCount,
      thumb: firstVisual ? `/cache/thumbs/${firstVisual.id}.jpg` : null,
      updatedAt: st.mtimeMs, createdAt: p.createdAt || st.birthtimeMs || st.mtimeMs, active: id === active,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function create({ name = 'Dự án mới', width = 1920, height = 1080, fps = 30 } = {}) {
  const id = uniqueId(name);
  const dir = dirOf(id);
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'exports'), { recursive: true });
  const p = emptyProject(String(name).slice(0, 120));
  Object.assign(p.settings, { width: Number(width) || 1920, height: Number(height) || 1080, fps: Number(fps) || 30 });
  p.createdAt = Date.now();
  writeJson(path.join(dir, 'project.json'), p);
  return id;
}

/** Switch the open project. Caller must make sure no job is using the current one. */
export function open(id) {
  if (!validId(id) || !fs.existsSync(path.join(dirOf(id), 'project.json'))) throw new Error('Không tìm thấy project');
  if (id === activeId()) return;
  mirror();
  const dir = dirOf(id);
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'exports'), { recursive: true });
  setActive(id);
  relink(MEDIA_DIR, path.join(dir, 'media'));
  relink(EXPORT_DIR, path.join(dir, 'exports'));
  fs.copyFileSync(path.join(dir, 'project.json'), `${PROJECT_FILE}.open.tmp`);
  fs.renameSync(`${PROJECT_FILE}.open.tmp`, PROJECT_FILE);
}

export function rename(id, name) {
  if (!validId(id)) throw new Error('id không hợp lệ');
  const file = id === activeId() ? PROJECT_FILE : path.join(dirOf(id), 'project.json');
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  p.name = String(name || '').trim().slice(0, 120) || p.name;
  writeJson(file, p);
  if (id === activeId()) mirror();
}

/** Copy a project (media included, exports not). */
export function duplicate(id) {
  if (!validId(id) || !fs.existsSync(dirOf(id))) throw new Error('Không tìm thấy project');
  if (id === activeId()) mirror();
  const src = JSON.parse(fs.readFileSync(path.join(dirOf(id), 'project.json'), 'utf8'));
  const name = `${src.name} (bản sao)`;
  const nid = uniqueId(name);
  fs.cpSync(path.join(dirOf(id), 'media'), path.join(dirOf(nid), 'media'), { recursive: true });
  fs.mkdirSync(path.join(dirOf(nid), 'exports'), { recursive: true });
  writeJson(path.join(dirOf(nid), 'project.json'), { ...src, name, createdAt: Date.now() });
  return nid;
}

/** Move to projects/.trash (recoverable by hand). */
export function remove(id) {
  if (!validId(id) || !fs.existsSync(dirOf(id))) throw new Error('Không tìm thấy project');
  if (id === activeId()) throw new Error('Không xoá được project đang mở — hãy mở project khác trước');
  fs.mkdirSync(TRASH_DIR, { recursive: true });
  fs.renameSync(dirOf(id), path.join(TRASH_DIR, `${id}-${Date.now()}`));
}
