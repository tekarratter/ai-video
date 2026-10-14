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
import { execFile } from 'node:child_process';
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
    const { stdout } = await exec('claude', ['auth', 'status', '--json'], { env: { ...process.env, ...env() }, timeout: 20_000 });
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

const tmux = (...a) => exec('tmux', a);
const screen = async () => (await tmux('capture-pane', '-p', '-J', '-t', LOGIN_TMUX)).stdout;

/** Start `claude auth login` in a hidden tmux session and return the sign-in URL. */
export async function startLogin({ console: useConsole = false } = {}) {
  await tmux('kill-session', '-t', `=${LOGIN_TMUX}`).catch(() => {});
  await tmux('new-session', '-d', '-s', LOGIN_TMUX, '-x', '400', '-y', '50', '-e', 'BROWSER=false',
    `claude auth login ${useConsole ? '--console' : '--claudeai'}; sleep 600`);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const m = (await screen().catch(() => '')).match(/https:\/\/\S+oauth\/authorize\S+/);
    if (m) {
      save({ ...load(), loginPending: true });
      return { url: m[0] };
    }
  }
  const text = await screen().catch(() => '');
  await tmux('kill-session', '-t', `=${LOGIN_TMUX}`).catch(() => {});
  throw new Error(`Không lấy được link đăng nhập: ${text.trim().split('\n').slice(-3).join(' ')}`);
}

/** Paste the code shown by Claude after signing in. */
export async function submitCode(code) {
  code = String(code || '').trim();
  if (!code) throw new Error('Thiếu mã');
  await tmux('send-keys', '-t', LOGIN_TMUX, '-l', code);
  await tmux('send-keys', '-t', LOGIN_TMUX, 'Enter');
  let text = '';
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    text = await screen().catch(() => '');
    if (/success|logged in|signed in/i.test(text)) break;
    if (/error|invalid|failed/i.test(text.split('Paste code here').pop() || '')) break;
  }
  await tmux('kill-session', '-t', `=${LOGIN_TMUX}`).catch(() => {});
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
  await tmux('kill-session', '-t', `=${LOGIN_TMUX}`).catch(() => {});
  await exec('claude', ['auth', 'logout'], { timeout: 20_000 }).catch(() => {});
  save({});
  cache = null;
}
