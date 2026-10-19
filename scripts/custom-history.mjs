#!/usr/bin/env node
// Writes docker/custom-history.sums: sha1 of every version of workspace/custom/* ever committed.
// docker/entrypoint.sh updates a workspace file only when it still matches one of these (never edited),
// so existing Docker volumes get fixed components without losing the user's own edits.
// Re-run before building an image: node scripts/custom-history.mjs
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

const git = (...a) => execFileSync('git', a, { encoding: 'buffer', maxBuffer: 1 << 28 });
const lines = new Set();
for (const commit of git('log', '--format=%H', '--', 'workspace/custom').toString().split('\n').filter(Boolean)) {
  for (const row of git('ls-tree', '-r', commit, '--', 'workspace/custom').toString().split('\n').filter(Boolean)) {
    const [meta, file] = row.split('\t');
    const blob = meta.split(' ')[2];
    const sum = crypto.createHash('sha1').update(git('cat-file', 'blob', blob)).digest('hex');
    lines.add(`${sum}  ./${file.replace('workspace/custom/', '')}`);
  }
}
fs.writeFileSync('docker/custom-history.sums', [...lines].sort().join('\n') + '\n');
console.log(lines.size, 'versions');
