import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

/** Drifting low fog + dark vignette (optionally tinted). Transparent — overlay spanning a scene. */
export const SpookyFog: React.FC<{ color?: string; tint?: string; density?: number; vignette?: number }> = ({ color = '#c9d6e3', tint = 'rgba(80,0,120,0.18)', density = 0.7, vignette = 0.65 }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const fade = interpolate(frame, [0, fps * 0.8, durationInFrames - fps * 0.8, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const big = Math.max(width, height);
  const layers = [0, 1, 2, 3];
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: fade }}>
      <AbsoluteFill style={{ background: tint, mixBlendMode: 'multiply' }} />
      {layers.map((l) => {
        const dir = l % 2 ? -1 : 1;
        const x = ((t * (25 + l * 15) * dir) % width) - width * 0.5;
        return (
          <div key={l} style={{
            position: 'absolute', left: x, bottom: -height * 0.08 + l * height * 0.06, width: width * 2, height: height * (0.32 - l * 0.04),
            background: `radial-gradient(ellipse 30% 50% at 25% 60%, ${color} 0%, transparent 70%), radial-gradient(ellipse 25% 45% at 70% 50%, ${color} 0%, transparent 70%)`,
            opacity: density * (0.55 - l * 0.08), filter: `blur(${big * 0.02}px)`,
          }} />
        );
      })}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${vignette}) 100%)` }} />
    </AbsoluteFill>
  );
};
