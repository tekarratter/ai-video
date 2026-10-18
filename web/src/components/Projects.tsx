import React, { useEffect, useRef, useState } from 'react';
import { flushSave, rememberProject, useStore } from '../store';
import { api } from './Account';
import { Icon } from './Icon';
import { uploadParts } from '../upload';
import { openCleanup } from './Cleanup';
import { openArticle } from './ArticleDialog';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PRESETS = [
  { label: '9:16 · 1080×1920 (Reels/TikTok/Shorts)', w: 1080, h: 1920 },
  { label: '16:9 · 1920×1080 (YouTube)', w: 1920, h: 1080 },
  { label: '1:1 · 1080×1080', w: 1080, h: 1080 },
  { label: '4:5 · 1080×1350', w: 1080, h: 1350 },
  { label: '4K · 3840×2160', w: 3840, h: 2160 },
];

const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return new Date(t).toLocaleDateString('vi-VN');
};

export function openProjects() { window.dispatchEvent(new Event('open-projects')); }

export const ProjectsDialog: React.FC = () => {
  const projects = useStore((s) => s.projects);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState('');
  const restoreRef = useRef<HTMLInputElement>(null);

  const backup = (p: any) => {
    const withExports = !p.exports || confirm(`Kèm ${p.exports} video đã xuất vào bản sao lưu?\n\nOK = kèm (file lớn hơn) · Huỷ = chỉ timeline + media + motion + hội thoại Claude`);
    const a = document.createElement('a');
    a.href = `/api/projects/${p.id}/backup${withExports ? '' : '?exports=0'}`;
    a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
    useStore.getState().toast(`Đang tạo bản sao lưu "${p.name}" — trình duyệt sẽ tải file .zip về`);
  };
  const restore = async (file: File) => {
    setErr('');
    try {
      setRestoring('0%');
      const uploadId = await uploadParts(file, (l, t) => setRestoring(`${t ? Math.floor((l / t) * 100) : 100}%`));
      setRestoring('đang giải nén…');
      await api('/api/projects/restore', 'POST', { uploadId, size: file.size, fileName: file.name });
      window.dispatchEvent(new Event('show-jobs'));
    } catch (e: any) { setErr(`Khôi phục lỗi: ${e.message}`); } finally { setRestoring(''); }
  };

  const refresh = () => api('/api/projects').then((r) => useStore.setState({ projects: r.projects, activeProject: r.active })).catch((e) => setErr(e.message));
  useEffect(() => {
    const on = () => { setOpen(true); setErr(''); setCreating(false); refresh(); };
    window.addEventListener('open-projects', on);
    return () => window.removeEventListener('open-projects', on);
  }, []);
  if (!open) return null;

  const run = async (fn: () => Promise<any>, close = false) => {
    setBusy(true); setErr('');
    try {
      const r = await fn();
      if (r?.projects) useStore.setState({ projects: r.projects, activeProject: r.active });
      if (close) setOpen(false);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const openP = (id: string) => run(async () => { await flushSave(); rememberProject(); return api(`/api/projects/${id}/open`, 'POST'); }, true);
  const create = () => run(async () => { await flushSave(); rememberProject(); return api('/api/projects', 'POST', { name: name.trim() || 'Dự án mới', width: PRESETS[preset].w, height: PRESETS[preset].h, fps: 30 }); }, true);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal wide">
        <div className="modal-head">
          <b><Icon name="folder" /> Dự án</b>
          <span className="spacer" />
          <button className="btn small" title="Xem video render của mọi dự án, chọn file cũ để xoá" onClick={() => { setOpen(false); openCleanup(); }}><Icon name="trash" /> Dọn dẹp ổ cứng</button>
          <div className="spacer" />
          <button className="btn small" disabled={!!restoring} onClick={() => restoreRef.current?.click()} title="Tạo dự án mới từ file sao lưu .zip">
            <Icon name="upload" /> {restoring ? `Đang tải lên ${restoring}` : 'Khôi phục từ file…'}
          </button>
          <input ref={restoreRef} type="file" hidden accept=".zip,application/zip" onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ''; }} />
          <button className="btn small" title="Dán link bài báo / diễn đàn → dự án mới có video đọc bài, ảnh trong bài, phụ đề" onClick={() => { setOpen(false); openArticle({ newProject: true }); }}><Icon name="text" /> Tạo từ link bài viết</button>
          <button className="btn primary small" onClick={() => setCreating(!creating)}><Icon name="plus" /> Dự án mới</button>
          <button className="icon-btn" onClick={() => setOpen(false)}><Icon name="x" /></button>
        </div>
        {creating && (
          <form className="form new-project" onSubmit={(e) => { e.preventDefault(); create(); }}>
            <label className="field"><span>Tên</span><input autoFocus placeholder="VD: Tour Sapa tháng 11" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field"><span>Khung hình</span>
              <select value={preset} onChange={(e) => setPreset(Number(e.target.value))}>{PRESETS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}</select>
            </label>
            <div className="row gap"><div className="spacer" /><button className="btn primary" disabled={busy}>Tạo và mở</button></div>
          </form>
        )}
        {err && <div className="error small">{err}</div>}
        <div className="project-grid">
          {projects.map((p) => (
            <div key={p.id} className={`project-card ${p.active ? 'active' : ''}`}>
              <div className="project-thumb" style={{ aspectRatio: `${p.width} / ${p.height}` }} onClick={() => !p.active && openP(p.id)}>
                {p.thumb ? <img src={p.thumb} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} /> : <Icon name="film" size={22} />}
                {p.active && <span className="badge">Đang mở</span>}
              </div>
              <div className="project-info">
                <b className="ellipsis" title={p.name}>{p.name}</b>
                <span className="muted small">{p.width}×{p.height} · {p.duration.toFixed(1)}s · {p.assets} asset{p.exports ? ` · ${p.exports} video` : ''}</span>
                <span className="muted small">{ago(p.updatedAt)}</span>
              </div>
              <div className="row gap">
                {!p.active && <button className="btn small primary" disabled={busy} onClick={() => openP(p.id)}>Mở</button>}
                <button className="icon-btn" title="Đổi tên" onClick={() => { const n = prompt('Tên mới:', p.name); if (n) run(() => api(`/api/projects/${p.id}`, 'PATCH', { name: n })); }}><Icon name="text" /></button>
                <button className="icon-btn" title="Sao lưu ra file .zip (timeline, media, video xuất, motion component, hội thoại Claude)" onClick={() => backup(p)}><Icon name="download" /></button>
                <button className="icon-btn" title="Nhân bản (kèm media)" disabled={busy} onClick={() => run(() => api(`/api/projects/${p.id}/duplicate`, 'POST'))}><Icon name="copy" /></button>
                {!p.active && <button className="icon-btn" title="Xoá" onClick={() => confirm(`Xoá project "${p.name}"? (chuyển vào workspace/projects/.trash)`) && run(() => api(`/api/projects/${p.id}`, 'DELETE'))}><Icon name="trash" /></button>}
              </div>
            </div>
          ))}
        </div>
        <div className="muted small">Mỗi dự án có timeline, media, video xuất và cuộc trò chuyện với Claude riêng; chuyển qua lại vẫn giữ playhead, clip đang chọn và lịch sử hoàn tác. Motion component (thư mục custom) dùng chung. Nút <Icon name="download" size={11} /> sao lưu dự án ra file .zip để cất giữ hoặc chuyển sang máy khác.</div>
      </div>
    </div>
  );
};
