import React from 'react';
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion';

/** Classic film leader countdown (5‑4‑3‑2‑1 with the rotating sweep and crosshair). Full scene, ~5s. */
export const FilmLeader: React.FC<{ from?: number; color?: string }> = ({ from = 5, color = '#d9d0bf' }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const per = Math.max(1, Math.floor(durationInFrames / from));
  const idx = Math.min(from - 1, Math.floor(frame / per));
  const p = (frame - idx * per) / per;
  const side = Math.min(width, height);
  const R = side * 0.36;
  const cx = width / 2, cy = height / 2;
  const a = p * Math.PI * 2 - Math.PI / 2;
  const sweep = `M${cx} ${cy} L${cx} ${cy - R * 2} A${R * 2} ${R * 2} 0 ${p > 0.5 ? 1 : 0} 1 ${cx + Math.cos(a) * R * 2} ${cy + Math.sin(a) * R * 2} Z`;
  const flick = 0.9 + random(`f${frame}`) * 0.1;
  return (
    <AbsoluteFill style={{ background: '#1a1814', filter: `sepia(.3) brightness(${flick})` }}>
      <svg width={width} height={height}>
        <path d={sweep} fill="#5b554b" />
        <line x1={0} y1={cy} x2={width} y2={cy} stroke="#111" strokeWidth={side * 0.006} />
        <line x1={cx} y1={0} x2={cx} y2={height} stroke="#111" strokeWidth={side * 0.006} />
        <circle cx={cx} cy={cy} r={R} stroke={color} strokeWidth={side * 0.012} fill="none" />
        <circle cx={cx} cy={cy} r={R * 0.82} stroke={color} strokeWidth={side * 0.006} fill="none" />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill={color} fontFamily="Georgia, serif" fontWeight="bold" fontSize={R * 1.25}>{from - idx}</text>
      </svg>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,.75) 100%)' }} />
    </AbsoluteFill>
  );
};
