import React from 'react';
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion';

/** Confetti burst from the bottom (or rain from the top). Transparent — use on an overlay track. */
export const Confetti: React.FC<{ count?: number; mode?: 'burst' | 'rain'; colors?: string[]; seed?: string }> = ({
  count = 140, mode = 'burst', colors = ['#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#ffffff'], seed = 'c',
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const g = height * 0.9; // gravity px/s²
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
      {Array.from({ length: count }).map((_, i) => {
        const r = (k: string) => random(`${seed}${k}${i}`);
        const size = (0.008 + r('s') * 0.012) * Math.min(width, height) * 1.6;
        let x: number, y: number;
        if (mode === 'rain') {
          const delay = r('d') * 2;
          const tt = Math.max(0, t - delay);
          x = r('x') * width + Math.sin(tt * 3 + r('p') * 6) * 30;
          y = -40 + tt * (height * (0.25 + r('v') * 0.25));
        } else {
          const angle = -Math.PI / 2 + (r('a') - 0.5) * 1.3;
          const v = height * (0.9 + r('v') * 0.9);
          const drag = Math.exp(-t * 0.9);
          x = width / 2 + Math.cos(angle) * v * (1 - drag) / 0.9 + Math.sin(t * 4 + r('p') * 6) * 20;
          y = height + 20 + Math.sin(angle) * v * (1 - drag) / 0.9 + 0.5 * g * 0.35 * t * t;
        }
        const rot = t * (200 + r('r') * 500) * (r('dir') > 0.5 ? 1 : -1);
        const flip = Math.abs(Math.cos(t * (4 + r('f') * 6)));
        return (
          <div key={i} style={{
            position: 'absolute', left: x, top: y, width: size, height: size * (r('shape') > 0.5 ? 0.45 : 1),
            background: colors[Math.floor(r('c') * colors.length)], borderRadius: r('shape') > 0.8 ? '50%' : 2,
            transform: `rotate(${rot}deg) scaleY(${0.3 + flip * 0.7})`,
          }} />
        );
      })}
    </AbsoluteFill>
  );
};
