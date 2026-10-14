# AI Video Studio

Trình dựng video chạy trên Remotion, làm việc cùng **Claude Code**. Chat trên panel và chat trong CLI là **cùng một phiên**.

```
┌──────────────┬─────────────┬──────────────────────────┬─────────────┐
│ Claude Code  │ Compositions│        Preview           │ Inspector   │
│ (chat ⇄ CLI) │ Assets      │   (@remotion/player)     │ Jobs        │
│              │ Motion      │                          │             │
│              ├─────────────┴──────────────────────────┴─────────────┤
│              │ Timeline: layer, clip, chuyển cảnh, phụ đề, playhead │
└──────────────┴──────────────────────────────────────────────────────┘
```

## Chạy

```bash
npm install
npm run dev          # server :3001 + giao diện :5180  →  mở http://<máy>:5180
```

Chạy lâu dài trong tmux (khuyên dùng): `scripts/start.sh` → session `ai-video-server`
(xem log: `tmux attach -t ai-video-server` hoặc `logs/server.log`; chạy lại script để restart).

Tự chạy khi khởi động máy (systemd user service):

```bash
cp deploy/ai-video.service ~/.config/systemd/user/   # sửa WorkingDirectory/ExecStart/PATH nếu khác
loginctl enable-linger $USER                        # chạy cả khi chưa đăng nhập
systemctl --user daemon-reload && systemctl --user enable --now ai-video.service
```

Lần đầu, panel chat sẽ hiện hộp thoại "trust folder" của Claude Code cho thư mục `workspace/`. Bấm chọn ngay trên panel.

**Dùng chung CLI:** server chạy `claude` trong tmux session `ai-video`. Mở terminal và gõ:

```bash
tmux attach -t ai-video      # thoát mà không tắt Claude: Ctrl+b rồi d
```

Gõ ở terminal thì panel thấy, gõ ở panel thì terminal thấy. Panel còn có tab **Terminal** hiển thị chính màn hình CLI đó.

Biến môi trường: `PORT` (3001), `WEB_PORT` (5180), `TMUX_SESSION` (ai-video), `CLAUDE_ARGS` (ví dụ `--model opus`),
`CLAUDE_AUTOSTART=0` để không tự khởi động Claude, `WHISPER_MODEL` (small), `RENDER_CONCURRENCY` (2).

## Triển khai bằng Docker (kèm Claude Code)

Máy dev chạy trực tiếp bằng `scripts/start.sh`, không build Docker. Muốn triển khai lên máy chủ khác thì xem **[docs/DEPLOY-DOCKER.md](docs/DEPLOY-DOCKER.md)**. Tài liệu đó gồm: yêu cầu máy chủ, cài đặt, kết nối tài khoản Claude Code, sao lưu, HTTPS, cập nhật và xử lý sự cố.

```bash
git clone https://github.com/tekarratter/ai-video.git && cd ai-video && docker compose up -d --build
```

## Tính năng

- **Nội dung:** video, ảnh, nhạc (kéo thả hoặc tải file), **link YouTube/Vimeo/TikTok** (yt-dlp), motion graphic (component Remotion).
- **Tự chuyển định dạng khi nhập:** HEIC/TIFF → JPG, ảnh > 3840px được thu nhỏ, video HEVC/ProRes/10-bit/MOV → H.264 MP4
  (cạnh dài tối đa 1920px, đổi bằng `MAX_VIDEO_SIDE`). Upload chạy nền, xem tiến độ ở tab Jobs.
- **Timeline:** track `sequence` (clip nối tiếp, có chuyển cảnh fade/slide/wipe/flip/clock-wipe), `overlay` (text/ảnh/video/motion đặt tự do), `audio`, phụ đề.
  Kéo để di chuyển hoặc đổi thứ tự, kéo mép để trim, có snap. Phím: `S` cắt, `Delete` xoá, `Space` phát, `Ctrl+Z`/`Ctrl+Shift+Z`, `Ctrl+D` nhân bản.
- **Inspector:** form Schema/JSON cho từng clip, cài đặt khung hình (16:9, 9:16, 1:1…), phụ đề, các action.
- **AI (Claude Code):** sửa `project.json` hoặc viết component trong `workspace/custom/` → preview cập nhật ngay, Ctrl+Z để hoàn tác.
  Mỗi tin nhắn tự kèm ngữ cảnh UI (playhead, clip đang chọn). Có thể đính kèm ảnh/video vào chat.
- **Công cụ cho AI** (`tools/vedit.mjs`): `info`, `import <file|url>`, `frames`/`frame`/`still` (để Claude "nhìn" video),
  `transcribe` (faster-whisper), `silence`/`cut-silence`, `subtitles`, `scenes`, `render`, `validate`.
- **Đăng YouTube:** Jobs → Exports → ▶ YouTube (hoặc nút "Đăng YouTube" sau khi render). Lần đầu cần tạo OAuth client
  loại *Desktop app* trên Google Cloud (bật YouTube Data API v3) — hướng dẫn hiện ngay trong hộp thoại. Token lưu ở
  `~/.config/ai-video/youtube.json`. Project Google chưa qua audit của YouTube thì video đăng qua API bị khoá ở chế độ riêng tư.
- **Render:** Remotion (`@remotion/renderer`) ra MP4 trong `workspace/exports/`. Có chế độ nháp (½ độ phân giải).

## Cấu trúc

```
server/      Express + WebSocket, cầu nối Claude (tmux + đọc transcript), render
remotion/    Composition "Main" dựng timeline từ project.json
shared/      Model timeline dùng chung (web, remotion, tools), IO, tải URL
tools/       vedit.mjs (CLI cho Claude), transcribe.py
web/         Giao diện React (Vite)
workspace/   Thư mục làm việc của Claude: CLAUDE.md, project.json, media/, custom/, exports/
```

`npm run studio` mở Remotion Studio gốc để debug composition.

## Phụ thuộc hệ thống

`ffmpeg`, `tmux`, `claude` (Claude Code CLI), Python 3 + `faster-whisper`, `yt-dlp`
(`pip install --user faster-whisper yt-dlp pillow-heif`). Lần render đầu tiên Remotion sẽ tải Chrome headless shell.

## Giấy phép Remotion

Remotion miễn phí cho cá nhân và công ty dưới 4 người. Với tổ chức lớn hơn cần mua
[company license](https://remotion.pro/license).
