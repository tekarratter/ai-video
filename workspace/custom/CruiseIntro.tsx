import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** Opening title for a travel video. Transparent background — use on an overlay track. */
export const CruiseIntro: React.FC<{ kicker?: string; title?: string; subtitle?: string; accent?: string }> = ({
  kicker = 'Trải nghiệm', title = 'HẠ LONG BAY', subtitle = 'Halora Nova Cruise', accent = '#fbbf24',
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const out = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const k = spring({ frame, fps, config: { damping: 200 } });
  const letters = title.split('');
  const line = interpolate(frame, [18, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const sub = spring({ frame: frame - 28, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ opacity: out, alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, Arial, sans-serif' }}>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 70%)' }} />
      <div style={{ color: '#fff', fontSize: 46, letterSpacing: 14, textTransform: 'uppercase', opacity: k, transform: `translateY(${(1 - k) * -30}px)`, textShadow: '0 4px 20px rgba(0,0,0,.6)' }}>
        {kicker}
      </div>
      <div style={{ display: 'flex', marginTop: 10 }}>
        {letters.map((c, i) => {
          const p = spring({ frame: frame - 4 - i * 2, fps, config: { damping: 11, mass: 0.6 } });
          return (
            <span key={i} style={{ display: 'inline-block', whiteSpace: 'pre', color: '#fff', fontSize: 120, fontWeight: 900, opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 90}px) scale(${0.5 + 0.5 * p})`, textShadow: '0 8px 40px rgba(0,0,0,.65)' }}>{c}</span>
          );
        })}
      </div>
      <div style={{ width: 620 * line, height: 6, borderRadius: 3, background: accent, margin: '22px 0 26px' }} />
      <div style={{ color: accent, fontSize: 72, fontStyle: 'italic', fontFamily: 'Georgia, serif', fontWeight: 700, opacity: Math.min(1, sub), transform: `scale(${0.7 + 0.3 * sub})`, textShadow: '0 4px 24px rgba(0,0,0,.7)' }}>
        {subtitle}
      </div>
    </AbsoluteFill>
  );
};
