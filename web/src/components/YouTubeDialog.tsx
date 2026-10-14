import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { onMessage } from '../ws';
import { Icon } from './Icon';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Status = { configured: boolean; connected: boolean; channel: { id: string; title: string } | null };

export function openYouTube(file?: string) {
  window.dispatchEvent(new CustomEvent('open-youtube', { detail: { file } }));
}

const post = async (url: string, body?: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};

const Setup: React.FC<{ onDone: (s: Status) => void }> = ({ onDone }) => {
  const [json, setJson] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="yt-setup">
      <ol>
        <li>Mở <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud Console</a>, tạo project (hoặc dùng project có sẵn).</li>
        <li>Bật <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">YouTube Data API v3</a>.</li>
        <li>Vào <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">Google Auth Platform</a>: cấu hình màn hình đồng ý (External), thêm email của bạn vào <b>Test users</b>.</li>
        <li><a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Clients</a> → Create client → loại <b>Desktop app</b> → tải file JSON.</li>
        <li>Dán nội dung file JSON vào ô dưới.</li>
      </ol>
      <textarea rows={5} placeholder='{"installed":{"client_id":"…","client_secret":"…"}}' value={json} onChange={(e) => setJson(e.target.value)} />
      {err && <div className="error small">{err}</div>}
      <button className="btn primary" onClick={async () => { try { setErr(''); onDone(await post('/api/youtube/client', { json })); } catch (e: any) { setErr(e.message); } }}>Lưu</button>
      <div className="muted small">Thông tin lưu ở <code>~/.config/ai-video/youtube.json</code> trên server, không nằm trong repo.</div>
    </div>
  );
};

const Connect: React.FC<{ onDone: (s: Status) => void }> = ({ onDone }) => {
  const [opened, setOpened] = useState(false);
  const [pasted, setPasted] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="yt-setup">
      <p>Đăng nhập Google và cho phép ứng dụng đăng video lên kênh của bạn.</p>
      <button className="btn primary" onClick={async () => {
        try { const { url } = await post('/api/youtube/auth-url'); window.open(url, '_blank'); setOpened(true); } catch (e: any) { setErr(e.message); }
      }}><Icon name="link" /> Kết nối YouTube</button>
      {opened && (
        <>
          <p className="small muted">
            Sau khi bấm "Allow", Google chuyển về <code>http://localhost:…/api/youtube/callback</code>.
            Nếu bạn mở editor từ máy khác thì trang đó sẽ báo không truy cập được. Khi đó hãy <b>copy toàn bộ URL trên thanh địa chỉ</b> và dán vào đây:
          </p>
          <input placeholder="http://localhost:3001/api/youtube/callback?code=…" value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <button className="btn" onClick={async () => { try { setErr(''); onDone(await post('/api/youtube/code', { input: pasted })); } catch (e: any) { setErr(e.message); } }}>Xác nhận</button>
        </>
      )}
      {err && <div className="error small">{err}</div>}
    </div>
  );
};

export const YouTubeDialog: React.FC = () => {
  const project = useStore((s) => s.project);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [exports, setExports] = useState<any[]>([]);
  const [file, setFile] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [tags, setTags] = useState('');
  const [privacy, setPrivacy] = useState('private');
  const [shorts, setShorts] = useState(false);
  const [kids, setKids] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const refresh = () => fetch('/api/youtube/status').then((r) => r.json()).then(setStatus);

  useEffect(() => {
    const on = (e: Event) => {
      setOpen(true);
      setErr('');
      refresh();
      fetch('/api/exports').then((r) => r.json()).then((list) => {
        setExports(list);
        const want = (e as CustomEvent).detail?.file;
        setFile(want || (list[0] ? `exports/${list[0].name}` : ''));
      });
      const p = useStore.getState().project;
      setTitle(p?.name || '');
      const { width, height } = p?.settings || {};
      setShorts(height > width);
    };
    window.addEventListener('open-youtube', on);
    const off = onMessage((m) => { if (m.type === 'youtube') setStatus(m.status); });
    return () => { window.removeEventListener('open-youtube', on); off(); };
  }, []);

  if (!open) return null;

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      let description = desc;
      let t = title;
      if (shorts && !/#shorts/i.test(t + description)) description = `${description}\n\n#Shorts`.trim();
      if (!t.trim()) t = project?.name || 'Video';
      await post('/api/youtube/upload', {
        file, title: t, description, privacy, madeForKids: kids,
        tags: tags.split(',').map((x) => x.trim()).filter(Boolean),
      });
      useStore.getState().toast('Đang đăng lên YouTube… (xem tab Jobs)');
      setOpen(false);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal">
        <div className="modal-head">
          <b><span className="yt-logo">▶</span> Đăng lên YouTube</b>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => setOpen(false)}><Icon name="x" /></button>
        </div>
        {!status ? <div className="muted">Đang tải…</div>
          : !status.configured ? <Setup onDone={setStatus} />
          : !status.connected ? <Connect onDone={setStatus} />
          : (
            <div className="form">
              <div className="row gap small">
                <span className="dot on" /> Kênh: <b>{status.channel?.title || 'đã kết nối'}</b>
                <div className="spacer" />
                <button className="btn small" onClick={async () => setStatus(await post('/api/youtube/disconnect'))}>Ngắt kết nối</button>
              </div>
              <label className="field"><span>Video</span>
                <select value={file} onChange={(e) => setFile(e.target.value)}>
                  {!exports.length && <option value="">Chưa có video xuất — hãy Render trước</option>}
                  {exports.map((x) => <option key={x.name} value={`exports/${x.name}`}>{x.name} ({(x.size / 1e6).toFixed(1)}MB)</option>)}
                </select>
              </label>
              <label className="field"><span>Tiêu đề</span><input maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label className="field textarea"><span>Mô tả</span><textarea rows={5} maxLength={5000} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
              <label className="field"><span>Tags</span><input placeholder="du lịch, hạ long, du thuyền" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
              <label className="field"><span>Chế độ</span>
                <select value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
                  <option value="private">Riêng tư</option>
                  <option value="unlisted">Không công khai (có link)</option>
                  <option value="public">Công khai</option>
                </select>
              </label>
              <label className="field checkbox"><span>YouTube Shorts</span><input type="checkbox" checked={shorts} onChange={(e) => setShorts(e.target.checked)} /></label>
              <label className="field checkbox"><span>Dành cho trẻ em</span><input type="checkbox" checked={kids} onChange={(e) => setKids(e.target.checked)} /></label>
              <div className="muted small">
                Shorts: video dọc, dài tối đa 3 phút. Lưu ý: nếu project Google Cloud chưa qua kiểm duyệt (audit) của YouTube,
                video đăng qua API sẽ bị khoá ở chế độ <b>riêng tư</b>.
              </div>
              {err && <div className="error small">{err}</div>}
              <div className="row gap">
                <div className="spacer" />
                <button className="btn" onClick={() => setOpen(false)}>Huỷ</button>
                <button className="btn primary" disabled={busy || !file} onClick={submit}><Icon name="upload" /> Đăng</button>
              </div>
            </div>
          )}
      </div>
    </div>
  );
};
