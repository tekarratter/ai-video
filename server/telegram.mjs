// Telegram notifications: one bot for the whole app, each user links their own chat.
// Linking: the app gives the user a t.me/<bot>?start=<code> link; the bot receives "/start <code>" over
// long polling and stores that chat id on the user. No public URL / webhook needed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONF_DIR = path.join(os.homedir(), '.config', 'ai-video');
const CONF = path.join(CONF_DIR, 'telegram.json');
const API = 'https://api.telegram.org';
const MAX_UPLOAD = 49 * 1024 * 1024; // bot API limit for sending files is 50 MB

function readConf() { try { return JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch { return {}; } }
function writeConf(c) {
  fs.mkdirSync(CONF_DIR, { recursive: true });
  fs.writeFileSync(`${CONF}.tmp`, JSON.stringify(c, null, 1), { mode: 0o600 });
  fs.renameSync(`${CONF}.tmp`, CONF);
}

let conf = readConf(); // { token, bot: { username, name }, chats: { [username]: { chatId, name } }, offset }
const token = () => process.env.TELEGRAM_BOT_TOKEN || conf.token || '';
const pending = new Map(); // link code → { username, expires }
const fp = (tok) => crypto.createHash('sha256').update(tok).digest('hex').slice(0, 12);
let pollState = { ok: null, error: null, at: 0 }; // last getUpdates result, shown to the admin

async function call(method, body, tok = token()) {
  const r = await fetch(`${API}/bot${tok}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(method === 'getUpdates' ? 65_000 : 20_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw Object.assign(new Error(j.description || `Telegram lỗi ${r.status}`), { code: j.error_code || r.status });
  return j.result;
}

export function status(username) {
  const c = conf.chats?.[username];
  return {
    configured: !!token(), fromEnv: !!process.env.TELEGRAM_BOT_TOKEN,
    bot: conf.bot || null, linked: !!c, chatName: c?.name || null, chatId: c?.chatId || null,
  };
}

/** Admin view: which bot, where the token comes from (masked), polling health, who is linked. */
export function adminStatus() {
  const tok = token();
  return {
    configured: !!tok, fromEnv: !!process.env.TELEGRAM_BOT_TOKEN, bot: conf.bot || null,
    tokenHint: tok ? `${tok.split(':')[0]}:…${tok.slice(-4)}` : null,
    polling: tok ? pollState : null,
    users: Object.entries(conf.chats || {}).map(([username, c]) => ({ username, chatId: c.chatId, chatName: c.name || null })),
  };
}

/** Admin: set (or clear) the bot token. Validates it with getMe. */
export async function setToken(tok) {
  if (process.env.TELEGRAM_BOT_TOKEN) throw new Error('Token đang lấy từ biến môi trường TELEGRAM_BOT_TOKEN — sửa ở đó rồi khởi động lại');
  tok = String(tok || '').trim();
  if (!tok) { conf = { ...conf, token: '', bot: null, botFor: null }; writeConf(conf); restartPolling(); return; }
  if (!/^\d+:[\w-]{20,}$/.test(tok)) throw new Error('Token không đúng dạng (vd 123456789:AAH…)');
  const me = await call('getMe', {}, tok).catch((e) => { throw new Error(e.code === 401 || e.code === 404 ? 'Token sai hoặc đã bị thu hồi' : e.message); });
  conf = { ...conf, token: tok, bot: { username: me.username, name: me.first_name }, botFor: fp(tok), offset: 0 };
  writeConf(conf);
  restartPolling();
}

/** Bot name for a token set through the environment (or after the token changed outside the app). */
async function ensureBot() {
  const tok = token();
  if (!tok || (conf.bot && conf.botFor === fp(tok))) return;
  try {
    const me = await call('getMe', {}, tok);
    conf = { ...conf, bot: { username: me.username, name: me.first_name }, botFor: fp(tok), offset: conf.botFor ? 0 : conf.offset };
    writeConf(conf);
  } catch (e) { pollState = { ok: false, error: e.message, at: Date.now() }; }
}

/** A one-time deep link that ties the user's Telegram chat to their app account. */
export function linkUrl(username) {
  if (!conf.bot?.username) throw new Error('Bot Telegram chưa được cấu hình');
  const code = crypto.randomBytes(9).toString('base64url');
  pending.set(code, { username, expires: Date.now() + 15 * 60e3 });
  return `https://t.me/${conf.bot.username}?start=${code}`;
}

export function setChat(username, chatId, name = null) {
  conf.chats = { ...(conf.chats || {}) };
  if (chatId) conf.chats[username] = { chatId: String(chatId).trim(), name };
  else delete conf.chats[username];
  writeConf(conf);
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

export async function sendTo(username, html) {
  const c = conf.chats?.[username];
  if (!token() || !c) return false;
  if (!html) html = '🔔 Thử thông báo từ <b>AI Video Studio</b> — bạn sẽ nhận tin ở đây khi render xong.';
  await call('sendMessage', { chat_id: c.chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true });
  return true;
}

/** Send a rendered video when it is small enough for the bot API (else the message link has to do). */
async function sendVideo(username, file, caption) {
  const c = conf.chats?.[username];
  if (!token() || !c || !file || process.env.TELEGRAM_SEND_VIDEO === '0') return false;
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return false; }
  if (size > MAX_UPLOAD) return false;
  const fd = new FormData();
  fd.append('chat_id', c.chatId);
  fd.append('caption', caption);
  fd.append('supports_streaming', 'true');
  fd.append('video', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), path.basename(file));
  const r = await fetch(`${API}/bot${token()}/sendVideo`, { method: 'POST', body: fd, signal: AbortSignal.timeout(300_000) });
  return (await r.json().catch(() => ({}))).ok === true;
}

const dur = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h} giờ ${m} phút` : m ? `${m} phút ${x} giây` : `${x} giây`;
};

/** Render finished / failed → message the user who started it. */
export async function notifyRender(job, { absFile, publicBase } = {}) {
  if (!job.user || !conf.chats?.[job.user] || job.cancelled) return;
  const took = job.finishedAt && job.renderStartedAt ? dur((job.finishedAt - job.renderStartedAt) / 1000) : null;
  const link = publicBase && job.url ? `${publicBase}${job.url}` : null;
  const lines = job.stage === 'done'
    ? [
      `✅ <b>Render xong</b>: ${esc(job.projectName || '')}`,
      esc(job.label),
      took ? `⏱ Thời gian render: ${took}` : null,
      job.sceneCount ? `🎬 ${job.sceneCount} cảnh · dùng lại ${job.reused || 0}` : null,
      link ? `⬇️ <a href="${esc(link)}">Tải video</a>` : null,
    ]
    : [
      `❌ <b>Render lỗi</b>: ${esc(job.projectName || '')}`,
      esc(job.label),
      esc(String(job.error || '').slice(0, 300)),
      job.sceneCount ? 'Các cảnh đã xong được giữ lại — bấm Render lần nữa để làm tiếp.' : null,
    ];
  try {
    await sendTo(job.user, lines.filter(Boolean).join('\n'));
    if (job.stage === 'done' && absFile) await sendVideo(job.user, absFile, `${job.projectName || ''} — ${path.basename(absFile)}`).catch(() => {});
  } catch (e) { console.warn('[telegram]', e.message); }
}

/* ---- long polling: handles /start <code>, /start, /stop ---- */
let pollGen = 0;
async function handle(msg) {
  const chatId = msg.chat?.id;
  const text = String(msg.text || '').trim();
  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || null;
  if (!chatId) return;
  const m = text.match(/^\/start(?:@\w+)?\s+(\S+)/);
  if (m) {
    const p = pending.get(m[1]);
    if (!p || p.expires < Date.now()) {
      await call('sendMessage', { chat_id: chatId, text: 'Mã kết nối đã hết hạn — bấm lại “Kết nối Telegram” trong AI Video Studio.' });
      return;
    }
    pending.delete(m[1]);
    setChat(p.username, chatId, name);
    await call('sendMessage', { chat_id: chatId, text: `Đã kết nối với tài khoản “${p.username}” của AI Video Studio. Bạn sẽ nhận thông báo khi render xong.` });
    onLinked?.(p.username);
    return;
  }
  if (/^\/stop/.test(text)) {
    for (const [u, c] of Object.entries(conf.chats || {})) if (String(c.chatId) === String(chatId)) setChat(u, null);
    await call('sendMessage', { chat_id: chatId, text: 'Đã ngắt kết nối, bạn sẽ không nhận thông báo nữa.' });
    return;
  }
  if (/^\/start/.test(text) || /^\/id/.test(text)) {
    await call('sendMessage', { chat_id: chatId, text: `Chat ID của bạn: ${chatId}\nVào AI Video Studio → menu tài khoản → Thông báo Telegram → “Kết nối Telegram”, hoặc nhập Chat ID này.` });
  }
}

async function poll(gen) {
  while (gen === pollGen && token()) {
    try {
      const ups = await call('getUpdates', { offset: conf.offset || 0, timeout: 50, allowed_updates: ['message'] });
      pollState = { ok: true, error: null, at: Date.now() };
      for (const u of ups) {
        conf.offset = u.update_id + 1;
        if (u.message) await handle(u.message).catch((e) => console.warn('[telegram]', e.message));
      }
      if (ups.length) writeConf(conf);
    } catch (e) {
      // 409: another getUpdates / webhook uses this token; 401: bad token
      if (gen !== pollGen) return;
      pollState = { ok: false, at: Date.now(), error: e.code === 401 ? 'Token không hợp lệ (đã bị thu hồi?)' : e.code === 409 ? 'Token đang được dùng ở nơi khác (một app/bot khác cũng đọc tin của bot này)' : e.message };
      if (e.code === 401) { console.warn('[telegram] token không hợp lệ'); return; }
      await new Promise((r) => setTimeout(r, e.code === 409 ? 30_000 : 5_000));
    }
  }
}
let onLinked = null;
export function restartPolling() {
  const gen = ++pollGen;
  pollState = { ok: null, error: null, at: 0 };
  if (token()) ensureBot().then(() => { if (gen === pollGen) poll(gen); });
}
export function start({ linked } = {}) { onLinked = linked; restartPolling(); }
