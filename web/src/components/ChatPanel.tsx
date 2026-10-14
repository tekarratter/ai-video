import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { findClip } from '../../../shared/timeline.js';
import { useStore, type ChatItem } from '../store';
import { currentTime } from '../player';
import { Icon } from './Icon';
import { TerminalView } from './TerminalView';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Prefill (and optionally send) a message in the chat panel from anywhere in the UI. */
export function askClaude(text: string, sendNow = false) {
  window.dispatchEvent(new CustomEvent('ask-claude', { detail: { text, sendNow } }));
}

function uiContext() {
  const s = useStore.getState();
  const parts = [`playhead ${currentTime().toFixed(2)}s`];
  if (s.selection) {
    const f = findClip(s.project, s.selection);
    if (f) parts.push(`clip đang chọn ${f.clip.id} (${f.clip.kind}${f.clip.text ? ` "${String(f.clip.text).slice(0, 40)}"` : ''}) trên track ${f.track.id}`);
    else if (s.project.assets.some((a: any) => a.id === s.selection)) parts.push(`asset đang chọn ${s.selection}`);
  }
  return `[UI] ${parts.join(' · ')}`;
}

export async function sendToClaude(text: string) {
  const r = await fetch('/api/chat/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!r.ok) useStore.getState().toast((await r.json()).error || 'Không gửi được', 'error');
}

const key = (k: string) => fetch('/api/chat/key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: k }) });

/* ---------- tiny markdown ---------- */
function inline(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('`')) out.push(<code key={i++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<b key={i++}>{t.slice(2, -2)}</b>);
    else if (t.startsWith('[')) { const mm = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!; out.push(<a key={i++} href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>); }
    else out.push(<i key={i++}>{t.slice(1, -1)}</i>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const Markdown: React.FC<{ text: string }> = ({ text }) => {
  const blocks: React.ReactNode[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      blocks.push(<pre key={i}><code>{code.join('\n')}</code></pre>);
    } else if (/^#{1,4}\s/.test(line)) {
      blocks.push(<div key={i} className="md-h">{inline(line.replace(/^#+\s/, ''))}</div>);
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s/, ''));
      i--;
      blocks.push(<ul key={i}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>);
    } else if (line.startsWith('|')) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) if (!/^\|[\s:|-]+\|$/.test(lines[i])) rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
      i--;
      blocks.push(<table key={i}><tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => (j === 0 ? <th key={k}>{inline(c)}</th> : <td key={k}>{inline(c)}</td>))}</tr>)}</tbody></table>);
    } else if (line.trim()) {
      blocks.push(<p key={i}>{inline(line)}</p>);
    }
  }
  return <div className="md">{blocks}</div>;
};

/* ---------- items ---------- */
function toolSummary(it: ChatItem) {
  const inp = it.input || {};
  switch (it.name) {
    case 'Bash': return inp.description || inp.command;
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': return String(inp.file_path || '').replace(/^.*\/workspace\//, '');
    case 'Glob': case 'Grep': return inp.pattern;
    case 'WebFetch': case 'WebSearch': return inp.url || inp.query;
    case 'TodoWrite': return `${(inp.todos || []).length} việc`;
    case 'Task': case 'Agent': return inp.description;
    default: return JSON.stringify(inp).slice(0, 80);
  }
}

const ToolItem: React.FC<{ it: ChatItem }> = ({ it }) => {
  const [open, setOpen] = useState(false);
  const img = it.name === 'Read' && /\.(jpe?g|png|webp)$/i.test(it.input?.file_path || '');
  const imgUrl = img ? String(it.input.file_path).replace(/^.*\/workspace\/(\.cache|media)\//, (_m, d) => `/${d === '.cache' ? 'cache' : 'media'}/`) : null;
  return (
    <div className={`tool-item ${it.error ? 'error' : ''}`}>
      <div className="tool-head" onClick={() => setOpen(!open)}>
        {it.done ? <Icon name={it.error ? 'x' : 'check'} size={12} /> : <span className="spinner" />}
        <b>{it.name}</b>
        <span className="tool-sum">{toolSummary(it)}</span>
        <Icon name={open ? 'chevdown' : 'chevron'} size={11} />
      </div>
      {imgUrl && imgUrl.startsWith('/') && <img className="tool-img" src={imgUrl} alt="" />}
      {open && (
        <div className="tool-body">
          {it.name === 'Bash' && <pre className="cmd">$ {it.input?.command}</pre>}
          {it.name === 'Edit' && <pre className="diff"><span className="del">{it.input?.old_string}</span>{'\n'}<span className="add">{it.input?.new_string}</span></pre>}
          {it.name === 'TodoWrite' && <ul>{(it.input?.todos || []).map((t: any, i: number) => <li key={i}>{t.status === 'completed' ? '☑' : '☐'} {t.content}</li>)}</ul>}
          {it.result && <pre className="result">{it.result}</pre>}
        </div>
      )}
    </div>
  );
};

const UserBubble: React.FC<{ text: string }> = ({ text }) => {
  const atts = [...text.matchAll(/(?:^|\s)@?(media\/[^\s,)]+\.(?:jpe?g|png|webp|gif|mp4|mov|webm|mp3|wav|m4a))/gi)].map((m) => m[1]);
  const clean = text.replace(/\n?\[UI\][^\n]*$/, '').replace(/\n?\(Đính kèm:[^)]*\)/, '').trim();
  const ctx = text.match(/\[UI\][^\n]*$/)?.[0];
  return (
    <div className="msg user">
      {atts.length > 0 && (
        <div className="atts">
          {atts.map((a) => (/\.(mp4|mov|webm)$/i.test(a) ? <video key={a} src={`/${a}`} muted /> : /\.(mp3|wav|m4a)$/i.test(a) ? <div key={a} className="att-file"><Icon name="music" /> {a.split('/').pop()}</div> : <img key={a} src={`/${a}`} alt="" />))}
        </div>
      )}
      <div className="bubble">{clean}</div>
      {ctx && <div className="ctx">{ctx.replace('[UI] ', '')}</div>}
    </div>
  );
};

const SUGGESTIONS = [
  'Xem các asset và dựng bản nháp video có chuyển cảnh, tiêu đề',
  'Cắt bỏ các khoảng lặng trong video',
  'Tạo phụ đề tiếng Việt từ giọng nói',
  'Tạo intro motion graphic cho video',
  'Thêm nhạc nền nhỏ, fade in/out',
  'Chuyển sang khung dọc 9:16 cho TikTok',
];

export const ChatPanel: React.FC = () => {
  const items = useStore((s) => s.chat);
  const status = useStore((s) => s.chatStatus);
  const tmux = useStore((s) => s.tmux);
  const [text, setText] = useState('');
  const [withCtx, setWithCtx] = useState(true);
  const [atts, setAtts] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [view, setView] = useState<'chat' | 'term'>('chat');
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, status.busy, status.prompt]);

  const submit = async (override?: string) => {
    const body = (override ?? text).trim();
    if (!body && !atts.length) return;
    let msg = body;
    if (atts.length) msg += `\n(Đính kèm: ${atts.join(', ')})`;
    if (withCtx) msg += `\n${uiContext()}`;
    setText('');
    setAtts([]);
    stick.current = true;
    await sendToClaude(msg);
  };

  useEffect(() => {
    const on = (e: Event) => {
      const { text: t, sendNow } = (e as CustomEvent).detail;
      setView('chat');
      if (sendNow) submit(t);
      else { setText(t); setTimeout(() => { taRef.current?.focus(); taRef.current?.setSelectionRange(t.length, t.length); }, 0); }
    };
    window.addEventListener('ask-claude', on);
    return () => window.removeEventListener('ask-claude', on);
  });

  const attach = async (files: FileList | File[]) => {
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append('files', f);
    setUploading(true);
    try {
      const r = await fetch('/api/chat/attach', { method: 'POST', body: fd });
      const j = await r.json();
      setAtts((a) => [...a, ...(j.paths || [])]);
    } finally { setUploading(false); }
  };

  const restart = async (mode: 'new' | 'continue') => {
    if (mode === 'new' && !confirm('Bắt đầu phiên Claude mới? (phiên cũ vẫn lưu, có thể /resume)')) return;
    await fetch('/api/chat/restart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
  };

  return (
    <div
      className={`chat panel ${dragging ? 'dropping' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) attach(e.dataTransfer.files); }}
    >
      <div className="chat-head">
        <span className={`dot ${!status.running ? 'off' : status.busy ? 'busy' : 'on'}`} />
        <div className="chat-title">
          <b>Claude Code</b>
          <span className="muted small" title="Gõ lệnh này trong terminal để dùng chung phiên CLI">tmux attach -t {tmux}</span>
        </div>
        <div className="spacer" />
        <div className="seg">
          <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')} title="Chat"><Icon name="chat" /></button>
          <button className={view === 'term' ? 'active' : ''} onClick={() => setView('term')} title="Terminal CLI (dùng chung)"><Icon name="terminal" /></button>
        </div>
        <button className="icon-btn" title="Phiên mới" onClick={() => restart('new')}><Icon name="plus" /></button>
      </div>

      {view === 'term' ? (
        <TerminalView />
      ) : (
        <>
          <div className="chat-list" ref={listRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
            {!status.running && (
              <div className="notice">
                Claude Code chưa chạy.
                <button className="btn small" onClick={() => restart('continue')}><Icon name="refresh" /> Khởi động (tiếp tục phiên trước)</button>
                <button className="btn small" onClick={() => restart('new')}>Phiên mới</button>
              </div>
            )}
            {items.length === 0 && status.running && (
              <div className="welcome">
                <div className="welcome-title"><Icon name="sparkle" size={18} /> Cùng dựng video với Claude</div>
                <p>Chat ở đây hoặc trong terminal (<code>tmux attach -t {tmux}</code>): hai nơi dùng chung một phiên. Claude chỉnh <code>project.json</code>, timeline cập nhật ngay.</p>
                <div className="chips">
                  {SUGGESTIONS.map((s) => <button key={s} onClick={() => submit(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {items.map((it) => {
              if (it.type === 'user') return <UserBubble key={it.key} text={it.text!} />;
              if (it.type === 'assistant') return <div key={it.key} className="msg assistant"><Markdown text={it.text!} /></div>;
              if (it.type === 'tool') return <ToolItem key={it.key} it={it} />;
              if (it.type === 'command') return <div key={it.key} className="msg system">⌘ {it.text}</div>;
              return <div key={it.key} className="msg system">{it.text}</div>;
            })}
            {status.prompt && (
              <div className="permission">
                <div className="perm-q"><Icon name="wrench" /> {status.prompt.question}</div>
                {status.prompt.context && <pre>{status.prompt.context}</pre>}
                <div className="perm-opts">
                  {status.prompt.options.map((o) => <button key={o.key} onClick={() => key(o.key)}>{o.key}. {o.label}</button>)}
                  <button onClick={() => key('Escape')}>Huỷ (Esc)</button>
                </div>
              </div>
            )}
            {status.busy && !status.prompt && (
              <div className="working"><span className="spinner" /> Claude đang làm việc…<button className="btn small" onClick={() => key('Escape')}><Icon name="stop" size={11} /> Dừng</button></div>
            )}
          </div>

          <div className="composer">
            {atts.length > 0 && (
              <div className="att-row">
                {atts.map((a) => (
                  <div key={a} className="att">
                    {/\.(jpe?g|png|webp|gif)$/i.test(a) ? <img src={`/${a}`} alt="" /> : <Icon name="film" />}
                    <button onClick={() => setAtts(atts.filter((x) => x !== a))}><Icon name="x" size={10} /></button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={taRef}
              rows={3}
              placeholder="Nhắn cho Claude… (Enter gửi, Shift+Enter xuống dòng, kéo thả ảnh/video vào đây)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
              onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); attach(e.clipboardData.files); } }}
            />
            <div className="composer-bar">
              <label className="icon-btn" title="Đính kèm ảnh/video">
                <Icon name="paperclip" />
                <input type="file" multiple hidden accept="image/*,video/*,audio/*" onChange={(e) => { if (e.target.files) attach(e.target.files); e.target.value = ''; }} />
              </label>
              {uploading && <span className="small muted">đang tải…</span>}
              <label className="ctx-toggle" title="Gửi kèm vị trí playhead và clip đang chọn">
                <input type="checkbox" checked={withCtx} onChange={(e) => setWithCtx(e.target.checked)} /> kèm ngữ cảnh
              </label>
              <div className="spacer" />
              {status.busy ? (
                <button className="btn small" onClick={() => key('Escape')} title="Ngắt (Esc)"><Icon name="stop" size={11} /> Dừng</button>
              ) : null}
              <button className="send" disabled={!text.trim() && !atts.length} onClick={() => submit()} title="Gửi"><Icon name="send" /></button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
