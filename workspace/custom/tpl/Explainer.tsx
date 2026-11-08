import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { SANS, clamp01, ease, easeOut, media, parts, useFonts, useUnit } from './common';

/*
 * Explainer scenes for "video from a document" (reports, lessons, papers, guidelines): key points, bar chart,
 * process, table, comparison, a zoom into a page of the document, and a document title card.
 * Shared props: `title` (supports *highlight*), `kicker` (small label above), `accent`, `theme` 'light' | 'dark',
 * `source` (small note, top right). The bottom ~12 % (9:16: ~16 %) stays free for subtitles. Items appear one by one: spread over the clip by default, or at `times`
 * (seconds from the clip start, e.g. when the narration mentions each one).
 */

type Theme = 'light' | 'dark';
const THEMES = {
  light: { bg: '#f4f6fb', bg2: '#e6ebf5', card: '#ffffff', text: '#0f172a', sub: '#475569', line: 'rgba(15,23,42,.10)', shadow: '0 18px 50px rgba(15,23,42,.12)' },
  dark: { bg: '#0b1220', bg2: '#16233b', card: 'rgba(255,255,255,.07)', text: '#f8fafc', sub: '#a5b4cb', line: 'rgba(255,255,255,.12)', shadow: '0 18px 50px rgba(0,0,0,.45)' },
};
type Common = { title?: string; kicker?: string; accent?: string; theme?: Theme; source?: string; times?: number[] };

/** Frame at which item i appears: `times[i]` if given, else spread between 0.7 s and ~65 % of the clip. */
const useAppear = (n: number, times?: number[]) => {
  const { fps, durationInFrames } = useVideoConfig();
  const first = 0.7 * fps;
  const step = n > 1 ? Math.min(1.8 * fps, Math.max(0.35 * fps, (durationInFrames * 0.65 - first) / (n - 1))) : 0;
  return (i: number) => (times?.[i] != null ? times[i] * fps : first + i * step);
};

const Hi: React.FC<{ text?: string; color: string }> = ({ text = '', color }) => (
  <>{parts(text).map((p, i) => <span key={i} style={p.hi ? { color } : undefined}>{p.t}</span>)}</>
);

/** Background + heading + footnote shared by all scenes. */
const Frame: React.FC<Common & { children: React.ReactNode; compact?: boolean }> = ({ title, kicker, accent = '#2563eb', theme = 'light', source, children, compact }) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useUnit();
  const T = THEMES[theme] || THEMES.light;
  const tp = spring({ frame: f - 2, fps, config: { damping: 16 } });
  const drift = Math.sin(f / (fps * 3)) * 30 * u;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${T.bg}, ${T.bg2})`, fontFamily: SANS, color: T.text, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', width: 900 * u, height: 900 * u, borderRadius: '50%', right: -300 * u + drift, top: -380 * u, background: `radial-gradient(circle, ${accent}2a, transparent 65%)` }} />
      <div style={{ position: 'absolute', width: 700 * u, height: 700 * u, borderRadius: '50%', left: -260 * u - drift, bottom: -320 * u, background: `radial-gradient(circle, ${accent}1c, transparent 65%)` }} />
      <div style={{ position: 'absolute', inset: 0, padding: portrait ? `${150 * u}px ${70 * u}px ${300 * u}px` : `${(compact ? 70 : 80) * u}px ${110 * u}px ${150 * u}px`, display: 'flex', flexDirection: 'column', gap: (portrait ? 50 : 40) * u }}>
        {(title || kicker) && (
          <div style={{ opacity: tp, transform: `translateY(${(1 - tp) * 30 * u}px)` }}>
            {kicker && <div style={{ display: 'inline-block', padding: `${8 * u}px ${20 * u}px`, borderRadius: 40 * u, background: `${accent}22`, color: accent, fontWeight: 800, fontSize: 26 * u, letterSpacing: 3 * u, textTransform: 'uppercase', marginBottom: 18 * u }}>{kicker}</div>}
            {title && <div style={{ fontWeight: 800, fontSize: (portrait ? 72 : 64) * u, lineHeight: 1.15, letterSpacing: -0.5 * u }}><Hi text={title} color={accent} /></div>}
            <div style={{ marginTop: 18 * u, height: 7 * u, width: 120 * u * ease((f - 6) / 18), borderRadius: 7 * u, background: accent }} />
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>{children}</div>
      </div>
      {source && <div style={{ position: 'absolute', right: (portrait ? 70 : 110) * u, top: (portrait ? 150 : 80) * u, maxWidth: '40%', textAlign: 'right', fontSize: 24 * u, color: T.sub, opacity: clamp01((f - fps) / 15) }}>{source}</div>}
    </AbsoluteFill>
  );
};

/** Emoji / number in a soft accent circle. */
const Badge: React.FC<{ icon?: string; n: number; size: number; accent: string; p: number }> = ({ icon, n, size, accent, p }) => (
  <div style={{ width: size, height: size, flex: 'none', borderRadius: '50%', background: icon ? `${accent}1f` : accent, color: icon ? undefined : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * (icon ? 0.52 : 0.46), fontWeight: 900, transform: `scale(${p})` }}>
    {icon || n}
  </div>
);

type Point = { icon?: string; title?: string; text?: string };

/** 2–6 key points as cards (emoji icon, short title, one line of text). Scene. */
export const KeyPoints: React.FC<Common & { items?: Point[] }> = ({ items = [], accent = '#2563eb', theme = 'light', times, ...c }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useUnit();
  const T = THEMES[theme] || THEMES.light;
  const at = useAppear(items.length, times);
  const n = items.length;
  const cols = portrait ? 1 : n <= 3 ? n : n === 4 ? 2 : 3;
  const dense = portrait ? n > 4 : n > 3;
  return (
    <Frame {...c} accent={accent} theme={theme}>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: (portrait ? 26 : 34) * u, alignContent: 'center' }}>
        {items.map((it, i) => {
          const p = spring({ frame: f - at(i), fps, config: { damping: 13, mass: 0.7 } });
          const last = i === items.findLastIndex((_, k) => f >= at(k));
          const row = portrait || cols === 1;
          return (
            <div key={i} style={{
              background: T.card, borderRadius: 26 * u, padding: `${(dense ? 26 : 36) * u}px ${34 * u}px`, boxShadow: T.shadow,
              border: `${3 * u}px solid ${last ? accent : 'transparent'}`, display: 'flex', flexDirection: row ? 'row' : 'column', gap: (row ? 28 : 20) * u,
              alignItems: row ? 'center' : 'flex-start', opacity: clamp01(p * 1.4), transform: `translateY(${(1 - p) * 60 * u}px) scale(${0.9 + 0.1 * p})`,
            }}>
              <Badge icon={it.icon} n={i + 1} size={(dense ? 84 : 104) * u} accent={accent} p={spring({ frame: f - at(i) - 5, fps, config: { damping: 9 } })} />
              <div style={{ minWidth: 0 }}>
                {it.title && <div style={{ fontWeight: 800, fontSize: (dense ? 40 : 46) * u, lineHeight: 1.2 }}><Hi text={it.title} color={accent} /></div>}
                {it.text && <div style={{ marginTop: 8 * u, fontSize: (dense ? 30 : 33) * u, color: T.sub, lineHeight: 1.35 }}><Hi text={it.text} color={accent} /></div>}
              </div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
};

type Bar = { label: string; value: number; color?: string; display?: string };
const fmtNum = (v: number, decimals: number, locale: string) => v.toLocaleString(locale === 'en' ? 'en-US' : 'vi-VN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Animated bar chart: bars grow one by one, values count up. Columns on 16:9, horizontal bars on 9:16. Scene. */
export const BarChart: React.FC<Common & { bars?: Bar[]; unit?: string; decimals?: number; max?: number; highlight?: number; horizontal?: boolean; locale?: 'vi' | 'en' }> = ({
  bars = [], unit = '', decimals, max, highlight, horizontal, locale = 'vi', accent = '#2563eb', theme = 'light', times, ...c
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useUnit();
  const T = THEMES[theme] || THEMES.light;
  const at = useAppear(bars.length, times);
  const top = max ?? Math.max(1e-9, ...bars.map((b) => b.value)) * 1.08;
  const dec = decimals ?? (bars.some((b) => !Number.isInteger(b.value)) ? 1 : 0);
  const hor = horizontal ?? portrait;
  const color = (b: Bar, i: number) => b.color || (highlight == null || highlight === i ? accent : theme === 'dark' ? '#475569' : '#94a3b8');
  const grow = (i: number) => easeOut((f - at(i)) / (0.9 * fps));
  // while counting keep the decimals (steady width); the final value drops them when it is a whole number
  const label = (b: Bar, i: number) => (grow(i) >= 1 ? b.display || `${fmtNum(b.value, Number.isInteger(b.value) ? 0 : dec, locale)}${unit}` : `${fmtNum(b.value * grow(i), dec, locale)}${unit}`);
  if (hor) {
    return (
      <Frame {...c} accent={accent} theme={theme}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 34 * u }}>
          {bars.map((b, i) => (
            <div key={i} style={{ opacity: clamp01((f - at(i) + 6) / 8) }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 36 * u, fontWeight: 700, marginBottom: 10 * u }}>
                <span>{b.label}</span><span style={{ color: color(b, i), fontWeight: 900 }}>{label(b, i)}</span>
              </div>
              <div style={{ height: 46 * u, borderRadius: 23 * u, background: T.line, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(b.value / top) * 100 * grow(i)}%`, borderRadius: 23 * u, background: color(b, i) }} />
              </div>
            </div>
          ))}
        </div>
      </Frame>
    );
  }
  return (
    <Frame {...c} accent={accent} theme={theme}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 40 * u, padding: `0 ${30 * u}px`, borderBottom: `${4 * u}px solid ${T.sub}` }}>
          {[0.25, 0.5, 0.75, 1].map((g) => <div key={g} style={{ position: 'absolute', left: 0, right: 0, bottom: `${g * 100 / 1.08}%`, borderTop: `${2 * u}px dashed ${T.line}` }} />)}
          {bars.map((b, i) => (
            <div key={i} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', position: 'relative' }}>
              <div style={{ fontSize: 40 * u, fontWeight: 900, color: color(b, i), marginBottom: 12 * u, opacity: clamp01((f - at(i)) / 6), whiteSpace: 'nowrap' }}>{label(b, i)}</div>
              <div style={{ width: '72%', maxWidth: 220 * u, height: `${(b.value / top) * 100 * grow(i)}%`, borderRadius: `${16 * u}px ${16 * u}px 0 0`, background: `linear-gradient(180deg, ${color(b, i)}, ${color(b, i)}cc)`, boxShadow: highlight === i ? `0 0 ${40 * u}px ${accent}66` : undefined }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 40 * u, padding: `${16 * u}px ${30 * u}px 0` }}>
          {bars.map((b, i) => <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 30 * u, fontWeight: 700, color: T.sub, lineHeight: 1.2, opacity: clamp01((f - at(i) + 6) / 8) }}>{b.label}</div>)}
        </div>
      </div>
    </Frame>
  );
};

/** Steps of a process / timeline: numbered (or emoji) nodes joined by a growing line; the current step glows. Scene. */
export const ProcessFlow: React.FC<Common & { steps?: Point[] }> = ({ steps = [], accent = '#2563eb', theme = 'light', times, ...c }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useUnit();
  const T = THEMES[theme] || THEMES.light;
  const at = useAppear(steps.length, times);
  const n = steps.length;
  const cur = steps.findLastIndex((_, k) => f >= at(k));
  const lineP = n > 1 ? clamp01(interpolate(f, steps.map((_, i) => at(i)), steps.map((_, i) => i / (n - 1)), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })) : 0;
  const node = (i: number) => 96 * u * (n > 5 ? 0.85 : 1);
  return (
    <Frame {...c} accent={accent} theme={theme}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: portrait ? 'column' : 'row', justifyContent: 'center', alignItems: portrait ? 'stretch' : 'flex-start', gap: (portrait ? 30 : 20) * u, paddingTop: portrait ? 0 : 60 * u }}>
        {/* connector */}
        {n > 1 && (portrait
          ? <div style={{ position: 'absolute', left: node(0) / 2 - 3 * u, top: `${50 / n}%`, height: `${(100 - 100 / n) * lineP}%`, width: 6 * u, background: accent, borderRadius: 6 * u }} />
          : <div style={{ position: 'absolute', top: 60 * u + node(0) / 2 - 3 * u, left: `${50 / n}%`, width: `${(100 - 100 / n) * lineP}%`, height: 6 * u, background: accent, borderRadius: 6 * u }} />)}
        {steps.map((s, i) => {
          const p = spring({ frame: f - at(i), fps, config: { damping: 12, mass: 0.7 } });
          const active = i === cur;
          const pulse = active ? 1 + 0.06 * Math.sin((f - at(i)) / 5) : 1;
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: portrait ? 'row' : 'column', alignItems: portrait ? 'center' : 'center', gap: 26 * u, textAlign: portrait ? 'left' : 'center', opacity: clamp01(p * 1.5), transform: `translate${portrait ? 'X' : 'Y'}(${(1 - p) * 50 * u}px)`, position: 'relative' }}>
              <div style={{ width: node(i), height: node(i), flex: 'none', borderRadius: '50%', background: f >= at(i) ? accent : T.card, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: node(i) * (s.icon ? 0.5 : 0.42), fontWeight: 900, boxShadow: active ? `0 0 0 ${10 * u}px ${accent}33, ${T.shadow}` : T.shadow, transform: `scale(${pulse})` }}>{s.icon || i + 1}</div>
              <div style={{ minWidth: 0, background: active ? T.card : 'transparent', borderRadius: 20 * u, padding: active ? `${16 * u}px ${20 * u}px` : `${16 * u}px ${20 * u}px`, boxShadow: active ? T.shadow : undefined }}>
                {s.title && <div style={{ fontWeight: 800, fontSize: (n > 4 && !portrait ? 34 : 42) * u, lineHeight: 1.2 }}><Hi text={s.title} color={accent} /></div>}
                {s.text && <div style={{ marginTop: 8 * u, fontSize: (n > 4 && !portrait ? 26 : 31) * u, color: T.sub, lineHeight: 1.35 }}><Hi text={s.text} color={accent} /></div>}
              </div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
};

/** Table: header, then rows slide in one by one; `highlight` = row index to emphasise. Keep ≤ 8 rows, ≤ 5 columns. Scene. */
export const DataTable: React.FC<Common & { columns?: string[]; rows?: (string | number)[][]; highlight?: number }> = ({
  columns = [], rows = [], highlight, accent = '#2563eb', theme = 'light', times, ...c
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useUnit();
  const T = THEMES[theme] || THEMES.light;
  const at = useAppear(rows.length, times);
  const fs = (portrait ? 34 : 36) * u * (rows.length > 6 ? 0.85 : 1) * (columns.length > 4 ? 0.85 : 1);
  const num = (v: unknown) => /^[\s\d.,%+\-−–×x/~≈<>≤≥$€₫]+$/.test(String(v)) && /\d/.test(String(v));
  const hp = spring({ frame: f - 4, fps, config: { damping: 15 } });
  return (
    <Frame {...c} accent={accent} theme={theme}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
        <div style={{ width: '100%', background: T.card, borderRadius: 24 * u, boxShadow: T.shadow, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `1.4fr repeat(${Math.max(0, columns.length - 1)}, 1fr)`, background: accent, color: '#fff', fontWeight: 800, fontSize: fs, opacity: hp, transform: `translateY(${(1 - hp) * -20 * u}px)` }}>
            {columns.map((h, i) => <div key={i} style={{ padding: `${20 * u}px ${26 * u}px`, textAlign: i && rows.some((r) => num(r[i])) ? 'right' : 'left' }}>{h}</div>)}
          </div>
          {rows.map((r, ri) => {
            const p = easeOut((f - at(ri)) / 12);
            const hi = highlight === ri && f >= at(ri) + 10;
            return (
              <div key={ri} style={{ display: 'grid', gridTemplateColumns: `1.4fr repeat(${Math.max(0, columns.length - 1)}, 1fr)`, fontSize: fs, borderTop: `${2 * u}px solid ${T.line}`, background: hi ? `${accent}22` : ri % 2 ? (theme === 'dark' ? 'rgba(255,255,255,.03)' : '#f8fafc') : 'transparent', opacity: p, transform: `translateX(${(1 - p) * 80 * u}px)`, fontWeight: hi ? 800 : 500 }}>
                {r.map((v, i) => <div key={i} style={{ padding: `${18 * u}px ${26 * u}px`, textAlign: i && num(v) ? 'right' : 'left', fontVariantNumeric: 'tabular-nums', color: hi && i ? accent : undefined }}>{String(v)}</div>)}
              </div>
            );
          })}
        </div>
      </div>
    </Frame>
  );
};

type Side = { title?: string; icon?: string; color?: string; points?: string[] };

/** Two sides compared (before/after, option A/B, myth/fact): panels slide in, points tick in alternately. Scene. */
export const VersusCompare: React.FC<Common & { left?: Side; right?: Side; vs?: string }> = ({
  left = { title: 'A', points: [] }, right = { title: 'B', points: [] }, vs = 'VS', accent = '#2563eb', theme = 'light', times, ...c
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useUnit();
  const T = THEMES[theme] || THEMES.light;
  const lp = left.points || [], rp = right.points || [];
  // order: L1, R1, L2, R2…
  const order: [0 | 1, number][] = [];
  for (let i = 0; i < Math.max(lp.length, rp.length); i++) { if (lp[i]) order.push([0, i]); if (rp[i]) order.push([1, i]); }
  const at = useAppear(order.length, times);
  const when = (s: 0 | 1, i: number) => at(order.findIndex(([a, b]) => a === s && b === i)) + 0.5 * fps;
  const panel = (s: Side, k: 0 | 1, pts: string[]) => {
    const col = s.color || (k ? '#16a34a' : '#dc2626');
    const p = spring({ frame: f - 4 - k * 6, fps, config: { damping: 14 } });
    return (
      <div style={{ flex: 1, background: T.card, borderRadius: 26 * u, boxShadow: T.shadow, borderTop: `${10 * u}px solid ${col}`, padding: `${40 * u}px ${44 * u}px`, opacity: p, transform: `translate${portrait ? 'Y' : 'X'}(${(1 - p) * (k ? 80 : -80) * u}px)`, display: 'flex', flexDirection: 'column', gap: 20 * u, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 * u }}>
          {s.icon && <span style={{ fontSize: 60 * u }}>{s.icon}</span>}
          <div style={{ fontWeight: 900, fontSize: 48 * u, color: col }}><Hi text={s.title} color={accent} /></div>
        </div>
        {pts.map((t, i) => {
          const q = spring({ frame: f - when(k, i), fps, config: { damping: 12 } });
          return (
            <div key={i} style={{ display: 'flex', gap: 16 * u, alignItems: 'flex-start', fontSize: (portrait ? 40 : 34) * u, lineHeight: 1.3, opacity: clamp01(q * 1.5), transform: `translateY(${(1 - q) * 20 * u}px)` }}>
              <span style={{ color: col, fontWeight: 900, transform: `scale(${q})`, flex: 'none' }}>{k ? '✓' : '✕'}</span>
              <span><Hi text={t} color={accent} /></span>
            </div>
          );
        })}
      </div>
    );
  };
  const vp = spring({ frame: f - 14, fps, config: { damping: 8 } });
  return (
    <Frame {...c} accent={accent} theme={theme}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
        <div style={{ width: '100%', display: 'flex', flexDirection: portrait ? 'column' : 'row', alignItems: 'stretch' }}>
          {panel(left, 0, lp)}
          <div style={{ alignSelf: 'center', zIndex: 1, margin: portrait ? `${-30 * u}px 0` : `0 ${-30 * u}px`, width: 110 * u, height: 110 * u, flex: 'none', borderRadius: '50%', background: accent, color: '#fff', fontWeight: 900, fontSize: 40 * u, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${vp})`, boxShadow: T.shadow }}>{vs}</div>
          {panel(right, 1, rp)}
        </div>
      </div>
    </Frame>
  );
};

/**
 * A page of the document (page image from `vedit doc --pages n`) on a desk: the page appears, then the camera zooms
 * into `focus` {x, y, w, h} (fractions of the page) and a highlighter frame is drawn around it, with an optional
 * `caption`. `aspect` = page height / width (A4 ≈ 1.414; vedit prints the page size). No focus = slow scroll down. Scene.
 */
export const DocZoom: React.FC<{ image?: string; focus?: { x: number; y: number; w: number; h: number }; caption?: string; kicker?: string; aspect?: number; accent?: string; zoomAt?: number }> = ({
  image = '', focus, caption = '', kicker = '', aspect = 1.414, accent = '#f59e0b', zoomAt = 1.2,
}) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { u, width, height } = useUnit();
  const W0 = Math.min(width * 0.78, (height * 0.84) / aspect);
  const H0 = W0 * aspect;
  const inP = spring({ frame: f, fps, config: { damping: 18 } });
  const z = ease((f - zoomAt * fps) / (1.3 * fps));
  let s = 1, cx = 0.5, cy = 0.5;
  if (focus) {
    const s1 = Math.min((width * 0.84) / (focus.w * W0), (height * (caption ? 0.62 : 0.74)) / (focus.h * H0), 4.5);
    s = 1 + (s1 - 1) * z;
    cx = 0.5 + (focus.x + focus.w / 2 - 0.5) * z;
    cy = 0.5 + (focus.y + focus.h / 2 - 0.5) * z;
  } else {
    // no focus: show the top of the page larger and scroll down slowly
    const s1 = Math.min(2.2, (width * 0.9) / W0);
    s = 1 + (s1 - 1) * z;
    const t = clamp01((f - zoomAt * fps) / Math.max(1, durationInFrames - zoomAt * fps));
    cy = 0.5 + (interpolate(t, [0, 1], [0.22, 0.78]) - 0.5) * z;
  }
  const yShift = caption && focus ? height * 0.07 * z : 0; // room for the caption at the top (subtitles use the bottom)
  const draw = ease((f - (zoomAt + 1.2) * fps) / (0.8 * fps));
  const capP = spring({ frame: f - (zoomAt + 1.6) * fps, fps, config: { damping: 14 } });
  const per = 2 * (focus ? focus.w * W0 + focus.h * H0 : 0);
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 40%, #2a3448, #0d1320 75%)', overflow: 'hidden', fontFamily: SANS }}>
      <div style={{
        position: 'absolute', left: width / 2 - W0 / 2, top: height / 2 - H0 / 2, width: W0, height: H0,
        transformOrigin: `${cx * 100}% ${cy * 100}%`,
        transform: `translate(${(0.5 - cx) * W0}px, ${(0.5 - cy) * H0 + yShift + (1 - inP) * 120 * u}px) scale(${s * (0.92 + 0.08 * inP)}) rotate(${(1 - z) * -1.2}deg)`,
        opacity: inP, boxShadow: `0 ${30 * u}px ${80 * u}px rgba(0,0,0,.55)`, background: '#fff',
      }}>
        {image && <Img src={media(image)!} style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }} />}
        {focus && (
          <svg style={{ position: 'absolute', left: `${focus.x * 100}%`, top: `${focus.y * 100}%`, width: `${focus.w * 100}%`, height: `${focus.h * 100}%`, overflow: 'visible' }}>
            <rect x={0} y={0} width="100%" height="100%" fill={`${accent}14`} stroke={accent} strokeWidth={6 / s} rx={6 / s}
              strokeDasharray={per} strokeDashoffset={per * (1 - draw)} opacity={draw > 0 ? 1 : 0} />
          </svg>
        )}
        {focus && <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,.35)', opacity: 0.9 * draw, clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${focus.y * 100}%, ${focus.x * 100}% ${focus.y * 100}%, ${focus.x * 100}% ${(focus.y + focus.h) * 100}%, ${(focus.x + focus.w) * 100}% ${(focus.y + focus.h) * 100}%, ${(focus.x + focus.w) * 100}% ${focus.y * 100}%, 0 ${focus.y * 100}%)` }} />}
      </div>
      {(caption || kicker) && (
        <div style={{ position: 'absolute', left: 60 * u, right: 60 * u, top: height * 0.045, display: 'flex', justifyContent: 'center', opacity: caption ? capP : inP, transform: `translateY(${(1 - (caption ? capP : inP)) * -40 * u}px)` }}>
          <div style={{ background: 'rgba(255,255,255,.96)', color: '#0f172a', borderLeft: `${10 * u}px solid ${accent}`, borderRadius: 18 * u, padding: `${18 * u}px ${30 * u}px`, boxShadow: '0 20px 50px rgba(0,0,0,.4)', maxWidth: 1500 * u }}>
            {kicker && <div style={{ fontSize: 24 * u, fontWeight: 800, letterSpacing: 2 * u, color: '#b45309', marginBottom: caption ? 6 * u : 0 }}>{kicker}</div>}
            {caption && <div style={{ fontSize: 40 * u, fontWeight: 700, lineHeight: 1.3 }}><Hi text={caption} color="#b45309" /></div>}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

/** Opening card for a document: a stack of pages (cover = `image`, e.g. page 1) + title, subtitle, author/source. Scene. */
export const DocTitle: React.FC<{ title?: string; subtitle?: string; kicker?: string; meta?: string; image?: string; accent?: string; theme?: Theme }> = ({
  title = 'Tên tài liệu', subtitle = '', kicker = 'TÓM TẮT TÀI LIỆU', meta = '', image = '', accent = '#2563eb', theme = 'dark',
}) => {
  useFonts();
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait } = useUnit();
  const T = THEMES[theme] || THEMES.dark;
  const dp = spring({ frame: f, fps, config: { damping: 14, mass: 0.9 } });
  const fan = ease((f - 8) / 22);
  const tp = (d: number) => spring({ frame: f - d, fps, config: { damping: 15 } });
  const pw = (portrait ? 430 : 400) * u, ph = pw * 1.36;
  const sheet = (k: number) => (
    <div key={k} style={{ position: 'absolute', inset: 0, background: '#fff', borderRadius: 10 * u, boxShadow: '0 20px 50px rgba(0,0,0,.35)', transform: `rotate(${(k - 1) * 7 * fan}deg) translate(${(k - 1) * 26 * u * fan}px, ${Math.abs(k - 1) * 10 * u * fan}px)`, overflow: 'hidden' }}>
      {k === 1 && (image
        ? <Img src={media(image)!} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
        : <div style={{ padding: 40 * u, display: 'flex', flexDirection: 'column', gap: 16 * u }}>
          <div style={{ height: 26 * u, width: '70%', background: accent, borderRadius: 6 * u }} />
          {[92, 85, 96, 70, 88, 94, 60, 90, 82].map((w, i) => <div key={i} style={{ height: 12 * u, width: `${w}%`, background: '#e2e8f0', borderRadius: 6 * u }} />)}
        </div>)}
    </div>
  );
  return (
    <AbsoluteFill style={{ background: `linear-gradient(150deg, ${T.bg}, ${T.bg2})`, fontFamily: SANS, color: T.text, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', width: 1100 * u, height: 1100 * u, borderRadius: '50%', left: portrait ? '50%' : '22%', top: portrait ? '30%' : '50%', marginLeft: -550 * u, marginTop: -550 * u, background: `radial-gradient(circle, ${accent}40, transparent 62%)` }} />
      <div style={{ display: 'flex', flexDirection: portrait ? 'column' : 'row', alignItems: 'center', gap: (portrait ? 90 : 110) * u, padding: `0 ${100 * u}px`, maxWidth: '100%' }}>
        <div style={{ position: 'relative', width: pw, height: ph, flex: 'none', opacity: dp, transform: `translateY(${(1 - dp) * 120 * u}px) scale(${0.85 + 0.15 * dp})` }}>
          {[0, 2, 1].map(sheet)}
        </div>
        <div style={{ maxWidth: portrait ? '100%' : 900 * u, textAlign: portrait ? 'center' : 'left' }}>
          {kicker && <div style={{ color: accent, fontWeight: 800, fontSize: 30 * u, letterSpacing: 5 * u, opacity: tp(12), marginBottom: 22 * u }}>{kicker}</div>}
          <div style={{ fontWeight: 900, fontSize: (portrait ? 82 : 76) * u, lineHeight: 1.12, opacity: tp(16), transform: `translateY(${(1 - tp(16)) * 40 * u}px)` }}><Hi text={title} color={accent} /></div>
          {subtitle && <div style={{ marginTop: 26 * u, fontSize: 40 * u, color: T.sub, lineHeight: 1.35, opacity: tp(26) }}>{subtitle}</div>}
          {meta && <div style={{ marginTop: 34 * u, display: 'inline-block', padding: `${10 * u}px ${22 * u}px`, borderRadius: 12 * u, background: T.card, fontSize: 28 * u, color: T.sub, opacity: tp(34) }}>{meta}</div>}
        </div>
      </div>
    </AbsoluteFill>
  );
};
