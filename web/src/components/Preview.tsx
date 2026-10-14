import React, { useEffect, useMemo, useRef } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { components } from '@custom';
import { Main } from '../../../remotion/Main';
import { projectDuration } from '../../../shared/timeline.js';
import { useStore } from '../store';
import { player } from '../player';
import { Icon } from './Icon';

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
    </div>
  );
};
