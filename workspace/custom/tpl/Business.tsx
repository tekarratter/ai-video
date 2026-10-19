import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { SANS, clamp01, ease, easeOut, media, parts, rand, useFonts, useUnit } from './common';

/**
 * Strobe teaser: photos flash-cut on the beat with white strobes and zoom punches, then a big reveal of the title.
 * `beat` = frames per cut (8 ≈ 225 BPM at 30 fps; 15 ≈ 120 BPM). The reveal takes the last `revealSeconds`.
 */
export const StrobeTeaser: React.FC<{ images?: string[]; title?: string; subtitle?: string; beat?: number; accent?: string; revealSeconds?: number }> = ({
  images = [], title = 'BIG REVEAL', subtitle = '', beat = 8, accent = '#facc15', revealSeconds = 2.5,
}) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { u, width } = useUnit();
  const revealAt = Math.max(beat * 2, durationInFrames - revealSeconds * fps);
  const inReveal = f >= revealAt;
  const k = Math.floor(f / beat), local = f % beat;
  const src = images.length ? images[k % images.length] : '';
  const flash = inReveal ? interpolate(f - revealAt, [0, 3, 10], [1, 1, 0], { extrapolateRight: 'clamp' }) : interpolate(local, [0, 2], [0.85, 0], { extrapolateRight: 'clamp' });
  const punch = 1.25 - 0.17 * easeOut(local / beat);
  const r = spring({ frame: f - revealAt, fps, config: { damping: 9, mass: 0.7 } });
  const glitch = inReveal && f - revealAt < 8 ? (rand(f) - 0.5) * 30 * u : 0;
  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden', fontFamily: SANS }}>
      {!inReveal && src && <Img src={media(src)!} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${punch}) rotate(${(rand(k) - 0.5) * 4}deg)`, filter: k % 3 === 2 ? 'grayscale(1) contrast(1.4)' : 'contrast(1.15) saturate(1.2)' }} />}
      {!inReveal && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,.2), rgba(0,0,0,.55))' }} />}
      {inReveal && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', background: `radial-gradient(circle, #1a1a1a, #000 70%)` }}>
          <div style={{ color: '#fff', fontWeight: 900, fontSize: Math.min(170 * u, width / 6), letterSpacing: 8 * u * (2 - r), transform: `scale(${0.6 + 0.4 * r}) translateX(${glitch}px)`, textShadow: `${-glitch / 2}px 0 #ff004c, ${glitch / 2}px 0 #00e1ff, 0 0 ${50 * u}px ${accent}88`, textAlign: 'center', lineHeight: 1 }}>
            {parts(title).map((p, i) => <span key={i} style={p.hi ? { color: accent } : undefined}>{p.t}</span>)}
          </div>
          {subtitle && <div style={{ marginTop: 34 * u, color: accent, fontWeight: 700, fontSize: 44 * u, letterSpacing: 10 * u, opacity: clamp01((f - revealAt - 12) / 10) }}>{subtitle}</div>}
        </AbsoluteFill>
      )}
      <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: flash }} />
    </AbsoluteFill>
  );
};

type Dish = { image?: string; name?: string; price?: string; desc?: string };

/** Cinematic F&B menu reel: one dish after another (equal share of the clip), slow push-in, name + price tag. Scene. */
export const MenuShowcase: React.FC<{ brand?: string; items?: Dish[]; accent?: string; dark?: boolean }> = ({
  brand = 'MENU', items = [{ name: 'Món đặc biệt', price: '89K', desc: 'Công thức gia truyền' }], accent = '#f59e0b', dark = true,
}) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { u, width, height, portrait } = useUnit();
  const n = Math.max(1, items.length);
  const seg = durationInFrames / n;
  const i = Math.min(n - 1, Math.floor(f / seg));
  const lf = f - i * seg;
  const it = items[i] || {};
  const inP = spring({ frame: lf, fps, config: { damping: 15 } });
  const priceP = spring({ frame: lf - 10, fps, config: { damping: 8, mass: 0.6 } });
  const fadeIn = clamp01(lf / 8), fadeOut = clamp01((seg - lf) / 8);
  const fg = dark ? '#fff' : '#1c1917';
  return (
    <AbsoluteFill style={{ background: dark ? '#0c0a09' : '#fafaf9', overflow: 'hidden', fontFamily: SANS }}>
      {it.image && <Img src={media(it.image)!} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${1.05 + 0.1 * (lf / seg)})`, opacity: Math.min(fadeIn, fadeOut) }} />}
      <div style={{ position: 'absolute', inset: 0, background: dark ? 'linear-gradient(to top, rgba(0,0,0,.88) 0%, rgba(0,0,0,.25) 50%, rgba(0,0,0,.55) 100%)' : 'linear-gradient(to top, rgba(255,255,255,.92) 0%, rgba(255,255,255,0) 55%)' }} />
      <div style={{ position: 'absolute', top: 60 * u, width: '100%', textAlign: 'center', color: accent, fontWeight: 800, fontSize: 38 * u, letterSpacing: 14 * u }}>{brand}</div>
      <div style={{ position: 'absolute', left: 70 * u, right: 70 * u, bottom: height * (portrait ? 0.12 : 0.1), transform: `translateY(${(1 - inP) * 60 * u}px)`, opacity: Math.min(inP, fadeOut) }}>
        <div style={{ color: accent, fontSize: 30 * u, fontWeight: 700, letterSpacing: 6 * u }}>{String(i + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}</div>
        <div style={{ color: fg, fontSize: Math.min(96 * u, width / 10), fontWeight: 900, lineHeight: 1.1, marginTop: 10 * u }}>{it.name}</div>
        {it.desc && <div style={{ color: fg, opacity: 0.8, fontSize: 36 * u, marginTop: 14 * u }}>{it.desc}</div>}
      </div>
      {it.price && (
        <div style={{ position: 'absolute', right: 70 * u, top: height * (portrait ? 0.14 : 0.16), width: 210 * u, height: 210 * u, borderRadius: '50%', background: accent, color: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 60 * u, transform: `scale(${priceP}) rotate(${(1 - priceP) * -90 + 8}deg)`, boxShadow: '0 14px 40px rgba(0,0,0,.4)', opacity: fadeOut }}>
          {it.price}
        </div>
      )}
    </AbsoluteFill>
  );
};

/** Clean Apple-style product motion: words blur in one by one, a device mockup slides up showing an image or video. Scene. */
export const AppleMotion: React.FC<{ headline?: string; sub?: string; image?: string; video?: string; theme?: 'light' | 'dark'; device?: 'phone' | 'laptop' | 'none'; accent?: string }> = ({
  headline = 'Đơn giản. *Mạnh mẽ.*', sub = '', image = '', video = '', theme = 'light', device = 'phone', accent = '#2563eb',
}) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, width, height, portrait } = useUnit();
  const dark = theme === 'dark';
  const fg = dark ? '#f5f5f7' : '#1d1d1f';
  const words = parts(headline).flatMap((p) => p.t.split(/(\s+)/).filter((w) => w.trim()).map((w) => ({ w, hi: p.hi })));
  const dev = spring({ frame: f - 14, fps, config: { damping: 18, mass: 1.1 } });
  const phone = device === 'phone';
  const dw = phone ? (portrait ? width * 0.5 : height * 0.36) : width * (portrait ? 0.86 : 0.52);
  const dh = phone ? dw * 2.05 : dw * 0.63;
  const content = video ? <OffthreadVideo src={media(video)!} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    : image ? <Img src={media(image)!} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', background: `linear-gradient(135deg, ${accent}, #a855f7)` }} />;
  const textBlock = (
    <div style={{ textAlign: portrait || device === 'none' ? 'center' : 'left', maxWidth: portrait ? '100%' : '48%' }}>
      <div style={{ fontWeight: 800, fontSize: Math.min(110 * u, width / (portrait ? 8 : 13)), lineHeight: 1.08, letterSpacing: -2 * u, color: fg }}>
        {words.map((x, i) => {
          const p = ease((f - i * 4) / 14);
          return <span key={i} style={{ display: 'inline-block', marginRight: '0.25em', opacity: p, filter: `blur(${(1 - p) * 14 * u}px)`, transform: `translateY(${(1 - p) * 30 * u}px)`, ...(x.hi ? { backgroundImage: `linear-gradient(90deg, ${accent}, #a855f7)`, WebkitBackgroundClip: 'text', color: 'transparent' } : {}) }}>{x.w}</span>;
        })}
      </div>
      {sub && <div style={{ marginTop: 26 * u, color: fg, opacity: 0.6 * ease((f - words.length * 4 - 6) / 14), fontSize: 40 * u, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
  return (
    <AbsoluteFill style={{ background: dark ? 'radial-gradient(ellipse at 50% 0%, #1c1c1e, #000 70%)' : 'radial-gradient(ellipse at 50% 0%, #ffffff, #e8e8ed 80%)', fontFamily: SANS, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 90 * u, display: 'flex', flexDirection: portrait ? 'column' : 'row', alignItems: 'center', justifyContent: device === 'none' ? 'center' : 'space-between', gap: 60 * u }}>
        {textBlock}
        {device !== 'none' && (
          <div style={{ width: dw, height: dh, flex: 'none', transform: `translateY(${(1 - dev) * height * 0.6}px) rotate(${(1 - dev) * 6}deg)`, opacity: clamp01(dev * 2) }}>
            <div style={{ width: '100%', height: '100%', borderRadius: phone ? dw * 0.14 : 18 * u, background: '#111', padding: phone ? dw * 0.035 : 14 * u, boxShadow: `0 ${40 * u}px ${90 * u}px rgba(0,0,0,${dark ? 0.6 : 0.25})`, position: 'relative' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: phone ? dw * 0.11 : 6 * u, overflow: 'hidden', background: '#000' }}>{content}</div>
              {phone && <div style={{ position: 'absolute', top: dw * 0.06, left: '50%', width: dw * 0.28, height: dw * 0.075, marginLeft: -dw * 0.14, borderRadius: 99, background: '#000' }} />}
            </div>
            {!phone && <div style={{ width: '116%', marginLeft: '-8%', height: 22 * u, background: 'linear-gradient(#d4d4d8, #a1a1aa)', borderRadius: `0 0 ${20 * u}px ${20 * u}px` }} />}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Horizontal video → vertical "movie short": the same video blurred as the background, the sharp video centred,
 * a title bar on top (and room for subtitles below). `video` is the asset path ("/media/x.mp4"), `start` the source second.
 */
export const BlurFrame: React.FC<{ video?: string; start?: number; title?: string; titleColor?: string; tag?: string; blur?: number; volume?: number; zoom?: number }> = ({
  video = '', start = 0, title = 'Tên phim', titleColor = '#facc15', tag = '', blur = 28, volume = 1, zoom = 1,
}) => {
  useFonts();
  const { fps } = useVideoConfig();
  const { u, width, height } = useUnit();
  const src = media(video);
  const startFrom = Math.round(start * fps);
  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden', fontFamily: SANS }}>
      {src && <OffthreadVideo src={src} startFrom={startFrom} muted style={{ position: 'absolute', inset: -60 * u, width: `calc(100% + ${120 * u}px)`, height: `calc(100% + ${120 * u}px)`, objectFit: 'cover', filter: `blur(${blur * u}px) brightness(.55) saturate(1.2)` }} />}
      {src && <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', transform: `translateY(-50%) scale(${zoom})`, height: Math.min(height * 0.6, width * 9 / 16 * 1.0) }}>
        <OffthreadVideo src={src} startFrom={startFrom} volume={volume} style={{ width: '100%', height: '100%', objectFit: 'cover', boxShadow: '0 20px 60px rgba(0,0,0,.6)' }} />
      </div>}
      <div style={{ position: 'absolute', top: height * 0.09, left: 50 * u, right: 50 * u, textAlign: 'center' }}>
        {tag && <div style={{ display: 'inline-block', background: titleColor, color: '#111', fontWeight: 900, fontSize: 30 * u, padding: `${6 * u}px ${18 * u}px`, borderRadius: 8 * u, marginBottom: 18 * u, letterSpacing: 2 * u }}>{tag}</div>}
        <div style={{ color: titleColor, fontWeight: 900, fontSize: Math.min(84 * u, width / 9), lineHeight: 1.15, textShadow: '0 4px 20px rgba(0,0,0,.8)' }}>{title}</div>
      </div>
    </AbsoluteFill>
  );
};
