#!/usr/bin/env bash
# Container start: refresh the workspace instructions from the image, pre-accept Claude Code's
# first-run screens for /app/workspace, then run the app.
set -e
TPL=/app/workspace-template
WS=/app/workspace
mkdir -p "$WS/custom" "$WS/.claude" "$HOME/.config/ai-video"

# instructions + permissions always follow the image version
cp "$TPL/CLAUDE.md" "$WS/CLAUDE.md"
cp "$TPL/.claude/settings.json" "$WS/.claude/settings.json"

# motion components: add new files and update the ones still identical to what an earlier image shipped;
# files edited in the workspace (by the user or Claude) are kept. Known shipped versions: .image-sums (last start)
# + docker/custom-history.sums (every committed version, from scripts/custom-history.mjs).
SUMS="$WS/custom/.image-sums"
HIST=/app/docker/custom-history.sums
touch "$SUMS"
NEW=$(mktemp)
(cd "$TPL/custom" && find . -type f ! -name .image-sums -print0 | sort -z | xargs -0 -r sha1sum) > "$NEW"
while read -r sum file; do
  dest="$WS/custom/$file"
  if [ ! -e "$dest" ]; then
    mkdir -p "$(dirname "$dest")" && cp "$TPL/custom/$file" "$dest"
  else
    cur=$(sha1sum "$dest" | cut -d' ' -f1)
    if [ "$cur" != "$sum" ]; then
      if grep -qsxF "$cur  $file" "$SUMS" "$HIST"; then cp "$TPL/custom/$file" "$dest"
      else echo "custom/${file#./}: edited in the workspace, keeping it (image version not applied)"; fi
    fi
  fi
done < "$NEW"
mv "$NEW" "$SUMS"

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
