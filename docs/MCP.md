# Kết nối Claude qua MCP

App có sẵn một **MCP server**. Nhờ nó, Claude ở nơi khác điều khiển được app: Claude Code trong terminal, Claude Desktop,
claude.ai trên web, hoặc bất kỳ ứng dụng nào hỗ trợ MCP. Claude có thể:

- **Tạo video tự động** từ tài liệu Word/PDF, link bài viết, đoạn văn hoặc chủ đề (`make_video`). Việc này được giao cho
  Claude dựng phim trong app, giống như bấm nút trong giao diện.
- **Nhờ Claude trong app sửa phim** bằng lời (`ask_editor`, rồi `editor_reply` để chờ kết quả).
- **Tự dựng:** đọc và ghi `project.json`, tải file lên, nhập từ link, đọc tài liệu / bài viết, thêm giọng đọc AI, nhạc nền.
- **Xem khung hình** (`preview_frame` trả về ảnh), **render** (`render_video` rồi `job_status`) và **lấy link tải MP4**
  (link có chữ ký, hết hạn sau 24 giờ).

Mọi thay đổi hiện ngay trong editor của người đang mở app, và Ctrl+Z hoàn tác được như bình thường.

## 1. Tạo token

Đăng nhập bằng tài khoản **admin**, mở menu tài khoản (góc trên phải), chọn **Kết nối Claude (MCP)**, rồi bấm **Tạo token**.
Token chỉ hiện **một lần**. Hộp thoại có sẵn các dòng cấu hình để chép.

Token có toàn quyền điều khiển app, nên giữ kín. Token nào bị lộ thì bấm **Thu hồi** trong cùng hộp thoại.
Danh sách token lưu ở `~/.config/ai-video/mcp.json` (file chỉ lưu mã băm, không lưu token gốc).

## 2. Thêm vào Claude

Trong các ví dụ dưới, `https://video.example.com` là địa chỉ bạn dùng để mở app.

**Claude Code (terminal):**

```bash
claude mcp add --transport http ai-video https://video.example.com/mcp --header "Authorization: Bearer aivmcp_…"
```

**claude.ai / Claude Desktop:** vào Cài đặt → Connectors → **Add custom connector**, dán URL có token:

```
https://video.example.com/mcp/t/aivmcp_…
```

**Ứng dụng MCP khác** (dùng Streamable HTTP, gửi token trong header):

```json
{ "mcpServers": { "ai-video": { "type": "http", "url": "https://video.example.com/mcp",
  "headers": { "Authorization": "Bearer aivmcp_…" } } } }
```

**Claude chạy ngay trên máy chủ của app** (qua stdio, không cần token):

```bash
claude mcp add ai-video -- node /đường-dẫn/ai-video/mcp/stdio.mjs
```

Nếu app không chạy ở cổng 3001, đặt thêm biến `AI_VIDEO_SERVER=http://127.0.0.1:<cổng>`.

## 3. Thử

- “Dùng ai-video tạo video 2 phút, giọng nữ tiếng Việt, từ file PDF này: https://…/bao-cao.pdf”
- “Xem khung hình giây 12 rồi nhờ editor đổi màu nhấn sang xanh lá”
- “Render bản nháp rồi gửi link tải”

## 4. Danh sách công cụ

| Nhóm | Công cụ |
|---|---|
| Tổng quan | `app_status`, `list_projects`, `open_project`, `create_project` |
| Giao việc cho Claude trong app | `make_video`, `ask_editor`, `editor_reply`, `editor_choose` |
| Dự án | `project_summary`, `get_project_json`, `save_project_json` |
| Nội dung | `upload_file` (base64, ≤ 40 MB), `import_url` (YouTube…, link PDF/DOCX, Google Drive), `read_document`, `read_article` |
| Âm thanh | `list_voices`, `add_voiceover`, `search_music`, `add_music` |
| Kết quả | `preview_frame`, `render_video`, `job_status`, `list_exports` |

## 5. Ghi chú kỹ thuật

- **Endpoint:** `POST /mcp` (token trong header `Authorization: Bearer`) hoặc `POST /mcp/t/<token>`. Server chạy kiểu
  stateless và trả JSON, không dùng SSE, nên đi qua được Cloudflare tunnel và các reverse proxy.
- **Việc dài chạy nền:** render, dựng video và đọc giọng không chạy hết trong một lần gọi. Mỗi lần gọi chờ tối đa
  khoảng 50 giây, vì client MCP thường bỏ cuộc sau 60 giây. Chưa xong thì kết quả trả về `job_id` hoặc trạng thái
  `working`, và Claude gọi `job_status` hoặc `editor_reply` để chờ tiếp.
- **Phạm vi:** các công cụ gọi API của app trên localhost và lệnh `vedit`, nên tác dụng giống hệt khi người dùng thao tác
  trong app. Chúng luôn làm việc trên **dự án đang mở**.
- **Mã nguồn:** `mcp/server.mjs` (danh sách công cụ, token, đường dẫn `/mcp`) và `mcp/stdio.mjs`.
