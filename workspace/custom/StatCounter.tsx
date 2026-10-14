import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

/** Animated number counting up with a label, e.g. "250 m² diện tích". */
export const StatCounter: React.FC<{ value?: number; suffix?: string; prefix?: string; label?: string; color?: string; background?: string; decimals?: number }> = ({
  value = 250, suffix = ' m²', prefix = '', label = 'Diện tích sàn', color = '#ffffff', background = 'linear-gradient(160deg,#111827,#374151)', decimals = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const n = interpolate(frame, [0, fps * 1.6], [0, value], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const o = interpolate(frame, [fps * 0.6, fps * 1.2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background, alignItems: 'center', justifyContent: 'center', color, fontFamily: 'Inter, Arial, sans-serif' }}>
      <div style={{ fontSize: 220, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{prefix}{n.toFixed(decimals)}{suffix}</div>
      <div style={{ fontSize: 56, opacity: o, letterSpacing: 6, textTransform: 'uppercase' }}>{label}</div>
    </AbsoluteFill>
  );
};
