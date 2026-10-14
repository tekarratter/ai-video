import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { components } from '@custom';
import { Main } from '../../../remotion/Main';
import { layoutTrack, projectDuration } from '../../../shared/timeline.js';
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

export const Preview: React.FC = () => {
  const project = useStore((s) => s.project);
  const openComp = useStore((s) => s.openComp);
  const hiddenTracks = useStore((s) => s.hiddenTracks);
  const playbackRate = useStore((s) => s.playbackRate);
  const ref = useRef<PlayerRef>(null);
  const { width, height, fps } = project.settings;
  const isMain = openComp === 'Main';
  const Custom = (components as Record<string, React.FC<any>>)[openComp]; // eslint-disable-line @typescript-eslint/no-explicit-any

  const duration = isMain ? Math.max(1, Math.round(projectDuration(project) * fps)) : 150;
  const inputProps = useMemo(() => ({ project, mediaBase: '', hiddenTracks }), [project, hiddenTracks]);

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

  return (
    <div className="preview">
      <div className="tabbar">
        <div className="tab active"><Icon name="comp" /> {isMain ? project.name || 'Main' : openComp}</div>
        {!isMain && (
          <button className="tab-close" onClick={() => useStore.setState({ openComp: 'Main' })} title="Đóng, về timeline chính"><Icon name="x" size={12} /></button>
        )}
        <div className="spacer" />
        <span className="muted small">{width}×{height} · {fps}fps</span>
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
      </div>
      {(isMain || !!Custom) && <SeekBar durationFrames={duration} />}
    </div>
  );
};
