import React from 'react';
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion';

/** Gentle falling snow. Transparent — use on an overlay track. */
export const Snowfall: React.FC<{ count?: number; speed?: number; opacity?: number }> = ({ count = 70, speed = 1, opacity = 0.85 }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity }}>
      {Array.from({ length: count }).map((_, i) => {
        const size = 4 + random(`s${i}`) * 12;
        const v = (60 + random(`v${i}`) * 90) * speed * (size / 10);
        const y = ((random(`y${i}`) * (height + 40) + t * v) % (height + 40)) - 20;
        const sway = Math.sin(t * (0.6 + random(`f${i}`)) + random(`p${i}`) * 6.28) * (12 + random(`a${i}`) * 25);
        const x = random(`x${i}`) * width + sway;
        return <div key={i} style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: '50%', background: '#fff', opacity: 0.5 + random(`o${i}`) * 0.5, filter: size > 12 ? 'blur(1.5px)' : undefined, boxShadow: '0 0 6px rgba(255,255,255,.6)' }} />;
      })}
    </AbsoluteFill>
  );
};
