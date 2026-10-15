import React, { useEffect, useMemo, useRef, useState } from 'react';
import { assetById, findClip, fmtTime, layoutTrack, projectDuration } from '../../../shared/timeline.js';
import { useStore, type Project } from '../store';
import { currentTime, deleteSelection, player, seek, splitAtPlayhead, togglePlay } from '../player';
import { addAssetClip } from './LeftPanel';
import { Icon } from './Icon';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ROW = 22;
const LEFT = 250;

type Row =
  | { kind: 'track'; track: any; collapsed: boolean }
  | { kind: 'clip'; track: any; l: any }
  | { kind: 'subs' };

function clipLabel(c: any, project: Project) {
  if (c.kind === 'text') return c.text?.split('\n')[0] || 'Text';
  if (c.kind === 'component') return c.name || c.component;
  if (c.kind === 'solid') return c.name || `Solid ${c.color}`;
  return c.name || assetById(project, c.assetId)?.name || c.id;
}

function clipColor(c: any, trackType: string) {
  if (trackType === 'audio' || c.kind === 'audio') return 'audio';
  return c.kind || 'video';
}

function rulerStep(pps: number) {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (s * pps >= 70) return s;
  return 600;
}

export const Timeline: React.FC = () => {
  const project = useStore((s) => s.project);
  const zoom = useStore((s) => s.zoom);
  const selection = useStore((s) => s.selection);
  const hidden = useStore((s) => s.hiddenTracks);
  const flash = useStore((s) => s.remoteFlash);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const duration = projectDuration(project);
  const fps = project.settings.fps;
  const width = Math.max(duration + 10, 30) * zoom;

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (project.subtitles.cues.length) out.push({ kind: 'subs' });
    for (const t of [...project.tracks].reverse()) {
      out.push({ kind: 'track', track: t, collapsed: !!collapsed[t.id] });
      if (!collapsed[t.id]) for (const l of layoutTrack(t, project)) out.push({ kind: 'clip', track: t, l });
    }
    return out;
  }, [project, collapsed]);

  /* ---------- scrubbing ---------- */
  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left - LEFT + el.scrollLeft) / zoom);
  };
  const scrub = (e: React.PointerEvent) => {
    player.ref?.pause();
    seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => seek(timeAt(ev.clientX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ---------- clip drag / trim ---------- */
  const startDrag = (e: React.PointerEvent, clipId: string, mode: 'move' | 'left' | 'right') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const store = useStore.getState();
    store.select(clipId);
    const before = structuredClone(store.project);
    const x0 = e.clientX;
    const f0 = findClip(before, clipId);
    if (!f0) return;
    const isSeq = f0.track.type === 'sequence';
    const c0 = f0.clip;
    const asset = c0.assetId ? assetById(before, c0.assetId) : null;
    const timed = c0.kind === 'video' || c0.kind === 'audio' || f0.track.type === 'audio';
    const snapPoints: number[] = [0, currentTime()];
    for (const t of before.tracks) for (const l of layoutTrack(t, before)) if (l.clip.id !== clipId) snapPoints.push(l.start, l.end);
    const snap = (t: number) => {
      const th = 6 / zoom;
      let best = t, bd = th;
      for (const p of snapPoints) if (Math.abs(p - t) < bd) { best = p; bd = Math.abs(p - t); }
      return best;
    };
    let moved = false;

    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / zoom;
      if (Math.abs(ev.clientX - x0) > 2) moved = true;
      if (!moved) return;
      const p = structuredClone(before);
      const f = findClip(p, clipId)!;
      const c = f.clip;
      const speed = c.speed || 1;
      if (mode === 'move') {
        if (isSeq) {
          // reorder: find target index by pointer time vs clip midpoints
          const t = timeAt(ev.clientX);
          const lay = layoutTrack(f0.track, before);
          let idx = lay.findIndex((l: any) => t < (l.start + l.end) / 2);
          if (idx < 0) idx = lay.length;
          const arr = f.track.clips;
          const [item] = arr.splice(f.index, 1);
          arr.splice(idx > f.index ? idx - 1 : idx, 0, item);
        } else {
          const len = (layoutTrack(f.track, p).find((l: any) => l.clip.id === clipId)?.duration) ?? 0;
          let s = Math.max(0, (c0.start ?? 0) + dt);
          const sEnd = snap(s + len);
          const sStart = snap(s);
          s = Math.abs(sStart - s) <= Math.abs(sEnd - (s + len)) ? sStart : sEnd - len;
          c.start = Math.max(0, +s.toFixed(3));
        }
      } else if (mode === 'left') {
        if (timed) {
          const minIn = 0;
          let nin = (c0.in ?? 0) + dt * speed;
          nin = Math.min(Math.max(minIn, nin), (c0.out ?? asset?.duration ?? 1) - 0.1);
          c.in = +nin.toFixed(3);
          if (!isSeq) c.start = +Math.max(0, (c0.start ?? 0) + (nin - (c0.in ?? 0)) / speed).toFixed(3);
        } else {
          const d0 = c0.duration ?? 5;
          const delta = Math.min(dt, d0 - 0.1);
          c.duration = +(d0 - delta).toFixed(3);
          if (!isSeq) c.start = +Math.max(0, (c0.start ?? 0) + delta).toFixed(3);
        }
      } else {
        if (timed) {
          const max = asset?.duration ?? Infinity;
          let nout = (c0.out ?? max) + dt * speed;
          nout = Math.max((c0.in ?? 0) + 0.1, Math.min(max, nout));
          c.out = +nout.toFixed(3);
        } else {
          let d = (c0.duration ?? 5) + dt;
          if (!isSeq) d = snap((c0.start ?? 0) + d) - (c0.start ?? 0);
          c.duration = +Math.max(0.1, d).toFixed(3);
        }
      }
      useStore.getState().setProject(p, { record: false, save: false });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) useStore.getState().setProject(useStore.getState().project, { record: true, save: true, from: before });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ---------- drop assets ---------- */
  const onDrop = (e: React.DragEvent, track?: any) => {
    const id = e.dataTransfer.getData('application/x-asset');
    if (!id) return;
    e.preventDefault();
    const asset = assetById(project, id);
    if (!asset) return;
    const t = timeAt(e.clientX);
    if (track?.type === 'sequence') {
      const lay = layoutTrack(track, project);
      let idx = lay.findIndex((l: any) => t < (l.start + l.end) / 2);
      if (idx < 0) idx = lay.length;
      addAssetClip(asset, { trackId: track.id, index: idx });
    } else if (track) addAssetClip(asset, { trackId: track.id, start: t });
    else addAssetClip(asset, { start: t });
  };

  /* ---------- zoom with ctrl+wheel ---------- */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const z = useStore.getState().zoom;
      useStore.setState({ zoom: Math.min(400, Math.max(5, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const fit = () => {
    const el = scrollRef.current;
    if (el) useStore.setState({ zoom: Math.max(5, (el.clientWidth - LEFT - 40) / Math.max(duration, 1)) });
  };

  const step = rulerStep(zoom);
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 10; t += step) ticks.push(t);

  return (
    <div className={`timeline panel ${flash && Date.now() - flash < 2500 ? 'ai-updated' : ''}`}>
      <Transport duration={duration} fps={fps} onFit={fit} />
      <div className="tl-scroll" ref={scrollRef} onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-asset')) e.preventDefault(); }} onDrop={(e) => onDrop(e)}>
        <div className="tl-inner" style={{ width: LEFT + width }}>
          <div className="tl-ruler-row">
            <div className="tl-corner"><Timecode fps={fps} /></div>
            <div className="tl-ruler" style={{ width }} onPointerDown={scrub}>
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: t * zoom }}><span>{fmtTime(t, fps).slice(0, 5)}</span></div>
              ))}
            </div>
          </div>
          {rows.map((r, i) => {
            if (r.kind === 'subs') {
              return (
                <div key="subs" className="tl-row track-row">
                  <div className={`tl-label ${selection === 'subs' ? 'selected' : ''}`} style={{ cursor: 'pointer' }} onClick={() => useStore.getState().select('subs')} title="Chỉnh kiểu chữ / danh sách phụ đề"><Icon name="text" size={12} /> Phụ đề <span className="muted small">{project.subtitles.cues.length}</span></div>
                  <div className="tl-lane" style={{ width }} onPointerDown={scrub}>
                    {project.subtitles.cues.map((c: any, j: number) => (
                      <div
                        key={j}
                        className={`tl-cue ${selection === `sub:${j}` ? 'selected' : ''}`}
                        style={{ left: c.start * zoom, width: Math.max(2, (c.end - c.start) * zoom) }}
                        title={`${c.text}\n(bấm để sửa trong Inspector)`}
                        onPointerDown={(e) => { e.stopPropagation(); useStore.getState().select(`sub:${j}`); seek(c.start + 0.01); }}
                      >{c.text}</div>
                    ))}
                  </div>
                </div>
              );
            }
            if (r.kind === 'track') {
              const t = r.track;
              const isHidden = t.hidden || hidden.includes(t.id);
              const lay = layoutTrack(t, project);
              const end = lay.reduce((m: number, l: any) => Math.max(m, l.end), 0);
              return (
                <div key={t.id} className="tl-row track-row" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); onDrop(e, t); }}>
                  <div className="tl-label">
                    <button className="eye" title={isHidden ? 'Hiện' : 'Ẩn'} onClick={() => useStore.getState().update((p) => { const tt = p.tracks.find((x: any) => x.id === t.id); tt.hidden = !tt.hidden || undefined; })}>
                      <Icon name={t.type === 'audio' ? (t.muted ? 'mute' : 'volume') : isHidden ? 'eyeoff' : 'eye'} size={12} />
                    </button>
                    <button className="caret" onClick={() => setCollapsed({ ...collapsed, [t.id]: !collapsed[t.id] })}>
                      <Icon name={r.collapsed ? 'chevron' : 'chevdown'} size={11} />
                    </button>
                    <span className="track-name">{`<${t.type === 'sequence' ? 'TransitionSeries' : t.type === 'audio' ? 'Audio' : 'Sequence'}>`} {t.name}</span>
                  </div>
                  <div className="tl-lane" style={{ width }}>
                    {end > 0 && <div className={`tl-trackbar ${t.type}`} style={{ left: 0, width: end * zoom }}>{lay.length}</div>}
                  </div>
                </div>
              );
            }
            const { l, track } = r;
            const c = l.clip;
            const sel = selection === c.id;
            const asset = c.assetId ? assetById(project, c.assetId) : null;
            const color = clipColor(c, track.type);
            let bg: React.CSSProperties = {};
            if (asset?.type === 'video' && c.kind === 'video') {
              const totalW = (asset.duration / (c.speed || 1)) * zoom;
              bg = { backgroundImage: `url(/cache/thumbs/${asset.id}.strip.jpg)`, backgroundSize: `${totalW}px 100%`, backgroundPosition: `${-((c.in ?? 0) / (c.speed || 1)) * zoom}px 0` };
            } else if (asset?.type === 'image') {
              bg = { backgroundImage: `url(/cache/thumbs/${asset.id}.jpg)`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' };
            } else if (asset && color === 'audio') {
              const totalW = (asset.duration / (c.speed || 1)) * zoom;
              bg = { backgroundImage: `url(/cache/thumbs/${asset.id}.wave.png)`, backgroundSize: `${totalW}px 100%`, backgroundPosition: `${-((c.in ?? 0) / (c.speed || 1)) * zoom}px 0` };
            }
            return (
              <div key={c.id} className={`tl-row ${i % 2 ? 'odd' : ''}`}>
                <div className={`tl-label clip-label ${sel ? 'selected' : ''}`} onClick={() => useStore.getState().select(c.id)}>
                  <Icon name={c.kind === 'text' ? 'text' : c.kind === 'component' ? 'motion' : c.kind === 'image' ? 'image' : c.kind === 'solid' ? 'square' : color === 'audio' ? 'music' : 'film'} size={11} />
                  <span>{clipLabel(c, project)}</span>
                </div>
                <div className="tl-lane" style={{ width }} onPointerDown={scrub}>
                  <div
                    className={`tl-clip ${color} ${sel ? 'selected' : ''}`}
                    style={{ left: l.start * zoom, width: Math.max(4, l.duration * zoom), ...bg }}
                    onPointerDown={(e) => startDrag(e, c.id, 'move')}
                    onDoubleClick={() => seek(l.start)}
                    title={`${clipLabel(c, project)}  ${l.start.toFixed(2)}s → ${l.end.toFixed(2)}s`}
                  >
                    <div className="handle left" onPointerDown={(e) => startDrag(e, c.id, 'left')} />
                    <span className="clip-text">{clipLabel(c, project)}</span>
                    <div className="handle right" onPointerDown={(e) => startDrag(e, c.id, 'right')} />
                  </div>
                  {l.transition > 0 && (
                    <div className="tl-transition" style={{ left: (l.end - l.transition) * zoom, width: l.transition * zoom }} title={`${c.transition.type} ${l.transition}s`} />
                  )}
                </div>
              </div>
            );
          })}
          <Playhead zoom={zoom} rows={rows.length} />
        </div>
      </div>
    </div>
  );
};

const Playhead: React.FC<{ zoom: number; rows: number }> = ({ zoom, rows }) => {
  const frame = useStore((s) => s.frame);
  const fps = useStore((s) => s.project.settings.fps);
  return <div className="playhead" style={{ left: LEFT + (frame / fps) * zoom, height: (rows + 1) * ROW + 6 }}><div className="playhead-knob" /></div>;
};

const Timecode: React.FC<{ fps: number }> = ({ fps }) => {
  const frame = useStore((s) => s.frame);
  return <span className="timecode">{fmtTime(frame / fps, fps)}<small>{frame}</small></span>;
};

const Transport: React.FC<{ duration: number; fps: number; onFit: () => void }> = ({ duration, fps, onFit }) => {
  const playing = useStore((s) => s.playing);
  const zoom = useStore((s) => s.zoom);
  const selection = useStore((s) => s.selection);
  const rate = useStore((s) => s.playbackRate);
  const [muted, setMuted] = useState(false);
  return (
    <div className="transport">
      <button className="icon-btn" onClick={onFit} title="Vừa khung"><Icon name="fullscreen" /> Fit</button>
      <select value={rate} onChange={(e) => useStore.setState({ playbackRate: Number(e.target.value) })} title="Tốc độ phát">
        {[0.25, 0.5, 1, 1.5, 2].map((r) => <option key={r} value={r}>{r}x</option>)}
      </select>
      <button className="icon-btn" onClick={() => splitAtPlayhead()} title="Cắt tại playhead (S)"><Icon name="scissors" /></button>
      <button className="icon-btn" disabled={!selection} onClick={() => deleteSelection()} title="Xoá (Delete)"><Icon name="trash" /></button>
      <div className="spacer" />
      <button className="icon-btn" onClick={() => { const m = !muted; setMuted(m); if (m) player.ref?.mute(); else player.ref?.unmute(); }} title="Tắt tiếng"><Icon name={muted ? 'mute' : 'volume'} /></button>
      <button className="icon-btn" onClick={() => seek(0)} title="Về đầu (Home)"><Icon name="start" /></button>
      <button className="icon-btn" onClick={() => seek(currentTime() - 1 / fps)} title="Lùi 1 frame (←)"><Icon name="prev" /></button>
      <button className="icon-btn play" onClick={() => togglePlay()} title="Phát / dừng (Space)"><Icon name={playing ? 'pause' : 'play'} size={16} /></button>
      <button className="icon-btn" onClick={() => seek(currentTime() + 1 / fps)} title="Tới 1 frame (→)"><Icon name="next" /></button>
      <span className="small muted">{fmtTime(duration, fps)}</span>
      <div className="spacer" />
      <button className="icon-btn" onClick={() => useStore.setState({ zoom: Math.max(5, zoom / 1.3) })}><Icon name="zoomout" /></button>
      <input type="range" min={5} max={400} value={zoom} onChange={(e) => useStore.setState({ zoom: Number(e.target.value) })} />
      <button className="icon-btn" onClick={() => useStore.setState({ zoom: Math.min(400, zoom * 1.3) })}><Icon name="zoomin" /></button>
    </div>
  );
};
