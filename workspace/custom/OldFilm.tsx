import React from 'react';
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion';

/**
 * Old film look over whatever is below: sepia/faded colour (blend layers), grain, dust, vertical scratches,
 * exposure flicker, gate weave and a dark vignette. Put it on an overlay track spanning the scenes.
 */
export const OldFilm: React.FC<{ sepia?: number; grain?: number; scratches?: number; flicker?: number; vignette?: number; blackWhite?: boolean }> = ({
  sepia = 0.75, grain = 0.35, scratches = 3, flicker = 0.12, vignette = 0.7, blackWhite = false,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const r = (k: string) => random(`${k}${frame}`);
  const dark = r('fl') * flicker; // exposure flicker
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
      {/* colour: blend layers (render-safe, unlike backdrop-filter) */}
      {blackWhite
        ? <AbsoluteFill style={{ background: '#808080', mixBlendMode: 'saturation' }} />
        : <AbsoluteFill style={{ background: '#8a6236', mixBlendMode: 'color', opacity: sepia }} />}
      <AbsoluteFill style={{ background: '#f1dfbd', mixBlendMode: 'multiply', opacity: blackWhite ? 0.12 : 0.3 }} />
      <AbsoluteFill style={{ background: '#2a1c0c', mixBlendMode: 'lighten', opacity: 0.25 }} />
      <AbsoluteFill style={{ background: '#000', opacity: dark }} />
      {/* grain: random noise tile shifted every frame */}
      <AbsoluteFill style={{ opacity: grain, mixBlendMode: 'overlay', backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='${frame % 50}'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`, backgroundPosition: `${r('gx') * 220}px ${r('gy') * 220}px` }} />
      {/* scratches */}
      {Array.from({ length: scratches }).map((_, i) => r(`s${i}`) > 0.45 && (
        <div key={i} style={{ position: 'absolute', left: r(`x${i}`) * width, top: 0, width: 1 + r(`w${i}`) * 2, height, background: r(`c${i}`) > 0.5 ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.35)', opacity: 0.4 + r(`o${i}`) * 0.6 }} />
      ))}
      {/* dust specks */}
      {Array.from({ length: 6 }).map((_, i) => r(`d${i}`) > 0.6 && (
        <div key={`d${i}`} style={{ position: 'absolute', left: r(`dx${i}`) * width, top: r(`dy${i}`) * height, width: 2 + r(`ds${i}`) * 7, height: 2 + r(`dh${i}`) * 5, borderRadius: '50%', background: r(`dc${i}`) > 0.3 ? '#000' : '#fff', opacity: 0.6 }} />
      ))}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 50%, rgba(20,10,0,${vignette}) 100%)` }} />
    </AbsoluteFill>
  );
};
