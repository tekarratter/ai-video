import React from 'react';
import { mediaUrl } from './mediaUrl';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** Closing scene: photo background, darkened, with call-to-action. Main-track scene. */
export const EndCard: React.FC<{ src?: string; title?: string; line1?: string; line2?: string; accent?: string }> = ({
  src, title = 'Halora Nova Cruise', line1 = 'Một hành trình đáng nhớ', line2 = 'Hẹn gặp lại trên vịnh Hạ Long!', accent = '#fbbf24',
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const z = interpolate(frame, [0, durationInFrames], [1.15, 1.3]);
  const a = spring({ frame: frame - 5, fps, config: { damping: 200 } });
  const b = spring({ frame: frame - 18, fps, config: { damping: 12 } });
  const c = spring({ frame: frame - 32, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ background: '#0b1220', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, Arial, sans-serif' }}>
      {src ? <Img src={mediaUrl(src)!} style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${z})`, filter: 'brightness(0.45)' }} /> : null}
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(11,18,32,0.2) 0%, rgba(11,18,32,0.75) 100%)' }} />
      <div style={{ position: 'relative', textAlign: 'center', padding: '0 70px' }}>
        <div style={{ color: '#fff', fontSize: 48, letterSpacing: 6, textTransform: 'uppercase', opacity: a, transform: `translateY(${(1 - a) * 30}px)` }}>{line1}</div>
        <div style={{ color: accent, fontSize: 112, fontWeight: 700, fontStyle: 'italic', fontFamily: 'Georgia, serif', lineHeight: 1.1, margin: '24px 0', opacity: Math.min(1, b), transform: `scale(${0.6 + 0.4 * b})`, textShadow: '0 8px 40px rgba(0,0,0,.6)' }}>{title}</div>
        <div style={{ width: 360 * c, height: 5, background: accent, margin: '0 auto 30px', borderRadius: 3 }} />
        <div style={{ color: '#fff', fontSize: 54, fontWeight: 800, opacity: c, transform: `translateY(${(1 - c) * 30}px)` }}>{line2}</div>
      </div>
    </AbsoluteFill>
  );
};
