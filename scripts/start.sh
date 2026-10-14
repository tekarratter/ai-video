#!/usr/bin/env bash
# Start (or restart) AI Video Studio in a detached tmux session "ai-video-server".
#   scripts/start.sh            → dev mode (Vite HMR: custom motion components update live)
#   tmux attach -t ai-video-server   → xem log   (thoát: Ctrl+b rồi d)
set -e
cd "$(dirname "$0")/.."
export PATH="/home/tk2/.nvm/versions/node/v24.21.0/bin:$HOME/.local/bin:$PATH"
SESSION=${SERVER_SESSION:-ai-video-server}

# Don't kill a running render/import/upload job (they cannot resume). Override with --force.
if [ "$1" != "--force" ]; then
  busy=$(curl -s --max-time 3 "http://localhost:${PORT:-3001}/api/jobs" 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const b = JSON.parse(s).filter((j) => !["done", "error"].includes(j.stage)); if (b.length) console.log(b.map((j) => `${j.label} (${j.stage})`).join("; ")); } catch {}
    });' 2>/dev/null)
  if [ -n "$busy" ]; then
    echo "Đang có tác vụ chạy: $busy"
    echo "Đợi xong rồi chạy lại, hoặc: $0 --force"
    exit 1
  fi
fi
tmux kill-session -t "=$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -c "$PWD" "export PATH='$PATH'; npm run dev 2>&1 | tee -a logs/server.log"
echo "Started in tmux session '$SESSION'. Logs: tmux attach -t $SESSION  (or logs/server.log)"
