import React, { useEffect, useState } from 'react';
import { useStore } from './store';
import { ChatPanel } from './components/ChatPanel';
import { LeftPanel } from './components/LeftPanel';
import { Preview } from './components/Preview';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { YouTubeDialog } from './components/YouTubeDialog';
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export const App: React.FC = () => {
  const project = useStore((s) => s.project);
  const toasts = useStore((s) => s.toasts);
  const [chatW, setChatW] = useState(400);
  const [tlH, setTlH] = useState(300);
  useShortcuts();

  const drag = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    const start = axis === 'x' ? e.clientX : e.clientY;
    const init = axis === 'x' ? chatW : tlH;
    const move = (ev: PointerEvent) => {
      if (axis === 'x') setChatW(Math.min(700, Math.max(300, init + ev.clientX - start)));
      else setTlH(Math.min(window.innerHeight - 250, Math.max(160, init - (ev.clientY - start))));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="app" style={{ gridTemplateColumns: `${chatW}px 4px 1fr` }}>
      <ChatPanel />
      <div className="splitter-x" onPointerDown={drag('x')} />
      <div className="editor" style={{ gridTemplateRows: `auto 1fr 4px ${tlH}px` }}>
        <TopBar />
        {project ? (
          <div className="editor-main">
            <LeftPanel />
            <Preview />
            <Inspector />
          </div>
        ) : (
          <div className="loading">Đang kết nối server…</div>
        )}
        <div className="splitter-y" onPointerDown={drag('y')} />
        {project && <Timeline />}
      </div>
      <YouTubeDialog />
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level || ''}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
};
