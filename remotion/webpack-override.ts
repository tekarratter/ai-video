import path from 'node:path';
import type { WebpackOverrideFn } from '@remotion/bundler';

const root = path.resolve(process.env.AI_VIDEO_ROOT || process.cwd());

export const webpackOverride: WebpackOverrideFn = (config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...(config.resolve?.alias || {}),
      '@custom': path.join(root, 'workspace', 'custom'),
    },
  },
});
