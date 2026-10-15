// Bridge between the web chat panel and ONE interactive Claude Code process running in tmux.
// The CLI and the panel share the same session:
//   - CLI  -> panel : we tail the session transcript (~/.claude/projects/<cwd>/<session>.jsonl)
//   - panel -> CLI  : we paste the text into the tmux pane (tmux paste-buffer + Enter)
// Users attach to the same CLI with:  tmux attach -t ai-video
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { execFile, spawn } from 'node:child_process';
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
  }

  async tmuxCmd(...args) {
    return exec('tmux', args, { maxBuffer: 8 * 1024 * 1024 });
  }

  async isRunning() {
    try { await this.tmuxCmd('has-session', '-t', `=${this.tmux}`); return true; } catch { return false; }
  }

  /** Start claude inside tmux (if not already running). `resume`: session id, or 'continue'. */
  async start({ resume } = {}) {
    if (await this.isRunning()) return;
    const id = crypto.randomUUID();
    let cmd = `claude ${this.claudeArgs}`.trim();
    const hasHistory = fs.existsSync(this.projectDir) && fs.readdirSync(this.projectDir)
      .some((f) => f.endsWith('.jsonl') && fs.readFileSync(path.join(this.projectDir, f), 'utf8').includes('"type":"user"'));
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
    await this.tmuxCmd('kill-session', '-t', `=${this.tmux}`).catch(() => {});
  }

  async restart({ resume } = {}) {
    await this.stop();
    await new Promise((r) => setTimeout(r, 300));
    await this.start({ resume });
  }

  /** Type a (possibly multi-line) message into the CLI and submit it. */
  async send(text) {
    if (!(await this.isRunning())) await this.start({ resume: this.status.sessionId || undefined });
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
    if (!(await this.isRunning())) return;
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
    if (!(await this.isRunning())) return;
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
    if (running) {
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
    return { status: this.status, items: this.items, tmux: this.tmux, cwd: this.cwd };
  }
}
