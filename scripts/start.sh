#!/usr/bin/env bash
# Start (or restart) AI Video Studio in a detached tmux session "ai-video-server".
#   scripts/start.sh            → dev mode (Vite HMR: custom motion components update live)
#   tmux attach -t ai-video-server   → xem log   (thoát: Ctrl+b rồi d)
set -e
cd "$(dirname "$0")/.."
export PATH="/home/tk2/.nvm/versions/node/v24.21.0/bin:$HOME/.local/bin:$PATH"
SESSION=${SERVER_SESSION:-ai-video-server}
tmux kill-session -t "=$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -c "$PWD" "export PATH='$PATH'; npm run dev 2>&1 | tee -a logs/server.log"
echo "Started in tmux session '$SESSION'. Logs: tmux attach -t $SESSION  (or logs/server.log)"
