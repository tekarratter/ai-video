// Upload rendered videos to YouTube (YouTube Data API v3, OAuth 2.0 "installed app" flow).
// Credentials live outside the repo: ~/.config/ai-video/youtube.json (chmod 600).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONF_DIR = path.join(os.homedir(), '.config', 'ai-video');
const CONF = path.join(CONF_DIR, 'youtube.json');
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
const CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KiB

function load() {
  try { return JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch { return {}; }
}
function save(c) {
  fs.mkdirSync(CONF_DIR, { recursive: true });
  fs.writeFileSync(CONF, JSON.stringify(c, null, 2), { mode: 0o600 });
  fs.chmodSync(CONF, 0o600);
}

export function status() {
  const c = load();
  return { configured: !!(c.client_id && c.client_secret), connected: !!c.refresh_token, channel: c.channel || null, redirectUri: c.redirect_uri || null };
}

/** Accepts either {client_id, client_secret} or the raw client_secret.json downloaded from Google Cloud. */
export function setClient({ client_id, client_secret, json }) {
  if (json) {
    const j = typeof json === 'string' ? JSON.parse(json) : json;
    const inner = j.installed || j.web || j;
    client_id = inner.client_id;
    client_secret = inner.client_secret;
  }
  if (!client_id || !client_secret) throw new Error('Thiếu client_id / client_secret');
  save({ client_id: client_id.trim(), client_secret: client_secret.trim() });
}

export function disconnect() {
  const c = load();
  delete c.refresh_token; delete c.access_token; delete c.expires_at; delete c.channel;
  save(c);
}

export function authUrl(redirectUri) {
  const c = load();
  if (!c.client_id) throw new Error('Chưa cấu hình OAuth client');
  c.redirect_uri = redirectUri;
  save(c);
  const q = new URLSearchParams({
    client_id: c.client_id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** `input` = the authorization code, or the whole URL Google redirected to (pasted by the user). */
export async function exchangeCode(input) {
  const c = load();
  let code = String(input || '').trim();
  if (/^https?:\/\//.test(code)) {
    const u = new URL(code);
    if (u.searchParams.get('error')) throw new Error(`Google: ${u.searchParams.get('error')}`);
    code = u.searchParams.get('code') || '';
  }
  if (!code) throw new Error('Không tìm thấy mã xác thực (code)');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: c.redirect_uri, grant_type: 'authorization_code' }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Đổi mã thất bại: ${j.error_description || j.error}`);
  if (!j.refresh_token) throw new Error('Google không trả refresh_token — gỡ quyền ứng dụng ở myaccount.google.com/permissions rồi kết nối lại');
  Object.assign(c, { refresh_token: j.refresh_token, access_token: j.access_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 });
  save(c);
  try {
    const ch = await api('GET', 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true');
    c.channel = ch.items?.[0] ? { id: ch.items[0].id, title: ch.items[0].snippet.title } : null;
    save(c);
  } catch { /* channel lookup is optional */ }
  return status();
}

async function accessToken() {
  const c = load();
  if (!c.refresh_token) throw new Error('Chưa kết nối tài khoản YouTube');
  if (c.access_token && c.expires_at > Date.now()) return c.access_token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Làm mới token thất bại: ${j.error_description || j.error} — hãy kết nối lại`);
  Object.assign(c, { access_token: j.access_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 });
  save(c);
  return c.access_token;
}

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `${r.status} ${r.statusText}`);
  return j;
}

/**
 * Resumable upload with progress.
 * meta: { title, description, tags[], privacy: 'private'|'unlisted'|'public', madeForKids, categoryId, publishAt }
 */
export async function upload(file, meta, onProgress) {
  const size = fs.statSync(file).size;
  const snippet = {
    title: String(meta.title || path.basename(file, path.extname(file))).slice(0, 100),
    description: String(meta.description || '').slice(0, 5000),
    tags: (meta.tags || []).map(String).filter(Boolean).slice(0, 30),
    categoryId: String(meta.categoryId || '22'),
  };
  const st = { privacyStatus: meta.privacy || 'private', selfDeclaredMadeForKids: !!meta.madeForKids };
  if (meta.publishAt) { st.privacyStatus = 'private'; st.publishAt = new Date(meta.publishAt).toISOString(); }

  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(size),
      'x-upload-content-type': 'video/mp4',
    },
    body: JSON.stringify({ snippet, status: st }),
  });
  if (!init.ok) {
    const j = await init.json().catch(() => ({}));
    throw new Error(`YouTube từ chối: ${j.error?.message || init.statusText}`);
  }
  const session = init.headers.get('location');
  const fd = fs.openSync(file, 'r');
  try {
    let offset = 0;
    for (;;) {
      const len = Math.min(CHUNK, size - offset);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      let r;
      for (let attempt = 0; ; attempt++) {
        try {
          r = await fetch(session, {
            method: 'PUT',
            headers: { authorization: `Bearer ${await accessToken()}`, 'content-length': String(len), 'content-range': `bytes ${offset}-${offset + len - 1}/${size}` },
            body: buf,
          });
          if (r.status >= 500 && attempt < 4) throw new Error(`HTTP ${r.status}`);
          break;
        } catch (e) {
          if (attempt >= 4) throw e;
          await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
        }
      }
      if (r.status === 200 || r.status === 201) {
        onProgress?.(1);
        const v = await r.json();
        return { id: v.id, url: `https://youtu.be/${v.id}`, studio: `https://studio.youtube.com/video/${v.id}/edit`, privacy: v.status?.privacyStatus };
      }
      if (r.status !== 308) {
        const j = await r.json().catch(() => ({}));
        throw new Error(`Upload lỗi: ${j.error?.message || r.status}`);
      }
      const range = r.headers.get('range'); // "bytes=0-12345"
      offset = range ? Number(range.split('-')[1]) + 1 : offset + len;
      onProgress?.(offset / size);
    }
  } finally {
    fs.closeSync(fd);
  }
}
