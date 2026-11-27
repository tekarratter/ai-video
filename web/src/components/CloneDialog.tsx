// "Clone video → Template": upload a reference video (or paste a link). The server analyses it (cuts, beat, speech
// with word times, frame grids), opens a project of its own and hands Claude the brief: rebuild it as an editable
// skeleton and write a reusable template (hypit's "clone any viral video" workflow, inside this editor).
import React, { useEffect, useState } from 'react';
import { flushSave, rememberProject, useStore } from '../store';
import { uploadParts } from '../upload';
import { api } from './Account';
import { Icon } from './Icon';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const openClone = () => window.dispatchEvent(new Event('open-clone'));
const showEditor = () => window.dispatchEvent(new Event('show-editor'));

const LANGS: [string, string][] = [['auto', 'Tự nhận'], ['vi', 'Tiếng Việt'], ['en', 'Tiếng Anh'], ['zh', 'Tiếng Trung'], ['ko', 'Tiếng Hàn'], ['ja', 'Tiếng Nhật'], ['es', 'Tiếng Tây Ban Nha']];

export const CloneDialog: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'file' | 'link'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [lang, setLang] = useState('auto');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    const on = () => { setOpen(true); setErr(''); };
    window.addEventListener('open-clone', on);
    return () => window.removeEventListener('open-clone', on);
  }, []);
  if (!open) return null;

  const close = () => { if (!busy) { setOpen(false); setFile(null); setUrl(''); setName(''); setNotes(''); } };
  const ready = mode === 'file' ? !!file : /^https?:\/\/\S+\.\S+/.test(url.trim());

  const submit = async () => {
    setErr('');
    try {
      await flushSave(); rememberProject();
      const body: any = { name: name.trim(), lang, notes: notes.trim() };
      if (mode === 'file' && file) {
        setBusy('Đang tải video lên… 0%');
        body.uploadId = await uploadParts(file, (l, t) => setBusy(`Đang tải video lên… ${t ? Math.round((l / t) * 100) : 100}%`));
        body.size = file.size;
        body.fileName = file.name;
      } else body.url = url.trim();
      setBusy('Bắt đầu phân tích…');
      const r = await api('/api/clone', 'POST', body);
      if (r?.projects) useStore.setState({ projects: r.projects, activeProject: r.active });
      useStore.getState().toast('Đang phân tích video mẫu (xem tab Jobs) — xong thì Claude dựng template trong khung chat');
      setBusy('');
      close();
      setOpen(false);
      showEditor();
    } catch (e: any) { setErr(e.message); setBusy(''); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal" style={{ width: 'min(560px, calc(100vw - 32px))' }}>
        <div className="modal-head">
          <b>🧬 Clone video → Template</b>
          <div className="spacer" />
          <button className="icon-btn" onClick={close} disabled={!!busy}><Icon name="x" /></button>
        </div>
        <div className="form">
          <div className="muted small">
            Đưa một video bạn thích (TikTok viral, quảng cáo hiệu quả, review sản phẩm…). App tìm điểm cắt cảnh, nhịp nhạc, lời thoại
            từng từ và chụp lưới khung hình; Claude xem toàn bộ, giải thích vì sao video cuốn, <b>dựng lại thành dự án sửa được</b> và
            lưu thành <b>template của bạn</b>: giữ cấu trúc, nhịp, kiểu chữ/hiệu ứng — thay chủ đề, sản phẩm, hình, giọng.
          </div>
          <div className="field"><span>Video mẫu</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="seg">
                <button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>Tải video lên</button>
                <button className={mode === 'link' ? 'active' : ''} onClick={() => setMode('link')}>Link</button>
              </div>
              {mode === 'file'
                ? (
                  <div>
                    <label className="btn small"><Icon name="upload" /> Chọn video
                      <input type="file" hidden accept="video/*" onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f); if (f && !name) setName(f.name.replace(/\.[^.]+$/, '')); e.target.value = ''; }} />
                    </label>
                    {file && <span className="small" style={{ marginLeft: 8 }}>{file.name} · {(file.size / 1e6).toFixed(1)} MB</span>}
                  </div>
                )
                : <input placeholder="https://www.tiktok.com/@…/video/… · YouTube Shorts · Reels" value={url} onChange={(e) => setUrl(e.target.value)} />}
            </div>
          </div>
          <label className="field"><span>Tên template</span><input placeholder="VD: Review laptop 30 giây" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>Ngôn ngữ lời thoại</span>
            <select value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label className="field"><span>Muốn giữ / thay gì</span>
            <textarea rows={3} placeholder="VD: giữ nhịp cắt và kiểu phụ đề; thay sản phẩm bằng laptop của shop, giọng đọc tiếng Việt" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="muted small">Chỉ dùng video bạn có quyền tham khảo. Template học cấu trúc và phong cách — không sao chép hình ảnh, nhân vật hay logo của video gốc.</div>
          {err && <div className="error small">{err}</div>}
          <div className="row gap">
            {busy && <span className="small muted">{busy}</span>}
            <div className="spacer" />
            <button className="btn" onClick={close} disabled={!!busy}>Huỷ</button>
            <button className="btn primary" disabled={!ready || !!busy} onClick={submit}><Icon name="sparkle" /> Phân tích &amp; tạo template</button>
          </div>
        </div>
      </div>
    </div>
  );
};
