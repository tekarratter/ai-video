// MCP server for the AI video editor: lets Claude (Claude Code, Claude Desktop, claude.ai, any MCP client)
// drive the app — projects, media, documents, voice-over, previews, renders, and the in-app editing Claude.
// Used two ways:
//   • over HTTP inside the app server: POST /mcp (Authorization: Bearer <token>) or /mcp/t/<token>
//     (tokens: account menu → "Kết nối Claude (MCP)"), see mountMcp();
//   • over stdio on the same machine: node mcp/stdio.mjs.
// Tools call the app's own HTTP API on localhost (trusted local tool) and the `vedit` CLI, so the
// editor UI updates live exactly as when the user or the in-app Claude edits.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { CACHE_DIR, ROOT, WORKSPACE } from '../shared/store.mjs';

const exec = promisify(execFile);
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const DOC_RE = /\.(pdf|docx|doc|odt|rtf|pptx|ppt|odp|txt|md)$/i;
const MAX_TEXT = 80_000;
// keep each call under client timeouts (MCP clients give up after 60 s by default; Cloudflare after ~100 s)
const MAX_WAIT = 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n)}\n… (cắt bớt ${s.length - n} ký tự)` : s);
const text = (s) => ({ content: [{ type: 'text', text: clip(String(s)) }] });
const json = (o) => text(JSON.stringify(o, null, 1));
const fail = (msg) => ({ content: [{ type: 'text', text: `Lỗi: ${msg}` }], isError: true });
const tool = (fn) => async (args) => { try { return await fn(args || {}); } catch (e) { return fail(e.message || String(e)); } };

/* ---------------- tokens (HTTP access) ---------------- */

const CONF_DIR = path.join(os.homedir(), '.config', 'ai-video');
const TOKENS = path.join(CONF_DIR, 'mcp.json');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function loadTokens() {
  let d;
  try { d = JSON.parse(fs.readFileSync(TOKENS, 'utf8')); } catch { d = {}; }
  d.tokens ||= [];
  d.secret ||= crypto.randomBytes(32).toString('hex'); // signs download links
  return d;
}
let store = loadTokens();
function saveTokens() {
  fs.mkdirSync(CONF_DIR, { recursive: true });
  fs.writeFileSync(`${TOKENS}.tmp`, JSON.stringify(store, null, 1), { mode: 0o600 });
  fs.renameSync(`${TOKENS}.tmp`, TOKENS);
}
const publicToken = ({ hash, ...t }) => t; // eslint-disable-line no-unused-vars

export function listTokens() { return store.tokens.map(publicToken); }
export function createToken(username, name) {
  const raw = `aivmcp_${crypto.randomBytes(24).toString('base64url')}`;
  const t = { id: crypto.randomBytes(5).toString('hex'), name: String(name || 'Claude').slice(0, 60), username, hash: sha(raw), createdAt: Date.now(), lastUsedAt: null };
  store.tokens.push(t);
  saveTokens();
  return { ...publicToken(t), token: raw };
}
export function revokeToken(id) {
  const n = store.tokens.length;
  store.tokens = store.tokens.filter((t) => t.id !== id);
  if (store.tokens.length !== n) saveTokens();
  return n !== store.tokens.length;
}
function checkToken(raw) {
  if (!raw || !/^aivmcp_/.test(raw)) return null;
  const h = sha(raw);
  const t = store.tokens.find((x) => x.hash.length === h.length && crypto.timingSafeEqual(Buffer.from(x.hash), Buffer.from(h)));
  if (t && (!t.lastUsedAt || Date.now() - t.lastUsedAt > 60_000)) { t.lastUsedAt = Date.now(); saveTokens(); }
  return t || null;
}

/** Signed, expiring download link for a file in the workspace (exports, media). */
const sign = (rel, exp) => crypto.createHmac('sha256', store.secret).update(`${rel}|${exp}`).digest('base64url').slice(0, 32);

/* ---------------- the MCP server ---------------- */

/**
 * @param {object} o
 * @param {string} o.base     app API base, e.g. http://127.0.0.1:3001
 * @param {(rel: string) => string} o.fileLink  how to hand a workspace file to the client (URL or local path)
 */
export function createMcpServer({ base, fileLink }) {
  const api = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .catch(() => { throw new Error(`không kết nối được app tại ${base} (server đang chạy chưa?)`); });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = t; }
    if (!r.ok) throw new Error(j?.error || `${method} ${url}: HTTP ${r.status}`);
    return j;
  };
  const vedit = async (args, { timeout = 55_000 } = {}) => {
    try {
      const { stdout, stderr } = await exec(process.execPath, [path.join(ROOT, 'tools', 'vedit.mjs'), ...args], {
        cwd: WORKSPACE, timeout, maxBuffer: 1 << 26, env: { ...process.env, AI_VIDEO_SERVER: base, AI_VIDEO_WORKSPACE: WORKSPACE },
      });
      return (stdout + (stderr ? `\n${stderr}` : '')).trim();
    } catch (e) {
      if (e.killed) throw new Error(`vedit ${args[0]} chạy quá ${timeout / 1000} giây`);
      throw new Error(((e.stderr || '') + (e.stdout || '')).trim() || e.message);
    }
  };
  /** Poll a job until it ends or `wait` seconds pass. */
  const waitJob = async (id, wait) => {
    const t0 = Date.now();
    for (;;) {
      const j = await api('GET', `/api/jobs/${id}`);
      if (['done', 'error'].includes(j.stage) || Date.now() - t0 > wait * 1000) return j;
      await sleep(1000);
    }
  };
  const jobView = (j) => {
    const v = { id: j.id, type: j.type, label: j.label, stage: j.stage, progress: Math.round((j.progress || 0) * 100) + '%' };
    if (j.eta) v.eta_seconds = j.eta;
    if (j.error) v.error = j.error;
    if (j.file) v.file = j.file;
    if (j.file && /\.mp4$/.test(j.file)) v.download = fileLink(j.file);
    if (j.paths) v.paths = j.paths;
    if (j.assetId) v.assetId = j.assetId;
    if (!['done', 'error'].includes(j.stage)) v.hint = 'Chưa xong — gọi job_status với wait_seconds để chờ tiếp.';
    return v;
  };
  const chat = () => api('GET', '/api/chat');
  /** Editor (in-app Claude) messages after the last user message. */
  const replySince = (items) => {
    let i = items.length - 1;
    while (i >= 0 && items[i].type !== 'user') i--;
    const after = items.slice(i + 1);
    return {
      replies: after.filter((x) => x.type === 'assistant').map((x) => x.text),
      tools_used: after.filter((x) => x.type === 'tool').length,
    };
  };
  const waitEditor = async (wait, { sentAt } = {}) => {
    const t0 = Date.now();
    let idleSince = 0;
    for (;;) {
      const c = await chat();
      const lastUser = [...c.items].reverse().find((x) => x.type === 'user');
      const arrived = !sentAt || (lastUser && Date.parse(lastUser.ts) >= sentAt - 5000);
      if (c.status.prompt) return { ...c, waiting: 'prompt' };
      if (arrived && !c.status.busy) { if (!idleSince) idleSince = Date.now(); if (Date.now() - idleSince > 2500) return { ...c, waiting: null }; } else idleSince = 0;
      if (Date.now() - t0 > wait * 1000) return { ...c, waiting: arrived ? 'busy' : 'not-arrived' };
      await sleep(1200);
    }
  };
  const editorResult = (c) => {
    const r = replySince(c.items);
    const out = { status: c.waiting === 'prompt' ? 'waiting_for_choice' : c.waiting === 'busy' ? 'working' : c.waiting === 'not-arrived' ? 'not_delivered' : 'done', ...r };
    if (c.status.prompt) out.prompt = c.status.prompt;
    if (out.status === 'working') out.hint = 'Claude trong app vẫn đang làm — gọi editor_reply để chờ tiếp (mỗi lần tối đa ~50 giây).';
    if (out.status === 'waiting_for_choice') out.hint = 'Claude trong app đang hỏi xác nhận trong terminal — gọi editor_choose với số thứ tự lựa chọn.';
    if (out.status === 'not_delivered') out.hint = 'Tin chưa tới Claude trong app (đang khởi động?) — thử lại sau vài giây.';
    return out;
  };
  const sendEditor = async (message) => {
    const c = await chat();
    if (c.status.prompt) throw new Error('Claude trong app đang chờ chọn trong một hộp hỏi — xem editor_reply (prompt) rồi dùng editor_choose');
    if (c.status.busy) throw new Error('Claude trong app đang làm việc khác — gọi editor_reply để chờ, rồi gửi lại');
    const sentAt = Date.now();
    await api('POST', '/api/chat/send', { text: message });
    return sentAt;
  };
  /** Write a document into the open project's media/docs (same as an upload from the UI). */
  const saveDoc = (name, buf) => {
    const dir = path.join(WORKSPACE, 'media', 'docs');
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(name).toLowerCase();
    const stem = path.basename(name, path.extname(name)).normalize('NFC').replace(/[/\\:*?"<>|\x00-\x1f]+/g, '_').trim() || 'tai-lieu';
    let dest = path.join(dir, stem + ext);
    for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `${stem}-${i}${ext}`);
    fs.writeFileSync(dest, buf);
    return path.relative(WORKSPACE, dest).split(path.sep).join('/');
  };
  /** Upload bytes through the app's chunked upload (images, video, audio → assets; documents → media/docs). */
  const uploadBytes = async (name, buf) => {
    const id = `up_mcp_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    for (let off = 0; off < buf.length || (buf.length === 0 && off === 0); off += 8 << 20) {
      const r = await fetch(`${base}/api/upload/part/${id}?offset=${off}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: buf.subarray(off, off + (8 << 20)) });
      if (!r.ok) throw new Error(`tải lên lỗi HTTP ${r.status}`);
      if (!buf.length) break;
    }
    const f = await api('POST', '/api/upload/finish', { files: [{ id, name, size: buf.length }] });
    return waitJob(f.job.id, MAX_WAIT);
  };
  /**
   * Download a document from a link (direct file, or a Google Drive share link). The type comes from the response
   * (arXiv & co. serve PDFs without a .pdf in the URL). `strict: false` → null when the link is not a document.
   */
  const fetchDoc = async (url, { strict = true } = {}) => {
    const drive = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]{20,})/);
    const u = drive ? `https://drive.google.com/uc?export=download&id=${drive[1]}` : url;
    const ac = new AbortController();
    const r = await fetch(u, { redirect: 'follow', signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0 (ai-video MCP)' } });
    const type = r.headers.get('content-type') || '';
    let name = decodeURIComponent((r.headers.get('content-disposition') || '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] || path.basename(new URL(r.url || url).pathname) || 'tai-lieu');
    if (!DOC_RE.test(name)) name += /pdf/.test(type) ? '.pdf' : /wordprocessingml/.test(type) ? '.docx' : '';
    const isDoc = r.ok && !/text\/html/.test(type) && DOC_RE.test(name);
    if (!isDoc) {
      ac.abort();
      if (!strict) return null;
      if (!r.ok) throw new Error(`tải tài liệu lỗi HTTP ${r.status}`);
      if (/text\/html/.test(type)) throw new Error('link trả về trang web, không phải file (Google Drive: bật "Bất kỳ ai có đường liên kết"; file lớn: tải về rồi tải lên app)');
      throw new Error('không nhận ra loại file (cần .pdf, .docx, .txt, .md)');
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 200 << 20) throw new Error('file quá lớn (> 200 MB)');
    return saveDoc(name, buf);
  };

  const server = new McpServer({ name: 'ai-video', title: 'AI Video Studio', version: VERSION }, {
    instructions: `AI Video Studio — trình dựng video (Remotion) có Claude dựng phim bên trong ("editor").
Hai cách làm:
1. Giao việc cho editor (khuyên dùng): make_video (từ tài liệu Word/PDF, link bài viết, văn bản hoặc chủ đề) hoặc
   ask_editor (mọi yêu cầu sửa video bằng lời). Việc dài: gọi editor_reply để chờ tiếp, preview_frame để xem kết quả.
2. Tự dựng: project_summary / get_project_json / save_project_json, upload_file, import_url, read_document,
   read_article, add_voiceover, search_music/add_music, preview_frame.
Render: render_video → job_status (chờ tối đa ~50 giây mỗi lần) → link tải trong kết quả. Mọi thay đổi hiện ngay
trong editor của người dùng; chỉ render khi người dùng yêu cầu. Người dùng đọc tiếng Việt.`,
  });
  const RO = { readOnlyHint: true, openWorldHint: false };

  server.registerTool('app_status', {
    title: 'Trạng thái app', annotations: RO,
    description: 'Tổng quan: dự án đang mở, các tác vụ đang chạy (render, giọng đọc…), trạng thái Claude trong app.',
  }, tool(async () => {
    const [p, jobs, c] = await Promise.all([api('GET', '/api/projects'), api('GET', '/api/jobs'), chat()]);
    const active = p.projects.find((x) => x.id === p.active);
    return json({
      open_project: active ? { id: active.id, name: active.name, size: `${active.width}x${active.height}`, duration: active.duration } : null,
      projects: p.projects.length,
      running_jobs: jobs.filter((j) => !['done', 'error'].includes(j.stage)).map(jobView),
      editor: { running: c.status.running, busy: c.status.busy, waiting_for_choice: !!c.status.prompt },
    });
  }));

  server.registerTool('list_projects', {
    title: 'Danh sách dự án', annotations: RO, description: 'Các dự án video (id, tên, khung hình, độ dài, lần sửa cuối).',
  }, tool(async () => {
    const p = await api('GET', '/api/projects');
    return json(p.projects.map((x) => ({ id: x.id, name: x.name, size: `${x.width}x${x.height}`, duration: Math.round(x.duration || 0), updated: x.updatedAt ? new Date(x.updatedAt).toISOString() : null, open: x.id === p.active })));
  }));

  server.registerTool('open_project', {
    title: 'Mở dự án', description: 'Mở một dự án (editor của người dùng chuyển theo). Không được khi đang có tác vụ chạy.',
    inputSchema: { id: z.string().describe('id từ list_projects') },
  }, tool(async ({ id }) => { const r = await api('POST', `/api/projects/${encodeURIComponent(id)}/open`); return json({ open: r.active }); }));

  server.registerTool('create_project', {
    title: 'Tạo dự án', description: 'Tạo dự án trống và mở nó.',
    inputSchema: {
      name: z.string().describe('Tên dự án'),
      size: z.enum(['1920x1080', '1080x1920', '1080x1080']).default('1920x1080').describe('Ngang 16:9, dọc 9:16 hoặc vuông'),
    },
  }, tool(async ({ name, size }) => {
    const [width, height] = size.split('x').map(Number);
    const r = await api('POST', '/api/projects', { name, width, height, fps: 30 });
    return json({ open: r.active, name, size });
  }));

  server.registerTool('project_summary', {
    title: 'Tóm tắt dự án', annotations: RO,
    description: 'Dự án đang mở: asset (id, loại, độ dài), các track và clip theo thời gian, phụ đề.',
  }, tool(async () => text(await vedit(['info']))));

  server.registerTool('get_project_json', {
    title: 'Đọc project.json', annotations: RO,
    description: 'Toàn bộ project.json của dự án đang mở (schema: xem tài nguyên trong CLAUDE.md của workspace — thời gian tính bằng giây).',
  }, tool(async () => json(await api('GET', '/api/project'))));

  server.registerTool('save_project_json', {
    title: 'Ghi project.json', annotations: { destructiveHint: true },
    description: 'Thay toàn bộ project.json của dự án đang mở (đọc bằng get_project_json, sửa, ghi lại). Giữ nguyên id. Kết quả kèm kiểm tra hợp lệ.',
    inputSchema: { project: z.record(z.string(), z.any()).describe('Đối tượng project đầy đủ') },
  }, tool(async ({ project }) => {
    if (!project.settings || !Array.isArray(project.tracks) || !Array.isArray(project.assets)) throw new Error('project thiếu settings / tracks / assets');
    await api('PUT', '/api/project', project);
    return text(`Đã lưu.\n${await vedit(['validate']).catch((e) => e.message)}`);
  }));

  server.registerTool('upload_file', {
    title: 'Tải file lên',
    description: 'Đưa một file (ảnh, video, nhạc, hoặc tài liệu Word/PDF/txt) vào dự án đang mở. Media thành asset; tài liệu vào media/docs/ để dùng với read_document / make_video. Tối đa ~40 MB (base64). File lớn hơn: người dùng tải lên trong app (tab Assets) hoặc gửi link cho import_url.',
    inputSchema: { name: z.string().describe('Tên file kèm đuôi, vd bao-cao.pdf'), content_base64: z.string().describe('Nội dung file mã hoá base64') },
  }, tool(async ({ name, content_base64 }) => {
    const buf = Buffer.from(content_base64, 'base64');
    if (!buf.length) throw new Error('file rỗng');
    if (buf.length > 40 << 20) throw new Error('file quá 40 MB — hãy tải lên trong app hoặc dùng import_url');
    const j = await uploadBytes(path.basename(name), buf);
    if (j.stage === 'error') throw new Error(j.error);
    return json(jobView(j));
  }));

  server.registerTool('import_url', {
    title: 'Nhập từ link',
    description: 'Nhập media từ link (YouTube, Vimeo, TikTok, link ảnh/video trực tiếp) thành asset; hoặc tải tài liệu (link PDF/DOCX, link chia sẻ Google Drive) vào media/docs/.',
    inputSchema: { url: z.string().url(), section: z.string().optional().describe('Chỉ tải đoạn video, vd "10-40" (giây)') },
  }, tool(async ({ url, section }) => {
    // documents (PDF/DOCX…, also without an extension in the URL) → media/docs; everything else → media import
    if (!/(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|facebook\.com|instagram\.com)\//.test(url)) {
      const doc = await fetchDoc(url, { strict: DOC_RE.test(new URL(url).pathname) }).catch((e) => { if (DOC_RE.test(new URL(url).pathname)) throw e; return null; });
      if (doc) return json({ document: doc, hint: 'Dùng read_document hoặc make_video với document_path này.' });
    }
    const r = await api('POST', '/api/import-url', { url, section });
    return json(jobView(await waitJob(r.job.id, MAX_WAIT)));
  }));

  server.registerTool('read_document', {
    title: 'Đọc tài liệu', annotations: RO,
    description: 'Đọc tài liệu Word/PDF/txt trong media/docs/: tiêu đề, đề mục, nội dung, bảng, vị trí hình [IMG #n], [PAGE n]. Không có path: liệt kê tài liệu. import_images thêm hình của tài liệu thành asset; page_sheet trả ảnh thu nhỏ các trang để xem bố cục.',
    inputSchema: {
      path: z.string().optional().describe('vd media/docs/bao-cao.pdf'),
      import_images: z.string().optional().describe('"all" hoặc "1,3,5"'),
      page_images: z.string().optional().describe('Trang cần lấy làm ảnh (asset), vd "3" hoặc "2-4" — dùng cho cảnh DocZoom'),
      page_sheet: z.boolean().optional().describe('Kèm ảnh thu nhỏ các trang (PDF)'),
    },
  }, tool(async ({ path: p, import_images, page_images, page_sheet }) => {
    if (!p) return text(await vedit(['doc']));
    const args = ['doc', p];
    if (import_images) args.push('--import', import_images);
    if (page_images) args.push('--pages', page_images);
    if (page_sheet) args.push('--sheet');
    const out = await vedit(args, { timeout: 55_000 });
    const content = [{ type: 'text', text: clip(out) }];
    if (page_sheet) {
      for (const f of [...out.matchAll(/: (\S+pages-\d+\.jpg)/g)].map((m) => m[1]).slice(0, 2)) {
        if (fs.existsSync(f)) content.push({ type: 'image', data: fs.readFileSync(f).toString('base64'), mimeType: 'image/jpeg' });
      }
    }
    return { content };
  }));

  server.registerTool('read_article', {
    title: 'Đọc bài viết', annotations: { readOnlyHint: true, openWorldHint: true },
    description: 'Đọc bài báo/blog/diễn đàn từ link: tiêu đề, nội dung, ảnh theo thứ tự. import_images thêm ảnh trong bài thành asset.',
    inputSchema: { url: z.string().url(), import_images: z.boolean().optional() },
  }, tool(async ({ url, import_images }) => text(await vedit(['article', url, ...(import_images ? ['--import'] : [])], { timeout: 55_000 }))));

  server.registerTool('list_voices', {
    title: 'Giọng đọc AI', annotations: RO, description: 'Danh sách giọng đọc (id dạng "vi:Mai Anh", "en:af_heart").',
    inputSchema: { lang: z.enum(['vi', 'en']).optional() },
  }, tool(async ({ lang }) => text(await vedit(['voices', ...(lang ? ['--lang', lang] : [])]))));

  server.registerTool('add_voiceover', {
    title: 'Thêm giọng đọc',
    description: 'Đọc một đoạn bằng giọng AI và đặt lên track "voice" tại giây `start`. Mỗi lần gọi một câu/cảnh (~10–20 giây xử lý). Trả về độ dài để xếp clip.',
    inputSchema: {
      text: z.string(), voice: z.string().default('vi:Mai Anh'), start: z.number().min(0).describe('Giây trên timeline'),
      speed: z.number().min(0.7).max(1.5).default(1),
    },
  }, tool(async ({ text: t, voice, start, speed }) => {
    const r = await api('POST', '/api/tts', { text: t, voice, start, speed });
    return json(jobView(await waitJob(r.job.id, MAX_WAIT)));
  }));

  server.registerTool('search_music', {
    title: 'Tìm nhạc nền', annotations: RO, description: 'Tìm nhạc nền (Incompetech CC BY + thư viện riêng) theo từ khoá tiếng Anh, vd "calm corporate".',
    inputSchema: { query: z.string() },
  }, tool(async ({ query }) => text(await vedit(['music', 'search', ...query.split(/\s+/).filter(Boolean)]))));

  server.registerTool('add_music', {
    title: 'Thêm nhạc nền', description: 'Đặt bản nhạc (trackId từ search_music) lên track nhạc, cắt vừa video, có fade.',
    inputSchema: { track_id: z.string(), volume: z.number().min(0).max(1).default(0.2) },
  }, tool(async ({ track_id, volume }) => text(await vedit(['music', 'add', track_id, '--volume', String(volume)], { timeout: 55_000 }))));

  server.registerTool('preview_frame', {
    title: 'Xem khung hình', annotations: RO,
    description: 'Render khung hình tại giây `time` của dự án đang mở (đúng như video xuất ra) và trả về ảnh để xem.',
    inputSchema: { time: z.number().min(0) },
  }, tool(async ({ time }) => {
    const out = path.join(CACHE_DIR, 'frames', `mcp_${Date.now()}.png`);
    const r = await api('POST', '/api/still', { time, out });
    const jpg = r.file.replace(/\.png$/, '.jpg');
    await exec('ffmpeg', ['-v', 'error', '-y', '-i', r.file, '-vf', "scale='min(1280,iw)':-2", '-q:v', '4', jpg]);
    const data = fs.readFileSync(jpg).toString('base64');
    fs.rmSync(r.file, { force: true }); fs.rmSync(jpg, { force: true });
    return { content: [{ type: 'image', data, mimeType: 'image/jpeg' }, { type: 'text', text: `Khung hình tại ${time}s` }] };
  }));

  server.registerTool('render_video', {
    title: 'Xuất video', annotations: { openWorldHint: false },
    description: 'Xuất MP4 dự án đang mở (chạy nền, có thể mất nhiều phút). Chỉ khi người dùng yêu cầu. Theo dõi bằng job_status.',
    inputSchema: { quality: z.enum(['final', 'draft']).default('final').describe('draft = nhanh, chất lượng thấp để duyệt') },
  }, tool(async ({ quality }) => {
    const r = await api('POST', '/api/render', quality === 'draft' ? { quality: 'draft' } : { continuous: true });
    return json(jobView(r.job || r));
  }));

  server.registerTool('job_status', {
    title: 'Theo dõi tác vụ', annotations: RO,
    description: 'Tiến độ một tác vụ (render, tải lên, giọng đọc…), có thể chờ tới `wait_seconds` (tối đa 50). Render xong có link tải video.',
    inputSchema: { job_id: z.string(), wait_seconds: z.number().min(0).max(MAX_WAIT).default(0) },
  }, tool(async ({ job_id, wait_seconds }) => json(jobView(await waitJob(job_id, wait_seconds)))));

  server.registerTool('list_exports', {
    title: 'Video đã xuất', annotations: RO, description: 'Các video MP4 đã xuất của dự án đang mở, kèm link tải.',
  }, tool(async () => {
    const l = await api('GET', '/api/exports');
    return json(l.map((f) => ({ name: f.name, size_mb: +(f.size / 1e6).toFixed(1), duration: f.duration, created: new Date(f.mtime).toISOString(), download: fileLink(`exports/${f.name}`) })));
  }));

  server.registerTool('ask_editor', {
    title: 'Nhờ Claude trong app',
    description: 'Gửi yêu cầu bằng lời cho Claude dựng phim trong app (nó tự đọc/sửa project, dùng mọi công cụ). Chờ tới `wait_seconds` rồi trả lời; việc dài thì gọi editor_reply để chờ tiếp. Người dùng thấy cuộc trò chuyện trong khung chat của app.',
    inputSchema: { message: z.string(), wait_seconds: z.number().min(0).max(MAX_WAIT).default(45) },
  }, tool(async ({ message, wait_seconds }) => {
    const sentAt = await sendEditor(message);
    return json(editorResult(await waitEditor(wait_seconds, { sentAt })));
  }));

  server.registerTool('editor_reply', {
    title: 'Chờ Claude trong app', annotations: RO,
    description: 'Chờ Claude trong app làm xong (tối đa `wait_seconds`) và lấy câu trả lời mới nhất.',
    inputSchema: { wait_seconds: z.number().min(0).max(MAX_WAIT).default(MAX_WAIT) },
  }, tool(async ({ wait_seconds }) => json(editorResult(await waitEditor(wait_seconds)))));

  server.registerTool('editor_choose', {
    title: 'Chọn trong hộp hỏi của Claude trong app',
    description: 'Khi editor_reply báo waiting_for_choice: chọn lựa chọn số `option` (đếm từ 1, theo danh sách prompt.options).',
    inputSchema: { option: z.number().int().min(1) },
  }, tool(async ({ option }) => {
    const c = await chat();
    if (!c.status.prompt) throw new Error('không có câu hỏi nào đang chờ');
    await api('POST', '/api/chat/key', { key: `nav:${option - 1}` });
    return json(editorResult(await waitEditor(20)));
  }));

  server.registerTool('make_video', {
    title: 'Tạo video tự động',
    description: `Giao cho Claude trong app dựng trọn một video có giọng đọc AI, hình minh họa, phụ đề, nhạc — giống các nút trong app.
Nguồn (chọn một): document_path (tài liệu trong media/docs, vd sau upload_file/import_url) hoặc document_url (link PDF/DOCX/Google Drive) → video giảng giải có hoạt ảnh (ý chính, biểu đồ, quy trình, bảng, phóng to trang tài liệu); article_url → video tóm tắt bài viết với ảnh trong bài; text → đọc/kể nội dung; topic → video giải thích một chủ đề.
Trả về ngay khi Claude bắt đầu; dùng editor_reply để chờ (thường 5–20 phút), preview_frame để xem. Không render.`,
    inputSchema: {
      document_path: z.string().optional(), document_url: z.string().url().optional(), article_url: z.string().url().optional(),
      text: z.string().optional(), topic: z.string().optional(),
      language: z.enum(['vi', 'en']).default('vi').describe('Ngôn ngữ giọng đọc (nguồn khác ngôn ngữ thì dịch)'),
      voice: z.string().optional().describe('Mặc định vi:Mai Anh / en:af_heart'),
      speed: z.number().min(0.8).max(1.3).default(1),
      length: z.enum(['short', 'medium', 'long']).default('medium').describe('~1 phút / 2–3 phút / 4–5 phút'),
      size: z.enum(['1920x1080', '1080x1920', '1080x1080']).default('1920x1080'),
      new_project: z.boolean().default(true),
      project_name: z.string().optional(),
      visuals: z.enum(['mix', 'motion', 'photos']).default('mix').describe('Tài liệu: kết hợp hoạt ảnh + hình tài liệu / chỉ hoạt ảnh / ưu tiên hình'),
      presenter_3d: z.boolean().default(false).describe('Nhân vật 3D dẫn chuyện (render chậm hơn)'),
      subtitles: z.boolean().default(true), music: z.boolean().default(true),
      notes: z.string().optional().describe('Yêu cầu thêm'),
    },
  }, tool(async (a) => {
    const sources = ['document_path', 'document_url', 'article_url', 'text', 'topic'].filter((k) => a[k]);
    if (sources.length !== 1) throw new Error('cần đúng một nguồn: document_path, document_url, article_url, text hoặc topic');
    if ((await chat()).status.busy) throw new Error('Claude trong app đang làm việc khác — gọi editor_reply để chờ');
    const voice = a.voice || (a.language === 'en' ? 'en:af_heart' : 'vi:Mai Anh');
    const langName = a.language === 'vi' ? 'tiếng Việt' : 'tiếng Anh';
    const LEN = { short: 'khoảng 60 giây (~8 cảnh), chỉ ý chính', medium: 'khoảng 2–3 phút (~15 cảnh)', long: 'khoảng 4–5 phút, đủ các ý' };
    const SIZE = { '1920x1080': 'Ngang 16:9', '1080x1920': 'Dọc 9:16', '1080x1080': 'Vuông 1:1' };
    const VIS = {
      mix: 'kết hợp hoạt ảnh minh họa (ý chính, biểu đồ, quy trình, bảng, so sánh) với hình và trang trong tài liệu',
      motion: 'toàn bộ bằng hoạt ảnh minh họa; chỉ dùng hình trong tài liệu khi thật cần',
      photos: 'ưu tiên hình và trang trong tài liệu, thiếu thì ảnh minh họa miễn phí; hoạt ảnh cho số liệu',
    };
    let docPath = a.document_path;
    const isDoc = !!(a.document_path || a.document_url);
    // the document must be in the project the video is built in → create the project first
    if (a.document_path && a.new_project) {
      const src = path.join(WORKSPACE, a.document_path);
      if (!fs.existsSync(src)) throw new Error(`không thấy ${a.document_path} trong dự án đang mở`);
      a._buf = fs.readFileSync(src); a._name = path.basename(src);
    }
    let projectLine = '- Dùng dự án đang mở, thêm vào cuối timeline';
    if (a.new_project) {
      const name = a.project_name || (a._name || a.document_url && path.basename(new URL(a.document_url).pathname) || a.topic || 'Video mới').replace(/\.\w+$/, '').replace(/[_-]+/g, ' ').slice(0, 80);
      const [width, height] = a.size.split('x').map(Number);
      await api('POST', '/api/projects', { name, width, height, fps: 30 });
      projectLine = `- Đã tạo dự án mới khung ${a.size} (${SIZE[a.size]}) và đang mở — dựng trong dự án này${isDoc ? ', đặt lại tên dự án theo tiêu đề tài liệu' : ''}`;
      if (a._buf) docPath = saveDoc(a._name, a._buf);
    }
    if (a.document_url) docPath = await fetchDoc(a.document_url);
    const lines = [];
    if (isDoc) {
      lines.push('Tạo video đọc và minh họa tài liệu, theo quy trình "Video từ tài liệu (Word/PDF)" trong CLAUDE.md (đọc lại mục đó trước khi làm).',
        `- Tài liệu: ${docPath}`,
        `- Giọng đọc: ${langName}, giọng "${voice}", tốc độ ${a.speed.toFixed(2)} (tài liệu khác ngôn ngữ thì dịch kịch bản, giữ thuật ngữ chuyên môn kèm giải thích)`,
        `- Độ dài: ${LEN[a.length]}`, projectLine, `- Hình ảnh: ${VIS[a.visuals]}`,
        `- Nhân vật 3D dẫn chuyện: ${a.presenter_3d ? 'có (Character3D ở góc, nhép môi theo giọng đọc)' : 'không'}`);
    } else if (a.article_url) {
      lines.push('Tạo video tóm tắt bài viết cho người ngại đọc, theo quy trình "Video từ bài viết" trong CLAUDE.md (đọc lại mục đó trước khi làm).',
        `- Link: ${a.article_url}`, `- Giọng đọc: ${langName}, giọng "${voice}", tốc độ ${a.speed.toFixed(2)} (bài khác ngôn ngữ thì dịch kịch bản)`,
        `- Độ dài: ${LEN[a.length]}`, a.new_project ? projectLine.replace(', đặt lại tên', '') : projectLine,
        '- Ảnh: dùng ảnh trong bài; thiếu thì thêm ảnh minh họa miễn phí (vedit images) hoặc motion graphic, ghi "Ảnh minh họa"');
    } else {
      lines.push(`Tạo video có giọng đọc ${a.text ? 'từ nội dung dưới đây' : `giải thích chủ đề: ${a.topic}`}, theo các quy tắc chung ở mục "Video templates" trong CLAUDE.md (kịch bản trung thành với nội dung${a.topic ? ', kiến thức phổ thông, không bịa số liệu/trích dẫn' : ''}); hình: hoạt ảnh minh họa trong custom/tpl/Explainer.tsx và ảnh minh họa miễn phí.`,
        `- Giọng đọc: ${langName}, giọng "${voice}", tốc độ ${a.speed.toFixed(2)}`, `- Độ dài: ${LEN[a.length]}`, projectLine);
      if (a.text) lines.push(`- Nội dung:\n${a.text}`);
    }
    lines.push(`- Phụ đề: ${a.subtitles ? 'có' : 'không'} · Nhạc nền: ${a.music ? 'có, nhỏ dưới giọng đọc' : 'không'}`);
    if (a.notes) lines.push(`- Yêu cầu thêm: ${a.notes}`);
    lines.push('Không render; xong thì báo tóm tắt các cảnh.');
    const sentAt = await sendEditor(lines.join('\n'));
    const c = await waitEditor(15, { sentAt });
    return json({ ...editorResult(c), status: c.waiting === 'not-arrived' ? 'not_delivered' : 'started', document: docPath, hint: 'Claude trong app đang dựng — gọi editor_reply (nhiều lần nếu cần) để chờ kết quả, preview_frame để xem.' });
  }));

  return server;
}

/* ---------------- HTTP mount (inside the app server) ---------------- */

const tokenOf = (req) => req.params.token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
const publicBase = (req) => {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  return `${proto}://${req.headers['x-forwarded-host']?.split(',')[0].trim() || req.headers.host}`;
};

/** Routes: POST /mcp, POST /mcp/t/:token (MCP); GET /mcp/dl/:exp/:sig/*path (signed downloads); /api/mcp/tokens (admin). */
export function mountMcp(app, { port }) {
  const base = `http://127.0.0.1:${port}`;
  const handle = async (req, res) => {
    const tok = checkToken(tokenOf(req));
    if (!tok) {
      res.set('WWW-Authenticate', 'Bearer realm="ai-video"');
      return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Thiếu hoặc sai token MCP (tạo ở menu tài khoản → Kết nối Claude (MCP))' }, id: null });
    }
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server: POST only)' }, id: null });
    const pub = publicBase(req);
    const server = createMcpServer({
      base,
      fileLink: (rel) => { const exp = Date.now() + 24 * 3600e3; return `${pub}/mcp/dl/${exp}/${sign(rel, exp)}/${rel.split('/').map(encodeURIComponent).join('/')}`; },
    });
    // stateless: one server + transport per request, plain JSON responses (no long-lived SSE through proxies)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('[mcp]', e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: e.message }, id: null });
    }
  };
  app.all('/mcp', handle);
  app.all('/mcp/t/:token', handle);

  app.get('/mcp/dl/:exp/:sig/*path', (req, res) => {
    const rel = [].concat(req.params.path).join('/');
    const exp = Number(req.params.exp);
    const want = sign(rel, exp);
    if (!(exp > Date.now()) || want.length !== req.params.sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(req.params.sig))) return res.status(403).send('Link hết hạn hoặc không hợp lệ');
    const file = path.resolve(WORKSPACE, rel);
    if (!file.startsWith(WORKSPACE + path.sep) || !fs.existsSync(file)) return res.status(404).send('Không thấy file');
    res.download(file, path.basename(file));
  });

  const admin = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Chỉ admin' }));
  app.get('/api/mcp/tokens', admin, (req, res) => res.json(listTokens()));
  app.post('/api/mcp/tokens', admin, (req, res) => res.json(createToken(req.user.username, req.body?.name)));
  app.delete('/api/mcp/tokens/:id', admin, (req, res) => res.json({ ok: revokeToken(req.params.id), tokens: listTokens() }));
}
