import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** Step caption: big outlined number, label, title. Transparent — use on an overlay track. */
export const StepTitle: React.FC<{ step?: string; label?: string; title?: string; accent?: string; y?: number }> = ({
  step = '01', label = 'STEP 1', title = 'Title', accent = '#1e73be', y = 0.6,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, height } = useVideoConfig();
  const a = spring({ frame, fps, config: { damping: 14, mass: 0.7 } });
  const bar = interpolate(frame, [4, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const b = spring({ frame: frame - 8, fps, config: { damping: 200 } });
  const out = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: out, fontFamily: 'Inter, Arial, sans-serif' }}>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,0) ${y * 100 - 12}%, rgba(0,0,0,0.6) ${y * 100 + 10}%, rgba(0,0,0,0.25) 100%)` }} />
      <div style={{ position: 'absolute', left: 70, right: 70, top: height * y }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ fontSize: 150, fontWeight: 900, lineHeight: 1, color: 'transparent', WebkitTextStroke: '4px #fff', opacity: a, transform: `translateX(${(1 - a) * -120}px)` }}>{step}</div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ background: accent, color: '#fff', fontWeight: 800, fontSize: 34, letterSpacing: 5, padding: '8px 20px', borderRadius: 8, transform: `translateY(${(1 - b) * 60}px)` }}>{label}</div>
          </div>
        </div>
        <div style={{ width: `${bar * 100}%`, height: 6, background: `linear-gradient(90deg, ${accent}, #7cc4ff)`, borderRadius: 3, margin: '18px 0' }} />
        <div style={{ color: '#fff', fontSize: 78, fontWeight: 900, lineHeight: 1.08, whiteSpace: 'pre-line', opacity: b, transform: `translateY(${(1 - b) * 40}px)`, textShadow: '0 6px 30px rgba(0,0,0,.7)' }}>{title}</div>
      </div>
    </AbsoluteFill>
  );
};
