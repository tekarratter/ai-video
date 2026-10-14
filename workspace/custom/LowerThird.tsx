import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** Name/title bar sliding in at the bottom-left. Transparent background — use on an overlay track. */
export const LowerThird: React.FC<{ name?: string; role?: string; accent?: string }> = ({ name = 'Nguyễn Văn A', role = 'Kiến trúc sư', accent = '#f59e0b' }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const exit = interpolate(frame, [durationInFrames - 15, durationInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const x = (1 - enter) * -600 + exit * -600;
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 120, bottom: 140, transform: `translateX(${x}px)`, fontFamily: 'Inter, Arial, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          <div style={{ width: 10, background: accent }} />
          <div style={{ background: 'rgba(10,10,10,0.82)', padding: '18px 32px' }}>
            <div style={{ color: '#fff', fontSize: 52, fontWeight: 800 }}>{name}</div>
            <div style={{ color: accent, fontSize: 32, marginTop: 4, letterSpacing: 2, textTransform: 'uppercase' }}>{role}</div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
