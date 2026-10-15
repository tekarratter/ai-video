import React from 'react';
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion';

/** Autumn leaves drifting down and spinning. Transparent — use on an overlay track. */
export const FallingLeaves: React.FC<{ count?: number; colors?: string[]; speed?: number; opacity?: number }> = ({
  count = 22, colors = ['#ea580c', '#f59e0b', '#dc2626', '#facc15', '#b45309'], speed = 1, opacity = 0.9,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity }}>
      {Array.from({ length: count }).map((_, i) => {
        const size = 26 + random(`s${i}`) * 34;
        const v = (70 + random(`v${i}`) * 80) * speed;
        const y = ((random(`y${i}`) * (height + 120) + t * v) % (height + 120)) - 60;
        const sway = Math.sin(t * (0.7 + random(`f${i}`) * 0.8) + random(`p${i}`) * 6.28) * (40 + random(`a${i}`) * 50);
        const x = random(`x${i}`) * width + sway;
        const rot = random(`r${i}`) * 360 + t * (60 + random(`w${i}`) * 120) * (random(`d${i}`) > 0.5 ? 1 : -1);
        const flip = Math.cos(t * (1 + random(`q${i}`) * 2));
        const c = colors[Math.floor(random(`c${i}`) * colors.length)];
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" style={{ position: 'absolute', left: x, top: y, transform: `rotate(${rot}deg) scaleX(${flip})`, filter: 'drop-shadow(0 3px 4px rgba(0,0,0,.35))' }}>
            <path d="M12 2c-1 2-1 3 0 4-2-1-4-1-5 0 1 1 2 2 2 3-2 0-4 1-5 3 2 0 3 1 4 2-1 1-1 3 0 4 2-1 3-1 4 0v4h0.2v-4c1-1 2-1 4 0 1-1 1-3 0-4 1-1 2-2 4-2-1-2-3-3-5-3 0-1 1-2 2-3-1-1-3-1-5 0 1-1 1-2 0-4z" fill={c} />
          </svg>
        );
      })}
    </AbsoluteFill>
  );
};
