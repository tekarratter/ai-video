import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { components } from '@custom';
import { Main } from '../../../remotion/Main';
import { applySafeZone, layoutTrack, projectDuration, SAFE_ZONES } from '../../../shared/timeline.js';
import { useStore } from '../store';
import { player, seek, togglePlay } from '../player';
import { Icon } from './Icon';

const fmt = (t: number) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

/** Fixed-size seek bar under the player: the whole video always fits, independent of the timeline zoom. */
const SeekBar: React.FC<{ durationFrames: number }> = ({ durationFrames }) => {
  const project = useStore((s) => s.project);
  const frame = useStore((s) => s.frame);
  const playing = useStore((s) => s.playing);
  const barRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const { fps } = project.settings;
  const total = durationFrames / fps;
  const now = Math.min(frame / fps, total);
  // scene markers: where each clip of the first sequence track starts
  const scenes = useMemo(() => {
    const main = project.tracks.find((t: any) => t.type === 'sequence' && !t.hidden); // eslint-disable-line @typescript-eslint/no-explicit-any
    return main ? layoutTrack(main, project).map((l: any) => ({ id: l.clip.id, start: l.start, end: l.end, kind: l.clip.kind, name: l.clip.name || l.clip.component || l.clip.kind })) : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  }, [project]);

  const timeAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * total;
  };
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const wasPlaying = useStore.getState().playing;
    if (wasPlaying) player.ref?.pause();
    seek(Math.min(timeAt(e.clientX), total - 1 / fps));
    const move = (ev: PointerEvent) => seek(Math.min(timeAt(ev.clientX), total - 1 / fps));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (wasPlaying) player.ref?.play();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const pct = (t: number) => `${(t / total) * 100}%`;
  return (
    <div className="seekbar">
      <button className="icon-btn" title="Phát / dừng (Space)" onClick={togglePlay}><Icon name={playing ? 'pause' : 'play'} /></button>
      <span className="num small seek-time">{fmt(now)}</span>
      <div
        className="seek-track"
        ref={barRef}
        onPointerDown={onDown}
        onPointerMove={(e) => setHover(timeAt(e.clientX))}
        onPointerLeave={() => setHover(null)}
      >
        <div className="seek-rail">
          {scenes.map((c: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
            <div key={c.id} className={`seek-scene ${c.kind}`} style={{ left: pct(c.start), width: pct(c.end - c.start) }} title={c.name} />
          ))}
          <div className="seek-fill" style={{ width: pct(now) }} />
        </div>
        <div className="seek-knob" style={{ left: pct(now) }} />
        {hover != null && <div className="seek-hover" style={{ left: pct(hover) }}>{fmt(hover)}</div>}
      </div>
      <span className="num small muted seek-time">{fmt(total)}</span>
    </div>
  );
};

const FORMATS: [string, number, number, string][] = [
  ['9:16', 1080, 1920, 'Dọc · Reels / TikTok / Shorts'],
  ['16:9', 1920, 1080, 'Ngang · YouTube'],
  ['1:1', 1080, 1080, 'Vuông · Instagram / Facebook'],
  ['4:5', 1080, 1350, 'Dọc 4:5 · bài đăng Instagram'],
  ['16:9 4K', 3840, 2160, 'Ngang 4K (render lâu)'],
  ['16:9 720p', 1280, 720, 'Ngang 720p (nhẹ, render nhanh)'],
  ['9:16 720p', 720, 1280, 'Dọc 720p (nhẹ)'],
];

/** "1080×1920 · 30fps" in the preview header — click to change the output format. */
const FormatPicker: React.FC = () => {
  const settings = useStore((s) => s.project.settings);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const { width, height, fps } = settings;
  const set = (patch: Record<string, number>) => useStore.getState().update((p) => { Object.assign(p.settings, patch); }, { record: true });
  const commit = (k: 'width' | 'height', v: string) => { const n = Math.max(16, Math.round(Number(v) / 2) * 2); if (n && n !== settings[k]) set({ [k]: n }); };
  const ratio = (w: number, h: number) => { const g = (a: number, b: number): number => (b ? g(b, a % b) : a); const d = g(w, h); return `${w / d}:${h / d}`; };
  return (
    <div className="fmt-picker" ref={ref}>
      <button className="fmt-btn" onClick={() => setOpen(!open)} title="Đổi định dạng xuất (khung hình, độ phân giải, fps)">
        {width}×{height} · {fps}fps <Icon name="chevdown" size={12} />
      </button>
      {open && (
        <div className="fmt-menu">
          <div className="section-title">Khung hình</div>
          {FORMATS.map(([name, w, h, desc]) => (
            <button key={`${w}x${h}`} className={`fmt-row ${w === width && h === height ? 'active' : ''}`} onClick={() => set({ width: w, height: h })}>
              <span className="fmt-shape" style={{ aspectRatio: `${w} / ${h}`, [w >= h ? 'width' : 'height']: 22 }} />
              <span><b>{name}</b> <span className="muted small">{w}×{h}</span><br /><span className="muted small">{desc}</span></span>
              {w === width && h === height && <Icon name="check" />}
            </button>
          ))}
          <div className="section-title">Tốc độ khung hình</div>
          <div className="seg fmt-fps">
            {[24, 25, 30, 50, 60].map((f) => <button key={f} className={f === fps ? 'active' : ''} onClick={() => set({ fps: f })}>{f}</button>)}
          </div>
          <div className="fmt-custom">
            <span className="muted small">Tuỳ chỉnh</span>
            <input key={`width${width}`} type="number" min={16} step={2} defaultValue={width} onBlur={(e) => commit('width', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit('width', (e.target as HTMLInputElement).value); }} />
            ×
            <input key={`height${height}`} type="number" min={16} step={2} defaultValue={height} onBlur={(e) => commit('height', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commit('height', (e.target as HTMLInputElement).value); }} />
            <span className="muted small">{ratio(width, height)}</span>
          </div>
          <div className="muted small fmt-note">Vị trí chữ/logo tính theo tỉ lệ khung nên tự co giãn; ảnh/video dùng chế độ "cover" sẽ được cắt lại theo khung mới. Có thể hoàn tác bằng Ctrl+Z.</div>
        </div>
      )}
    </div>
  );
};

export const Preview: React.FC = () => {
  const project = useStore((s) => s.project);
  const openComp = useStore((s) => s.openComp);
  const hiddenTracks = useStore((s) => s.hiddenTracks);
  const playbackRate = useStore((s) => s.playbackRate);
  const ref = useRef<PlayerRef>(null);
  const box = useRef<HTMLDivElement>(null);
  const activeProject = useStore((s) => s.activeProject);
  const [nativeFull, setFull] = useState(false);
  // iPhone Safari can't put an element in full screen (only a bare <video>): fill the window instead
  const [pseudoFull, setPseudoFull] = useState(false);
  const pseudoRef = useRef(false);
  pseudoRef.current = pseudoFull;
  const isFull = nativeFull || pseudoFull;
  const { width, height, fps } = project.settings;
  const isMain = openComp === 'Main';
  const Custom = (components as Record<string, React.FC<any>>)[openComp]; // eslint-disable-line @typescript-eslint/no-explicit-any

  const duration = isMain ? Math.max(1, Math.round(projectDuration(project) * fps)) : 150;
  const safePreview = useStore((s) => s.safePreview);
  const inputProps = useMemo(() => {
    const zone = safePreview ? SAFE_ZONES[safePreview] : null;
    return zone ? { project: applySafeZone(project, zone), mediaBase: '', hiddenTracks, safeGuide: zone } : { project, mediaBase: '', hiddenTracks };
  }, [project, hiddenTracks, safePreview]);

  useEffect(() => {
    const p = ref.current;
    if (!p) return;
    player.ref = p;
    const onFrame = (e: { detail: { frame: number } }) => useStore.setState({ frame: e.detail.frame });
    const onPlay = () => useStore.setState({ playing: true });
    const onPause = () => useStore.setState({ playing: false });
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    p.seekTo(Math.min(useStore.getState().frame, duration - 1));
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
    };
  }, [openComp]); // eslint-disable-line react-hooks/exhaustive-deps

  // switching project restores its playhead
  useEffect(() => { ref.current?.seekTo(Math.min(useStore.getState().frame, duration - 1)); }, [activeProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // full screen = the whole preview (frame + seek bar), so playback controls stay usable
  const toggleFull = () => {
    const d = document as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const el = box.current as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (pseudoRef.current) { setPseudoFull(false); return; }
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      Promise.resolve((d.exitFullscreen || d.webkitExitFullscreen)?.call(d)).catch(() => {});
      return;
    }
    const req = el?.requestFullscreen || el?.webkitRequestFullscreen;
    if (!req) { setPseudoFull(true); return; }
    try { Promise.resolve(req.call(el)).catch(() => setPseudoFull(true)); } catch { setPseudoFull(true); }
  };
  useEffect(() => {
    const onChange = () => {
      const d = document as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      setFull(!!box.current && (d.fullscreenElement || d.webkitFullscreenElement) === box.current);
    };
    const onKey = () => toggleFull();
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && pseudoRef.current) setPseudoFull(false); };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    window.addEventListener('preview-fullscreen', onKey);
    window.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
      window.removeEventListener('preview-fullscreen', onKey);
      window.removeEventListener('keydown', onEsc);
    };
  }, []);

  return (
    <div className={`preview ${pseudoFull ? 'pseudo-full' : ''}`} ref={box}>
      <div className="tabbar">
        <div className="tab active"><Icon name="comp" /> {isMain ? project.name || 'Main' : openComp}</div>
        {!isMain && (
          <button className="tab-close" onClick={() => useStore.setState({ openComp: 'Main' })} title="Đóng, về timeline chính"><Icon name="x" size={12} /></button>
        )}
        <div className="spacer" />
        {isMain ? <FormatPicker /> : <span className="muted small">{width}×{height} · {fps}fps</span>}
      </div>
      <div className="stage">
        {isMain || Custom ? (
          <Player
            key={openComp}
            ref={ref}
            component={(isMain ? Main : Custom) as React.FC<any>} // eslint-disable-line @typescript-eslint/no-explicit-any
            inputProps={isMain ? inputProps : {}}
            playbackRate={playbackRate}
            durationInFrames={duration}
            fps={fps}
            compositionWidth={width}
            compositionHeight={height}
            style={{ width: '100%', height: '100%' }}
            acknowledgeRemotionLicense
            clickToPlay={false}
            doubleClickToFullscreen
            spaceKeyToPlayOrPause={false}
            loop
            errorFallback={({ error }) => <div className="player-error">Lỗi preview: {error.message}</div>}
          />
        ) : (
          <div className="player-error">Không tìm thấy component “{openComp}”</div>
        )}
        {isMain && safePreview && (
          <button className="safe-badge" title="Vùng đỏ: bị giao diện Facebook trên điện thoại che. Bấm để tắt" onClick={() => useStore.setState({ safePreview: null })}>
            Xem như {SAFE_ZONES[safePreview]?.label} ✕
          </button>
        )}
        <button className="fs-btn" onClick={toggleFull} title={isFull ? 'Thoát toàn màn hình (F / Esc)' : 'Xem toàn màn hình (F)'}>
          <Icon name={isFull ? 'fsexit' : 'fullscreen'} size={16} />
        </button>
      </div>
      {(isMain || !!Custom) && <SeekBar durationFrames={duration} />}
    </div>
  );
};
