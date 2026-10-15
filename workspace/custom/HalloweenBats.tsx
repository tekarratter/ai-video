import React from 'react';
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion';

const Bat: React.FC<{ size: number; flap: number; color: string }> = ({ size, flap, color }) => {
  const w = 0.35 + 0.65 * Math.abs(Math.sin(flap)); // wing opening
  return (
    <svg width={size} height={size * 0.6} viewBox="-50 -30 100 60" style={{ overflow: 'visible' }}>
      <g fill={color}>
        <path transform={`scale(1 ${w})`} d="M0 -4 C-8 -14 -22 -18 -48 -10 C-40 -4 -38 2 -40 8 C-32 2 -26 4 -22 10 C-18 2 -12 2 -6 6 Z" />
        <path transform={`scale(1 ${w})`} d="M0 -4 C8 -14 22 -18 48 -10 C40 -4 38 2 40 8 C32 2 26 4 22 10 C18 2 12 2 6 6 Z" />
        <ellipse cx="0" cy="0" rx="6" ry="9" />
        <path d="M-5 -7 L-4 -14 L-1 -8 Z M5 -7 L4 -14 L1 -8 Z" />
      </g>
    </svg>
  );
};

/** Bats flapping across the frame. Transparent — overlay track. */
export const HalloweenBats: React.FC<{ count?: number; color?: string; speed?: number; seed?: string }> = ({ count = 14, color = '#0b0b0f', speed = 1, seed = 'bat' }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = (frame / fps) * speed;
  const side = Math.min(width, height);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
      {Array.from({ length: count }).map((_, i) => {
        const r = (k: string) => random(`${seed}${k}${i}`);
        const size = side * (0.06 + r('s') * 0.1);
        const dir = r('d') > 0.5 ? 1 : -1;
        const v = width * (0.18 + r('v') * 0.22);
        const span = width + size * 2;
        const x0 = r('x') * span;
        const x = dir > 0 ? ((x0 + t * v) % span) - size : span - ((x0 + t * v) % span) - size;
        const y = height * (0.08 + r('y') * 0.5) + Math.sin(t * (1.5 + r('w') * 2) + r('p') * 6) * height * 0.05;
        return (
          <div key={i} style={{ position: 'absolute', left: x, top: y, transform: `scaleX(${dir}) rotate(${Math.sin(t * 2 + i) * 8}deg)`, opacity: 0.75 + r('o') * 0.25, filter: size < side * 0.09 ? 'blur(1px)' : undefined }}>
            <Bat size={size} flap={t * (14 + r('f') * 8) + r('p') * 6} color={color} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
