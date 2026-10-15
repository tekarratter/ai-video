import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** Spider dropping on its thread from the top, then bobbing. Transparent overlay. */
export const HangingSpider: React.FC<{ x?: number; drop?: number; size?: number; color?: string }> = ({ x = 0.8, drop = 0.35, size = 0.09, color = '#111' }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const side = Math.min(width, height);
  const s = side * size;
  const down = spring({ frame, fps, config: { damping: 6, stiffness: 60, mass: 0.8 } });
  const up = spring({ frame: frame - (durationInFrames - fps * 0.8), fps, config: { damping: 200 } });
  const bob = Math.sin((frame / fps) * 2.2) * side * 0.012;
  const y = Math.max(0, height * drop * down * (1 - up) + bob);
  const legs = Math.sin((frame / fps) * 9) * 6;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: width * x, top: 0, width: 2, height: y, background: 'rgba(255,255,255,0.7)' }} />
      <svg width={s * 1.6} height={s * 1.4} viewBox="-40 -30 80 70" style={{ position: 'absolute', left: width * x - s * 0.8, top: y - s * 0.35, overflow: 'visible' }}>
        <g stroke={color} strokeWidth="3.5" fill="none" strokeLinecap="round">
          {[-1, 1].map((d) => [0, 1, 2, 3].map((k) => (
            <path key={`${d}${k}`} d={`M0 ${2 + k * 4} q ${d * 18} ${-14 + k * 6 + (k % 2 ? legs : -legs)} ${d * 32} ${2 + k * 9}`} />
          )))}
        </g>
        <ellipse cx="0" cy="14" rx="15" ry="17" fill={color} />
        <circle cx="0" cy="-4" r="10" fill={color} />
        <circle cx="-4" cy="-6" r="2.6" fill="#ff3b30" /><circle cx="4" cy="-6" r="2.6" fill="#ff3b30" />
      </svg>
    </AbsoluteFill>
  );
};
