# AI Video Studio — editor + Remotion renderer + Claude Code (+ optional Vietnamese/English TTS).
#   docker compose up -d --build        →  http://<host>:5180   (admin / Hoang2026, đổi ngay)
# Build args:
#   WITH_TTS=1   VieNeu-TTS (tiếng Việt) + Kokoro (English) — thêm ~1.5 GB
#   CLAUDE_CODE_VERSION=latest
FROM node:24-bookworm-slim

ARG WITH_TTS=1
ARG CLAUDE_CODE_VERSION=latest

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Ho_Chi_Minh \
    TERM=xterm-256color \
    LANG=C.UTF-8 \
    PATH=/opt/venv/bin:$PATH \
    TTS_PYTHON=/opt/venv/bin/python \
    YTDLP=/opt/venv/bin/yt-dlp \
    KOKORO_DIR=/opt/models/kokoro \
    HF_HOME=/opt/hf \
    HF_HUB_DISABLE_PROGRESS_BARS=1 \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1

# system tools + libraries for the headless Chrome used by Remotion + fonts with Vietnamese glyphs
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini tmux ffmpeg zip unzip curl ca-certificates git procps \
      python3 python3-venv python3-pip \
      fonts-noto-core fonts-noto-color-emoji fonts-dejavu-core fontconfig \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 \
      libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 libdrm2 libxshmfence1 libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*

# Python: HEIC conversion, Whisper, yt-dlp, Google Drive downloads (+ TTS)
RUN python3 -m venv /opt/venv \
    && pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir pillow pillow-heif faster-whisper yt-dlp gdown \
    && if [ "$WITH_TTS" = "1" ]; then \
         pip install --no-cache-dir vieneu kokoro-onnx soundfile \
         && mkdir -p $KOKORO_DIR \
         && base=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0 \
         && curl -fsSL -o $KOKORO_DIR/kokoro-v1.0.int8.onnx $base/kokoro-v1.0.int8.onnx \
         && curl -fsSL -o $KOKORO_DIR/voices-v1.0.bin $base/voices-v1.0.bin \
         && python -c "from vieneu import Vieneu; Vieneu()" ; \
       fi \
    && mkdir -p $HF_HOME && chown -R node:node $HF_HOME /opt/venv

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force

COPY --chown=node:node . .
# Chrome for Remotion rendering, downloaded at build time
RUN npx remotion browser ensure \
    && mv workspace workspace-template && mkdir -p workspace logs library/music

ENV PORT=3001 WEB_PORT=5180
EXPOSE 5180
VOLUME ["/app/workspace", "/home/node", "/app/library/music"]
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/entrypoint.sh"]
CMD ["npm", "run", "serve"]
