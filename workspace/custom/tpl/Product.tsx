// Product introduction (tech-shop style): article-banner look — product photo full bleed, a dark brand-tinted
// gradient from the text side, small logo top-left, pill category tag, big bold 2-line headline (Be Vietnam Pro),
// photo-credit pill bottom-right. The same look is used for the thumbnail, the intro, spec / feature scenes and the CTA.
import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { SANS, clamp01, easeOut, media, parts, useFonts, useUnit } from './common';

type BrandProps = {
  /** logo image (/media/logo.png); without it the `brand` text is drawn as a wordmark */
  logo?: string;
  brand?: string;
  tagline?: string;
  /** brand colour of the gradient (dark tint over the photo) */
  tint?: string;
  /** highlight colour for *words*, price, buttons */
  accent?: string;
  hideBrand?: boolean;
};

export const PRODUCT_TINTS: Record<string, string> = { blue: '#0f2a6b', navy: '#111a3a', purple: '#2a1f4d', red: '#5a1414', teal: '#0b3b46', dark: '#0d0f14' };
const tintOf = (t?: string) => PRODUCT_TINTS[t || ''] || t || PRODUCT_TINTS.blue;
/** hex → rgba with alpha (accepts #rgb / #rrggbb; anything else is returned unchanged) */
const alpha = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const isVideo = (s?: string) => !!s && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(s);

const Hi: React.FC<{ text: string; accent: string }> = ({ text, accent }) => (
  <>{String(text || '').split('\n').map((line, li, arr) => (
    <React.Fragment key={li}>
      {parts(line).map((p, i) => <span key={i} style={p.hi ? { color: accent } : undefined}>{p.t}</span>)}
      {li < arr.length - 1 && <br />}
    </React.Fragment>
  ))}</>
);

/** Product photo (or video) covering the frame with a slow push-in. */
const Photo: React.FC<{ src?: string; push?: number; x?: number; focus?: string; dim?: number }> = ({ src, push = 0, x = 0, focus = 'center', dim = 1 }) => {
  if (!src) return <AbsoluteFill style={{ background: 'radial-gradient(circle at 70% 45%, #3b4a6b 0%, #141a2a 60%)' }} />;
  const style: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: focus, transform: `translateX(${x}px) scale(${1 + push})`, filter: dim < 1 ? `brightness(${dim})` : undefined };
  return isVideo(src) ? <OffthreadVideo src={media(src)!} muted style={style} /> : <Img src={media(src)!} style={style} />;
};

/** Logo (image) or wordmark "Brand●" + small tagline. */
const BrandMark: React.FC<BrandProps & { u: number; o?: number }> = ({ logo, brand = 'Tên cửa hàng', tagline = '', accent = '#ff7e00', u, o = 1 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12 * u, opacity: o }}>
    {logo
      ? <Img src={media(logo)!} style={{ height: 58 * u, maxWidth: 360 * u, objectFit: 'contain' }} />
      : (
        <div style={{ lineHeight: 1 }}>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 38 * u, letterSpacing: -0.5 * u }}>{brand}<span style={{ color: accent }}>●</span></div>
          {tagline && <div style={{ color: 'rgba(255,255,255,.75)', fontSize: 15 * u, marginTop: 4 * u, fontWeight: 500 }}>{tagline}</div>}
        </div>
      )}
  </div>
);

const Pill: React.FC<{ text: string; u: number; style?: React.CSSProperties }> = ({ text, u, style }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', padding: `${8 * u}px ${20 * u}px`, borderRadius: 999, background: 'rgba(255,255,255,.14)', border: `${1.5 * u}px solid rgba(255,255,255,.28)`, color: '#fff', fontWeight: 700, fontSize: 22 * u, letterSpacing: 1.5 * u, textTransform: 'uppercase', backdropFilter: 'blur(6px)', ...style }}>{text}</div>
);

type BannerProps = BrandProps & {
  image?: string;
  /** category tag, e.g. "GIỚI THIỆU", "REVIEW", "TIN TỨC", "MỚI VỀ" */
  kicker?: string;
  /** 1–2 lines; "\n" breaks a line, *word* = accent colour */
  title?: string;
  sub?: string;
  /** short spec chips under the title */
  specs?: string[];
  price?: string;
  oldPrice?: string;
  /** photo credit, e.g. "Ảnh: ASUS" */
  credit?: string;
  /** where the product sits in the photo (CSS object-position), e.g. "70% 50%" */
  focus?: string;
  /** text side on 16:9 (the gradient comes from that side) */
  side?: 'left' | 'right';
};

/** Shared banner layout. `p` = reveal progress per element (all 1 = finished banner = thumbnail). */
const Banner: React.FC<BannerProps & { p: { img: number; grad: number; brand: number; pill: number; l1: number; l2: number; sub: number; chips: number[]; price: number; credit: number }; push: number; out?: number }> = (props) => {
  useFonts();
  const { u, width, height, portrait } = useUnit();
  const {
    image, kicker = 'GIỚI THIỆU', title = 'Tên sản phẩm\n*điểm nổi bật*', sub = '', specs = [], price = '', oldPrice = '', credit = '',
    focus = 'center', side = 'left', accent = '#ff7e00', p, push, out = 1, hideBrand,
  } = props;
  const tint = tintOf(props.tint);
  const square = !portrait && Math.abs(width - height) < width * 0.1;
  const pad = (portrait ? 64 : 76) * u;
  const lines = String(title).split('\n');
  // fit the longest line in the text box (bold Be Vietnam Pro ≈ 0.6 em per character)
  const boxW = portrait || square ? width - 2 * pad : width * 0.48;
  const titleSize = Math.min((portrait ? 88 : square ? 80 : 84) * u, boxW / (Math.max(8, ...lines.map((l) => l.replace(/\*/g, '').length)) * 0.6));
  const dir = side === 'right' ? 270 : 90;
  const grad = portrait || square
    ? `linear-gradient(0deg, ${tint} 0%, ${alpha(tint, 0.94)} ${portrait ? 30 : 34}%, ${alpha(tint, 0.55)} ${portrait ? 52 : 58}%, ${alpha(tint, 0)} ${portrait ? 72 : 82}%)`
    : `linear-gradient(${dir}deg, ${tint} 0%, ${alpha(tint, 0.9)} 30%, ${alpha(tint, 0.45)} 52%, ${alpha(tint, 0)} 72%)`;
  const textBox: React.CSSProperties = portrait || square
    ? { position: 'absolute', left: pad, right: pad, bottom: height * (portrait ? 0.1 : 0.08) }
    : { position: 'absolute', [side === 'right' ? 'right' : 'left']: pad, width: width * 0.48, top: height * 0.31 };
  const rise = (k: number) => ({ opacity: k, transform: `translateY(${(1 - k) * 36 * u}px)` });
  return (
    <AbsoluteFill style={{ background: tint, overflow: 'hidden', fontFamily: SANS, opacity: out }}>
      <AbsoluteFill style={{ opacity: p.img }}>
        {portrait
          ? <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: height * 0.66, overflow: 'hidden' }}><Photo src={image} push={push} focus={focus} /></div>
          : <Photo src={image} push={push} focus={focus} x={(1 - p.img) * 40 * u * (side === 'right' ? -1 : 1)} />}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: grad, opacity: p.grad }} />
      {/* soft light from the photo side, like the article banners */}
      <AbsoluteFill style={{ background: `radial-gradient(circle at ${side === 'right' ? '20%' : '80%'} ${portrait ? '30%' : '40%'}, rgba(255,255,255,.10), rgba(255,255,255,0) 45%)`, opacity: p.grad }} />
      {!hideBrand && <div style={{ position: 'absolute', left: pad * 0.7, top: pad * 0.6 }}><BrandMark {...props} u={u} o={p.brand} /></div>}
      <div style={{ ...textBox, display: 'flex', flexDirection: 'column', alignItems: side === 'right' && !portrait && !square ? 'flex-end' : 'flex-start', textAlign: side === 'right' && !portrait && !square ? 'right' : 'left', gap: 22 * u }}>
        {kicker && <div style={{ opacity: p.pill, transform: `scale(${0.85 + 0.15 * p.pill})`, transformOrigin: 'left center' }}><Pill text={kicker} u={u} /></div>}
        <div style={{ color: '#fff', fontWeight: 800, fontSize: titleSize, lineHeight: 1.16, letterSpacing: -0.5 * u, textShadow: '0 4px 28px rgba(0,0,0,.35)' }}>
          {lines.map((l, i) => <div key={i} style={rise(i === 0 ? p.l1 : p.l2)}><Hi text={l} accent={accent} /></div>)}
        </div>
        {sub && <div style={{ ...rise(p.sub), color: 'rgba(255,255,255,.85)', fontSize: (portrait ? 36 : 32) * u, fontWeight: 500, lineHeight: 1.35, maxWidth: portrait ? undefined : width * 0.44 }}><Hi text={sub} accent={accent} /></div>}
        {!!specs.length && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 * u, justifyContent: side === 'right' && !portrait && !square ? 'flex-end' : 'flex-start' }}>
            {specs.slice(0, 5).map((s, i) => (
              <div key={i} style={{ ...rise(p.chips[i] ?? 1), padding: `${10 * u}px ${18 * u}px`, borderRadius: 12 * u, background: 'rgba(0,0,0,.28)', border: `${1.5 * u}px solid rgba(255,255,255,.18)`, color: '#fff', fontWeight: 700, fontSize: 26 * u }}>{s}</div>
            ))}
          </div>
        )}
        {price && (
          <div style={{ ...rise(p.price), display: 'flex', alignItems: 'baseline', gap: 16 * u }}>
            <div style={{ background: accent, color: '#fff', fontWeight: 900, fontSize: 44 * u, padding: `${6 * u}px ${22 * u}px`, borderRadius: 12 * u, boxShadow: `0 10px 30px ${alpha(accent, 0.45)}` }}>{price}</div>
            {oldPrice && <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 30 * u, textDecoration: 'line-through', fontWeight: 600 }}>{oldPrice}</div>}
          </div>
        )}
      </div>
      {credit && (
        <div style={{ position: 'absolute', right: pad * 0.5, bottom: pad * 0.45, opacity: p.credit, padding: `${4 * u}px ${12 * u}px`, borderRadius: 999, background: 'rgba(0,0,0,.45)', color: 'rgba(255,255,255,.9)', fontSize: 16 * u, fontWeight: 600 }}>{credit}</div>
      )}
    </AbsoluteFill>
  );
};

const DONE = { img: 1, grad: 1, brand: 1, pill: 1, l1: 1, l2: 1, sub: 1, chips: [1, 1, 1, 1, 1], price: 1, credit: 1 };

/** Static thumbnail / article banner (export with `vedit thumbnail`). Scene. */
export const ProductThumbnail: React.FC<BannerProps> = (props) => <Banner {...props} p={DONE} push={0.02} />;

/**
 * Animated intro in the same look: photo slides in with a slow push, gradient, logo, tag, headline lines, spec chips,
 * price. Its last frame is the thumbnail. Also good for feature scenes (`hideBrand`, other `kicker`). Scene, 3.5–6 s.
 */
export const ProductIntro: React.FC<BannerProps & { delay?: number }> = ({ delay = 0, ...props }) => {
  const f = useCurrentFrame() - delay;
  const { fps, durationInFrames } = useVideoConfig();
  const sp = (at: number, damping = 16) => spring({ frame: f - at, fps, config: { damping } });
  const lin = (a: number, b: number) => clamp01((f - a) / (b - a));
  const p = {
    img: easeOut(lin(0, 16)), grad: easeOut(lin(2, 18)), brand: easeOut(lin(8, 20)), pill: sp(12, 12),
    l1: sp(18), l2: sp(24), sub: sp(32), chips: [0, 1, 2, 3, 4].map((i) => sp(38 + i * 5, 14)), price: sp(46 + (props.specs?.length || 0) * 5, 11), credit: easeOut(lin(30, 44)),
  };
  const push = 0.1 * (1 - easeOut(f / (durationInFrames || 1))) + 0.02;
  // no fade-out: the clip's transition handles the exit and the last frame stays the finished banner (= thumbnail)
  return <Banner {...props} p={p} push={push} />;
};

/** Spec sheet: product photo panel + rows (icon, label, value) appearing one by one. Scene. */
export const ProductSpecs: React.FC<BrandProps & {
  image?: string; kicker?: string; title?: string; specs?: { icon?: string; label: string; value: string }[]; times?: number[]; source?: string;
}> = (props) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, width, height, portrait } = useUnit();
  const { image, kicker = 'THÔNG SỐ', title = 'Cấu hình *nổi bật*', specs = [{ icon: '⚡', label: 'CPU', value: 'Intel Core i7' }, { icon: '🎮', label: 'GPU', value: 'RTX 5070 8 GB' }, { icon: '🖥️', label: 'Màn hình', value: '16" 2.5K 165 Hz' }], times = [], source = '', accent = '#ff7e00', hideBrand } = props;
  const tint = tintOf(props.tint);
  const rows = specs.slice(0, 7);
  const at = (i: number) => (times[i] != null ? times[i] * fps : 14 + i * 9);
  const head = spring({ frame: f - 4, fps, config: { damping: 16 } });
  const pad = 72 * u;
  const panel = portrait ? { left: 0, right: 0, top: 0, height: height * 0.4 } : { left: 0, top: 0, bottom: 0, width: width * 0.44 };
  return (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, ${tint} 0%, #0b0e16 100%)`, fontFamily: SANS, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', ...panel, overflow: 'hidden' }}>
        <Photo src={image} push={0.06 - 0.04 * easeOut(f / 120)} />
        <div style={{ position: 'absolute', inset: 0, background: portrait ? `linear-gradient(0deg, ${tint} 0%, ${alpha(tint, 0)} 45%)` : `linear-gradient(270deg, ${tint} 0%, ${alpha(tint, 0)} 40%)` }} />
      </div>
      {!hideBrand && <div style={{ position: 'absolute', left: pad * 0.7, top: pad * 0.6 }}><BrandMark {...props} u={u} /></div>}
      <div style={{ position: 'absolute', ...(portrait ? { left: pad, right: pad, top: height * 0.42 } : { left: width * 0.5, right: pad, top: height * 0.14 }), display: 'flex', flexDirection: 'column', gap: 18 * u }}>
        <div style={{ opacity: head }}><Pill text={kicker} u={u} /></div>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 58 * u, lineHeight: 1.15, opacity: head, transform: `translateY(${(1 - head) * 30 * u}px)` }}><Hi text={title} accent={accent} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 * u }}>
          {rows.map((r, i) => {
            const k = spring({ frame: f - at(i), fps, config: { damping: 15 } });
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 20 * u, padding: `${16 * u}px 0`, borderBottom: `${1.5 * u}px solid rgba(255,255,255,.12)`, opacity: k, transform: `translateX(${(1 - k) * 50 * u}px)` }}>
                <div style={{ width: 60 * u, height: 60 * u, borderRadius: 16 * u, background: alpha(accent, 0.16), border: `${1.5 * u}px solid ${alpha(accent, 0.5)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 * u, flex: 'none' }}>{r.icon || '•'}</div>
                <div style={{ color: 'rgba(255,255,255,.62)', fontSize: 26 * u, fontWeight: 600, width: 200 * u, flex: 'none' }}>{r.label}</div>
                <div style={{ color: '#fff', fontSize: 32 * u, fontWeight: 700, lineHeight: 1.25 }}><Hi text={r.value} accent={accent} /></div>
              </div>
            );
          })}
        </div>
        {source && <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 18 * u, marginTop: 8 * u }}>{source}</div>}
      </div>
    </AbsoluteFill>
  );
};

/** Closing call to action: product, price, "MUA NGAY" button (pulses), hotline / address / website. Scene. */
export const ProductCTA: React.FC<BrandProps & {
  image?: string; title?: string; price?: string; oldPrice?: string; button?: string; hotline?: string; address?: string; website?: string; note?: string;
}> = (props) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, width, height, portrait } = useUnit();
  const { image, title = 'Có sẵn tại *cửa hàng*', price = '', oldPrice = '', button = 'MUA NGAY', hotline = '', address = '', website = '', note = '', accent = '#ff7e00' } = props;
  const tint = tintOf(props.tint);
  const k = (at: number, d = 15) => spring({ frame: f - at, fps, config: { damping: d } });
  const pulse = 1 + 0.04 * Math.max(0, Math.sin((f - 40) / 6)) * (f > 40 ? 1 : 0);
  const pad = 76 * u;
  const contact = [hotline && ['📞', hotline], address && ['📍', address], website && ['🌐', website]].filter(Boolean) as [string, string][];
  return (
    <AbsoluteFill style={{ background: tint, fontFamily: SANS, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', ...(portrait ? { left: 0, right: 0, top: 0, height: height * 0.5 } : { right: 0, top: 0, bottom: 0, width: width * 0.55 }), overflow: 'hidden', opacity: k(0, 20) }}>
        <Photo src={image} push={0.08 * (1 - easeOut(f / 90))} />
      </div>
      <AbsoluteFill style={{ background: portrait ? `linear-gradient(0deg, ${tint} 0%, ${tint} 50%, ${alpha(tint, 0)} 70%)` : `linear-gradient(90deg, ${tint} 0%, ${tint} 40%, ${alpha(tint, 0)} 70%)` }} />
      <div style={{ position: 'absolute', left: pad * 0.7, top: pad * 0.6 }}><BrandMark {...props} u={u} o={k(4)} /></div>
      <div style={{ position: 'absolute', ...(portrait ? { left: pad, right: pad, bottom: height * 0.1 } : { left: pad, width: width * 0.46, top: height * 0.26 }), display: 'flex', flexDirection: 'column', gap: 24 * u }}>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 66 * u, lineHeight: 1.15, opacity: k(8), transform: `translateY(${(1 - k(8)) * 30 * u}px)` }}><Hi text={title} accent={accent} /></div>
        {price && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 * u, opacity: k(16, 11), transform: `scale(${0.8 + 0.2 * k(16, 11)})`, transformOrigin: 'left center' }}>
            <span style={{ color: accent, fontWeight: 900, fontSize: 72 * u }}>{price}</span>
            {oldPrice && <span style={{ color: 'rgba(255,255,255,.6)', fontSize: 34 * u, textDecoration: 'line-through', fontWeight: 600 }}>{oldPrice}</span>}
          </div>
        )}
        {button && (
          <div style={{ alignSelf: 'flex-start', opacity: k(24, 12), transform: `scale(${(0.7 + 0.3 * k(24, 12)) * pulse})`, transformOrigin: 'left center', background: accent, color: '#fff', fontWeight: 900, fontSize: 40 * u, padding: `${18 * u}px ${44 * u}px`, borderRadius: 999, letterSpacing: 2 * u, boxShadow: `0 14px 40px ${alpha(accent, 0.5)}` }}>{button}</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 * u, marginTop: 6 * u }}>
          {contact.map(([ic, t], i) => (
            <div key={i} style={{ color: '#fff', fontSize: 30 * u, fontWeight: 600, display: 'flex', gap: 14 * u, alignItems: 'center', opacity: k(32 + i * 6), transform: `translateX(${(1 - k(32 + i * 6)) * 40 * u}px)` }}><span>{ic}</span><span>{t}</span></div>
          ))}
          {note && <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 22 * u, opacity: k(50) }}>{note}</div>}
        </div>
      </div>
    </AbsoluteFill>
  );
};
