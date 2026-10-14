import React from 'react';
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** Words pop in one after another. */
export const KineticText: React.FC<{ text?: string; color?: string; highlight?: string; fontSize?: number; background?: string; stagger?: number }> = ({
  text = 'Biến ý tưởng thành video', color = '#ffffff', highlight = '#facc15', fontSize = 120, background = 'transparent', stagger = 5,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(/\s+/);
  return (
    <AbsoluteFill style={{ background, alignItems: 'center', justifyContent: 'center', padding: 120 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 0.3em', fontFamily: 'Inter, Arial, sans-serif', fontWeight: 900, fontSize, lineHeight: 1.1 }}>
        {words.map((w, i) => {
          const p = spring({ frame: frame - i * stagger, fps, config: { damping: 12, mass: 0.6 } });
          const isHi = w.startsWith('*') && w.endsWith('*');
          return (
            <span key={i} style={{ display: 'inline-block', color: isHi ? highlight : color, opacity: Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * 80}px) scale(${0.6 + 0.4 * p})`, textShadow: '0 6px 30px rgba(0,0,0,0.5)' }}>
              {isHi ? w.slice(1, -1) : w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
