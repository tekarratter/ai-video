import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** "Subscribe / Like / Follow"-style button: slides up, a cursor clicks it, it turns to the done state. Overlay. */
export const CallToAction: React.FC<{ label?: string; doneLabel?: string; color?: string; icon?: string; y?: number }> = ({
  label = 'ĐĂNG KÝ', doneLabel = 'ĐÃ ĐĂNG KÝ', color = '#ef4444', icon = '🔔', y = 0.78,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const side = Math.min(width, height);
  const enter = spring({ frame, fps, config: { damping: 14 } });
  const exit = interpolate(frame, [durationInFrames - 12, durationInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const clickAt = Math.round(fps * 1.3);
  const clicked = frame >= clickAt;
  const press = clicked ? 1 - 0.08 * Math.exp(-(frame - clickAt) / 3) : 1;
  const cur = interpolate(frame, [fps * 0.5, clickAt], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const bell = clicked ? Math.sin((frame - clickAt) / 2) * 25 * Math.exp(-(frame - clickAt) / 10) : 0;
  const fs = side * 0.055;
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: '50%', top: `${y * 100}%`, transform: `translate(-50%, -50%) translateY(${(1 - enter + exit) * height * 0.3}px) scale(${press})`, display: 'flex', gap: fs * 0.5, alignItems: 'center' }}>
        <div style={{ background: clicked ? '#3f3f46' : color, color: '#fff', fontFamily: 'Inter, Arial, sans-serif', fontWeight: 800, fontSize: fs, padding: `${fs * 0.45}px ${fs * 1.1}px`, borderRadius: fs * 0.4, letterSpacing: 1, boxShadow: '0 10px 30px rgba(0,0,0,.35)', whiteSpace: 'nowrap' }}>
          {clicked ? doneLabel : label}
        </div>
        <div style={{ fontSize: fs * 1.3, transform: `rotate(${bell}deg)`, transformOrigin: '50% 10%' }}>{icon}</div>
        <svg width={fs * 1.2} height={fs * 1.2} viewBox="0 0 24 24" style={{ position: 'absolute', left: `${30 + (1 - cur) * 60}%`, top: `${60 + (1 - cur) * 90}%`, opacity: cur > 0 && frame < clickAt + fps ? 1 : 0, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.5))' }}>
          <path d="M4 2l16 10-7 1.5L16 21l-3 1-3-7.5L4 18z" fill="#fff" stroke="#000" strokeWidth="1.2" />
        </svg>
      </div>
    </AbsoluteFill>
  );
};
