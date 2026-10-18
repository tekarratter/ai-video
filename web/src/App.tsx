import React, { useEffect, useState } from 'react';
import { toggleLayout, useStore, type Layout } from './store';
import { Icon } from './components/Icon';
import { ChatPanel } from './components/ChatPanel';
import { LeftPanel } from './components/LeftPanel';
import { Preview } from './components/Preview';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { YouTubeDialog } from './components/YouTubeDialog';
import { ClaudeAuthDialog, LoginScreen } from './components/Account';
import { ProjectsDialog } from './components/Projects';
import { CleanupDialog } from './components/Cleanup';
import { TelegramAdminDialog, TelegramDialog } from './components/Telegram';
import { DubDialog } from './components/DubDialog';
import { ArticleDialog } from './components/ArticleDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { deleteSelection, duplicateSelection, fps, seek, currentTime, splitAtPlayhead, togglePlay } from './player';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable], .xterm')) return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
      if (mod) return;
      switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break;
        case 's': case 'S': splitAtPlayhead(); break;
        case 'Delete': case 'Backspace': deleteSelection(); break;
        case 'Escape': s.select(null); break;
        case 'ArrowLeft': seek(currentTime() - (e.shiftKey ? 1 : 1 / fps())); break;
        case 'ArrowRight': seek(currentTime() + (e.shiftKey ? 1 : 1 / fps())); break;
        case 'Home': seek(0); break;
        case 'f': case 'F': window.dispatchEvent(new Event('preview-fullscreen')); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export const App: React.FC = () => {
  const user = useStore((s) => s.user);
  const authChecked = useStore((s) => s.authChecked);
  if (!authChecked) return <div className="loading">Đang tải…</div>;
  if (!user) return <LoginScreen />;
  return <Editor />;
};

/** Thin bar shown in place of a collapsed panel; click to expand. */
const Strip: React.FC<{ k: keyof Layout; label: string }> = ({ k, label }) => (
  <button className={`collapsed-strip ${k}`} onClick={() => toggleLayout(k)} title={`Mở ${label}`}>
    <Icon name={k === 'left' ? 'chevron' : k === 'right' ? 'chevron' : 'chevdown'} size={13} />
    <span>{label}</span>
  </button>
);

const Editor: React.FC = () => {
  const project = useStore((s) => s.project);
  const layout = useStore((s) => s.layout);
  const toasts = useStore((s) => s.toasts);
  const [chatW, setChatW] = useState(400);
  const [tlH, setTlH] = useState(300);
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [chatOpen, setChatOpen] = useState(false);
  const [portraitOk, setPortraitOk] = useState(() => { try { return sessionStorage.getItem('aiv.portraitOk') === '1'; } catch { return false; } });
  useShortcuts();
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    const tog = () => setChatOpen((o) => !o);
    window.addEventListener('resize', on);
    window.addEventListener('toggle-chat', tog);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('toggle-chat', tog); };
  }, []);
  // phones / small tablets: chat becomes a drawer, timeline shrinks so the preview keeps some room
  const compact = vp.w < 1200 || vp.h < 520;
  const tl = compact ? Math.min(tlH, Math.max(110, Math.round(vp.h * 0.38))) : Math.min(tlH, Math.max(160, vp.h - 250));

  const drag = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    const start = axis === 'x' ? e.clientX : e.clientY;
    const init = axis === 'x' ? chatW : tl;
    const move = (ev: PointerEvent) => {
      if (axis === 'x') setChatW(Math.min(700, Math.max(300, init + ev.clientX - start)));
      else setTlH(Math.min(window.innerHeight - 150, Math.max(110, init - (ev.clientY - start))));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className={`app ${compact ? 'compact' : ''}`} style={{ gridTemplateColumns: compact ? 'minmax(0, 1fr)' : `${chatW}px 4px minmax(0, 1fr)` }}>
      <div className={compact ? `chat-drawer ${chatOpen ? 'open' : ''}` : 'chat-slot'}>
        <ErrorBoundary label="chat"><ChatPanel /></ErrorBoundary>
      </div>
      {compact && chatOpen && <div className="chat-scrim" onClick={() => setChatOpen(false)} />}
      {!compact && <div className="splitter-x" onPointerDown={drag('x')} />}
      <div className="editor" style={{ gridTemplateRows: layout.timeline ? 'auto minmax(0, 1fr) 0px 39px' : `auto minmax(0, 1fr) 4px ${tl}px` }}>
        <TopBar />
        {project ? (
          <div className="editor-main" style={{ ...(layout.left ? { '--lw': '30px' } : {}), ...(layout.right ? { '--rw': '30px' } : {}) } as React.CSSProperties}>
            {layout.left && <Strip k="left" label="Assets" />}
            <div style={{ display: layout.left ? 'none' : 'contents' }}><ErrorBoundary label="panel trái"><LeftPanel /></ErrorBoundary></div>
            <ErrorBoundary label="preview"><Preview /></ErrorBoundary>
            {layout.right && <Strip k="right" label="Inspector" />}
            <div style={{ display: layout.right ? 'none' : 'contents' }}><ErrorBoundary label="inspector"><Inspector /></ErrorBoundary></div>
          </div>
        ) : (
          <div className="loading">Đang kết nối server…</div>
        )}
        <div className="splitter-y" style={layout.timeline ? { display: 'none' } : undefined} onPointerDown={drag('y')} />
        {project && <ErrorBoundary label="timeline"><Timeline /></ErrorBoundary>}
      </div>
      <YouTubeDialog />
      <ProjectsDialog />
      <CleanupDialog />
      <TelegramDialog />
      <TelegramAdminDialog />
      <DubDialog />
      <ArticleDialog />
      <ClaudeAuthDialog />
      {vp.h > vp.w && vp.w < 760 && !portraitOk && (
        <div className="rotate-hint">
          <div className="rotate-icon">📱</div>
          <b>Xoay ngang điện thoại</b>
          <div className="muted">Màn hình dọc quá hẹp để dựng phim. Xoay ngang để xem đủ khung xem trước, timeline và các bảng.</div>
          <button className="btn ghost" onClick={() => { setPortraitOk(true); try { sessionStorage.setItem('aiv.portraitOk', '1'); } catch { /* private mode */ } }}>Vẫn dùng màn dọc</button>
        </div>
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level || ''}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
};
