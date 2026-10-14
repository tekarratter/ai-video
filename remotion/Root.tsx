import React from 'react';
import { Composition } from 'remotion';
import { Main, mainMetadata } from './Main';
import { components } from '@custom';
import { emptyProject } from '../shared/timeline.js';

export const Root: React.FC = () => (
  <>
    <Composition
      id="Main"
      component={Main}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={300}
      defaultProps={{ project: emptyProject(), mediaBase: 'http://localhost:3001' }}
      calculateMetadata={mainMetadata}
    />
    {Object.entries(components).map(([name, C]) => (
      <Composition
        key={name}
        id={name.replace(/[^a-zA-Z0-9-]/g, '-')}
        component={C as React.FC<Record<string, unknown>>}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={150}
        defaultProps={{}}
      />
    ))}
  </>
);
