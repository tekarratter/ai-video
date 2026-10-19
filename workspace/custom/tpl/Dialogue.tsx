import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { SANS, media, rand, useFonts, useUnit } from './common';

type Host = { name?: string; image?: string; color?: string; role?: string };
type Turn = { speaker: number; start: number; end: number; text?: string };

const Avatar: React.FC<{ host: Host; size: number; active: number; u: number }> = ({ host, size, active, u }) => {
  const c = host.color || '#38bdf8';
  const initials = (host.name || '?').split(/\s+/).map((w) => w[0]).slice(-2).join('').toUpperCase();
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', position: 'relative', flex: 'none' }}>
      <div style={{ position: 'absolute', inset: -10 * u * (1 + active), borderRadius: '50%', border: `${6 * u}px solid ${c}`, opacity: 0.25 + 0.75 * active, boxShadow: `0 0 ${60 * u * active}px ${c}` }} />
      {host.image
        ? <Img src={media(host.image)!} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', filter: `saturate(${0.6 + 0.4 * active}) brightness(${0.75 + 0.25 * active})` }} />
        : <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: `linear-gradient(135deg, ${c}, #1e293b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: size * 0.36, fontFamily: SANS }}>{initials}</div>}
    </div>
  );
};

const Wave: React.FC<{ on: number; color: string; u: number; seed: number }> = ({ on, color, u, seed }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: 'flex', gap: 6 * u, alignItems: 'center', height: 60 * u }}>
      {Array.from({ length: 14 }, (_, i) => {
        const h = 8 + on * 50 * Math.abs(Math.sin(f / (3 + rand(i + seed) * 3) + i)) * (0.4 + rand(i * 7 + seed) * 0.6);
        return <div key={i} style={{ width: 7 * u, height: h * u, borderRadius: 9 * u, background: color, opacity: 0.35 + 0.65 * on }} />;
      })}
    </div>
  );
};

/**
 * Two-host podcast / talk-show scene. `turns` (seconds from the clip start) say who speaks when: the active host
 * lights up, their waveform moves, and the line shows as a caption. Put the voice clips on the voice track at the same times.
 */
export const PodcastStudio: React.FC<{
  title?: string; episode?: string; hosts?: Host[]; turns?: Turn[]; caption?: boolean; background?: string; accent?: string;
}> = ({
  title = 'PODCAST', episode = '', hosts = [{ name: 'Minh', color: '#38bdf8' }, { name: 'Lan', color: '#f472b6' }], turns = [], caption = true,
  background = '', accent = '#facc15',
}) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, width, height, portrait } = useUnit();
  const t = f / fps;
  const cur = turns.find((x) => t >= x.start && t < x.end);
  const level = (i: number) => {
    // smooth 0..1 "speaking" level per host
    const near = turns.filter((x) => x.speaker === i).map((x) => Math.min(interpolate(t, [x.start - 0.15, x.start + 0.1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), interpolate(t, [x.end - 0.1, x.end + 0.2], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })));
    return Math.max(0, ...near, turns.length ? 0 : 0.6);
  };
  const enter = spring({ frame: f, fps, config: { damping: 16 } });
  const size = (portrait ? 330 : 300) * u;
  return (
    <AbsoluteFill style={{ background: background ? undefined : 'radial-gradient(ellipse at 50% 30%, #1e1b4b 0%, #0b1020 55%, #05060a 100%)', fontFamily: SANS, overflow: 'hidden' }}>
      {background && <Img src={media(background)!} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(6px) brightness(.45)' }} />}
      {/* studio lights */}
      {[0.2, 0.5, 0.8].map((x, i) => (
        <div key={i} style={{ position: 'absolute', left: width * x - 220 * u, top: -200 * u, width: 440 * u, height: height * 0.9, background: `linear-gradient(to bottom, rgba(255,255,255,${0.07 + 0.03 * Math.sin(f / 30 + i)}), rgba(255,255,255,0))`, clipPath: 'polygon(42% 0, 58% 0, 100% 100%, 0 100%)' }} />
      ))}
      {/* neon title */}
      <div style={{ position: 'absolute', top: height * (portrait ? 0.1 : 0.08), width: '100%', textAlign: 'center', transform: `scale(${0.8 + 0.2 * enter})`, opacity: enter }}>
        <div style={{ display: 'inline-block', color: '#fff', fontWeight: 900, fontSize: 70 * u, letterSpacing: 6 * u, padding: `${10 * u}px ${36 * u}px`, border: `${4 * u}px solid ${accent}`, borderRadius: 18 * u, textShadow: `0 0 ${24 * u}px ${accent}`, boxShadow: `0 0 ${40 * u}px ${accent}55, inset 0 0 ${30 * u}px ${accent}33` }}>
          🎙 {title}
        </div>
        {episode && <div style={{ color: 'rgba(255,255,255,.75)', fontSize: 30 * u, marginTop: 16 * u, fontWeight: 600 }}>{episode}</div>}
      </div>
      {/* hosts */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: height * (portrait ? 0.3 : 0.3), display: 'flex', flexDirection: portrait ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: portrait ? 70 * u : 220 * u }}>
        {hosts.slice(0, 2).map((h, i) => {
          const lv = level(i);
          const s = spring({ frame: f - 6 - i * 6, fps, config: { damping: 14 } });
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 * u, transform: `translateY(${(1 - s) * 80 * u}px) scale(${0.94 + 0.08 * lv})`, opacity: s }}>
              <Avatar host={h} size={size} active={lv} u={u} />
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 40 * u }}>{h.name}</div>
              {h.role && <div style={{ color: 'rgba(255,255,255,.65)', fontSize: 26 * u, marginTop: -12 * u }}>{h.role}</div>}
              <Wave on={lv} color={h.color || '#38bdf8'} u={u} seed={i * 31} />
            </div>
          );
        })}
      </div>
      {/* caption */}
      {caption && cur?.text && (
        <div style={{ position: 'absolute', left: 70 * u, right: 70 * u, bottom: height * 0.07, display: 'flex', justifyContent: 'center' }}>
          <div style={{ background: 'rgba(0,0,0,.6)', border: `${3 * u}px solid ${hosts[cur.speaker]?.color || accent}`, color: '#fff', borderRadius: 22 * u, padding: `${18 * u}px ${30 * u}px`, fontSize: 40 * u, fontWeight: 600, lineHeight: 1.3, textAlign: 'center', maxWidth: 1500 * u }}>
            <b style={{ color: hosts[cur.speaker]?.color || accent }}>{hosts[cur.speaker]?.name}: </b>{cur.text}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

/** Speech bubble overlay with typewriter text (place it over a character photo). `side` = which side the tail points to. */
export const ChatBubble: React.FC<{
  text?: string; name?: string; side?: 'left' | 'right'; x?: number; y?: number; width?: number; color?: string; textColor?: string; typing?: boolean;
}> = ({ text = 'Xin chào! Hôm nay chúng ta nói về chuyện gì?', name = '', side = 'left', x = 0.5, y = 0.25, width = 0.7, color = '#ffffff', textColor = '#0f172a', typing = true }) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { u, width: W, height: H } = useUnit();
  const pop = spring({ frame: f, fps, config: { damping: 12, mass: 0.6 } });
  const out = interpolate(f, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shown = typing ? Math.floor(Math.min(text.length, (f - 4) * 1.6)) : text.length;
  const bw = W * width;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: W * x - bw / 2, top: H * y, width: bw, transform: `scale(${pop * out})`, transformOrigin: side === 'left' ? '10% 100%' : '90% 100%', fontFamily: SANS }}>
        <div style={{ background: color, color: textColor, borderRadius: 34 * u, padding: `${24 * u}px ${32 * u}px`, fontSize: 46 * u, lineHeight: 1.35, fontWeight: 600, boxShadow: '0 12px 40px rgba(0,0,0,.35)', position: 'relative' }}>
          {name && <div style={{ fontWeight: 900, fontSize: 28 * u, opacity: 0.6, marginBottom: 6 * u }}>{name}</div>}
          <span>{text.slice(0, Math.max(0, shown))}</span>
          <span style={{ opacity: 0 }}>{text.slice(Math.max(0, shown))}</span>
          <div style={{ position: 'absolute', bottom: -26 * u, [side === 'left' ? 'left' : 'right']: 60 * u, width: 0, height: 0, borderLeft: `${22 * u}px solid transparent`, borderRight: `${22 * u}px solid transparent`, borderTop: `${30 * u}px solid ${color}` } as React.CSSProperties} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
