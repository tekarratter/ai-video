# AI Video Studio trên Windows

Bản chạy cho Windows 10/11 trên **máy chỉ có CPU**: không cần GPU, CUDA, WSL, Docker hay tmux.

## Chạy bằng một lệnh

```bat
ai-video.bat
```

Lần đầu, lệnh này tự cài mọi thứ. Từ lần sau nó chạy luôn:

- **Server** ở `http://localhost:3001`.
- **Giao diện** ở `http://localhost:5180`, trình duyệt tự mở.

Bấm `Ctrl+C` để dừng. Log ghi vào `logs\server.log` (UTF-8).

| Lệnh | Việc làm |
|---|---|
| `ai-video.bat` | Cài nếu cần, rồi chạy (dev: tự nạp lại khi sửa code) |
| `ai-video.bat -Test` | Chạy thử với dữ liệu mẫu nhỏ. Không động vào `workspace\` thật |
| `ai-video.bat -Setup` | Cài lại phụ thuộc (sau `git pull`) |
| `ai-video.bat -NoBrowser` | Không tự mở trình duyệt |
| `ai-video.bat -Serve` | Chạy không theo dõi thay đổi code |

Có thể gọi script PowerShell trực tiếp:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\run.ps1 -Test
```

## Cần có sẵn

| Phần mềm | Cài bằng |
|---|---|
| Node.js ≥ 20 | `winget install OpenJS.NodeJS.LTS` |
| Python ≥ 3.9 | `winget install Python.Python.3.12` |
| ffmpeg | `winget install --id Gyan.FFmpeg -e` |

ffmpeg không cần nằm sẵn trong PATH. Script tự tìm ffmpeg ở các chỗ winget, scoop, choco hoặc `C:\ffmpeg\bin` thường cài vào.

## Script cài gì

`scripts\windows\setup.ps1` cài ba thứ:

1. **Gói npm**: `npm ci`.
2. **venv Python riêng** ở `.venv\`, theo `requirements-windows.txt`:
   - `faster-whisper`, chạy CPU bằng CTranslate2 int8. **Không cài torch, không cài CUDA.**
   - `av<17`: faster-whisper 1.2 lỗi với PyAV 17 trở lên (`metadata_errors`).
   - `Pillow` và `pillow-heif` để đổi ảnh HEIC.
   - `yt-dlp`.
3. **Chrome headless shell** cho Remotion render.

Không cài gì vào Python hệ thống.

## Script tối ưu gì cho Windows

- **UTF-8 ở mọi tầng.** Script đặt các thiết lập sau:
  - `chcp 65001`
  - `PYTHONUTF8=1` và `PYTHONIOENCODING=utf-8`
  - console và PowerShell pipe dùng UTF-8
  - các file `.ps1` lưu UTF-8 có BOM để PowerShell 5.1 đọc đúng tiếng Việt
- **Tên tệp có dấu**, ví dụ `đèn lồng Hội An.jpg`, dùng được ở mọi bước: nhập, ffmpeg, Whisper, render, sao lưu `.zip`.
  - `tar.exe` có sẵn của Windows bị crash khi nén tên không phải ASCII.
  - Vì vậy zip/unzip trên Windows chạy qua `tools\ziputil.py` (Python `zipfile`, tên UTF-8, chặn đường dẫn `..\`).
- **Giới hạn luồng CPU** tự tính theo máy. Đặt sẵn biến môi trường thì script giữ nguyên giá trị đó.

  | Biến | Mặc định | Ý nghĩa |
  |---|---|---|
  | `WHISPER_THREADS`, `OMP_NUM_THREADS` | số lõi vật lý | Luồng cho nhận dạng giọng nói |
  | `RENDER_CONCURRENCY` | ~ luồng/4, giới hạn theo RAM | Số tab Chrome render song song |
  | `PROXY_THREADS` | ½ số luồng | ffmpeg tạo bản xem trước |
  | `WHISPER_MODEL` | `small` | Đổi sang `tiny` hoặc `base` nếu máy chậm |

  ffmpeg chạy nền ở mức ưu tiên *Below normal* (Windows không có `nice`), nên giao diện vẫn mượt.
- **Đường dẫn Windows**:
  - venv nằm ở `Scripts\python.exe`, không phải `bin/python`.
  - `python3` chỉ có trên Linux/mac. Trên Windows dùng Python của `.venv`, hoặc `python`.
  - Font cho drawtext là `C:\Windows\Fonts\arial.ttf`.
- **Dự án** trỏ `workspace\media` và `workspace\exports` vào dự án đang mở. Trên Linux việc này dùng symlink. Trên Windows dùng **directory junction**, nên không cần quyền admin hay Developer Mode.

## Clone video mẫu

Trang chủ → **🎬 Clone video mẫu**: phân tích một video mẫu (cảnh, lời, nhịp, màu) ngay trên máy, chỉ dùng CPU, rồi lưu thành template. Xem [docs/CLONE-VIDEO.md](docs/CLONE-VIDEO.md).

## Khác với bản Linux

- **Panel chat Claude chạy Claude Code ở chế độ nền.** Bản Linux điều khiển Claude Code qua `tmux`. Windows không có tmux, nên server chạy `claude -p` (stream-json) và vẫn đọc transcript như bản Linux.
  - Cần Claude Code CLI. `setup` tự cài bằng `npm install -g @anthropic-ai/claude-code`.
  - Đăng nhập trong app: menu tài khoản → *Claude Code*. Dùng được tài khoản Claude, API key, hoặc token từ `claude setup-token`.
  - Không có nút xem terminal trực tiếp, và không có hộp thoại hỏi quyền. Claude chỉ chạy được các lệnh có trong `workspace\.claude\settings.json` (vedit, ffmpeg, ffprobe…). Lệnh khác bị từ chối, và việc từ chối hiện trong khung chat.
  - Lần đầu chạy, app đánh dấu thư mục `workspace\` là tin cậy trong `%USERPROFILE%\.claude.json` (bản Linux hỏi việc này trong terminal). Thiếu bước này, Claude bỏ qua danh sách quyền của workspace.
  - Vẫn có thể mở Claude Code (CLI hoặc app desktop) trong `workspace\`, hoặc kết nối qua **MCP**: menu tài khoản → *Kết nối Claude (MCP)*, xem [docs/MCP.md](docs/MCP.md).
- **Giọng đọc AI (VieNeu/Kokoro)**: nếu chưa có `.venv-tts`, script tự dùng VieNeu-TTS đã cài ở `C:\Claude\tools\vieneu-tts` (đặt `TTS_PYTHON` và `HF_HOME` tới đó; đổi chỗ bằng `VIENEU_DIR`). Giọng tiếng Anh (Kokoro) cần thêm `kokoro-onnx`.
- **Đọc PDF/Word**:
  - `.docx` đọc được ngay.
  - PDF cần poppler (`pdftotext`, `pdfimages`, `pdftoppm`) trong PATH.
  - `.doc` và `.pptx` cần LibreOffice (`soffice`).

## Chạy thử (`ai-video.bat -Test`)

Lệnh này tạo workspace tạm ở `.smoke-thử nghiệm\` trong repo (đã nằm trong `.gitignore`). Dữ liệu mẫu và log server nằm ở `%TEMP%\ai-video thử nghiệm\`. Sau đó lệnh kiểm tra lần lượt:

1. Server khởi động.
2. Nhập ảnh, giọng đọc và video có tên tiếng Việt.
3. ffmpeg lấy khung hình và tạo bảng khung hình có chữ.
4. Whisper nhận dạng giọng tiếng Việt trên CPU, model `tiny`.
5. Remotion render nháp 4 giây ra MP4.
6. Sao lưu dự án ra `.zip`, giữ nguyên tên tiếng Việt.

Workspace thật không bị đụng tới.
