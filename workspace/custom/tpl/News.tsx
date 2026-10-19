import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { SANS, easeOut, media, parts, useFonts, useUnit } from './common';

/** Scrolling news ticker bar (transparent overlay — span it over the whole video). */
export const NewsTicker: React.FC<{
  label?: string; items?: string[]; color?: string; barColor?: string; textColor?: string; speed?: number;
  position?: 'bottom' | 'top'; offset?: number; clock?: string;
}> = ({ label = 'TIN NÓNG', items = ['Tin mới cập nhật liên tục'], color = '#e11d2a', barColor = 'rgba(10,14,24,0.92)', textColor = '#ffffff', speed = 1, position = 'bottom', offset = 0.035, clock = '' }) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, height } = useUnit();
  const h = 74 * u;
  const enter = spring({ frame: f, fps, config: { damping: 18 } });
  const text = items.filter(Boolean).join('   ●   ');
  const run = `${text}   ●   ${text}   ●   ${text}   ●   `;
  const x = -((f * 3.2 * speed * u) % Math.max(1, text.length * 21 * u + 140 * u));
  const y = position === 'bottom' ? height * (1 - offset) - h : height * offset;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: y, height: h, display: 'flex', transform: `translateY(${(1 - enter) * (position === 'bottom' ? 1 : -1) * h * 2}px)`, fontFamily: SANS, boxShadow: '0 8px 30px rgba(0,0,0,.35)' }}>
        <div style={{ background: color, color: '#fff', fontWeight: 900, fontSize: 32 * u, padding: `0 ${26 * u}px`, display: 'flex', alignItems: 'center', gap: 12 * u, letterSpacing: 1.5 * u, zIndex: 2, whiteSpace: 'nowrap' }}>
          <span style={{ width: 14 * u, height: 14 * u, borderRadius: 99, background: '#fff', opacity: 0.5 + 0.5 * Math.abs(Math.sin(f / 8)) }} />
          {label}
        </div>
        <div style={{ flex: 1, background: barColor, overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center' }}>
          <div style={{ position: 'absolute', left: 0, whiteSpace: 'nowrap', transform: `translateX(${x}px)`, color: textColor, fontSize: 34 * u, fontWeight: 600 }}>{run}</div>
        </div>
        {clock && <div style={{ background: '#fff', color: '#111', fontWeight: 800, fontSize: 30 * u, padding: `0 ${20 * u}px`, display: 'flex', alignItems: 'center', zIndex: 2 }}>{clock}</div>}
      </div>
    </AbsoluteFill>
  );
};

/** Bottom-third gradient news caption: category tag, headline (supports *highlight*), source line. Transparent overlay. */
export const NewsGradient: React.FC<{
  kicker?: string; headline?: string; sub?: string; accent?: string; height?: number; bottom?: number; align?: 'left' | 'center';
}> = ({ kicker = 'NÓNG', headline = 'Tiêu đề tin *quan trọng* hôm nay', sub = '', accent = '#facc15', height = 0.42, bottom = 0.12, align = 'left' }) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { u, width, height: H } = useUnit();
  const a = spring({ frame: f - 4, fps, config: { damping: 16 } });
  const b = spring({ frame: f - 12, fps, config: { damping: 16 } });
  const out = interpolate(f, [durationInFrames - 10, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const pad = 64 * u;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: out }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: H * height, background: 'linear-gradient(to top, rgba(0,0,0,.92) 0%, rgba(0,0,0,.7) 45%, rgba(0,0,0,0) 100%)' }} />
      <div style={{ position: 'absolute', left: pad, right: pad, bottom: H * bottom, fontFamily: SANS, textAlign: align, display: 'flex', flexDirection: 'column', alignItems: align === 'center' ? 'center' : 'flex-start', gap: 18 * u }}>
        {kicker && (
          <div style={{ background: accent, color: '#111', fontWeight: 900, fontSize: 30 * u, padding: `${6 * u}px ${18 * u}px`, borderRadius: 6 * u, letterSpacing: 2 * u, transform: `translateX(${(1 - a) * -60 * u}px)`, opacity: a }}>{kicker}</div>
        )}
        <div style={{ color: '#fff', fontWeight: 900, fontSize: Math.min(76 * u, width / 14), lineHeight: 1.18, textShadow: '0 4px 24px rgba(0,0,0,.6)', transform: `translateY(${(1 - b) * 40 * u}px)`, opacity: b }}>
          {parts(headline).map((p, i) => <span key={i} style={p.hi ? { color: accent } : undefined}>{p.t}</span>)}
        </div>
        {sub && <div style={{ color: 'rgba(255,255,255,.82)', fontSize: 32 * u, fontWeight: 600, opacity: b }}>{sub}</div>}
      </div>
    </AbsoluteFill>
  );
};

/** "Breaking news" opening sting: striped red wipe, label, headline, date — over an optional photo. Scene. */
export const BreakingIntro: React.FC<{ label?: string; headline?: string; date?: string; image?: string; accent?: string; channel?: string }> = ({
  label = 'TIN NÓNG', headline = 'Tiêu đề bản tin', date = '', image = '', accent = '#e11d2a', channel = '',
}) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, width, height } = useUnit();
  const wipe = easeOut(f / 14);
  const lab = spring({ frame: f - 8, fps, config: { damping: 11 } });
  const hd = spring({ frame: f - 18, fps, config: { damping: 15 } });
  const zoom = 1.08 + f * 0.0012;
  return (
    <AbsoluteFill style={{ background: '#05070c', overflow: 'hidden', fontFamily: SANS }}>
      {image && <Img src={media(image)!} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})`, filter: 'brightness(.55) saturate(1.1)' }} />}
      <div style={{ position: 'absolute', inset: 0, background: `repeating-linear-gradient(-45deg, ${accent} 0 ${40 * u}px, rgba(0,0,0,0) ${40 * u}px ${80 * u}px)`, opacity: 0.18 * (1 - easeOut((f - 20) / 20)), transform: `translateX(${(f * 4 * u) % (113 * u)}px)` }} />
      <div style={{ position: 'absolute', left: 0, top: height * 0.38, height: 130 * u, width: width * wipe, background: accent, boxShadow: `0 0 ${60 * u}px ${accent}` }} />
      <div style={{ position: 'absolute', left: 64 * u, top: height * 0.38, height: 130 * u, display: 'flex', alignItems: 'center', color: '#fff', fontWeight: 900, fontSize: 84 * u, letterSpacing: 4 * u, transform: `scale(${0.7 + 0.3 * lab})`, transformOrigin: 'left center', opacity: lab }}>
        {label}
        {channel && <span style={{ marginLeft: 30 * u, fontSize: 36 * u, fontWeight: 700, opacity: 0.85 }}>{channel}</span>}
      </div>
      <div style={{ position: 'absolute', left: 64 * u, right: 64 * u, top: height * 0.38 + 170 * u, color: '#fff', fontWeight: 800, fontSize: Math.min(64 * u, width / 15), lineHeight: 1.2, textShadow: '0 4px 24px rgba(0,0,0,.7)', transform: `translateY(${(1 - hd) * 50 * u}px)`, opacity: hd }}>
        {parts(headline).map((p, i) => <span key={i} style={p.hi ? { color: '#facc15' } : undefined}>{p.t}</span>)}
      </div>
      {date && <div style={{ position: 'absolute', left: 64 * u, top: height * 0.38 - 60 * u, color: 'rgba(255,255,255,.85)', fontSize: 32 * u, fontWeight: 700, opacity: hd }}>{date}</div>}
    </AbsoluteFill>
  );
};
