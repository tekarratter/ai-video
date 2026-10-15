import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

/** Warm light leak / lens flare sweep — film-look overlay, nice between scenes. Overlay track, 1–2s. */
export const LightLeak: React.FC<{ color?: string; color2?: string; intensity?: number }> = ({ color = '#ff8a3d', color2 = '#ffd166', intensity = 0.85 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const p = frame / Math.max(1, durationInFrames - 1);
  const o = interpolate(p, [0, 0.35, 0.65, 1], [0, intensity, intensity, 0]);
  const x = interpolate(p, [0, 1], [-0.3, 1.3]);
  const big = Math.max(width, height);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'screen', opacity: o }}>
      <div style={{ position: 'absolute', left: x * width - big * 0.6, top: -big * 0.25, width: big * 1.2, height: big * 1.0, background: `radial-gradient(ellipse at center, ${color} 0%, transparent 60%)`, filter: 'blur(40px)' }} />
      <div style={{ position: 'absolute', left: (1 - x) * width - big * 0.4, top: height - big * 0.5, width: big * 0.8, height: big * 0.7, background: `radial-gradient(ellipse at center, ${color2} 0%, transparent 60%)`, filter: 'blur(50px)', opacity: 0.8 }} />
      <div style={{ position: 'absolute', left: x * width, top: 0, width: big * 0.06, height: '100%', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent)', transform: 'skewX(-18deg)', filter: 'blur(8px)' }} />
    </AbsoluteFill>
  );
};
