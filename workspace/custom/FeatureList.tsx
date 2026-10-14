import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** Check-mark feature cards popping in one by one. Transparent — use on an overlay track. */
export const FeatureList: React.FC<{ items?: string[]; accent?: string; y?: number }> = ({
  items = ['Thermal-break aluminum', 'Energy efficient', 'Built for Texas weather'], accent = '#1e73be', y = 0.56,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, height } = useVideoConfig();
  const out = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity: out, fontFamily: 'Inter, Arial, sans-serif' }}>
      <div style={{ position: 'absolute', left: 70, right: 70, top: height * y, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {items.map((t, i) => {
          const p = spring({ frame: frame - 6 - i * 12, fps, config: { damping: 12, mass: 0.6 } });
          const tick = spring({ frame: frame - 14 - i * 12, fps, config: { damping: 10 } });
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 24, background: 'rgba(255,255,255,0.94)', borderRadius: 22, padding: '22px 30px', boxShadow: '0 14px 40px rgba(0,0,0,.35)', opacity: Math.min(1, p * 1.5), transform: `translateX(${(1 - p) * 500}px)` }}>
              <div style={{ width: 64, height: 64, borderRadius: 32, background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, fontWeight: 900, transform: `scale(${tick})` }}>✓</div>
              <div style={{ color: '#13202e', fontSize: 50, fontWeight: 800 }}>{t}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
