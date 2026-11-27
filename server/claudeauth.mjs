// Claude Code authentication for whoever deploys the app — their own Claude account, configured from the web UI.
// Three ways:
//   login  — `claude auth login` (Pro/Max subscription or Console) driven in a hidden tmux session:
//            we show the sign-in URL, the user pastes back the code Claude shows after signing in.
//   apikey — Anthropic Console API key  → ANTHROPIC_API_KEY for the claude process
//   token  — long-lived token from `claude setup-token` (subscription) → CLAUDE_CODE_OAUTH_TOKEN
// Secrets are stored in ~/.config/ai-video/claude.json (chmod 600), never in the repo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { CLAUDE_BIN, HAS_TMUX } from '../shared/platform.mjs';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CONF_DIR = path.join(os.homedir(), '.config', 'ai-video');
const CONF = path.join(CONF_DIR, 'claude.json');
const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');
const LOGIN_TMUX = 'ai-video-claude-login';

function load() { try { return JSON.parse(fs.readFileSync(CONF, 'utf8')); } catch { return {}; } }
function save(c) {
  fs.mkdirSync(CONF_DIR, { recursive: true });
  fs.writeFileSync(CONF, JSON.stringify(c, null, 1), { mode: 0o600 });
  fs.chmodSync(CONF, 0o600);
}

/** Extra environment for the claude process (tmux -e). */
export function env() {
  const c = load();
  if (c.method === 'apikey' && c.apiKey) return { ANTHROPIC_API_KEY: c.apiKey };
  if (c.method === 'token' && c.oauthToken) return { CLAUDE_CODE_OAUTH_TOKEN: c.oauthToken };
  return {};
}

const mask = (s) => (s ? `${s.slice(0, 10)}…${s.slice(-4)}` : null);

let cache = null;
export async function status({ fresh = false } = {}) {
  if (cache && !fresh && Date.now() - cache.at < 15_000) return cache.value;
  const c = load();
  let s = { loggedIn: false };
  try {
    const { stdout } = await exec(CLAUDE_BIN, ['auth', 'status', '--json'], { env: { ...process.env, ...env() }, timeout: 20_000 });
    s = JSON.parse(stdout);
  } catch (e) {
    try { s = JSON.parse(e.stdout); } catch { s = { loggedIn: false, error: String(e.message).split('\n')[0] }; }
  }
  const value = {
    loggedIn: !!s.loggedIn, authMethod: s.authMethod || null, email: s.email || null, orgName: s.orgName || null,
    method: c.method || (s.loggedIn ? 'login' : null), apiKey: mask(c.apiKey), oauthToken: mask(c.oauthToken),
    loginPending: !!c.loginPending, error: s.error || null,
  };
  cache = { at: Date.now(), value };
  return value;
}

/** Claude asks once "Do you want to use this API key?" — pre-approve the key we were given. */
function approveApiKey(key) {
  let j = {};
  try { j = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8')); } catch { /* new */ }
  const tail = key.slice(-20);
  j.customApiKeyResponses ??= { approved: [], rejected: [] };
  j.customApiKeyResponses.approved = [...new Set([...(j.customApiKeyResponses.approved || []), tail])];
  j.customApiKeyResponses.rejected = (j.customApiKeyResponses.rejected || []).filter((x) => x !== tail);
  fs.writeFileSync(CLAUDE_JSON, JSON.stringify(j, null, 2));
}

export function setApiKey(key) {
  key = String(key || '').trim();
  if (!/^sk-ant-[\w-]{20,}$/.test(key)) throw new Error('API key không hợp lệ (dạng sk-ant-…)');
  approveApiKey(key);
  save({ method: 'apikey', apiKey: key });
  cache = null;
}

export function setToken(token) {
  token = String(token || '').trim();
  if (!/^sk-ant-oat[\w-]{20,}$/.test(token)) throw new Error('Token không hợp lệ (dạng sk-ant-oat…, lấy bằng lệnh: claude setup-token)');
  save({ method: 'token', oauthToken: token });
  cache = null;
}

/* `claude auth login` waits for a pasted code. With tmux it runs in a hidden session (it wants a terminal there);
 * without tmux (Windows) plain pipes are enough: it prints the URL on stdout and reads the code from stdin. */
let pipe = null; // { proc, out, done }
const login = HAS_TMUX ? {
  async start(args) {
    await exec('tmux', ['kill-session', '-t', `=${LOGIN_TMUX}`]).catch(() => {});
    await exec('tmux', ['new-session', '-d', '-s', LOGIN_TMUX, '-x', '400', '-y', '50', '-e', 'BROWSER=false', `claude ${args.join(' ')}; sleep 600`]);
  },
  screen: async () => (await exec('tmux', ['capture-pane', '-p', '-J', '-t', LOGIN_TMUX])).stdout,
  async type(text) {
    await exec('tmux', ['send-keys', '-t', LOGIN_TMUX, '-l', text]);
    await exec('tmux', ['send-keys', '-t', LOGIN_TMUX, 'Enter']);
  },
  kill: () => exec('tmux', ['kill-session', '-t', `=${LOGIN_TMUX}`]).catch(() => {}),
  exited: () => false,
} : {
  async start(args) {
    this.kill();
    const proc = spawn(CLAUDE_BIN, args, { env: { ...process.env, BROWSER: 'false' }, windowsHide: true });
    const p = { proc, out: '', done: false };
    const add = (d) => { p.out = (p.out + d.toString('utf8')).slice(-20000); };
    proc.stdout.on('data', add);
    proc.stderr.on('data', add);
    proc.on('error', (e) => { p.out += `\n${e.message}`; p.done = true; });
    proc.on('close', () => { p.done = true; });
    setTimeout(() => { if (!p.done) proc.kill(); }, 10 * 60_000).unref();
    pipe = p;
  },
  screen: async () => pipe?.out || '',
  async type(text) {
    if (!pipe || pipe.done) throw new Error('Phiên đăng nhập đã kết thúc — bấm đăng nhập lại');
    pipe.proc.stdin.write(`${text}\n`);
  },
  kill() { if (pipe && !pipe.done) pipe.proc.kill(); pipe = null; },
  exited: () => !!pipe?.done,
};

/** Start `claude auth login` and return the sign-in URL. */
export async function startLogin({ console: useConsole = false } = {}) {
  await login.start(['auth', 'login', useConsole ? '--console' : '--claudeai']);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const m = (await login.screen().catch(() => '')).match(/https:\/\/\S+oauth\/authorize\S+/);
    if (m) {
      save({ ...load(), loginPending: true });
      return { url: m[0] };
    }
    if (login.exited()) break;
  }
  const text = await login.screen().catch(() => '');
  await login.kill();
  throw new Error(`Không lấy được link đăng nhập: ${text.trim().split('\n').slice(-3).join(' ')}`);
}

/** Paste the code shown by Claude after signing in. */
export async function submitCode(code) {
  code = String(code || '').trim();
  if (!code) throw new Error('Thiếu mã');
  const before = (await login.screen().catch(() => '')).length;
  await login.type(code);
  let text = '';
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    text = await login.screen().catch(() => '');
    const after = HAS_TMUX ? text.split('Paste code here').pop() || '' : text.slice(before);
    if (/success|logged in|signed in/i.test(after)) break;
    if (/error|invalid|failed/i.test(after)) break;
    if (login.exited()) break;
  }
  await login.kill();
  const c = load();
  delete c.loginPending;
  const s = await status({ fresh: true });
  if (!s.loggedIn) {
    save(c);
    throw new Error(`Đăng nhập chưa thành công: ${text.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`);
  }
  // a subscription login replaces any API key / token set before
  save({ method: 'login' });
  cache = null;
  return status({ fresh: true });
}

export async function logout() {
  await login.kill();
  await exec(CLAUDE_BIN, ['auth', 'logout'], { timeout: 20_000 }).catch(() => {});
  save({});
  cache = null;
}
