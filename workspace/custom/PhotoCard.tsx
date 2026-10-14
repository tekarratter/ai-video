import React from 'react';
import { mediaUrl } from './mediaUrl';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

/** Landscape photo in a vertical frame: blurred fill background + whole photo with slow zoom. Main-track scene. */
export const PhotoCard: React.FC<{ src: string; zoomFrom?: number; zoomTo?: number; pan?: number }> = ({ src, zoomFrom = 1, zoomTo = 1.12, pan = 0 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = frame / Math.max(1, durationInFrames - 1);
  const z = interpolate(p, [0, 1], [zoomFrom, zoomTo]);
  return (
    <AbsoluteFill style={{ background: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <Img src={mediaUrl(src)!} style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(40px) brightness(0.6)', transform: 'scale(1.2)' }} />
      <div style={{ width: '100%', aspectRatio: '16 / 10', overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.6)' }}>
        <Img src={mediaUrl(src)!} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${z}) translateX(${pan * p * 10}%)` }} />
      </div>
    </AbsoluteFill>
  );
};
