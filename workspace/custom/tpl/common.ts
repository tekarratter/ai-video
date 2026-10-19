// Shared helpers for the template components (news, dialogue, whiteboard, business…).
import { getInputProps, useVideoConfig } from 'remotion';

// Vietnamese-capable fonts — loaded in one place (remotion/vnFonts.ts, files in the repo)
export { VN_SANS as SANS, VN_SERIF as SERIF, VN_HAND as HAND, VN_MARKER as MARKER, useVnFonts as useFonts } from '../../../remotion/vnFonts';

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
