import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

/** Thin progress bar along the top/bottom edge that fills over the clip — put it on an overlay spanning the video. */
export const ProgressBar: React.FC<{ color?: string; thickness?: number; position?: 'top' | 'bottom'; track?: string }> = ({
  color = '#f59e0b', thickness = 10, position = 'bottom', track = 'rgba(255,255,255,0.15)',
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = Math.min(1, frame / Math.max(1, durationInFrames - 1));
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, [position]: 0, height: thickness, background: track }}>
        <div style={{ width: `${p * 100}%`, height: '100%', background: color, boxShadow: `0 0 ${thickness * 1.5}px ${color}` }} />
      </div>
    </AbsoluteFill>
  );
};
