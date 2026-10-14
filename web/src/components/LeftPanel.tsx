import React, { useRef, useState } from 'react';
import { components, componentDefaults } from '@custom';
import { newId, layoutTrack, projectDuration } from '../../../shared/timeline.js';
import { useStore, type Project } from '../store';
import { currentTime } from '../player';
import { Icon } from './Icon';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function uploadFiles(files: FileList | File[]) {
  const fd = new FormData();
  for (const f of Array.from(files)) fd.append('files', f);
  const toast = useStore.getState().toast;
  toast(`Đang tải lên ${fd.getAll('files').length} file…`);
  try {
    const r = await fetch('/api/upload', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) toast(j.error || 'Upload lỗi', 'error');
    else toast('Đã tải lên, đang xử lý… (xem tab Jobs)');
  } catch (e: any) {
    toast(`Upload lỗi: ${e.message}`, 'error');
  }
}

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
  const [tab, setTab] = useState<'comp' | 'assets' | 'motion'>('assets');
  const [q, setQ] = useState('');
  const [url, setUrl] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const assets = project.assets.filter((a: any) => a.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="left-panel panel">
      <div className="panel-tabs">
        <button className={tab === 'comp' ? 'active' : ''} onClick={() => setTab('comp')}>Compositions</button>
        <button className={tab === 'assets' ? 'active' : ''} onClick={() => setTab('assets')}>Assets</button>
        <button className={tab === 'motion' ? 'active' : ''} onClick={() => setTab('motion')}>Motion</button>
      </div>

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
          <div className="row gap">
            <button className="btn small" onClick={() => fileRef.current?.click()}><Icon name="upload" /> Tải file</button>
            <input ref={fileRef} type="file" multiple hidden accept="video/*,image/*,audio/*" onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ''; }} />
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
