// User templates made by cloning a reference video ("Clone video → template").
// Each one lives in workspace/templates/<id>/ and is shared by all projects:
//   template.json   catalogue entry (same shape as web/src/templates.ts Template + status/source/projectId)
//   reference/      the reference video (source.mp4)
//   analysis/       automatic evidence: analysis.json, overview.md, transcript.json, poster.jpg, shots/, timeline/
//   ANALYSIS.md     Claude: why the piece works, its visual / caption / sound systems
//   TIMELINE.md     Claude: time-located account of the reference (sections by source time + phase)
//   RECIPE.md       Claude: how to make a new video from this template (what stays, what changes, steps)
//   skeleton/       snapshot of the rebuilt project (project.json + media/) every new video starts from
import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE } from './store.mjs';

export const TEMPLATES_DIR = path.join(WORKSPACE, 'templates');
const TRASH = path.join(TEMPLATES_DIR, '.trash');
export const validTemplateId = (id) => /^[a-z0-9][a-z0-9-]{0,60}$/.test(String(id || ''));
export const templateDir = (id) => {
  if (!validTemplateId(id)) throw Object.assign(new Error('template id không hợp lệ'), { status: 400 });
  return path.join(TEMPLATES_DIR, id);
};

const FIELD_TYPES = new Set(['source', 'text', 'textarea', 'files', 'voice2']);
const SIZES = new Set(['1080x1920', '1920x1080', '1080x1080']);

function slug(name) {
  const s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return s || 'template';
}
function writeJson(file, obj) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}

export function readTemplate(id) {
  const f = path.join(templateDir(id), 'template.json');
  if (!fs.existsSync(f)) throw Object.assign(new Error(`Không có template "${id}"`), { status: 404 });
  return { ...JSON.parse(fs.readFileSync(f, 'utf8')), id };
}
export function writeTemplate(id, t) {
  fs.mkdirSync(templateDir(id), { recursive: true });
  writeJson(path.join(templateDir(id), 'template.json'), { ...t, id, updatedAt: Date.now() });
}
export function patchTemplate(id, patch) {
  const t = readTemplate(id);
  writeTemplate(id, { ...t, ...patch });
  return readTemplate(id);
}

/** Catalogue for the home screen: newest first, with URLs of the poster / reference video. */
export function listTemplates() {
  let dirs = [];
  try { dirs = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && validTemplateId(d.name)); } catch { return []; }
  const out = [];
  for (const d of dirs) {
    try {
      const t = readTemplate(d.name);
      const dir = templateDir(d.name);
      const has = (rel) => fs.existsSync(path.join(dir, rel));
      out.push({
        ...t,
        user: true,
        cat: 'mine',
        poster: has('analysis/poster.jpg') ? `/templates/${d.name}/analysis/poster.jpg` : null,
        refVideo: has('reference/source.mp4') ? `/templates/${d.name}/reference/source.mp4` : null,
        hasRecipe: has('RECIPE.md'),
        hasSkeleton: has('skeleton/project.json'),
        problems: t.status === 'ready' ? checkTemplate(d.name) : [],
      });
    } catch { /* half-written folder: skip */ }
  }
  return out.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
}

/** New template folder (status "analyzing") before the reference is analysed. */
export function createDraft({ name, source = {}, notes = '', lang = 'auto', projectId = null }) {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  const base = slug(name);
  let id = base;
  for (let i = 2; fs.existsSync(path.join(TEMPLATES_DIR, id)); i++) id = `${base}-${i}`;
  fs.mkdirSync(path.join(TEMPLATES_DIR, id, 'reference'), { recursive: true });
  writeTemplate(id, {
    name: String(name || 'Template mới').slice(0, 80),
    icon: '🧬',
    desc: 'Đang phân tích video mẫu…',
    status: 'analyzing',
    sizes: [], voice: true, fields: [],
    source, notes: String(notes || '').slice(0, 2000), lang, projectId,
    createdAt: Date.now(),
  });
  return id;
}

/** Hard-link (or copy) the reference video into the template folder. */
export function storeReference(id, file) {
  const dst = path.join(templateDir(id), 'reference', 'source.mp4');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.rmSync(dst, { force: true });
  try { fs.linkSync(file, dst); } catch { fs.copyFileSync(file, dst); }
  return dst;
}

export function removeTemplate(id) {
  const dir = templateDir(id);
  if (!fs.existsSync(dir)) throw Object.assign(new Error('Không có template này'), { status: 404 });
  fs.mkdirSync(TRASH, { recursive: true });
  fs.renameSync(dir, path.join(TRASH, `${id}-${Date.now()}`));
}

/** Problems that keep a template from being usable from the home screen (empty list = OK). */
export function checkTemplate(id) {
  const problems = [];
  let t;
  try { t = readTemplate(id); } catch (e) { return [e.message]; }
  const dir = templateDir(id);
  if (!t.name) problems.push('thiếu name');
  if (!t.desc || /Đang phân tích|đang dựng template/i.test(t.desc)) problems.push('thiếu desc (mô tả ngắn cho thẻ template)');
  if (!Array.isArray(t.sizes) || !t.sizes.length) problems.push('sizes trống (vd ["1080x1920"])');
  for (const s of t.sizes || []) if (!SIZES.has(s)) problems.push(`size không hỗ trợ: ${s}`);
  if (!Array.isArray(t.fields)) problems.push('fields phải là mảng');
  const keys = new Set();
  for (const f of t.fields || []) {
    if (!f || !f.k || !FIELD_TYPES.has(f.type)) { problems.push(`field không hợp lệ: ${JSON.stringify(f)}`); continue; }
    if (keys.has(f.k)) problems.push(`field trùng k: ${f.k}`);
    keys.add(f.k);
    if (!f.label) problems.push(`field ${f.k}: thiếu label`);
    if (f.type === 'source' && (!Array.isArray(f.modes) || !f.modes.length || f.modes.some((m) => !['link', 'text', 'topic'].includes(m)))) problems.push(`field ${f.k}: modes phải gồm link/text/topic`);
    if (f.type === 'files' && !f.accept) problems.push(`field ${f.k}: thiếu accept (vd "image/*,video/*")`);
  }
  if (t.length && (!Array.isArray(t.length) || t.length.some((x) => !Array.isArray(x) || x.length !== 2))) problems.push('length phải là [[key, label], …]');
  if (!fs.existsSync(path.join(dir, 'RECIPE.md'))) problems.push('thiếu RECIPE.md');
  if (!fs.existsSync(path.join(dir, 'ANALYSIS.md'))) problems.push('thiếu ANALYSIS.md');
  return problems;
}

/** Media files a project actually uses: asset files referenced by clips / logo / component props. */
function usedAssets(project) {
  const text = JSON.stringify({ tracks: project.tracks, logo: project.logo, subtitles: project.subtitles?.style });
  return (project.assets || []).filter((a) => text.includes(`"${a.id}"`) || text.includes(`/${a.path}`) || text.includes(`"${a.path}"`));
}

/**
 * Save a project (normally the rebuilt clone) as the template's skeleton: project.json with only the assets it
 * uses + those media files. "Dùng template" copies the skeleton into a new project for the next video.
 */
export function saveSkeleton(id, projectFile, mediaDir) {
  const dir = templateDir(id);
  if (!fs.existsSync(dir)) throw Object.assign(new Error(`Không có template "${id}"`), { status: 404 });
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  const assets = usedAssets(project);
  const sk = path.join(dir, 'skeleton');
  const tmp = `${sk}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'media'), { recursive: true });
  let bytes = 0;
  for (const a of assets) {
    const src = path.join(path.dirname(mediaDir), a.path);
    const dst = path.join(tmp, a.path);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); }
    bytes += fs.statSync(dst).size;
  }
  const { demo, demoPoster, fromDemo, ...rest } = project;
  writeJson(path.join(tmp, 'project.json'), { ...rest, assets, fromTemplate: id });
  fs.rmSync(sk, { recursive: true, force: true });
  fs.renameSync(tmp, sk);
  return { assets: assets.length, bytes, dropped: (project.assets || []).length - assets.length };
}
