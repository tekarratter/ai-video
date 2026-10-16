# Triển khai AI Video Studio bằng Docker

Hướng dẫn cài app lên **máy chủ triển khai** (không phải máy dev). Image đóng gói sẵn:

- Editor (web) và server
- Remotion + Chrome để render, ffmpeg
- Whisper (phụ đề), yt-dlp (tải link YouTube…), gdown (tải thư mục Google Drive)
- **Claude Code CLI**: mỗi nơi triển khai đăng nhập bằng tài khoản Claude của riêng mình
- Giọng đọc AI: VieNeu-TTS (tiếng Việt) và Kokoro (tiếng Anh), có thể tắt

---

## 1. Yêu cầu máy chủ

| | Tối thiểu | Khuyến nghị |
|---|---|---|
| CPU | 4 nhân x86_64 | 8 nhân trở lên |
| RAM | 8 GB | 16–32 GB (render nhanh hơn, tránh lỗi thiếu RAM) |
| Ổ đĩa | 20 GB trống | 50 GB+ (media và video xuất) |
| Hệ điều hành | Linux có Docker Engine 24+ và Docker Compose v2 | Ubuntu 22.04/24.04 |

### Cài Docker (Ubuntu)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER     # đăng xuất rồi đăng nhập lại để có hiệu lực
docker compose version            # phải in ra phiên bản v2.x
```

---

## 2. Cài đặt

```bash
git clone https://github.com/tekarratter/ai-video.git
cd ai-video

# (tuỳ chọn) đặt mật khẩu admin cho lần chạy đầu
echo "AIV_ADMIN_PASSWORD=MatKhauManh2026" > .env

docker compose up -d --build      # lần đầu mất khoảng 10–20 phút (tải Chrome, model giọng đọc…)
docker compose logs -f            # xem log, Ctrl+C để thoát
```

Mở trình duyệt: **http://<địa-chỉ-máy-chủ>:5180**

### Máy chủ không có mạng ra GitHub / muốn build một lần, chạy nhiều nơi

Build image ở một máy có Docker rồi chép sang máy chủ:

```bash
# máy build
docker compose build
docker save ai-video:latest | gzip > ai-video-image.tgz
scp ai-video-image.tgz docker-compose.yml user@may-chu:~/ai-video/

# máy chủ
cd ~/ai-video
gunzip -c ai-video-image.tgz | docker load
docker compose up -d --no-build
```

- Đăng nhập lần đầu bằng `admin` / mật khẩu trong `.env`. Nếu không đặt, mật khẩu mặc định là `Hoang2026`.
- App sẽ yêu cầu **đổi mật khẩu** ngay.
- Thêm tài khoản cho người khác: menu tài khoản (góc trên phải) → **Quản lý tài khoản**.

---

## 3. Kết nối Claude Code (tài khoản Claude của bạn)

Phần chat AI chỉ hoạt động sau khi admin kết nối tài khoản Claude. Vào menu tài khoản → **Tài khoản Claude Code**, rồi chọn **một** trong ba cách:

### Cách 1: Đăng nhập Claude (gói Pro / Max)
1. Bấm **Lấy link đăng nhập**. Một tab mới mở ra trang đăng nhập của Claude.
2. Đăng nhập và bấm **Authorize**.
3. Trang hiện ra một **mã (code)**. Copy mã, dán vào ô trong app rồi bấm **Xác nhận**.

Nếu muốn dùng tài khoản Anthropic Console (trả theo lượng dùng), bấm "…hoặc bằng tài khoản Console".

### Cách 2: Token dài hạn (gói Pro / Max)
1. Trên máy bất kỳ đã cài Claude Code, chạy `claude setup-token` rồi đăng nhập.
2. Copy token dạng `sk-ant-oat01-…`, dán vào tab **Token dài hạn** và bấm **Lưu**. Token có hiệu lực khoảng 1 năm.

### Cách 3: API key (Anthropic Console, trả theo lượng dùng)
1. Tạo key tại https://console.anthropic.com/settings/keys.
2. Dán key dạng `sk-ant-api03-…` vào tab **API key** và bấm **Lưu**.

**Thông tin thêm:**
- Kết nối xong, ô chat bên trái hoạt động ngay.
- Đổi tài khoản sẽ khởi động lại phiên Claude, lịch sử chat vẫn giữ.
- Thông tin đăng nhập nằm trong volume `home` của container, không nằm trong image hay repo.

---

## 4. Dữ liệu và sao lưu

| Volume | Nội dung |
|---|---|
| `ai-video_workspace` → `/app/workspace` | Các dự án: timeline, media, video xuất |
| `ai-video_home` → `/home/node` | Tài khoản app, đăng nhập Claude Code, lịch sử chat, cache model |
| `./library/music` → `/app/library/music` | Nhạc riêng: bỏ file mp3/m4a vào đây, thư mục con được dùng làm thể loại |

### Sao lưu từng dự án ngay trong app

Mở **Dự án** (nút 📁 trên thanh trên cùng):

- Nút **⬇ Sao lưu** trên mỗi dự án tải về một file `.zip` gồm: timeline (`project.json`), toàn bộ media, video đã xuất (có thể bỏ), motion component và hội thoại Claude của dự án.
- **Khôi phục từ file…** tải file `.zip` lên và tạo thành một **dự án mới** (không ghi đè dự án đang có). Motion component chỉ được thêm nếu chưa có.
- Tải lên được chia thành từng phần 8 MB nên chạy được qua Cloudflare Tunnel / proxy giới hạn 100 MB mỗi request.

**Chuyển dự án từ máy dev sang máy chủ mới:** ở máy dev bấm Sao lưu → ở máy chủ bấm Khôi phục từ file.

### Sao lưu toàn bộ (volume)

```bash
docker run --rm -v ai-video_workspace:/data -v $PWD:/backup alpine tar czf /backup/workspace-$(date +%F).tgz -C /data .
docker run --rm -v ai-video_home:/data -v $PWD:/backup alpine tar czf /backup/home-$(date +%F).tgz -C /data .
```

Khôi phục: tạo lại volume rồi giải nén ngược với `tar xzf … -C /data`.

---

## 5. Cấu hình

Đặt trong file `.env` cạnh `docker-compose.yml`, hoặc sửa trực tiếp `docker-compose.yml`:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `AIV_ADMIN_PASSWORD` | `Hoang2026` | Mật khẩu admin, chỉ dùng cho **lần chạy đầu** (sau đó đổi trong app) |
| `RENDER_CONCURRENCY` | `1` | Số frame render song song. Mỗi luồng cần ~1–1,5 GB RAM và không nên vượt số nhân CPU: 8 GB → 1, 16 GB → 3–4, 32 GB → 6. Đây là cách chính để render nhanh hơn |
| `RENDER_TIMEOUT_MS` | `600000` | Thời gian tối đa chờ một frame (máy thiếu RAM có thể rất chậm) |
| `RENDER_VIDEO_CACHE_MB` | `256` | Bộ nhớ đệm frame video khi render. Tăng (512–1024) nếu nhiều RAM để render nhanh hơn |
| `RENDER_MAX_SCENE_SEC` | `15` | Render theo từng cảnh (mỗi clip của track chính); cảnh dài hơn số giây này được chia nhỏ. Cảnh không đổi được dùng lại ở lần render sau, render bị dừng/lỗi làm tiếp phần còn lại |
| `RENDER_PARTS_DAYS` | `14` | Cảnh đã render (trong `workspace/.cache/render-parts`) không dùng tới sau số ngày này thì tự xoá. Có thể xoá tay trong **Dọn dẹp ổ cứng** |
| build arg `WITH_TTS` | `1` | Đặt `"0"` để bỏ giọng đọc AI, image nhẹ hơn khoảng 1,5 GB |
| build arg `CLAUDE_CODE_VERSION` | `latest` | Ghim phiên bản Claude Code CLI |

Đổi cổng: sửa `ports: - "8080:5180"` trong `docker-compose.yml`.

---

## 6. Mở ra Internet (HTTPS)

App chỉ nên mở ra Internet qua reverse proxy có HTTPS. Ví dụ với **Caddy**, file `Caddyfile`:

```
video.example.com {
    reverse_proxy localhost:5180
}
```

Caddy tự xin chứng chỉ HTTPS và WebSocket hoạt động sẵn. Với **Nginx**, cần thêm:

```nginx
location / {
    proxy_pass http://127.0.0.1:5180;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    client_max_body_size 8g;          # cho phép upload file lớn
    proxy_request_buffering off;
    proxy_read_timeout 3600s;
}
```

Khi đã có reverse proxy, nên đổi `ports` thành `"127.0.0.1:5180:5180"` để không ai vào thẳng cổng 5180 được.

---

## 7. Cập nhật phiên bản mới

```bash
cd ai-video
git pull
docker compose up -d --build
```

- Dữ liệu trong volume được giữ nguyên.
- **Không cập nhật khi đang render hoặc upload**, vì tác vụ đang chạy sẽ bị huỷ. Kiểm tra tab **Jobs** trước.
- Hướng dẫn cho Claude (`workspace/CLAUDE.md`, quyền `.claude/settings.json`) luôn được cập nhật theo image.
- Motion component trong `workspace/custom` chỉ được **thêm mới**, không ghi đè bản bạn đã sửa.

---

## 8. Lệnh hữu ích

```bash
docker compose ps                                  # trạng thái
docker compose logs -f --tail 100                  # log
docker compose restart                             # khởi động lại (huỷ job đang chạy)
docker exec -it ai-video tmux attach -t ai-video   # xem / gõ trực tiếp vào Claude Code (thoát: Ctrl+b rồi d)
docker exec -it ai-video bash                      # vào shell của container
docker compose down                                # dừng (giữ dữ liệu)
```

---

## 9. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Chat báo "Claude Code chưa đăng nhập" | Menu tài khoản → Tài khoản Claude Code → kết nối (mục 3) |
| Đăng nhập Claude báo lỗi mã | Lấy link mới (mỗi link chỉ dùng một lần) rồi dán đúng mã, không thừa khoảng trắng |
| Render lỗi `delayRender` / `Target closed` | Thiếu RAM: đóng bớt ứng dụng, dùng **Render nháp**, giữ `RENDER_CONCURRENCY=1`, hoặc tăng RAM |
| Upload file lớn bị ngắt | Reverse proxy chặn kích thước hoặc timeout: xem cấu hình Nginx ở mục 6 |
| Màn hình trắng sau khi cập nhật | Tải lại trang không dùng cache: **Ctrl+Shift+R** |
| Quên mật khẩu admin | Xoá file người dùng rồi khởi động lại; tài khoản mặc định sẽ được tạo lại: `docker exec ai-video rm /home/node/.config/ai-video/users.json && docker compose restart` |
| Tải nhạc chậm | Server nhạc Incompetech đôi khi chậm (1–3 phút một bài). Bài đã tải được lưu cache |
| Giọng đọc lần đầu chậm | Lần đầu cần nạp model, mất khoảng 15 giây. Các lần sau nhanh hơn |
