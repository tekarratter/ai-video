import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

/** Cute translucent ghost drifting across with a wavy tail. Transparent overlay. */
export const FloatingGhost: React.FC<{ y?: number; size?: number; color?: string; direction?: 'left' | 'right'; text?: string }> = ({ y = 0.4, size = 0.22, color = '#ffffff', direction = 'right', text = 'Boo!' }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const side = Math.min(width, height);
  const s = side * size;
  const p = frame / Math.max(1, durationInFrames - 1);
  const x = interpolate(p, [0, 1], direction === 'right' ? [-s, width + s * 0.2] : [width + s * 0.2, -s]);
  const yy = height * y + Math.sin(t * 2.4) * side * 0.04;
  const wave = (k: number) => Math.sin(t * 6 + k) * 4;
  const booOpacity = interpolate(p, [0.35, 0.45, 0.65, 0.75], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: x, top: yy, width: s, transform: `rotate(${Math.sin(t * 2) * 6}deg) scaleX(${direction === 'right' ? 1 : -1})`, opacity: 0.88, filter: `drop-shadow(0 0 ${s * 0.12}px rgba(255,255,255,.6))` }}>
        <svg viewBox="0 0 100 120" width={s} height={s * 1.2}>
          <path fill={color} d={`M10 60 C10 20 30 4 50 4 C70 4 90 20 90 60 L90 108 Q83 ${116 + wave(0)} 76 108 Q69 ${100 + wave(1)} 62 108 Q55 ${116 + wave(2)} 48 108 Q41 ${100 + wave(3)} 34 108 Q27 ${116 + wave(4)} 20 108 Q13 ${100 + wave(5)} 10 108 Z`} />
          <ellipse cx="36" cy="48" rx="7" ry="10" fill="#111" /><ellipse cx="62" cy="48" rx="7" ry="10" fill="#111" />
          <ellipse cx="49" cy="72" rx="8" ry={6 + Math.abs(Math.sin(t * 3)) * 5} fill="#111" />
        </svg>
      </div>
      {text && (
        <div style={{ position: 'absolute', left: x + (direction === 'right' ? s * 0.9 : -s * 0.6), top: yy - s * 0.25, opacity: booOpacity, color: '#fff', fontFamily: 'Impact, sans-serif', fontSize: s * 0.32, textShadow: '0 0 12px #a855f7, 0 4px 10px #000' }}>{text}</div>
      )}
    </AbsoluteFill>
  );
};
