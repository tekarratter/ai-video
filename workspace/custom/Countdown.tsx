import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** 3‑2‑1 countdown: each number pops in with a ring that drains. Set `from` and the clip duration ≈ from seconds. */
export const Countdown: React.FC<{ from?: number; color?: string; accent?: string; background?: string; endText?: string }> = ({
  from = 3, color = '#ffffff', accent = '#f59e0b', background = 'transparent', endText = 'GO!',
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const steps = from + (endText ? 1 : 0);
  const per = Math.max(1, Math.floor(durationInFrames / steps));
  const idx = Math.min(steps - 1, Math.floor(frame / per));
  const local = frame - idx * per;
  const label = idx < from ? String(from - idx) : endText;
  const pop = spring({ frame: local, fps, config: { damping: 10, stiffness: 160 } });
  const fadeOut = interpolate(local, [per - 6, per], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const side = Math.min(width, height);
  const r = side * 0.28;
  const prog = local / per;
  const C = 2 * Math.PI * r;
  return (
    <AbsoluteFill style={{ background, alignItems: 'center', justifyContent: 'center' }}>
      <svg width={r * 2 + 40} height={r * 2 + 40} style={{ position: 'absolute', opacity: idx < from ? 1 : 0 }}>
        <circle cx={r + 20} cy={r + 20} r={r} stroke="rgba(255,255,255,0.18)" strokeWidth={side * 0.02} fill="none" />
        <circle cx={r + 20} cy={r + 20} r={r} stroke={accent} strokeWidth={side * 0.02} fill="none" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * prog} transform={`rotate(-90 ${r + 20} ${r + 20})`} />
      </svg>
      <div style={{ fontFamily: 'Inter, Arial, sans-serif', fontWeight: 900, fontSize: side * (idx < from ? 0.34 : 0.2), color: idx < from ? color : accent, transform: `scale(${pop})`, opacity: fadeOut, textShadow: '0 6px 30px rgba(0,0,0,.5)' }}>
        {label}
      </div>
    </AbsoluteFill>
  );
};
