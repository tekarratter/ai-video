import React from 'react';
import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** Spooky title: flickering orange glow, dripping letters, jack‑o'‑lanterns. Full scene (dark bg) or set background="transparent". */
export const HalloweenTitle: React.FC<{ title?: string; subtitle?: string; color?: string; background?: string; pumpkins?: boolean }> = ({
  title = 'HAPPY\nHALLOWEEN', subtitle = '31.10', color = '#ff7a1a', background = 'radial-gradient(ellipse at 50% 40%, #2a1240 0%, #0a0612 70%)', pumpkins = true,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const side = Math.min(width, height);
  const t = frame / fps;
  // candle-like flicker, deterministic
  const flick = 0.75 + 0.25 * random(`f${Math.floor(frame / 2)}`) * (random(`g${Math.floor(frame / 9)}`) > 0.15 ? 1 : 0.2);
  const enter = spring({ frame, fps, config: { damping: 12 } });
  const lines = title.split('\n');
  const fs = Math.min(side * 0.17, (width * 0.86) / Math.max(...lines.map((l) => l.length)) * 1.3);
  const drip = (i: number) => interpolate(t, [0.6 + random(`d${i}`) * 1.2, 2.5 + random(`e${i}`) * 2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  let k = 0;
  return (
    <AbsoluteFill style={{ background, alignItems: 'center', justifyContent: 'center', fontFamily: 'Impact, "Arial Black", sans-serif' }}>
      <div style={{ textAlign: 'center', transform: `scale(${0.6 + 0.4 * enter})`, opacity: enter }}>
        {lines.map((line, li) => (
          <div key={li} style={{ whiteSpace: 'nowrap', fontSize: fs, lineHeight: 1.05, letterSpacing: fs * 0.04, color, textShadow: `0 0 ${fs * 0.25 * flick}px ${color}, 0 0 ${fs * 0.6 * flick}px rgba(255,90,0,${0.6 * flick}), 0 ${fs * 0.05}px 0 #3b0a00` }}>
            {[...line].map((ch, ci) => {
              const i = k++;
              const d = ch.trim() && random(`h${i}`) > 0.55 ? drip(i) : 0;
              return (
                <span key={ci} style={{ position: 'relative', display: 'inline-block' }}>
                  {ch === ' ' ? ' ' : ch}
                  {d > 0 && <span style={{ position: 'absolute', left: '40%', top: '82%', width: fs * 0.07, height: fs * 0.45 * d, background: color, borderRadius: `0 0 ${fs}px ${fs}px`, boxShadow: `0 0 ${fs * 0.1}px ${color}` }} />}
                </span>
              );
            })}
          </div>
        ))}
        {subtitle && <div style={{ marginTop: fs * 0.35, color: '#e9d5ff', fontFamily: 'Georgia, serif', fontSize: fs * 0.3, letterSpacing: fs * 0.08, opacity: interpolate(t, [0.8, 1.4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>{subtitle}</div>}
      </div>
      {pumpkins && [0.16, 0.84].map((px, i) => {
        const pop = spring({ frame: frame - 10 - i * 6, fps, config: { damping: 10 } });
        const ps = side * 0.17;
        return (
          <svg key={i} viewBox="0 0 100 90" width={ps} height={ps * 0.9} style={{ position: 'absolute', left: width * px - ps / 2, bottom: height * 0.08, transform: `scale(${pop})`, transformOrigin: 'bottom center' }}>
            <rect x="46" y="2" width="8" height="16" rx="3" fill="#3f6212" />
            <ellipse cx="30" cy="54" rx="26" ry="32" fill="#ea580c" /><ellipse cx="70" cy="54" rx="26" ry="32" fill="#ea580c" /><ellipse cx="50" cy="54" rx="28" ry="34" fill="#f97316" />
            <g fill={`rgba(255,${200 + 40 * flick},80,${flick})`}>
              <path d="M30 42 L40 42 L35 32 Z" /><path d="M60 42 L70 42 L65 32 Z" />
              <path d="M26 60 Q50 80 74 60 L66 64 L62 58 L56 66 L50 60 L44 66 L38 58 L34 64 Z" />
            </g>
          </svg>
        );
      })}
    </AbsoluteFill>
  );
};
