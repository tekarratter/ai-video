import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** 70s retro title: rotating sunburst, rainbow stripes, chunky outlined serif with offset shadow. Full scene. */
export const RetroTitle: React.FC<{ title?: string; subtitle?: string; colors?: string[]; background?: string }> = ({
  title = 'NGÀY XƯA\nYÊU DẤU', subtitle = 'since 1975', colors = ['#e4572e', '#f3a712', '#a8c686', '#29335c'], background = '#f4e4c1',
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const side = Math.min(width, height);
  const t = frame / fps;
  const enter = spring({ frame, fps, config: { damping: 11 } });
  const lines = title.split('\n');
  const fs = Math.min(side * 0.16, (width * 0.85) / Math.max(...lines.map((l) => l.length)) * 1.7);
  const stripes = interpolate(frame, [0, fps * 0.8], [0, 1], { extrapolateRight: 'clamp' });
  const big = Math.hypot(width, height);
  return (
    <AbsoluteFill style={{ background, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', width: big, height: big, left: width / 2 - big / 2, top: height / 2 - big / 2, transform: `rotate(${t * 8}deg)`, background: `repeating-conic-gradient(rgba(228,87,46,.13) 0deg 10deg, transparent 10deg 20deg)` }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: height * 0.12, display: 'flex', flexDirection: 'column', gap: side * 0.012 }}>
        {colors.map((c, i) => (
          <div key={c} style={{ height: side * 0.028, background: c, width: `${Math.min(1, stripes * 1.6 - i * 0.15) * 100}%` }} />
        ))}
      </div>
      <div style={{ textAlign: 'center', transform: `scale(${0.5 + 0.5 * enter}) rotate(${(1 - enter) * -8}deg)` }}>
        {lines.map((l, i) => (
          <div key={i} style={{ fontFamily: '"Cooper Black", "Georgia", serif', fontWeight: 900, fontSize: fs, lineHeight: 1.25, whiteSpace: 'nowrap', color: colors[1], WebkitTextStroke: `${fs * 0.035}px ${colors[3]}`, textShadow: `${fs * 0.05}px ${fs * 0.05}px 0 ${colors[0]}, ${fs * 0.1}px ${fs * 0.1}px 0 ${colors[3]}` }}>{l}</div>
        ))}
        {subtitle && <div style={{ marginTop: fs * 0.25, fontFamily: 'Georgia, serif', fontStyle: 'italic', color: colors[3], fontSize: fs * 0.32, opacity: interpolate(t, [0.6, 1.2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>{subtitle}</div>}
      </div>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(80,40,0,.35) 100%)', mixBlendMode: 'multiply' }} />
    </AbsoluteFill>
  );
};
