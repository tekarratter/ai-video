import { getInputProps } from 'remotion';

/** Resolve "/media/x.jpg" against the renderer's mediaBase (relative paths work in the editor preview). */
export const mediaUrl = (src?: string) => {
  if (!src || /^https?:/.test(src)) return src;
  let base = '';
  try { base = ((getInputProps() as any)?.mediaBase as string) || ''; } catch { /* preview */ }
  return base + src;
};
