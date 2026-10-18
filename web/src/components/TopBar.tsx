import React, { useEffect, useState } from 'react';
import { flushSave, useStore } from '../store';
import { Icon } from './Icon';
import { openYouTube } from './YouTubeDialog';
import { UserMenu } from './Account';
import { openProjects } from './Projects';
import { UploadProgress } from './LeftPanel';

export async function startRender(quality: 'final' | 'draft', target?: 'facebook', continuous = false) {
  const st = useStore.getState();
  if (target === 'facebook' && st.project && st.project.settings.width > st.project.settings.height)
    st.toast('Dự án đang khung ngang — trên điện thoại Facebook sẽ hiện nhỏ. Nên đổi khung 9:16 (1080×1920) trước khi render.', 'error');
  await flushSave(); // render exactly what is on screen; the server snapshots the project now
  const r = await fetch('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quality, target, continuous }) });
  const j = await r.json();
  if (!r.ok) st.toast(j.error || 'Render lỗi', 'error');
  else if (j.queued) st.toast(`Đã lưu trạng thái dự án và xếp hàng — chờ ${j.queued} render trước. Bạn có thể chuyển sang dự án khác.`);
  else st.toast(`${target === 'facebook' ? 'Bắt đầu render bản Facebook di động' : quality === 'draft' ? 'Bắt đầu render nháp' : 'Bắt đầu render'} — đã lưu trạng thái dự án, bạn có thể chuyển sang dự án khác.`);
}

/** "3 phút", "1 giờ 5 phút", "40 giây" */
export function fmtEta(s?: number) {
  if (!s) return '';
  if (s >= 3600) return `${Math.floor(s / 3600)} giờ ${Math.round((s % 3600) / 60)} phút`;
  if (s >= 90) return `${Math.round(s / 60)} phút`;
  return `${Math.max(5, Math.round(s / 5) * 5)} giây`;
}

export async function stopRender(id?: string) {
  if (!confirm('Dừng render này? Các cảnh đã xong được giữ lại để lần sau làm tiếp.')) return;
  const r = await fetch('/api/render/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
  if (!r.ok) useStore.getState().toast((await r.json().catch(() => ({}))).error || 'Không dừng được', 'error');
}

export const TopBar: React.FC = () => {
  const project = useStore((s) => s.project);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const flash = useStore((s) => s.remoteFlash);
  // only the open project's render: the Download/YouTube buttons refer to this project's exports
  // the running render (any project) first, else the open project's latest: Download/YouTube refer to its exports
  const renderJob = useStore((s) => {
    const all = Object.values(s.jobs).filter((j) => j.type === 'render');
    const live = all.filter((j) => !['done', 'error'].includes(j.stage)).sort((a, b) => a.startedAt - b.startedAt);
    return live.find((j) => j.stage !== 'queued') || live[0]
      || all.filter((j) => !j.projectId || j.projectId === s.activeProject).sort((a, b) => b.startedAt - a.startedAt)[0];
  });
  const queuedCount = useStore((s) => Object.values(s.jobs).filter((j) => j.type === 'render' && j.stage === 'queued').length);
  const activeProject = useStore((s) => s.activeProject);
  const [showFlash, setShowFlash] = useState(false);
  const [menu, setMenu] = useState(false);
  const safePreview = useStore((s) => s.safePreview);

  useEffect(() => {
    if (!flash) return;
    setShowFlash(true);
    const t = setTimeout(() => setShowFlash(false), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const rendering = renderJob && !['done', 'error'].includes(renderJob.stage);

  return (
    <div className="topbar">
      <button className="icon-btn chat-toggle" title="Chat với Claude" onClick={() => window.dispatchEvent(new Event('toggle-chat'))}><Icon name="chat" /></button>
      <div className="brand"><span className="logo">▶</span> <span className="brand-name">AI Video Studio</span></div>
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
        <div className="render-progress" title={`${renderJob.label}${queuedCount && renderJob.stage !== 'queued' ? ` · ${queuedCount} render đang chờ` : ''}`}>
          <span>
            {renderJob.projectId && renderJob.projectId !== activeProject ? `${renderJob.projectName} · ` : ''}
            {renderJob.stage === 'stopping' ? 'Đang dừng…' : renderJob.stage === 'queued' ? 'Chờ lượt' : renderJob.stage === 'bundle' ? 'Đóng gói' : renderJob.stage === 'browser' ? 'Chuẩn bị' : renderJob.stage === 'audio' ? 'Âm thanh' : renderJob.stage === 'join' ? 'Ghép cảnh' : renderJob.current ? `Cảnh ${renderJob.current.split(' · ')[0]}` : 'Render'} {!['stopping', 'queued'].includes(renderJob.stage) && `${Math.round(renderJob.progress * 100)}%`}
            {renderJob.eta ? ` · còn ~${fmtEta(renderJob.eta)}` : ''}{queuedCount && renderJob.stage !== 'queued' ? ` · +${queuedCount} chờ` : ''}
          </span>
          <div className="bar"><div style={{ width: `${renderJob.progress * 100}%` }} /></div>
        </div>
      )}
      {rendering && renderJob.stage !== 'stopping' && (
        <button className="btn danger small" title="Dừng render" onClick={() => stopRender(renderJob.id)}><Icon name="stop" /> Dừng</button>
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
        <button className="btn primary" title={rendering ? 'Đang có render chạy — bấm để xếp hàng render dự án này' : 'Render video (theo cảnh)'} onClick={() => startRender('final')}><Icon name="rocket" /> Render</button>
        <button className="btn primary caret" onClick={() => setMenu(!menu)}>▾</button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            <button title="Render theo từng cảnh: cảnh không đổi được dùng lại, bị dừng thì lần sau làm tiếp" onClick={() => { setMenu(false); startRender('final'); }}>Render MP4 (chất lượng cao, theo cảnh)</button>
            <button title="Render từ đầu đến cuối trong một lượt, không chia cảnh, không dùng lại phần cũ" onClick={() => { setMenu(false); startRender('final', undefined, true); }}>Render liền một lượt từ đầu (không chia cảnh)</button>
            <button onClick={() => { setMenu(false); startRender('draft'); }}>Render nháp (½ độ phân giải)</button>
            <button title="Logo, ảnh nhỏ, phụ đề được kéo vào vùng không bị giao diện Facebook trên điện thoại che" onClick={() => { setMenu(false); startRender('final', 'facebook'); }}>Render cho Facebook di động (dọc, tránh vùng bị che)</button>
            <button onClick={() => { setMenu(false); useStore.setState((s) => ({ safePreview: s.safePreview ? null : 'facebook' })); }}>{safePreview ? '✓ ' : ''}Xem trước như Facebook di động</button>
          </div>
        )}
      </div>
      <UserMenu />
    </div>
  );
};
