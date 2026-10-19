import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { HAND, MARKER, SERIF, SANS, clamp01, ease, easeOut, media, parts, rand, useFonts, useUnit } from './common';

const Marker: React.FC<{ u: number; color: string }> = ({ u, color }) => (
  <svg width={70 * u} height={70 * u} viewBox="0 0 64 64" style={{ position: 'absolute', left: -6 * u, top: -58 * u, filter: 'drop-shadow(4px 6px 4px rgba(0,0,0,.25))' }}>
    <g transform="rotate(35 32 32)">
      <rect x="24" y="2" width="16" height="44" rx="4" fill="#f8fafc" stroke="#334155" strokeWidth="2" />
      <rect x="24" y="2" width="16" height="12" rx="4" fill={color} />
      <path d="M26 46 L38 46 L34 58 L30 58 Z" fill="#475569" />
      <path d="M30 58 L34 58 L32 63 Z" fill={color} />
    </g>
  </svg>
);

/** Text written on a line with a marker following the stroke (clip reveal). */
const WrittenLine: React.FC<{ text: string; p: number; color: string; size: number; u: number; pen: boolean; hi: string }> = ({ text, p, color, size, u, pen, hi }) => (
  <div style={{ position: 'relative', display: 'inline-block' }}>
    <div style={{ clipPath: `inset(-20% ${100 - p * 100}% -20% 0)`, color, fontSize: size, fontFamily: MARKER, lineHeight: 1.25, whiteSpace: 'pre-wrap' }}>
      {parts(text).map((x, i) => <span key={i} style={x.hi ? { color: hi, textDecoration: `underline ${4 * u}px ${hi}`, textUnderlineOffset: 8 * u } : undefined}>{x.t}</span>)}
    </div>
    {pen && p > 0 && p < 1 && <div style={{ position: 'absolute', left: `${p * 100}%`, top: '55%' }}><Marker u={u} color={color} /></div>}
  </div>
);

/**
 * Whiteboard explainer scene: title + bullet lines written by a marker one after another, optional image drawn as a
 * black-marker sketch. Each line takes `lineSeconds`; keep the clip at least title + lines × lineSeconds long.
 */
export const WhiteboardScene: React.FC<{
  title?: string; lines?: string[]; image?: string; imageSide?: 'right' | 'left' | 'top'; color?: string; accent?: string; lineSeconds?: number;
}> = ({ title = 'Ý chính', lines = ['Điều thứ nhất', 'Điều thứ *hai*'], image = '', imageSide = 'right', color = '#1e293b', accent = '#dc2626', lineSeconds = 1.6 }) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, width, height, portrait } = useUnit();
  const step = lineSeconds * fps;
  const tp = clamp01(f / (step * 0.8));
  const lp = (i: number) => clamp01((f - step * 0.8 - i * step) / (step * 0.85));
  const writing = (i: number) => lp(i) > 0 && lp(i) < 1;
  const imgP = ease((f - 6) / (fps * 1.4));
  const side = portrait ? 'top' : imageSide;
  const under = easeOut((f - step * 0.8) / 14);
  const k = portrait ? 1.3 : 1;
  return (
    <AbsoluteFill style={{ background: '#fbfbf8', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 30% 20%, rgba(255,255,255,1), rgba(226,232,240,.55))' }} />
      <div style={{ position: 'absolute', inset: 22 * u, border: `${10 * u}px solid #cbd5e1`, borderRadius: 14 * u, boxShadow: 'inset 0 0 40px rgba(0,0,0,.06)' }} />
      <div style={{ position: 'absolute', inset: 80 * u, display: 'flex', flexDirection: side === 'top' ? 'column' : side === 'left' ? 'row-reverse' : 'row', gap: 60 * u, alignItems: 'center' }}>
        <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column', gap: 26 * u, minWidth: 0, order: side === 'top' ? 2 : 0 }}>
          <div style={{ position: 'relative', alignSelf: 'flex-start' }}>
            <WrittenLine text={title} p={tp} color={color} size={86 * u * k} u={u} pen={tp < 1} hi={accent} />
            <div style={{ position: 'absolute', left: 0, bottom: -10 * u, height: 8 * u, width: `${under * 100}%`, background: accent, borderRadius: 8 * u, transform: 'rotate(-0.6deg)' }} />
          </div>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 18 * u, alignItems: 'flex-start', opacity: lp(i) > 0 ? 1 : 0 }}>
              <span style={{ color: accent, fontFamily: MARKER, fontSize: 56 * u * k, lineHeight: 1.25 }}>•</span>
              <WrittenLine text={l} p={lp(i)} color={color} size={56 * u * k} u={u} pen={writing(i)} hi={accent} />
            </div>
          ))}
        </div>
        {image && (
          <div style={{ flex: 1, alignSelf: 'stretch', position: 'relative', minHeight: side === 'top' ? height * 0.3 : undefined, order: side === 'top' ? 1 : 0 }}>
            <Img src={media(image)!} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', filter: 'grayscale(1) contrast(1.9) brightness(1.15)', mixBlendMode: 'multiply', clipPath: `polygon(0 0, ${imgP * 140}% 0, ${imgP * 140 - 40}% 100%, 0 100%)` }} />
            <Img src={media(image)!} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0.55 * ease((f - fps * 1.6) / fps), mixBlendMode: 'multiply' }} />
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

/** Pencil sketch that fills in with watercolour, on paper, with a handwritten caption. Scene. */
export const DoodleImage: React.FC<{ image?: string; caption?: string; paper?: string; ink?: string; colorDelay?: number }> = ({
  image = '', caption = 'Một nét vẽ, một câu chuyện', paper = '#f7f1e3', ink = '#2b2b2b', colorDelay = 1.2,
}) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { u, width, height } = useUnit();
  const sketch = ease(f / (fps * 1.3));
  const wash = ease((f - fps * colorDelay) / (fps * 1.4));
  const cap = clamp01((f - fps * 0.8) / (fps * 1.2));
  const drift = interpolate(f, [0, durationInFrames], [1.02, 1.08]);
  const blobs = [0.3, 0.6, 0.45, 0.75].map((x, i) => `radial-gradient(circle at ${x * 100}% ${(0.3 + rand(i) * 0.5) * 100}%, #000 ${wash * (55 + rand(i + 9) * 30)}%, transparent ${wash * (55 + rand(i + 9) * 30) + 12}%)`).join(',');
  const boxW = width * 0.78, boxH = height * 0.68;
  return (
    <AbsoluteFill style={{ background: paper, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `repeating-linear-gradient(0deg, rgba(0,0,0,.035) 0 ${2 * u}px, transparent ${2 * u}px ${46 * u}px)` }} />
      <div style={{ position: 'absolute', left: (width - boxW) / 2, top: height * 0.07, width: boxW, height: boxH, transform: `scale(${drift}) rotate(-0.6deg)` }}>
        {image && <>
          <Img src={media(image)!} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(1) contrast(2.2) brightness(1.25)', mixBlendMode: 'multiply', opacity: 0.9, WebkitMaskImage: `linear-gradient(115deg, #000 ${sketch * 120 - 20}%, transparent ${sketch * 120}%)`, maskImage: `linear-gradient(115deg, #000 ${sketch * 120 - 20}%, transparent ${sketch * 120}%)` }} />
          <Img src={media(image)!} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(1.25) contrast(.95) blur(.6px)', mixBlendMode: 'multiply', opacity: 0.85, WebkitMaskImage: blobs, maskImage: blobs }} />
        </>}
        <div style={{ position: 'absolute', inset: -6 * u, border: `${3 * u}px solid ${ink}`, borderRadius: 10 * u, opacity: 0.55 * sketch, clipPath: `inset(0 ${100 - sketch * 100}% 0 0)` }} />
      </div>
      <div style={{ position: 'absolute', left: 60 * u, right: 60 * u, top: height * 0.07 + boxH + 40 * u, textAlign: 'center', fontFamily: HAND, color: ink, fontSize: Math.min(72 * u, width / 13), clipPath: `inset(-20% ${100 - cap * 100}% -20% 0)` }}>{caption}</div>
    </AbsoluteFill>
  );
};

/** Investigative "paper cut-out" collage (VOX style): torn photo, tape, halftone paper, red marker circle on *highlight*. Scene. */
export const PaperCutout: React.FC<{ image?: string; kicker?: string; title?: string; note?: string; paper?: string; accent?: string; seed?: number }> = ({
  image = '', kicker = 'ĐIỀU TRA', title = 'Sự thật *phía sau* câu chuyện', note = '', paper = '#efe6d2', accent = '#e3342f', seed = 3,
}) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, width, height, portrait } = useUnit();
  const inP = spring({ frame: f, fps, config: { damping: 13 } });
  const txt = spring({ frame: f - 10, fps, config: { damping: 15 } });
  const circle = clamp01((f - fps * 0.9) / (fps * 0.7));
  // torn edge polygon
  const n = 26, pts: string[] = [];
  for (let i = 0; i <= n; i++) pts.push(`${(i / n) * 100}% ${rand(seed + i) * 3}%`);
  for (let i = 0; i <= n; i++) pts.push(`${100 - rand(seed + 40 + i) * 3}% ${(i / n) * 100}%`);
  for (let i = n; i >= 0; i--) pts.push(`${(i / n) * 100}% ${100 - rand(seed + 80 + i) * 3}%`);
  for (let i = n; i >= 0; i--) pts.push(`${rand(seed + 120 + i) * 3}% ${(i / n) * 100}%`);
  const pw = portrait ? width * 0.84 : width * 0.5, ph = portrait ? height * 0.42 : height * 0.66;
  const Tape: React.FC<{ x: number; y: number; r: number }> = ({ x, y, r }) => (
    <div style={{ position: 'absolute', left: x, top: y, width: 150 * u, height: 46 * u, background: 'rgba(250,240,200,.75)', transform: `rotate(${r}deg)`, boxShadow: '0 2px 6px rgba(0,0,0,.15)' }} />
  );
  return (
    <AbsoluteFill style={{ background: paper, overflow: 'hidden', fontFamily: SANS }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `radial-gradient(rgba(0,0,0,.12) ${1.6 * u}px, transparent ${1.8 * u}px)`, backgroundSize: `${14 * u}px ${14 * u}px`, opacity: 0.6 }} />
      {image && (
        <div style={{ position: 'absolute', left: portrait ? (width - pw) / 2 : width * 0.05, top: portrait ? height * 0.08 : (height - ph) / 2, width: pw, height: ph, transform: `translateY(${(1 - inP) * 120 * u}px) rotate(${-2.5 + (1 - inP) * -8}deg)`, filter: 'drop-shadow(0 18px 24px rgba(0,0,0,.35))' }}>
          <div style={{ position: 'absolute', inset: 0, background: '#fff', clipPath: `polygon(${pts.join(',')})` }} />
          <Img src={media(image)!} style={{ position: 'absolute', inset: 14 * u, width: `calc(100% - ${28 * u}px)`, height: `calc(100% - ${28 * u}px)`, objectFit: 'cover', clipPath: `polygon(${pts.join(',')})`, filter: 'contrast(1.1) saturate(.85) sepia(.15)' }} />
          <Tape x={-40 * u} y={-14 * u} r={-25} />
          <Tape x={pw - 110 * u} y={ph - 30 * u} r={-20} />
        </div>
      )}
      <div style={{ position: 'absolute', left: portrait ? 70 * u : width * 0.6, right: 70 * u, top: portrait ? height * 0.56 : height * 0.26, transform: `translateX(${(1 - txt) * 80 * u}px)`, opacity: txt }}>
        <div style={{ display: 'inline-block', background: '#111', color: paper, fontWeight: 900, fontSize: 30 * u, letterSpacing: 4 * u, padding: `${8 * u}px ${18 * u}px`, transform: 'rotate(-2deg)' }}>{kicker}</div>
        <div style={{ fontFamily: SERIF, fontWeight: 900, color: '#111', fontSize: Math.min(92 * u, width / 11), lineHeight: 1.12, marginTop: 30 * u }}>
          {parts(title).map((p, i) => p.hi ? (
            <span key={i} style={{ position: 'relative', whiteSpace: 'nowrap' }}>
              {p.t}
              <svg style={{ position: 'absolute', left: '-10%', top: '-18%', width: '120%', height: '136%', overflow: 'visible' }} viewBox="0 0 100 50" preserveAspectRatio="none">
                <path d="M50 4 C 88 2, 99 20, 94 34 C 86 50, 18 52, 5 34 C -4 18, 22 3, 58 6" fill="none" stroke={accent} strokeWidth={3.2} strokeLinecap="round" pathLength={100} strokeDasharray="100 100" strokeDashoffset={100 * (1 - easeOut(circle))} />
              </svg>
            </span>
          ) : <span key={i}>{p.t}</span>)}
        </div>
        {note && <div style={{ fontFamily: HAND, color: accent, fontSize: 48 * u, marginTop: 34 * u, transform: 'rotate(-3deg)', opacity: circle }}>{note}</div>}
      </div>
    </AbsoluteFill>
  );
};
