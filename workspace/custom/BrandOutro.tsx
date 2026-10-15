import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { mediaUrl } from './mediaUrl';

/** Closing call-to-action scene with logo, tagline, products and contact. Main-track scene. */
export const BrandOutro: React.FC<{ logo?: string; bg?: string; greeting?: string; tagline?: string; products?: string[]; phone?: string; phones?: string[]; website?: string; place?: string; accent?: string; pillBg?: string; greetingColor?: string; tint?: string }> = ({
  logo, bg, greeting, tagline = 'Reliable & Solid Solutions', products = ['Windows', 'Doors', 'Bifold', 'Storefront'],
  phone = '(682) 757-7777', phones, website = 'solidlineus.com', place = 'Arlington, Texas', accent = '#1e73be', pillBg = 'rgba(30,115,190,0.25)', greetingColor = '#ffd166', tint = '#0b1622',
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const s = (d: number, damping = 200) => spring({ frame: frame - d, fps, config: { damping } });
  const z = interpolate(frame, [0, durationInFrames], [1.1, 1.25]);
  return (
    <AbsoluteFill style={{ background: tint, fontFamily: 'Inter, Arial, sans-serif', alignItems: 'center', justifyContent: 'center' }}>
      {bg ? <Img src={mediaUrl(bg)!} style={{ position: 'absolute', height: '100%', left: '50%', transform: `translateX(-50%) scale(${z})`, filter: 'blur(14px) brightness(0.35)' }} /> : null}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 70px', textAlign: 'center' }}>
        {greeting ? <div style={{ color: greetingColor, fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 700, fontSize: 70, marginBottom: 40, opacity: s(4), transform: `translateY(${(1 - s(4)) * -30}px)`, textShadow: '0 4px 24px rgba(0,0,0,.6)' }}>{greeting}</div> : null}
        {logo ? <Img src={mediaUrl(logo)!} style={{ width: 520, borderRadius: 40, boxShadow: '0 20px 60px rgba(0,0,0,.5)', transform: `scale(${s(0, 12)})` }} /> : null}
        <div style={{ color: '#fff', fontSize: 58, fontWeight: 800, marginTop: 50, opacity: s(14), transform: `translateY(${(1 - s(14)) * 30}px)` }}>{tagline}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 16, marginTop: 40 }}>
          {products.map((p, i) => (
            <div key={i} style={{ border: `3px solid ${accent}`, background: pillBg, color: '#fff', fontSize: 38, fontWeight: 700, padding: '10px 26px', borderRadius: 40, transform: `scale(${s(24 + i * 5, 12)})` }}>{p}</div>
          ))}
        </div>
        <div style={{ marginTop: 60, background: accent, color: '#fff', fontSize: 64, fontWeight: 900, padding: '20px 50px', borderRadius: 20, transform: `scale(${s(48, 10)})`, boxShadow: `0 14px 40px ${accent}80` }}>{website}</div>
        <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          {(phones && phones.length ? phones : [phone]).map((ph, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 18, color: '#fff', fontSize: 50, fontWeight: 700, fontVariantNumeric: 'tabular-nums', opacity: s(58 + i * 6), transform: `translateY(${(1 - s(58 + i * 6)) * 24}px)` }}>
              <span style={{ width: 56, textAlign: 'center' }}>☎</span><span>{ph}</span>
            </div>
          ))}
        </div>
        <div style={{ color: '#9fb3c8', fontSize: 38, marginTop: 14, letterSpacing: 4, textTransform: 'uppercase', opacity: s(68) }}>{place}</div>
      </div>
    </AbsoluteFill>
  );
};
