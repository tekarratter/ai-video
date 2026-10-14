import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const TitleCard: React.FC<{ title?: string; subtitle?: string; color?: string; background?: string }> = ({
  title = 'Tiêu đề',
  subtitle = '',
  color = '#ffffff',
  background = 'linear-gradient(135deg,#0f172a,#1e3a8a)',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 200 } });
  const line = interpolate(frame, [10, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background, alignItems: 'center', justifyContent: 'center', color, fontFamily: 'Georgia, serif' }}>
      <div style={{ fontSize: 110, letterSpacing: 4, opacity: p, transform: `translateY(${(1 - p) * 40}px)` }}>{title}</div>
      <div style={{ width: 400 * line, height: 3, background: color, margin: '24px 0', opacity: 0.8 }} />
      <div style={{ fontSize: 44, opacity: line, fontFamily: 'Inter, Arial, sans-serif' }}>{subtitle}</div>
    </AbsoluteFill>
  );
};
