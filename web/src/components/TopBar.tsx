import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Icon } from './Icon';
import { openYouTube } from './YouTubeDialog';
import { UserMenu } from './Account';
import { openProjects } from './Projects';
import { UploadProgress } from './LeftPanel';

export async function startRender(quality: 'final' | 'draft') {
  const r = await fetch('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quality }) });
  const j = await r.json();
  if (!r.ok) useStore.getState().toast(j.error || 'Render lỗi', 'error');
  else useStore.getState().toast(quality === 'draft' ? 'Bắt đầu render nháp…' : 'Bắt đầu render…');
}

export async function stopRender() {
  if (!confirm('Dừng render đang chạy? Phần đã render sẽ bị bỏ.')) return;
  const r = await fetch('/api/render/stop', { method: 'POST' });
  if (!r.ok) useStore.getState().toast((await r.json().catch(() => ({}))).error || 'Không dừng được', 'error');
}

export const TopBar: React.FC = () => {
  const project = useStore((s) => s.project);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const flash = useStore((s) => s.remoteFlash);
  const renderJob = useStore((s) => Object.values(s.jobs).filter((j) => j.type === 'render').sort((a, b) => b.startedAt - a.startedAt)[0]);
  const [showFlash, setShowFlash] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!flash) return;
    setShowFlash(true);
    const t = setTimeout(() => setShowFlash(false), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const rendering = renderJob && !['done', 'error'].includes(renderJob.stage);

  return (
    <div className="topbar">
      <div className="brand"><span className="logo">▶</span> AI Video Studio</div>
      <button className="btn ghost" title="Danh sách dự án / tạo dự án mới" onClick={openProjects}><Icon name="folder" /> Dự án ▾</button>
      <input
        className="project-name"
        value={project?.name || ''}
        onChange={(e) => useStore.getState().update((p) => { p.name = e.target.value; })}
      />
      <button className="icon-btn" title="Hoàn tác (Ctrl+Z)" disabled={!canUndo} onClick={() => useStore.getState().undo()}><Icon name="undo" /></button>
      <button className="icon-btn" title="Làm lại (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => useStore.getState().redo()}><Icon name="redo" /></button>
      {showFlash && <span className="ai-flash"><Icon name="sparkle" /> Claude vừa cập nhật timeline — Ctrl+Z để hoàn tác</span>}
      <div className="spacer" />
      <UploadProgress compact />
      {rendering && (
        <div className="render-progress" title={renderJob.stage}>
          <span>{renderJob.stage === 'stopping' ? 'Đang dừng…' : renderJob.stage === 'bundle' ? 'Đóng gói' : renderJob.stage === 'browser' ? 'Chuẩn bị' : 'Render'} {renderJob.stage !== 'stopping' && `${Math.round(renderJob.progress * 100)}%`}</span>
          <div className="bar"><div style={{ width: `${renderJob.progress * 100}%` }} /></div>
        </div>
      )}
      {rendering && renderJob.stage !== 'stopping' && (
        <button className="btn danger small" title="Dừng render" onClick={stopRender}><Icon name="stop" /> Dừng</button>
      )}
      {renderJob?.stage === 'error' && !renderJob.cancelled && (
        <span className="render-error" title={renderJob.error}>⚠ Render lỗi — xem tab Jobs</span>
      )}
      {renderJob?.stage === 'done' && renderJob.url && (
        <>
          <a className="btn ghost" href={renderJob.url} target="_blank" rel="noreferrer" download><Icon name="download" /> Tải video</a>
          <button className="btn yt" onClick={() => openYouTube(renderJob.file)}>▶ Đăng YouTube</button>
        </>
      )}
      <div className="split-btn">
        <button className="btn primary" disabled={rendering} onClick={() => startRender('final')}><Icon name="rocket" /> Render</button>
        <button className="btn primary caret" onClick={() => setMenu(!menu)}>▾</button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            <button onClick={() => { setMenu(false); startRender('final'); }}>Render MP4 (chất lượng cao)</button>
            <button onClick={() => { setMenu(false); startRender('draft'); }}>Render nháp (½ độ phân giải)</button>
          </div>
        )}
      </div>
      <UserMenu />
    </div>
  );
};
