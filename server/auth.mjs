// Login for the editor. Users + sessions live outside the repo in ~/.config/ai-video (chmod 600).
// Passwords: scrypt with a random salt. Sessions: random token in an HttpOnly cookie, 30 days.
// Requests from this machine that did not come through a proxy (vedit, Claude CLI, the renderer's
// headless Chrome) are trusted without a login.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONF_DIR = path.join(os.homedir(), '.config', 'ai-video');
const USERS = path.join(CONF_DIR, 'users.json');
const SESSIONS = path.join(CONF_DIR, 'sessions.json');
const COOKIE = 'aiv_session';
const TTL = 30 * 24 * 3600 * 1000;
export const DEFAULT_USER = { username: process.env.AIV_ADMIN_USER || 'admin', password: process.env.AIV_ADMIN_PASSWORD || 'Hoang2026' };

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) {
  fs.mkdirSync(CONF_DIR, { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 1), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  fs.chmodSync(file, 0o600);
}

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') };
}
function checkPassword(user, pw) {
  const h = crypto.scryptSync(String(pw), user.salt, 64);
  const want = Buffer.from(user.hash, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}

let users = readJson(USERS, null);
if (!users?.length) {
  users = [{ username: DEFAULT_USER.username, role: 'admin', ...hashPassword(DEFAULT_USER.password), createdAt: Date.now(), mustChange: true }];
  writeJson(USERS, users);
  console.log(`[auth] tạo tài khoản mặc định ${DEFAULT_USER.username} / ${DEFAULT_USER.password} — hãy đổi mật khẩu`);
}
const saveUsers = () => writeJson(USERS, users);
const publicUser = (u) => u && { username: u.username, role: u.role, mustChange: !!u.mustChange, createdAt: u.createdAt };

let sessions = readJson(SESSIONS, {});
for (const [t, s] of Object.entries(sessions)) if (s.expires < Date.now()) delete sessions[t];
let saveTimer;
const saveSessions = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeJson(SESSIONS, sessions), 300); };

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isLoopback = (a = '') => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
/** Local tool talking straight to the API (no proxy in between). The Vite proxy adds X-Forwarded-For. */
const isLocalTool = (req) => isLoopback(req.socket?.remoteAddress) && !req.headers['x-forwarded-for'];

/** The user of a request, or a pseudo-user for trusted local tools, or null. */
export function userOf(req) {
  const tok = parseCookies(req.headers.cookie)[COOKIE];
  const s = tok && sessions[tok];
  if (s && s.expires > Date.now()) {
    const u = users.find((x) => x.username === s.username);
    if (u) {
      if (s.expires - Date.now() < TTL - 24 * 3600 * 1000) { s.expires = Date.now() + TTL; saveSessions(); } // sliding expiry
      return u;
    }
  }
  if (isLocalTool(req)) return { username: 'local', role: 'admin', local: true };
  return null;
}

function setCookie(res, token, maxAge) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAge / 1000)}`);
}

// brute-force brake: per IP, 5 free attempts then 1 attempt / 10 s
const attempts = new Map();
function throttled(ip) {
  const a = attempts.get(ip) || { n: 0, t: 0 };
  return a.n >= 5 && Date.now() - a.t < 10_000;
}
function failed(ip) { const a = attempts.get(ip) || { n: 0, t: 0 }; attempts.set(ip, { n: a.n + 1, t: Date.now() }); }

const OPEN_PATHS = new Set(['/api/auth/login', '/api/auth/me', '/api/auth/logout', '/api/youtube/callback']);

/** Express middleware: everything under these prefixes needs a login. */
export function requireAuth(req, res, next) {
  if (OPEN_PATHS.has(req.path)) return next();
  if (!/^\/(api|media|exports|cache|library)(\/|$)/.test(req.path)) return next();
  const u = userOf(req);
  if (!u) return res.status(401).json({ error: 'Chưa đăng nhập' });
  req.user = u;
  next();
}

export function registerRoutes(app) {
  app.get('/api/auth/me', (req, res) => {
    const u = userOf(req);
    if (!u) return res.status(401).json({ error: 'Chưa đăng nhập' });
    res.json({ user: publicUser(u) });
  });

  app.post('/api/auth/login', (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    if (throttled(ip)) return res.status(429).json({ error: 'Sai quá nhiều lần, đợi 10 giây rồi thử lại' });
    const { username, password } = req.body || {};
    const u = users.find((x) => x.username.toLowerCase() === String(username || '').trim().toLowerCase());
    if (!u || !checkPassword(u, password)) {
      failed(ip);
      return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
    }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions[token] = { username: u.username, expires: Date.now() + TTL, createdAt: Date.now(), ua: String(req.headers['user-agent'] || '').slice(0, 120) };
    saveSessions();
    setCookie(res, token, TTL);
    res.json({ user: publicUser(u) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const tok = parseCookies(req.headers.cookie)[COOKIE];
    if (tok) { delete sessions[tok]; saveSessions(); }
    setCookie(res, '', 0);
    res.json({ ok: true });
  });

  app.post('/api/auth/password', (req, res) => {
    const me = req.user;
    if (!me || me.local) return res.status(400).json({ error: 'Hãy đăng nhập bằng tài khoản' });
    const { current, password } = req.body || {};
    if (!checkPassword(me, current)) return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng' });
    if (String(password || '').length < 6) return res.status(400).json({ error: 'Mật khẩu mới tối thiểu 6 ký tự' });
    Object.assign(me, hashPassword(password), { mustChange: false });
    saveUsers();
    // log out other sessions of this user
    const keep = parseCookies(req.headers.cookie)[COOKIE];
    for (const [t, s] of Object.entries(sessions)) if (s.username === me.username && t !== keep) delete sessions[t];
    saveSessions();
    res.json({ user: publicUser(me) });
  });

  /* ---- user management (admin) ---- */
  const admin = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Chỉ admin' }));
  const NAME = /^[a-zA-Z0-9._-]{3,32}$/;

  app.get('/api/users', admin, (req, res) => res.json(users.map(publicUser)));

  app.post('/api/users', admin, (req, res) => {
    const { username, password, role = 'editor' } = req.body || {};
    if (!NAME.test(String(username || ''))) return res.status(400).json({ error: 'Tên đăng nhập 3–32 ký tự: chữ, số, . _ -' });
    if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
    if (String(password || '').length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
    users.push({ username, role: role === 'admin' ? 'admin' : 'editor', ...hashPassword(password), createdAt: Date.now(), mustChange: true });
    saveUsers();
    res.json(users.map(publicUser));
  });

  app.patch('/api/users/:name', admin, (req, res) => {
    const u = users.find((x) => x.username === req.params.name);
    if (!u) return res.status(404).json({ error: 'Không có người dùng này' });
    const { password, role } = req.body || {};
    if (password != null) {
      if (String(password).length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
      Object.assign(u, hashPassword(password), { mustChange: u.username !== req.user.username });
      for (const [t, s] of Object.entries(sessions)) if (s.username === u.username) delete sessions[t];
      saveSessions();
    }
    if (role && role !== u.role) {
      if (u.role === 'admin' && users.filter((x) => x.role === 'admin').length === 1) return res.status(400).json({ error: 'Phải còn ít nhất 1 admin' });
      u.role = role === 'admin' ? 'admin' : 'editor';
    }
    saveUsers();
    res.json(users.map(publicUser));
  });

  app.delete('/api/users/:name', admin, (req, res) => {
    const u = users.find((x) => x.username === req.params.name);
    if (!u) return res.status(404).json({ error: 'Không có người dùng này' });
    if (u.username === req.user.username) return res.status(400).json({ error: 'Không tự xoá chính mình' });
    if (u.role === 'admin' && users.filter((x) => x.role === 'admin').length === 1) return res.status(400).json({ error: 'Phải còn ít nhất 1 admin' });
    users = users.filter((x) => x !== u);
    for (const [t, s] of Object.entries(sessions)) if (s.username === u.username) delete sessions[t];
    saveUsers(); saveSessions();
    res.json(users.map(publicUser));
  });
}
