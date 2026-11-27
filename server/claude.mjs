// Bridge between the web chat panel and ONE interactive Claude Code process running in tmux.
// The CLI and the panel share the same session:
//   - CLI  -> panel : we tail the session transcript (~/.claude/projects/<cwd>/<session>.jsonl)
//   - panel -> CLI  : we paste the text into the tmux pane (tmux paste-buffer + Enter)
// Users attach to the same CLI with:  tmux attach -t ai-video
//
// Without tmux (Windows) the same bridge runs claude HEADLESS: `claude -p --input-format stream-json
// --output-format stream-json`, one long-lived process per session. Messages go in as JSON lines on stdin, the panel
// still follows the transcript file; busy = a sent message has no `result` event yet. No live terminal view, and
// permission dialogs can't be answered there: tools outside workspace/.claude/settings.json are refused.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { CLAUDE_BIN, HAS_TMUX, NO_TMUX_MSG } from '../shared/platform.mjs';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const KEYMAP = {
  '\r': 'Enter', '\x7f': 'BSpace', '\x1b': 'Escape', '\t': 'Tab', '\x03': 'C-c', '\x04': 'C-d',
  '\x1b[A': 'Up', '\x1b[B': 'Down', '\x1b[C': 'Right', '\x1b[D': 'Left', '\x1b[Z': 'BTab',
  '\x1b[H': 'Home', '\x1b[F': 'End', '\x1b[3~': 'DC', '\x1b[5~': 'PPage', '\x1b[6~': 'NPage',
  '\x0f': 'C-o', '\x12': 'C-r', '\x15': 'C-u', '\x0c': 'C-l', '\x0b': 'C-k', '\x01': 'C-a', '\x05': 'C-e',
};

/**
 * Detect an interactive selection dialog (permission / trust / plan approval) on the CLI screen.
 * Options are the contiguous lines aligned with the "❯" cursor line.
 */
export function parsePrompt(lines) {
  if (!lines.some((l) => /Enter to confirm|Esc to cancel|Esc to exit|to select/i.test(l))) return null;
  const sel = lines.findIndex((l) => /^\s*[│ ]*\s*❯\s*\S/.test(l) && !/^\s*❯\s*$/.test(l));
  if (sel < 0) return null;
  const col = lines[sel].indexOf('❯') + lines[sel].slice(lines[sel].indexOf('❯') + 1).search(/\S/) + 1;
  const textAt = (l) => (l.length > col && /^[\s│❯]*$/.test(l.slice(0, col)) && /\S/.test(l[col]) ? l.slice(col).replace(/[│\s]+$/, '') : null);
  let a = sel, b = sel;
  while (a - 1 >= 0 && textAt(lines[a - 1]) !== null) a--;
  while (b + 1 < lines.length && textAt(lines[b + 1]) !== null) b++;
  const options = [];
  for (let i = a; i <= b; i++) {
    const label = textAt(lines[i]);
    const m = label.match(/^(\d+)\.\s+(.*)$/);
    options.push({ key: m ? m[1] : `nav:${i - a}`, label: m ? m[2] : label, selected: i === sel });
  }
  if (options.length < 2) return null;
  const clean = (l) => l.replace(/[│╭╮╰╯─]/g, '').trim();
  let q = a - 1;
  while (q >= 0 && !/\?\s*$/.test(clean(lines[q])) && a - q < 25) q--;
  const question = q >= 0 && /\?\s*$/.test(clean(lines[q])) ? clean(lines[q]) : 'Claude cần bạn chọn:';
  const context = lines.slice(Math.max(0, (q >= 0 ? q : a) - 10), q >= 0 ? q : a).map(clean).filter(Boolean).join('\n');
  return { question, context, options };
}

export class ClaudeBridge extends EventEmitter {
  constructor({ cwd, session = 'ai-video', claudeArgs = '', env = () => ({}) }) {
    super();
    this.env = env; // extra env for the claude process (credentials), read at every start
    this.cwd = cwd;
    this.tmux = session;
    this.claudeArgs = claudeArgs;
    this.projectDir = path.join(os.homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    this.file = null;
    this.offset = 0;
    this.partial = '';
    this.items = [];
    this.toolIndex = new Map();
    this.status = { running: false, busy: false, prompt: null, sessionId: null };
    this.screen = '';
    this.size = { cols: 120, rows: 40 };
    this.terminalWatchers = 0;
    this.headless = !HAS_TMUX;
    this.proc = null; // headless claude process
    this.pending = 0; // headless: messages sent without a `result` yet
  }

  async tmuxCmd(...args) {
    if (!HAS_TMUX) throw new Error(NO_TMUX_MSG);
    return exec('tmux', args, { maxBuffer: 8 * 1024 * 1024 });
  }

  async isRunning() {
    if (this.headless) return !!this.proc;
    try { await this.tmuxCmd('has-session', '-t', `=${this.tmux}`); return true; } catch { return false; }
  }

  hasHistory() {
    return fs.existsSync(this.projectDir) && fs.readdirSync(this.projectDir)
      .some((f) => f.endsWith('.jsonl') && fs.readFileSync(path.join(this.projectDir, f), 'utf8').includes('"type":"user"'));
  }

  /** A notice in the chat list (not part of the transcript). */
  notice(text) {
    const item = { type: 'system', text, ts: new Date().toISOString(), key: `notice-${Date.now()}-${this.items.length}` };
    this.items.push(item);
    this.emit('items', { added: [item], updated: [] });
  }

  /**
   * Headless claude ignores workspace/.claude/settings.json permissions until the folder is trusted — normally a dialog
   * the user accepts in the interactive CLI, which headless mode never shows. The app runs Claude in its own workspace,
   * so record that trust in ~/.claude.json (key: the folder and its git root, forward slashes).
   */
  trustWorkspace() {
    const file = path.join(os.homedir(), '.claude.json');
    let j = {};
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') return; }
    const keys = [this.cwd];
    for (let d = this.cwd; ; d = path.dirname(d)) {
      if (fs.existsSync(path.join(d, '.git'))) { keys.push(d); break; }
      if (path.dirname(d) === d) break;
    }
    j.projects ??= {};
    let changed = false;
    for (const k of keys.map((x) => x.replace(/\\/g, '/'))) {
      if (j.projects[k]?.hasTrustDialogAccepted) continue;
      j.projects[k] = { ...(j.projects[k] || {}), hasTrustDialogAccepted: true };
      changed = true;
    }
    if (changed) fs.writeFileSync(file, JSON.stringify(j, null, 2));
  }

  /** Headless start: one `claude -p` process speaking stream-json. */
  async startHeadless({ resume } = {}) {
    if (this.proc) return;
    try { this.trustWorkspace(); } catch (e) { console.warn('[claude] trust workspace', e.message); }
    const id = crypto.randomUUID();
    if (resume === 'continue' && !this.hasHistory()) resume = undefined;
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      ...this.claudeArgs.split(/\s+/).filter(Boolean)];
    if (resume === 'continue') args.push('--continue');
    else if (resume) args.push('--resume', resume);
    else args.push('--session-id', id);
    const proc = spawn(CLAUDE_BIN, args, { cwd: this.cwd, env: { ...process.env, ...(this.env() || {}) }, windowsHide: true });
    this.proc = proc;
    this.pending = 0;
    this.startedAt = Date.now();
    let errTail = '';
    proc.stderr.on('data', (d) => { errTail = (errTail + d.toString('utf8')).slice(-2000); });
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let e;
      try { e = JSON.parse(line); } catch { return; }
      if (e.type === 'system' && e.subtype === 'init' && e.session_id) {
        const f = path.join(this.projectDir, `${e.session_id}.jsonl`);
        if (this.file !== f) this.switchTo(f);
      } else if (e.type === 'result') {
        this.pending = Math.max(0, this.pending - 1);
        // 'success' errors (not logged in, API errors) are already in the transcript as an assistant message
        if (e.is_error && e.subtype !== 'success') this.notice(`Claude dừng lượt này: ${e.subtype}${e.result ? ` — ${String(e.result).slice(0, 400)}` : ''}`);
        this.pollScreen();
      }
    });
    const ended = (why) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.pending = 0;
      if (!this.stopping && why) this.notice(why);
      this.pollScreen();
    };
    proc.on('error', (e) => ended(`Không chạy được Claude Code (${CLAUDE_BIN}): ${e.message}`));
    proc.on('close', (code) => ended(code ? `Claude Code đã dừng (mã ${code})${errTail.trim() ? `: ${errTail.trim().split('\n').slice(-3).join(' ')}` : ''}` : ''));
    if (!resume) this.switchTo(path.join(this.projectDir, `${id}.jsonl`));
    else if (resume !== 'continue' && fs.existsSync(path.join(this.projectDir, `${resume}.jsonl`))) this.switchTo(path.join(this.projectDir, `${resume}.jsonl`));
    this.pollScreen();
    if (resume) {
      // --resume/--continue exits at once when there is nothing to resume: fall back to a new session.
      await new Promise((r) => setTimeout(r, 3000));
      if (!this.proc) await this.startHeadless();
    }
  }

  /** Start claude inside tmux (if not already running). `resume`: session id, or 'continue'. */
  async start({ resume } = {}) {
    if (this.headless) return this.startHeadless({ resume });
    if (await this.isRunning()) return;
    const id = crypto.randomUUID();
    let cmd = `claude ${this.claudeArgs}`.trim();
    const hasHistory = this.hasHistory();
    if (resume === 'continue' && !hasHistory) resume = undefined;
    if (resume === 'continue') cmd += ' --continue';
    else if (resume) cmd += ` --resume ${resume}`;
    else cmd += ` --session-id ${id}`;
    const envArgs = Object.entries(this.env() || {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    await this.tmuxCmd('new-session', '-d', '-s', this.tmux, '-x', String(this.size.cols), '-y', String(this.size.rows), '-c', this.cwd, ...envArgs, cmd);
    await this.tmuxCmd('set-option', '-t', this.tmux, 'remain-on-exit', 'off').catch(() => {});
    await this.tmuxCmd('set-option', '-t', this.tmux, 'history-limit', '5000').catch(() => {});
    if (!resume) this.switchTo(path.join(this.projectDir, `${id}.jsonl`));
    else if (resume !== 'continue' && fs.existsSync(path.join(this.projectDir, `${resume}.jsonl`))) this.switchTo(path.join(this.projectDir, `${resume}.jsonl`));
    this.startedAt = Date.now();
    if (resume) {
      // --resume/--continue exits immediately when there is nothing to resume: fall back to a new session.
      await new Promise((r) => setTimeout(r, 3000));
      if (!(await this.isRunning())) await this.start();
    }
  }

  async stop() {
    if (this.headless) {
      const p = this.proc;
      if (!p) return;
      this.stopping = true;
      const gone = new Promise((r) => { p.once('close', r); setTimeout(r, 5000); });
      // the whole tree: tool commands claude started (ffmpeg, node…) must not outlive it
      if (process.platform === 'win32') execFile('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {});
      else p.kill();
      await gone;
      this.stopping = false;
      if (this.proc === p) { this.proc = null; this.pending = 0; this.pollScreen(); }
      return;
    }
    await this.tmuxCmd('kill-session', '-t', `=${this.tmux}`).catch(() => {});
  }

  async restart({ resume } = {}) {
    await this.stop();
    await new Promise((r) => setTimeout(r, 300));
    await this.start({ resume });
  }

  /**
   * Wait until the CLI shows its empty input box. Right after a (re)start — e.g. when a new project was just
   * opened — the TUI needs several seconds; text pasted earlier got lost or left the box browsing history
   * ("History 53/59"), and the message never arrived.
   */
  async waitReady(timeout = 30000) {
    const t0 = Date.now();
    let downs = 0;
    while (Date.now() - t0 < timeout) {
      let scr = '';
      try { scr = (await this.tmuxCmd('capture-pane', '-p', '-t', this.tmux)).stdout; } catch { /* starting */ }
      const lines = scr.split('\n');
      if (/History \d+\/\d+/.test(scr) && downs < 80) {
        // stuck browsing earlier messages: walk back down to the draft
        await this.tmuxCmd('send-keys', '-t', this.tmux, 'Down').catch(() => {});
        downs++;
        await new Promise((r) => setTimeout(r, 120));
        continue;
      }
      const box = lines.findIndex((l, i) => /^❯/.test(l) && /^─{3}/.test(lines[i - 1] || ''));
      if (box >= 0 && !parsePrompt(lines)) {
        if (Date.now() - (this.startedAt || 0) < 8000) await new Promise((r) => setTimeout(r, 800)); // let a fresh TUI settle
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error('Claude chưa sẵn sàng nhận tin (đang khởi động hoặc chờ bạn chọn trong terminal)');
  }

  /** Type a (possibly multi-line) message into the CLI and submit it. */
  async send(text) {
    if (!(await this.isRunning())) await this.start({ resume: this.status.sessionId || undefined });
    if (this.headless) {
      if (!this.proc) throw new Error('Claude Code chưa chạy được — xem thông báo trong khung chat');
      this.proc.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`);
      this.pending++;
      this.pollScreen();
      return;
    }
    await this.waitReady();
    const buf = `aiv${Date.now()}`;
    await new Promise((resolve, reject) => {
      const p = spawn('tmux', ['load-buffer', '-b', buf, '-']);
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tmux load-buffer exit ${code}`))));
      p.stdin.end(text);
    });
    await this.tmuxCmd('paste-buffer', '-p', '-d', '-b', buf, '-t', this.tmux);
    await new Promise((r) => setTimeout(r, 250));
    await this.tmuxCmd('send-keys', '-t', this.tmux, 'Enter');
  }

  /** Raw terminal input from the xterm view. */
  async input(data) {
    if (this.headless || !(await this.isRunning())) return;
    const parts = [];
    let lit = '';
    const flush = () => { if (lit) parts.push(['-l', lit]); lit = ''; };
    for (let i = 0; i < data.length;) {
      const seq = Object.keys(KEYMAP).filter((k) => data.startsWith(k, i)).sort((a, b) => b.length - a.length)[0];
      if (seq) { flush(); parts.push([KEYMAP[seq]]); i += seq.length; } else { lit += data[i]; i++; }
    }
    flush();
    for (const p of parts) await this.tmuxCmd('send-keys', '-t', this.tmux, ...p);
    this.pollScreen(true);
  }

  async key(name) {
    if (!(await this.isRunning())) return;
    if (this.headless) {
      // Stop button (Escape / Ctrl-C): interrupt the current turn, the process keeps running.
      if (['Escape', 'C-c'].includes(name) && this.proc) {
        this.proc.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: crypto.randomUUID(), request: { subtype: 'interrupt' } })}\n`);
      }
      return;
    }
    const m = /^nav:(\d+)$/.exec(name);
    if (m) {
      // Unnumbered menu: move the ❯ cursor to the option, then Enter.
      const opts = this.status.prompt?.options || [];
      const cur = opts.findIndex((o) => o.selected);
      const diff = Number(m[1]) - (cur < 0 ? 0 : cur);
      for (let i = 0; i < Math.abs(diff); i++) await this.tmuxCmd('send-keys', '-t', this.tmux, diff > 0 ? 'Down' : 'Up');
      await this.tmuxCmd('send-keys', '-t', this.tmux, 'Enter');
    } else await this.tmuxCmd('send-keys', '-t', this.tmux, name);
    setTimeout(() => this.pollScreen(), 150);
  }

  async resize(cols, rows) {
    this.size = { cols, rows };
    if (this.headless || !(await this.isRunning())) return;
    // Don't fight with a real terminal attached via `tmux attach`: it owns the size then.
    const { stdout } = await this.tmuxCmd('list-clients', '-t', this.tmux).catch(() => ({ stdout: '' }));
    if (!stdout.trim()) await this.tmuxCmd('resize-window', '-t', this.tmux, '-x', String(cols), '-y', String(rows)).catch(() => {});
  }

  /* ---------------- transcript ---------------- */

  switchTo(file) {
    if (this.file === file) return;
    this.file = file;
    this.offset = 0;
    this.partial = '';
    this.items = [];
    this.toolIndex.clear();
    this.status.sessionId = path.basename(file, '.jsonl');
    this.emit('reset', { sessionId: this.status.sessionId, items: [] });
    this.readNew();
  }

  /** Follow the newest transcript in this project dir (handles /clear, /resume, user-started sessions). */
  pickLatest() {
    let files;
    try { files = fs.readdirSync(this.projectDir).filter((f) => f.endsWith('.jsonl')); } catch { return; }
    let best = null, bestM = 0;
    for (const f of files) {
      const full = path.join(this.projectDir, f);
      const m = fs.statSync(full).mtimeMs;
      if (m > bestM) { best = full; bestM = m; }
    }
    if (!best) return;
    // Only switch away from our current file when another one was written more recently.
    const cur = this.file && fs.existsSync(this.file) ? fs.statSync(this.file).mtimeMs : 0;
    if (!this.file || (best !== this.file && bestM > cur + 500)) this.switchTo(best);
  }

  readNew() {
    if (!this.file || !fs.existsSync(this.file)) return;
    const size = fs.statSync(this.file).size;
    if (size < this.offset) { const f = this.file; this.file = null; this.switchTo(f); return; }
    if (size === this.offset) return;
    const fd = fs.openSync(this.file, 'r');
    const buf = Buffer.alloc(size - this.offset);
    fs.readSync(fd, buf, 0, buf.length, this.offset);
    fs.closeSync(fd);
    this.offset = size;
    const text = this.partial + buf.toString('utf8');
    const lines = text.split('\n');
    this.partial = lines.pop();
    const added = [];
    const updated = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      this.ingest(e, added, updated);
    }
    if (added.length || updated.length) this.emit('items', { added, updated });
  }

  ingest(e, added, updated) {
    if (e.isSidechain) return;
    const ts = e.timestamp;
    const push = (item) => { item.key = `${e.uuid || ts}-${added.length}-${this.items.length}`; this.items.push(item); added.push(item); };
    if (e.type === 'user' && e.message) {
      const c = e.message.content;
      if (typeof c === 'string') {
        if (e.isMeta) return;
        const cmd = c.match(/<command-name>(.*?)<\/command-name>/);
        if (cmd) return push({ type: 'command', text: cmd[1], ts });
        if (c.startsWith('<local-command-stdout>')) {
          const out = c.replace(/<\/?local-command-stdout>/g, '').trim();
          if (out) push({ type: 'system', text: out, ts });
          return;
        }
        if (c.startsWith('<')) return;
        return push({ type: 'user', text: c, ts });
      }
      for (const b of c || []) {
        if (b.type === 'tool_result') {
          const item = this.toolIndex.get(b.tool_use_id);
          if (item) {
            const content = Array.isArray(b.content) ? b.content.map((x) => (x.type === 'text' ? x.text : `[${x.type}]`)).join('\n') : String(b.content ?? '');
            item.result = content.slice(0, 4000);
            item.error = !!b.is_error;
            item.done = true;
            updated.push(item);
          }
        } else if (b.type === 'text' && !e.isMeta && !b.text.startsWith('<')) {
          push({ type: 'user', text: b.text, ts });
        } else if (b.type === 'image') {
          push({ type: 'user', text: '[ảnh]', ts });
        }
      }
    } else if (e.type === 'assistant' && e.message) {
      for (const b of e.message.content || []) {
        if (b.type === 'text' && b.text.trim()) push({ type: 'assistant', text: b.text, ts });
        else if (b.type === 'tool_use') {
          const item = { type: 'tool', id: b.id, name: b.name, input: b.input, ts, done: false };
          push(item);
          this.toolIndex.set(b.id, item);
        }
      }
    } else if (e.type === 'system' && e.subtype === 'api_error') {
      push({ type: 'system', text: `API error: ${e.error?.message || 'retrying…'}`, ts });
    }
  }

  /* ---------------- screen / status ---------------- */

  async pollScreen(force = false) {
    const running = await this.isRunning();
    let busy = false, prompt = null;
    if (this.headless) busy = running && this.pending > 0;
    else if (running) {
      try {
        const { stdout } = await this.tmuxCmd('capture-pane', '-p', '-t', this.tmux);
        busy = /esc to interrupt/i.test(stdout);
        const lines = stdout.split('\n');
        prompt = parsePrompt(lines);
        if (this.terminalWatchers > 0 || force) {
          const { stdout: ansi } = await this.tmuxCmd('capture-pane', '-p', '-e', '-t', this.tmux);
          const { stdout: dims } = await this.tmuxCmd('display-message', '-p', '-t', this.tmux, '#{pane_width} #{pane_height} #{cursor_x} #{cursor_y}');
          const [cols, rows, cx, cy] = dims.trim().split(' ').map(Number);
          if (ansi !== this.screen || force) {
            this.screen = ansi;
            this.emit('screen', { screen: ansi, cols, rows, cx, cy });
          }
        }
      } catch { /* pane went away */ }
    }
    const next = { ...this.status, running, busy, prompt };
    if (JSON.stringify(next) !== JSON.stringify(this.status)) {
      this.status = next;
      this.emit('status', this.status);
    }
  }

  watch() {
    this.pickLatest();
    const tick = async () => {
      try { this.pickLatest(); this.readNew(); await this.pollScreen(); } catch (e) { console.warn('[claude]', e.message); }
      setTimeout(tick, this.terminalWatchers > 0 ? 250 : 700);
    };
    tick();
  }

  snapshot() {
    // tmux: null → headless (no shared terminal to attach to)
    return { status: this.status, items: this.items, tmux: this.headless ? null : this.tmux, cwd: this.cwd };
  }
}
