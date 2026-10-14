import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { mediaUrl } from './mediaUrl';

/** Opening scene: hero photo with zoom, project name and tagline. Main-track scene. */
export const ProjectIntro: React.FC<{ src?: string; kicker?: string; title?: string; subtitle?: string; accent?: string }> = ({
  src, kicker = 'SolidLine Project', title = 'THE WINDING\nHOUSE', subtitle = 'From open patio to sunroom', accent = '#1e73be',
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const z = interpolate(frame, [0, durationInFrames], [1.25, 1.05]);
  const k = spring({ frame: frame - 6, fps, config: { damping: 200 } });
  const lines = title.split('\n');
  const sub = spring({ frame: frame - 34, fps, config: { damping: 200 } });
  const bar = interpolate(frame, [24, 46], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: '#0b1622', fontFamily: 'Inter, Arial, sans-serif', justifyContent: 'center' }}>
      {src ? <Img src={mediaUrl(src)!} style={{ position: 'absolute', height: '100%', left: '50%', transform: `translateX(-50%) scale(${z})`, filter: 'brightness(0.55)' }} /> : null}
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(11,22,34,0.1) 30%, rgba(11,22,34,0.85) 100%)' }} />
      <div style={{ position: 'relative', padding: '0 80px', marginTop: 420 }}>
        <div style={{ color: '#7cc4ff', fontSize: 40, fontWeight: 800, letterSpacing: 10, textTransform: 'uppercase', opacity: k, transform: `translateY(${(1 - k) * 30}px)` }}>{kicker}</div>
        {lines.map((l, i) => {
          const p = spring({ frame: frame - 12 - i * 7, fps, config: { damping: 13, mass: 0.7 } });
          return (
            <div key={i} style={{ overflow: 'hidden' }}>
              <div style={{ color: '#fff', fontSize: 132, fontWeight: 900, lineHeight: 1.02, transform: `translateY(${(1 - p) * 140}px)`, textShadow: '0 8px 40px rgba(0,0,0,.5)' }}>{l}</div>
            </div>
          );
        })}
        <div style={{ width: 300 * bar, height: 10, background: accent, borderRadius: 5, margin: '28px 0' }} />
        <div style={{ color: '#fff', fontSize: 52, fontWeight: 600, opacity: sub, transform: `translateX(${(1 - sub) * -40}px)` }}>{subtitle}</div>
      </div>
    </AbsoluteFill>
  );
};
