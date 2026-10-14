import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { mediaUrl } from './mediaUrl';

/** Before/after slider: a divider sweeps across revealing the "after" photo. Main-track scene. */
export const BeforeAfter: React.FC<{ before: string; after: string; accent?: string }> = ({ before, after, accent = '#1e73be' }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();
  const pos = interpolate(frame, [12, durationInFrames * 0.45, durationInFrames * 0.6, durationInFrames - 8], [1, 0.12, 0.12, 0.5], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const lbl = spring({ frame, fps, config: { damping: 200 } });
  const img: React.CSSProperties = { position: 'absolute', height: '100%', left: '50%', transform: 'translateX(-50%)' };
  const tag = (t: string, side: 'left' | 'right', bg: string): React.ReactNode => (
    <div style={{ position: 'absolute', top: 300, [side]: 50, background: bg, color: '#fff', fontFamily: 'Inter, Arial, sans-serif', fontWeight: 900, fontSize: 46, letterSpacing: 6, padding: '12px 26px', borderRadius: 12, opacity: lbl, transform: `translateY(${(1 - lbl) * -40}px)` }}>{t}</div>
  );
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Img src={mediaUrl(after)!} style={img} />
      <AbsoluteFill style={{ clipPath: `inset(0 ${(1 - pos) * 100}% 0 0)` }}>
        <Img src={mediaUrl(before)!} style={img} />
      </AbsoluteFill>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: width * pos - 4, width: 8, background: '#fff', boxShadow: '0 0 30px rgba(0,0,0,.6)' }}>
        <div style={{ position: 'absolute', top: '50%', left: -36, width: 80, height: 80, borderRadius: 40, background: accent, border: '6px solid #fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, fontWeight: 900 }}>⇆</div>
      </div>
      {tag('BEFORE', 'left', 'rgba(0,0,0,0.65)')}
      {tag('AFTER', 'right', accent)}
    </AbsoluteFill>
  );
};
