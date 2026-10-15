import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** Testimonial / quote: big quote mark, words reveal one by one, author line slides in. */
export const QuoteCard: React.FC<{ quote?: string; author?: string; role?: string; accent?: string; background?: string }> = ({
  quote = 'Đội ngũ làm việc rất chuyên nghiệp, đúng tiến độ và kết quả vượt mong đợi.', author = 'Anh Minh', role = 'Khách hàng', accent = '#f59e0b', background = 'linear-gradient(135deg,#111827,#1f2937)',
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const side = Math.min(width, height);
  const words = quote.split(/\s+/);
  const perWord = Math.max(1, Math.round(fps * 0.09));
  const mark = spring({ frame, fps, config: { damping: 12 } });
  const authorIn = spring({ frame: frame - words.length * perWord - 6, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ background, alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif' }}>
      <div style={{ width: width * 0.8 }}>
        <div style={{ fontSize: side * 0.3, lineHeight: 0.6, color: accent, transform: `scale(${mark})`, transformOrigin: 'left bottom', height: side * 0.14 }}>“</div>
        <div style={{ color: '#fff', fontSize: side * 0.062, lineHeight: 1.35, fontStyle: 'italic' }}>
          {words.map((w, i) => {
            const p = interpolate(frame, [i * perWord, i * perWord + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            return <span key={i} style={{ opacity: p, display: 'inline-block', transform: `translateY(${(1 - p) * 12}px)`, marginRight: '0.28em' }}>{w}</span>;
          })}
        </div>
        <div style={{ marginTop: side * 0.05, display: 'flex', alignItems: 'center', gap: side * 0.02, opacity: authorIn, transform: `translateX(${(1 - authorIn) * -40}px)`, fontFamily: 'Inter, Arial, sans-serif' }}>
          <div style={{ width: side * 0.06, height: 4, background: accent }} />
          <div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: side * 0.042 }}>{author}</div>
            <div style={{ color: accent, fontSize: side * 0.03, letterSpacing: 2, textTransform: 'uppercase' }}>{role}</div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
