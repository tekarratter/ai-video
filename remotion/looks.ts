// Colour looks for image/video clips (`clip.look`). Plain CSS filters on the media element — render-safe.
export const LOOKS: Record<string, { label: string; filter: string }> = {
  sepia: { label: 'Sepia (ảnh cũ)', filter: 'sepia(0.85) contrast(1.05) brightness(0.98)' },
  bw: { label: 'Đen trắng', filter: 'grayscale(1) contrast(1.15)' },
  'bw-soft': { label: 'Đen trắng dịu', filter: 'grayscale(1) contrast(0.9) brightness(1.08)' },
  vintage: { label: 'Vintage', filter: 'sepia(0.45) saturate(0.75) contrast(0.92) brightness(1.05) hue-rotate(-8deg)' },
  faded: { label: 'Phai màu (film 80s)', filter: 'saturate(0.6) contrast(0.85) brightness(1.1)' },
  polaroid: { label: 'Polaroid', filter: 'sepia(0.25) saturate(1.3) contrast(0.9) brightness(1.08) hue-rotate(-10deg)' },
  kodak: { label: 'Kodachrome', filter: 'saturate(1.45) contrast(1.15) sepia(0.15)' },
  warm: { label: 'Ấm', filter: 'sepia(0.25) saturate(1.2) hue-rotate(-12deg)' },
  cool: { label: 'Lạnh', filter: 'saturate(0.9) hue-rotate(15deg) brightness(1.03)' },
  dramatic: { label: 'Kịch tính', filter: 'contrast(1.35) saturate(1.15) brightness(0.92)' },
  noir: { label: 'Noir', filter: 'grayscale(1) contrast(1.6) brightness(0.85)' },
  spooky: { label: 'Rùng rợn (Halloween)', filter: 'saturate(0.55) hue-rotate(200deg) contrast(1.2) brightness(0.8)' },
};
export const LOOK_OPTIONS = ['', ...Object.keys(LOOKS)];

/** CSS filter for a clip look preset. */
export function lookFilter(look?: string): string | undefined {
  return look ? LOOKS[look]?.filter : undefined;
}
