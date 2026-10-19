#!/usr/bin/env node
// Renders the preset portraits shown in the "Nhân vật" panel: web/public/characters/<preset>.png
// Usage: node tools/characters.mjs [preset…]
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'web/public/characters');
const src = fs.readFileSync(path.join(ROOT, 'workspace/custom/tpl/Character3D.tsx'), 'utf8');
const all = [...src.matchAll(/^ {2}(\w+): \{ label: '/gm)].map((m) => m[1]);
const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const ids = want.length ? want : all;
fs.mkdirSync(OUT, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.join(ROOT, 'remotion', 'index.ts'), webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, alias: { ...(c.resolve?.alias || {}), '@custom': path.join(ROOT, 'workspace', 'custom') } } }) });
for (const preset of ids) {
  const inputProps = { preset, background: 'stage', enter: 'none', action: 'idle', expression: 'smile', y: 0.97, size: 0.92 };
  const comp = await selectComposition({ serveUrl, id: 'Character3D', inputProps });
  await renderStill({ serveUrl, composition: { ...comp, width: 240, height: 240 }, inputProps, frame: 20, output: path.join(OUT, `${preset}.png`) });
  console.log('✓', preset);
}
