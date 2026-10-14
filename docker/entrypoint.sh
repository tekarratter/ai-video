#!/usr/bin/env bash
# Container start: refresh the workspace instructions from the image, pre-accept Claude Code's
# first-run screens for /app/workspace, then run the app.
set -e
TPL=/app/workspace-template
WS=/app/workspace
mkdir -p "$WS/custom" "$WS/.claude" "$HOME/.config/ai-video"

# instructions + permissions always follow the image version; motion components are only added, never overwritten
cp "$TPL/CLAUDE.md" "$WS/CLAUDE.md"
cp "$TPL/.claude/settings.json" "$WS/.claude/settings.json"
cp -rn "$TPL/custom/." "$WS/custom/" 2>/dev/null || true

node - <<'JS'
const fs = require('fs'), path = require('path');
const file = path.join(process.env.HOME, '.claude.json');
let j = {};
try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
j.hasCompletedOnboarding = true;
j.theme ??= 'dark';
j.projects ??= {};
const p = (j.projects['/app/workspace'] ??= {});
p.hasTrustDialogAccepted = true;
p.hasCompletedProjectOnboarding = true;
fs.writeFileSync(file, JSON.stringify(j, null, 2));
JS

exec "$@"
