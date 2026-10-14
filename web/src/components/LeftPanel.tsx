import React, { useRef, useState } from 'react';
import { components, componentDefaults } from '@custom';
import { newId, layoutTrack, projectDuration } from '../../../shared/timeline.js';
import { useStore, type Project, type Upload } from '../store';
import { currentTime } from '../player';
import { Icon } from './Icon';
import { MusicPanel, VoicePanel } from './AudioLibrary';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Upload with real progress (XHR — fetch can't report upload progress). Shown in <UploadProgress>. */
export function uploadFiles(files: FileList | File[], opts: { logo?: boolean } = {}) {
  const list = Array.from(files);
  if (!list.length) return;
  const fd = new FormData();
  for (const f of list) fd.append('files', f);
  const id = `up_${Date.now()}`;
  const total = list.reduce((n, f) => n + f.size, 0);
  const name = list.length === 1 ? list[0].name : `${list.length} file`;
  const xhr = new XMLHttpRequest();
  const set = (patch: Partial<Upload>) => useStore.setState((s) => ({ uploads: { ...s.uploads, [id]: { ...s.uploads[id], ...patch } } }));
  const done = (ms = 0) => setTimeout(() => useStore.setState((s) => { const u = { ...s.uploads }; delete u[id]; return { uploads: u }; }), ms);
  set({ id, name, files: list.length, loaded: 0, total, speed: 0, state: 'uploading', startedAt: Date.now(), abort: () => xhr.abort() });
  let lastT = Date.now(), lastLoaded = 0;
  xhr.upload.onprogress = (e) => {
    const now = Date.now();
    const dt = (now - lastT) / 1000;
    if (dt < 0.5 && e.loaded < e.total) return;
    const speed = dt > 0 ? (e.loaded - lastLoaded) / dt : 0;
    lastT = now; lastLoaded = e.loaded;
    const prev = useStore.getState().uploads[id]?.speed || speed;
    set({ loaded: e.loaded, total: e.total || total, speed: prev ? prev * 0.6 + speed * 0.4 : speed });
  };
  xhr.upload.onload = () => set({ loaded: total, state: 'processing' });
  xhr.onload = () => {
    let j: any = {};
    try { j = JSON.parse(xhr.responseText); } catch { /* not json */ }
    if (xhr.status >= 200 && xhr.status < 300) {
      useStore.getState().toast(`Đã tải lên ${name} — đang xử lý (tab Jobs)`);
      done(1500);
    } else {
      const error = `Lỗi ${xhr.status}: ${j.error || xhr.statusText || 'không rõ'}`;
      set({ state: 'error', error });
      useStore.getState().toast(`Upload lỗi — ${error}`, 'error');
    }
  };
  xhr.onerror = () => set({ state: 'error', error: 'Mất kết nối tới server khi đang tải lên (mạng chập chờn hoặc server khởi động lại) — hãy thử lại' });
  xhr.onabort = () => { set({ state: 'cancelled' }); done(2500); };
  xhr.open('POST', `/api/upload${opts.logo ? '?logo=1' : ''}`);
  xhr.send(fd);
  window.dispatchEvent(new Event('show-jobs')); // follow progress in the Jobs tab
}

const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
const eta = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} giờ ${Math.round((s % 3600) / 60)} phút` : s >= 60 ? `${Math.floor(s / 60)} phút ${Math.round(s % 60)} giây` : `${Math.round(s)} giây`);

/** Progress of browser → server uploads. */
export const UploadProgress: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const uploads = Object.values(useStore((s) => s.uploads));
  if (!uploads.length) return null;
  return (
    <div className={`uploads ${compact ? 'compact' : ''}`}>
      {uploads.map((u) => {
        const pct = u.total ? Math.min(100, (u.loaded / u.total) * 100) : 0;
        const left = u.speed > 0 ? (u.total - u.loaded) / u.speed : 0;
        return (
          <div key={u.id} className={`upload ${u.state}`}>
            <div className="row gap">
              <Icon name="upload" size={12} />
              <span className="ellipsis grow" title={u.name}>{u.name}</span>
              <b className="num">{u.state === 'processing' ? 'Đang xử lý…' : u.state === 'cancelled' ? 'Đã huỷ' : u.state === 'error' ? 'Lỗi' : `${pct.toFixed(0)}%`}</b>
              {u.state === 'uploading' && <button className="icon-btn" title="Huỷ tải lên" onClick={() => u.abort?.()}><Icon name="x" size={12} /></button>}
              {(u.state === 'error') && <button className="icon-btn" title="Đóng" onClick={() => useStore.setState((s) => { const x = { ...s.uploads }; delete x[u.id]; return { uploads: x }; })}><Icon name="x" size={12} /></button>}
            </div>
            <div className="bar"><div style={{ width: `${u.state === 'processing' ? 100 : pct}%` }} /></div>
            {!compact && u.state === 'uploading' && (
              <div className="muted small">{mb(u.loaded)} / {mb(u.total)}{u.speed > 0 ? ` · ${mb(u.speed)}/s · còn ~${eta(left)}` : ''}</div>
            )}
            {!compact && u.state === 'processing' && <div className="muted small">{mb(u.total)} đã lên server — đang giải nén / chuyển đổi, xem tab Jobs</div>}
            {u.error && <div className="error small">{u.error}</div>}
          </div>
        );
      })}
    </div>
  );
};

// leaving/reloading the page would cancel a running upload
window.addEventListener('beforeunload', (e) => {
  if (Object.values(useStore.getState().uploads).some((u) => u.state === 'uploading')) { e.preventDefault(); e.returnValue = ''; }
});

export async function importUrl(url: string, audioOnly = false) {
  const r = await fetch('/api/import-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, audioOnly }) });
  const j = await r.json();
  if (!r.ok) useStore.getState().toast(j.error, 'error');
  else useStore.getState().toast('Đang tải từ link… (xem tab Jobs)');
}

function trackOf(p: Project, type: string) {
  let t = p.tracks.find((x: any) => x.type === type);
  if (!t) {
    t = { id: type === 'audio' ? 'music' : type === 'sequence' ? 'main' : 'overlay', name: type, type, clips: [] };
    if (type === 'sequence') p.tracks.unshift(t); else p.tracks.push(t);
  }
  return t;
}

/** Add an asset to the timeline: video/image → end of main track, audio → music track at playhead. */
export function addAssetClip(asset: any, opts: { trackId?: string; start?: number; index?: number } = {}) {
  useStore.getState().update((p) => {
    const t = opts.trackId ? p.tracks.find((x: any) => x.id === opts.trackId) : trackOf(p, asset.type === 'audio' ? 'audio' : 'sequence');
    if (!t) return;
    const clip: any = { id: newId(), name: asset.name, assetId: asset.id };
    if (asset.type === 'image') Object.assign(clip, { kind: 'image', duration: 4 });
    else Object.assign(clip, { kind: asset.type === 'audio' ? 'audio' : 'video', in: 0, out: asset.duration });
    if (t.type === 'sequence') {
      if (asset.type === 'audio') return;
      t.clips.splice(opts.index ?? t.clips.length, 0, clip);
    } else {
      if (t.type === 'audio' && asset.type !== 'audio') return;
      if (t.type === 'overlay' && asset.type !== 'audio') Object.assign(clip, { width: 0.4, height: 0.4, x: 0.75, y: 0.3 });
      clip.start = opts.start ?? currentTime();
      t.clips.push(clip);
    }
    useStore.setState({ selection: clip.id });
  });
}

export function addTextClip(text = 'Tiêu đề mới') {
  useStore.getState().update((p) => {
    const t = trackOf(p, 'overlay');
    const clip = { id: newId(), kind: 'text', text, start: currentTime(), duration: 3, x: 0.5, y: 0.5, style: { fontSize: 80, color: '#ffffff', fontWeight: 800 }, animation: { in: 'slide-up', out: 'fade', duration: 0.6 } };
    t.clips.push(clip);
    useStore.setState({ selection: clip.id });
  });
}

export function addSolidClip() {
  useStore.getState().update((p) => {
    const t = trackOf(p, 'sequence');
    const clip = { id: newId(), kind: 'solid', name: 'Solid', color: '#111827', duration: 3 };
    t.clips.push(clip);
    useStore.setState({ selection: clip.id });
  });
}

export function addComponentClip(name: string, where: 'sequence' | 'overlay' = 'sequence') {
  useStore.getState().update((p) => {
    const t = trackOf(p, where);
    const clip: any = { id: newId(), kind: 'component', name, component: name, props: structuredClone((componentDefaults as any)?.[name] || {}), duration: 4 };
    if (where === 'overlay') clip.start = currentTime();
    t.clips.push(clip);
    useStore.setState({ selection: clip.id });
  });
}

const AssetCard: React.FC<{ asset: any }> = ({ asset }) => {
  const sel = useStore((s) => s.selection === asset.id);
  const thumb = asset.type === 'audio' ? `/cache/thumbs/${asset.id}.wave.png` : `/cache/thumbs/${asset.id}.jpg`;
  return (
    <div
      className={`asset ${sel ? 'selected' : ''}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('application/x-asset', asset.id); e.dataTransfer.effectAllowed = 'copy'; }}
      onClick={() => useStore.getState().select(asset.id)}
      onDoubleClick={() => addAssetClip(asset)}
      title={`${asset.name}\nDouble-click hoặc kéo vào timeline để thêm`}
    >
      <div className={`asset-thumb ${asset.type}`}>
        <img src={thumb} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
        <span className="asset-badge"><Icon name={asset.type === 'video' ? 'film' : asset.type === 'image' ? 'image' : 'music'} size={11} /></span>
        {asset.duration ? <span className="asset-dur">{asset.duration.toFixed(1)}s</span> : null}
      </div>
      <div className="asset-name">{asset.name}</div>
    </div>
  );
};

export const LeftPanel: React.FC = () => {
  const project = useStore((s) => s.project);
  const openComp = useStore((s) => s.openComp);
  const [tab, setTab] = useState<'comp' | 'assets' | 'motion' | 'music' | 'voice'>('assets');
  const [q, setQ] = useState('');
  const [url, setUrl] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const assets = project.assets.filter((a: any) => a.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="left-panel panel">
      <div className="panel-tabs">
        <button className={tab === 'comp' ? 'active' : ''} onClick={() => setTab('comp')}>Comps</button>
        <button className={tab === 'assets' ? 'active' : ''} onClick={() => setTab('assets')}>Assets</button>
        <button className={tab === 'motion' ? 'active' : ''} onClick={() => setTab('motion')}>Motion</button>
        <button className={tab === 'music' ? 'active' : ''} onClick={() => setTab('music')} title="Thư viện nhạc nền"><Icon name="music" size={12} /> Nhạc</button>
        <button className={tab === 'voice' ? 'active' : ''} onClick={() => setTab('voice')} title="Giọng đọc AI (TTS)"><Icon name="mic" size={12} /> Giọng</button>
      </div>

      {tab === 'music' && <MusicPanel />}
      {tab === 'voice' && <VoicePanel />}

      {tab === 'comp' && (
        <div className="panel-body">
          <div className={`tree-item ${openComp === 'Main' ? 'active' : ''}`} onClick={() => useStore.setState({ openComp: 'Main' })}>
            <Icon name="comp" /> {project.name || 'Main'} <span className="muted small">{projectDuration(project).toFixed(1)}s</span>
          </div>
          {project.tracks.map((t: any) => (
            <div key={t.id} className="tree-item sub"><Icon name="folder" /> {t.name} <span className="muted small">{layoutTrack(t, project).length}</span></div>
          ))}
          <div className="section-title">Motion components</div>
          {Object.keys(components).map((name) => (
            <div key={name} className={`tree-item ${openComp === name ? 'active' : ''}`} onClick={() => useStore.setState({ openComp: name })}>
              <Icon name="motion" /> {name}
            </div>
          ))}
        </div>
      )}

      {tab === 'assets' && (
        <div
          className={`panel-body ${drag ? 'dropping' : ''}`}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); }}
        >
          <input className="search" placeholder="Tìm…" value={q} onChange={(e) => setQ(e.target.value)} />
          <UploadProgress />
          <div className="row gap">
            <button className="btn small" onClick={() => fileRef.current?.click()}><Icon name="upload" /> Tải file</button>
            <input ref={fileRef} type="file" multiple hidden accept="video/*,image/*,audio/*,.heic,.heif,.zip" onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ''; }} />
          </div>
          <form className="url-import" onSubmit={(e) => { e.preventDefault(); if (url.trim()) { importUrl(url.trim()); setUrl(''); } }}>
            <Icon name="link" />
            <input placeholder="Dán link YouTube / video…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn small" type="submit">Tải</button>
          </form>
          {!assets.length && <div className="empty">Kéo thả video, ảnh, nhạc vào đây<br />hoặc dán link YouTube.</div>}
          <div className="asset-grid">
            {assets.map((a: any) => <AssetCard key={a.id} asset={a} />)}
          </div>
        </div>
      )}

      {tab === 'motion' && (
        <div className="panel-body">
          <div className="muted small" style={{ marginBottom: 8 }}>Component Remotion trong <code>workspace/custom</code>. Bấm để thêm vào timeline, hoặc nhờ Claude tạo mẫu mới.</div>
          {Object.keys(components).map((name) => (
            <div key={name} className="motion-item">
              <div className="motion-name" onClick={() => useStore.setState({ openComp: name })}><Icon name="motion" /> {name}</div>
              <div className="row gap">
                <button className="btn small" onClick={() => addComponentClip(name, 'sequence')} title="Thêm như một cảnh trên track chính">+ Cảnh</button>
                <button className="btn small" onClick={() => addComponentClip(name, 'overlay')} title="Thêm lên track overlay tại playhead">+ Overlay</button>
              </div>
            </div>
          ))}
          <div className="row gap" style={{ marginTop: 10 }}>
            <button className="btn small" onClick={() => addTextClip()}><Icon name="text" /> Text</button>
            <button className="btn small" onClick={() => addSolidClip()}><Icon name="square" /> Solid</button>
          </div>
        </div>
      )}
    </div>
  );
};
