import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { mediaUrl } from './mediaUrl';

/** Wide photo in a vertical frame: fills the height and pans slowly sideways (with a gentle zoom). Main-track scene. */
export const PanPhoto: React.FC<{ src: string; aspect?: number; from?: number; to?: number; zoom?: number }> = ({
  src, aspect = 4 / 3, from = 0, to = 1, zoom = 1.06,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const p = interpolate(frame, [0, durationInFrames - 1], [0, 1], { extrapolateRight: 'clamp' });
  const ease = p * p * (3 - 2 * p);
  const imgW = height * aspect;
  const travel = Math.max(0, imgW - width);
  const x = -travel * (from + (to - from) * ease);
  const s = interpolate(p, [0, 1], [1, zoom]);
  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      <Img src={mediaUrl(src)!} style={{ position: 'absolute', top: 0, left: 0, height, width: imgW, objectFit: 'cover', transform: `translateX(${x}px) scale(${s})`, transformOrigin: 'center' }} />
    </AbsoluteFill>
  );
};
