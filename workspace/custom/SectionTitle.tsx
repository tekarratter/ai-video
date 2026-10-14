import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** Section caption: small tag + bold title that wipes in. Transparent — use on an overlay track. */
export const SectionTitle: React.FC<{ tag?: string; title?: string; accent?: string; y?: number }> = ({
  tag = '01', title = 'Tiêu đề', accent = '#fbbf24', y = 0.7,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, height } = useVideoConfig();
  const t = spring({ frame, fps, config: { damping: 200 } });
  const wipe = interpolate(frame, [6, 22], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const pop = spring({ frame: frame - 6, fps, config: { damping: 12, mass: 0.7 } });
  const out = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: out, fontFamily: 'Inter, Arial, sans-serif' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: height * y, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 70px' }}>
        <div style={{ background: accent, color: '#111', fontWeight: 800, fontSize: 36, letterSpacing: 6, padding: '8px 26px', borderRadius: 40, textTransform: 'uppercase', transform: `translateY(${(1 - t) * 40}px) scale(${0.8 + 0.2 * t})`, opacity: t }}>
          {tag}
        </div>
        <div style={{ marginTop: 18, clipPath: `inset(0 ${100 - wipe}% 0 0)`, transform: `scale(${0.85 + 0.15 * Math.min(1, pop)})` }}>
          <div style={{ color: '#fff', fontSize: 92, fontWeight: 900, lineHeight: 1.08, textAlign: 'center', whiteSpace: 'pre-line', textShadow: '0 6px 30px rgba(0,0,0,.75), 0 2px 6px rgba(0,0,0,.6)' }}>
            {title}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
