import React, { useMemo, useRef, useState } from 'react';
import { components, componentDefaults } from '@custom';
import { Player, Thumbnail } from '@remotion/player';
import { newId, layoutTrack, projectDuration } from '../../../shared/timeline.js';
import { useStore, type Project, type Upload } from '../store';
import { currentTime } from '../player';
import { Icon } from './Icon';
import { MusicPanel, VoicePanel } from './AudioLibrary';
import { openDub } from './DubDialog';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CHUNK = 8 * 1024 * 1024; // well under Cloudflare's 100 MB request limit
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Upload in 8 MB parts, one file after another (a single huge multipart request is buffered —
 * and over 100 MB rejected — by proxies like Cloudflare, so progress froze and nothing arrived).
 * Each part is retried on network errors and resumes from what the server already has.
 * Progress is shown in <UploadProgress>.
 */
export function uploadFiles(files: FileList | File[], opts: { logo?: boolean } = {}) {
  const list = Array.from(files);
  if (!list.length) return;
  const id = `up_${Date.now()}`;
  const total = list.reduce((n, f) => n + f.size, 0);
  const name = list.length === 1 ? list[0].name : `${list.length} file`;
  let xhr: XMLHttpRequest | null = null;
  let cancelled = false;
  const set = (patch: Partial<Upload>) => useStore.setState((s) => (s.uploads[id] || patch.id ? { uploads: { ...s.uploads, [id]: { ...s.uploads[id], ...patch } } } : {}));
  const done = (ms = 0) => setTimeout(() => useStore.setState((s) => { const u = { ...s.uploads }; delete u[id]; return { uploads: u }; }), ms);
  const parts = list.map((f, i) => ({ file: f, id: `${id}_${i}_${Math.random().toString(36).slice(2, 8)}` }));
  set({ id, name, files: list.length, loaded: 0, total, speed: 0, state: 'uploading', startedAt: Date.now(),
    abort: () => { cancelled = true; xhr?.abort(); } });

  let base = 0; // bytes of fully uploaded files + parts
  let lastT = Date.now(), lastLoaded = 0, speed = 0;
  const report = (loaded: number) => {
    const now = Date.now(), dt = (now - lastT) / 1000;
    if (dt < 0.5) { set({ loaded }); return; }
    const sp = (loaded - lastLoaded) / dt;
    speed = speed ? speed * 0.6 + sp * 0.4 : sp;
    lastT = now; lastLoaded = loaded;
    set({ loaded, speed });
  };
  const put = (pid: string, blob: Blob, offset: number) => new Promise<{ status: number; body: any }>((resolve, reject) => {
    const x = new XMLHttpRequest(); xhr = x;
    x.open('PUT', `/api/upload/part/${pid}?offset=${offset}`);
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.timeout = 120_000;
    x.upload.onprogress = (e) => report(base + e.loaded);
    x.onload = () => { let b: any = {}; try { b = JSON.parse(x.responseText); } catch { /* not json */ } resolve({ status: x.status, body: b }); };
    x.onerror = () => reject(new Error('network'));
    x.ontimeout = () => reject(new Error('timeout'));
    x.onabort = () => reject(new Error('abort'));
    x.send(blob);
  });

  (async () => {
    for (const [i, { file, id: pid }] of parts.entries()) {
      set({ current: `${i + 1}/${list.length} ${file.name}` });
      let offset = 0, tries = 0;
      const fileBase = base;
      while (offset < file.size || (file.size === 0 && offset === 0 && tries === 0)) {
        if (cancelled) throw new Error('abort');
        const blob = file.slice(offset, Math.min(file.size, offset + CHUNK));
        try {
          const r = await put(pid, blob, offset);
          if (r.status === 200 || r.status === 409) { offset = Number(r.body.size) || 0; tries = 0; }
          else if (r.status === 401) throw Object.assign(new Error('Phiên đăng nhập đã hết — hãy đăng nhập lại rồi tải lên lại'), { fatal: true });
          else if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw Object.assign(new Error(`Lỗi ${r.status}: ${r.body.error || 'không rõ'}`), { fatal: true });
          else throw new Error(`Lỗi ${r.status}`);
          base = fileBase + offset;
          report(base);
          if (file.size === 0) break;
        } catch (e: any) {
          if (cancelled || e.message === 'abort' || e.fatal) throw e;
          if (++tries > 8) throw new Error(`Mất kết nối khi tải ${file.name} (${e.message}) — hãy thử lại`);
          set({ retry: `Mạng chập chờn — thử lại lần ${tries}/8…` });
          await sleep(Math.min(30_000, 1000 * 2 ** tries));
          // ask the server how much of this file it already has, then continue from there
          try { const r = await fetch(`/api/upload/part/${pid}`); if (r.ok) offset = Number((await r.json()).size) || 0; } catch { /* retry anyway */ }
          base = fileBase + offset;
          set({ retry: undefined });
        }
      }
    }
    set({ loaded: total, state: 'processing', current: undefined });
    const r = await fetch('/api/upload/finish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logo: !!opts.logo, files: parts.map((p) => ({ id: p.id, name: p.file.name, size: p.file.size })) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`Lỗi ${r.status}: ${j.error || 'không rõ'}`), { fatal: true });
    useStore.getState().toast(`Đã tải lên ${name} — đang xử lý (tab Jobs)`);
    done(1500);
  })().catch((e: any) => {
    for (const p of parts) fetch(`/api/upload/part/${p.id}`, { method: 'DELETE' }).catch(() => {});
    if (cancelled || e.message === 'abort') { set({ state: 'cancelled', retry: undefined }); done(2500); return; }
    set({ state: 'error', error: e.message, retry: undefined });
    useStore.getState().toast(`Upload lỗi — ${e.message}`, 'error');
  });
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
            {!compact && u.state === 'uploading' && u.current && u.files > 1 && <div className="muted small ellipsis">Đang tải {u.current}</div>}
            {u.retry && <div className="small" style={{ color: 'var(--warn, #e0a030)' }}>{u.retry}</div>}
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

/** Motion library card: still frame, plays (looped) while hovered. */
const MotionCard: React.FC<{ name: string }> = ({ name }) => {
  const { width, height, fps } = useStore((s) => s.project.settings);
  const [hover, setHover] = useState(false);
  const Comp = (components as Record<string, React.FC<any>>)[name];
  const props = (componentDefaults as any)?.[name] || {};
  const dur = Math.round(fps * 4);
  const common = { component: Comp, compositionWidth: width, compositionHeight: height, fps, durationInFrames: dur, inputProps: props, style: { width: '100%', height: '100%' } };
  return (
    <div className="motion-item">
      <div
        className="motion-preview"
        style={{ aspectRatio: `${width} / ${height}` }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => setHover(!hover)}
        title="Rê chuột để xem chuyển động · bấm đúp để mở"
        onDoubleClick={() => useStore.setState({ openComp: name })}
      >
        {hover
          ? <Player {...common} autoPlay loop controls={false} acknowledgeRemotionLicense errorFallback={() => <div className="player-error">Lỗi</div>} />
          : <Thumbnail {...common} frameToDisplay={Math.round(fps * 1.5)} errorFallback={() => <div className="player-error">Lỗi</div>} />}
        {!hover && <span className="motion-play"><Icon name="play" size={12} /></span>}
      </div>
      <div className="motion-name" onClick={() => useStore.setState({ openComp: name })} title="Mở để xem/sửa">{name}</div>
      <div className="row gap">
        <button className="btn small" onClick={() => addComponentClip(name, 'sequence')} title="Thêm như một cảnh trên track chính">+ Cảnh</button>
        <button className="btn small" onClick={() => addComponentClip(name, 'overlay')} title="Thêm lên track overlay tại playhead">+ Overlay</button>
      </div>
    </div>
  );
};

type AssetView = 'large' | 'small' | 'list' | 'details';
const VIEWS: [AssetView, string, string][] = [
  ['large', 'Thumbnail lớn', 'M4 4h16v16H4z'],
  ['small', 'Thumbnail nhỏ', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
  ['list', 'Danh sách', 'M4 5h4v4H4zM10 7h10M4 15h4v4H4zM10 17h10'],
  ['details', 'Chi tiết', 'M4 6h16M4 12h16M4 18h16M9 4v16'],
];
const thumbOf = (a: any) => (a.type === 'audio' ? `/cache/thumbs/${a.id}.wave.png` : `/cache/thumbs/${a.id}.jpg`);
const typeIcon = (a: any) => (a.type === 'video' ? 'film' : a.type === 'image' ? 'image' : 'music');
const fmtDur = (d?: number) => (d ? (d >= 60 ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}` : `${d.toFixed(1)}s`) : '');
const hideBroken = (e: React.SyntheticEvent<HTMLImageElement>) => ((e.target as HTMLImageElement).style.visibility = 'hidden');

/** Shared drag/select/add behaviour of every asset view. */
function assetProps(asset: any, sel: boolean, cls: string) {
  return {
    className: `${cls} ${sel ? 'selected' : ''}`,
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData('application/x-asset', asset.id); e.dataTransfer.effectAllowed = 'copy'; },
    onClick: () => useStore.getState().select(asset.id),
    onDoubleClick: () => addAssetClip(asset),
    title: `${asset.name}\nDouble-click hoặc kéo vào timeline để thêm`,
  };
}

const AssetCard: React.FC<{ asset: any; used: boolean }> = ({ asset, used }) => {
  const sel = useStore((s) => s.selection === asset.id);
  return (
    <div {...assetProps(asset, sel, 'asset')}>
      <div className={`asset-thumb ${asset.type}`}>
        <img src={thumbOf(asset)} alt="" loading="lazy" onError={hideBroken} />
        <span className="asset-badge"><Icon name={typeIcon(asset)} size={11} /></span>
        {used && <span className="asset-used" title="Đang dùng trên timeline" />}
        {asset.duration ? <span className="asset-dur">{fmtDur(asset.duration)}</span> : null}
      </div>
      <div className="asset-name">{asset.name}</div>
    </div>
  );
};

const AssetRow: React.FC<{ asset: any; used: boolean }> = ({ asset, used }) => {
  const sel = useStore((s) => s.selection === asset.id);
  return (
    <div {...assetProps(asset, sel, 'asset-row')}>
      <div className={`asset-mini ${asset.type}`}><img src={thumbOf(asset)} alt="" loading="lazy" onError={hideBroken} /></div>
      <div className="asset-row-meta">
        <div className="asset-row-name">{used && <span className="asset-used inline" title="Đang dùng trên timeline" />}{asset.name}</div>
        <div className="muted small">{[asset.type, fmtDur(asset.duration), asset.width && `${asset.width}×${asset.height}`].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
  );
};

const AssetDetails: React.FC<{ assets: any[]; used: Set<string> }> = ({ assets, used }) => {
  const selection = useStore((s) => s.selection);
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: '', dir: 1 });
  const val = (a: any, k: string) => (k === 'name' ? a.name.toLowerCase() : k === 'type' ? a.type : k === 'dur' ? a.duration || 0 : k === 'res' ? (a.width || 0) * (a.height || 0) : 0);
  const rows = sort.k ? [...assets].sort((a, b) => (val(a, sort.k) > val(b, sort.k) ? 1 : val(a, sort.k) < val(b, sort.k) ? -1 : 0) * sort.dir) : assets;
  const th = (k: string, label: string) => (
    <th onClick={() => setSort(sort.k === k ? { k, dir: sort.dir === 1 ? -1 : 1 } : { k, dir: 1 })}>{label}{sort.k === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>
  );
  return (
    <table className="asset-table">
      <thead><tr>{th('name', 'Tên')}{th('type', '')}{th('dur', 'Dài')}{th('res', 'Cỡ')}</tr></thead>
      <tbody>
        {rows.map((a) => {
          const p = assetProps(a, selection === a.id, '');
          return (
            <tr key={a.id} {...p}>
              <td className="asset-td-name" title={a.name}>{used.has(a.id) && <span className="asset-used inline" title="Đang dùng trên timeline" />}{a.name}</td>
              <td title={a.type}><Icon name={typeIcon(a)} size={11} /></td>
              <td className="num">{fmtDur(a.duration)}</td>
              <td className="num">{a.width ? `${a.width}×${a.height}` : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

const AssetBrowser: React.FC<{ assets: any[] }> = ({ assets }) => {
  const project = useStore((s) => s.project);
  const [view, setView] = useState<AssetView>(() => { try { return (localStorage.getItem('aiv.assetView') as AssetView) || 'small'; } catch { return 'small'; } });
  const [type, setType] = useState('');
  const pick = (v: AssetView) => { setView(v); try { localStorage.setItem('aiv.assetView', v); } catch { /* ignore */ } };
  const used = useMemo(() => new Set<string>(project.tracks.flatMap((t: any) => t.clips.map((c: any) => c.assetId)).filter(Boolean)), [project]);
  const list = type ? assets.filter((a) => a.type === type) : assets;
  const counts = (t: string) => assets.filter((a) => a.type === t).length;
  return (
    <>
      <div className="asset-toolbar">
        <select value={type} onChange={(e) => setType(e.target.value)} title="Lọc theo loại">
          <option value="">Tất cả ({assets.length})</option>
          {counts('video') > 0 && <option value="video">Video ({counts('video')})</option>}
          {counts('image') > 0 && <option value="image">Ảnh ({counts('image')})</option>}
          {counts('audio') > 0 && <option value="audio">Âm thanh ({counts('audio')})</option>}
        </select>
        <div className="spacer" />
        <div className="seg view-seg">
          {VIEWS.map(([v, label, d]) => (
            <button key={v} className={view === v ? 'active' : ''} title={label} onClick={() => pick(v)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
            </button>
          ))}
        </div>
      </div>
      {view === 'details' ? <AssetDetails assets={list} used={used} />
        : view === 'list' ? <div className="asset-list">{list.map((a) => <AssetRow key={a.id} asset={a} used={used.has(a.id)} />)}</div>
        : <div className={`asset-grid ${view}`}>{list.map((a) => <AssetCard key={a.id} asset={a} used={used.has(a.id)} />)}</div>}
    </>
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
        <button className={tab === 'music' ? 'active' : ''} onClick={() => setTab('music')} title="Thư viện nhạc nền">Music</button>
        <button className={tab === 'voice' ? 'active' : ''} onClick={() => setTab('voice')} title="Giọng đọc AI (TTS) — chọn & nghe thử giọng cho clip"><Icon name="mic" size={11} />Voice</button>
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
            <button className="btn small" onClick={() => openDub()} title="Dịch lời thoại của video/link YouTube và đọc lại bằng giọng AI"><Icon name="mic" /> Thuyết minh</button>
            <input ref={fileRef} type="file" multiple hidden accept="video/*,image/*,audio/*,.heic,.heif,.zip" onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ''; }} />
          </div>
          <form className="url-import" onSubmit={(e) => { e.preventDefault(); if (url.trim()) { importUrl(url.trim()); setUrl(''); } }}>
            <Icon name="link" />
            <input placeholder="Dán link YouTube / video…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn small" type="submit">Tải</button>
          </form>
          {!assets.length && <div className="empty">Kéo thả video, ảnh, nhạc vào đây<br />hoặc dán link YouTube.</div>}
          {!!assets.length && <AssetBrowser assets={assets} />}
        </div>
      )}

      {tab === 'motion' && (
        <div className="panel-body">
          <div className="muted small" style={{ marginBottom: 8 }}>Component Remotion trong <code>workspace/custom</code>. Bấm để thêm vào timeline, hoặc nhờ Claude tạo mẫu mới.</div>
          <div className="motion-grid">
            {Object.keys(components).map((name) => <MotionCard key={name} name={name} />)}
          </div>
          <div className="row gap" style={{ marginTop: 10 }}>
            <button className="btn small" onClick={() => addTextClip()}><Icon name="text" /> Text</button>
            <button className="btn small" onClick={() => addSolidClip()}><Icon name="square" /> Solid</button>
          </div>
        </div>
      )}
    </div>
  );
};
