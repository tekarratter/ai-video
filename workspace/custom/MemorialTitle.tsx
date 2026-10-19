import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

// Memorial / death-anniversary title scene: deep red with gold text and slowly rising incense smoke.
export const MemorialTitle: React.FC<{
  kicker?: string; title?: string; name?: string; lines?: string[]; gold?: string; background?: string;
}> = ({
  kicker = 'Lễ giỗ',
  title = 'Tưởng nhớ',
  name = 'Họ và tên',
  lines = [],
  gold = '#e8c36a',
  background = 'radial-gradient(ellipse at 50% 40%, #5a1010 0%, #2a0606 60%, #120202 100%)',
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, height } = useVideoConfig();
  const s = height / 1920;
  const p = (delay: number) => spring({ frame: frame - delay, fps, config: { damping: 200 } });
  const fadeOut = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const line = interpolate(frame, [20, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const smoke = [0, 1, 2, 3, 4].map((i) => {
    const t = (frame / fps + i * 1.7) % 8;
    return { x: 50 + Math.sin(t * 0.9 + i) * 6, y: 100 - t * 11, o: interpolate(t, [0, 2, 8], [0, 0.18, 0]) };
  });
  return (
    <AbsoluteFill style={{ background, alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, "Times New Roman", serif', opacity: fadeOut }}>
      {smoke.map((m, i) => (
        <div key={i} style={{
          position: 'absolute', left: `${m.x}%`, top: `${m.y}%`, width: 420 * s, height: 420 * s, marginLeft: -210 * s,
          borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,240,220,0.9), rgba(255,240,220,0) 70%)',
          opacity: m.o, filter: `blur(${30 * s}px)`,
        }} />
      ))}
      <div style={{ position: 'absolute', inset: 40 * s, border: `${3 * s}px solid ${gold}`, opacity: 0.45 * p(0) }} />
      <div style={{ position: 'absolute', inset: 58 * s, border: `${1.5 * s}px solid ${gold}`, opacity: 0.3 * p(0) }} />
      <div style={{ textAlign: 'center', color: gold, padding: `0 ${90 * s}px` }}>
        <div style={{ fontSize: 54 * s, letterSpacing: 10 * s, textTransform: 'uppercase', opacity: p(5) }}>{kicker}</div>
        <div style={{ fontSize: 96 * s, marginTop: 30 * s, opacity: p(15), transform: `translateY(${(1 - p(15)) * 40 * s}px)` }}>{title}</div>
        <div style={{ width: 520 * s * line, height: 3 * s, background: gold, margin: `${40 * s}px auto`, opacity: 0.8 }} />
        <div style={{ fontSize: 120 * s, fontWeight: 700, color: '#fff3d6', lineHeight: 1.15, opacity: p(30), transform: `scale(${0.92 + 0.08 * p(30)})`, textShadow: `0 0 ${30 * s}px rgba(232,195,106,.45)` }}>{name}</div>
        <div style={{ marginTop: 60 * s }}>
          {lines.map((l, i) => (
            <div key={i} style={{ fontSize: 48 * s, lineHeight: 1.6, color: '#f5e2b5', opacity: p(50 + i * 12), fontFamily: 'Inter, Arial, sans-serif' }}>{l}</div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
