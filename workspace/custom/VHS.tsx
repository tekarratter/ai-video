import React from 'react';
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion';

/** 80s/90s VHS tape look: scanlines, colour bleed, tracking noise band, jitter and "PLAY ▶" + date OSD. Overlay. */
export const VHS: React.FC<{ date?: string; label?: string; glitch?: number; showOsd?: boolean }> = ({ date = 'OCT. 31 1994', label = 'PLAY ▶', glitch = 0.5, showOsd = true }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const r = (k: string) => random(`${k}${frame}`);
  const side = Math.min(width, height);
  const t = frame / fps;
  const bandY = ((t * 0.18) % 1.3 - 0.15) * height;
  const burst = r('b') < glitch * 0.08; // occasional strong glitch
  const fs = side * 0.045;
  const secs = Math.floor(t);
  const clock = `${String(Math.floor(secs / 3600)).padStart(1, '0')}:${String(Math.floor(secs / 60) % 60).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
      {/* washed-out tape colour: lifted blacks, cool-magenta cast (blend layers are render-safe) */}
      <AbsoluteFill style={{ background: '#3a1f5c', mixBlendMode: 'lighten', opacity: 0.35 }} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg,#ff3d7f,#3dd9ff)', mixBlendMode: 'soft-light', opacity: 0.25 }} />
      {burst && <AbsoluteFill style={{ background: r('h') > 0.5 ? '#00ffd0' : '#ff00a0', mixBlendMode: 'color', opacity: 0.35 }} />}
      {/* chroma fringe */}
      <AbsoluteFill style={{ boxShadow: 'inset 4px 0 0 rgba(255,0,80,.25), inset -4px 0 0 rgba(0,200,255,.25)', mixBlendMode: 'screen' }} />
      {/* scanlines */}
      <AbsoluteFill style={{ backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,.22) 0px, rgba(0,0,0,.22) 1px, transparent 2px, transparent 4px)' }} />
      {/* tracking band */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: bandY, height: height * 0.05, background: 'linear-gradient(180deg, transparent, rgba(255,255,255,.18), rgba(255,255,255,.05), transparent)', transform: `translateX(${(r('t') - 0.5) * 20}px)` }} />
      {burst && <div style={{ position: 'absolute', left: 0, right: 0, top: r('gy') * height, height: height * 0.02, background: 'rgba(255,255,255,.4)', mixBlendMode: 'difference' }} />}
      {showOsd && (
        <div style={{ position: 'absolute', inset: side * 0.05, fontFamily: '"VCR OSD Mono", "Courier New", monospace', fontWeight: 700, color: '#fff', fontSize: fs, textShadow: '2px 0 rgba(255,0,80,.7), -2px 0 rgba(0,200,255,.7)' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, opacity: Math.floor(t * 1.5) % 2 ? 1 : 0.85 }}>{label}</div>
          <div style={{ position: 'absolute', right: 0, top: 0 }}>SP</div>
          <div style={{ position: 'absolute', left: 0, bottom: 0 }}>{clock}</div>
          <div style={{ position: 'absolute', right: 0, bottom: 0 }}>{date}</div>
        </div>
      )}
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,.55) 100%)' }} />
    </AbsoluteFill>
  );
};
