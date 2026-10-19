// Shared helpers for the template components (news, dialogue, whiteboard, business…).
import { useState } from 'react';
import { continueRender, delayRender, getInputProps, useVideoConfig } from 'remotion';

export const SANS = '"Be Vietnam Pro", Inter, Arial, sans-serif';
export const SERIF = '"Playfair Display", Georgia, serif';
export const HAND = '"Patrick Hand", "Itim", "Comic Sans MS", cursive';
export const MARKER = '"Itim", "Patrick Hand", "Comic Sans MS", cursive';

// Vietnamese-capable Google fonts (sans, serif, two handwriting faces)
const HREF = 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700;800;900'
  + '&family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Patrick+Hand&family=Itim&subset=vietnamese&display=block';
if (typeof document !== 'undefined' && !document.querySelector(`link[href="${HREF}"]`)) {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = HREF;
  document.head.appendChild(l);
}
let ready: Promise<unknown> | null = null;
const loadAll = () => (ready ??= Promise.race([
  Promise.all(['700 40px "Be Vietnam Pro"', '900 40px "Be Vietnam Pro"', '900 40px "Playfair Display"', '400 40px "Patrick Hand"', '400 40px "Itim"']
    .map((f) => document.fonts.load(f, 'Ầ ỗ ữ ặ'))),
  new Promise((r) => setTimeout(r, 8000)), // offline: fall back instead of hanging the render
]));
/** Hold the frame until the fonts are loaded (renders never show the fallback font). */
export const useFonts = () => {
  useState(() => {
    if (typeof document === 'undefined') return;
    const h = delayRender('Loading template fonts');
    loadAll().then(() => continueRender(h), () => continueRender(h));
  });
};

/** "/media/x.jpg" → URL the renderer can load (mediaBase); http(s) URLs pass through. */
export const media = (src?: string) => {
  if (!src || /^(https?:|data:|blob:)/.test(src)) return src;
  let base = '';
  try { base = ((getInputProps() as any)?.mediaBase as string) || ''; } catch { /* preview */ }
  return base + (src.startsWith('/') ? src : `/${src}`);
};

/** Size unit: 1 = 1px on a 1080-wide (short side) frame, so layouts scale with 16:9, 9:16 and 1:1. */
export const useUnit = () => {
  const { width, height } = useVideoConfig();
  return { u: Math.min(width, height) / 1080, width, height, portrait: height > width * 1.1 };
};

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const ease = (x: number) => { const t = clamp01(x); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

/** Deterministic pseudo-random in [0,1) (renders must be identical frame to frame). */
export const rand = (seed: number) => { const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

/** Split "text with *highlight*" into parts. */
export const parts = (s: string) => String(s || '').split(/(\*[^*]+\*)/).filter(Boolean).map((p) => (p.startsWith('*') && p.endsWith('*') ? { t: p.slice(1, -1), hi: true } : { t: p, hi: false }));
