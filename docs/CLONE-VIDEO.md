# Clone video mẫu thành template

Tải lên một video bạn muốn học theo: quảng cáo, TikTok, bản tin, phóng sự… App phân tích video đó thành một **luồng** (mở đầu → nội dung → kêu gọi hành động, nhịp cắt, tốc độ nói, màu chủ đạo) rồi lưu thành **template**. Sau đó bạn làm video mới cùng cấu trúc, với nội dung của riêng mình.

Ý tưởng lấy từ [hypit](https://github.com/hypit-ai/hypit): đọc video mẫu qua lời nói có mốc thời gian từng từ, điểm cắt cảnh và lưới khung hình có ghi thời gian, rồi neo cấu trúc video mới theo **lời** thay vì theo giây. Phần này được viết lại cho AI Video Studio, không dùng mã của hypit.

## Cách dùng

1. **Trang chủ → 🎬 Clone video mẫu.**
   - Chọn một tệp video, hoặc một video đã có trong dự án. Với video ở link YouTube/TikTok, nhập vào dự án trước (Assets → Link).
   - Chọn ngôn ngữ lời nói.
   - Chọn chế độ chép lời: *base* cân bằng; *tiny* nhanh hơn; *small* chính xác hơn nhưng chậm.
2. Bấm **Phân tích.** Toàn bộ chạy trên máy, chỉ dùng CPU, không gửi video đi đâu. Một video 30 giây mất khoảng 15–40 giây. Kết quả gồm:
   - **Cảnh:** điểm cắt cứng và chuyển cảnh mờ dần, trượt, ảnh zoom chậm.
   - **Lời nói theo từng từ:** faster-whisper.
   - **Nhịp:** mỗi câu là một nhịp. Máy đoán vai trò từng nhịp (mở đầu, đặt vấn đề, mục liệt kê, nội dung, kết luận, kêu gọi hành động, kết) dựa vào vị trí và từ khoá.
   - **Số đo:** nhịp cắt, số từ/phút, tỉ lệ có lời, âm lượng, độ sáng và màu chủ đạo.
   - **Bảng khung hình:** mỗi ô có thời gian, vai trò, lời nói và dải màu.
3. **Xem và sửa luồng.** Đổi vai trò nếu máy đoán sai. Thêm ghi chú cho từng nhịp, ví dụ "chữ vàng to giữa màn hình", "zoom nhanh vào sản phẩm".
4. Bấm **Lưu thành template.** Template hiện ở **Templates → ⭐ Mẫu của tôi** và dùng được theo hai cách:
   - **Tạo dự án từ khung mẫu.** Dự án mới có sẵn đủ các cảnh với thời lượng như video mẫu. Ảnh khung hình mẫu đứng giữ chỗ, đặt tên "Cảnh N · vai trò". Phụ đề là lời mẫu, khớp thời gian. Bạn thay dần từng cảnh và từng câu.
   - **Điền form → Tạo video.** Nhập nội dung mới (chủ đề, văn bản hoặc link), ảnh/video của bạn và lời kêu gọi hành động. Claude sẽ viết lời mới theo đúng số nhịp và vai trò, đọc giọng, ghép hình theo nhịp cắt của mẫu. Không dùng lại lời, tên hay thương hiệu của video mẫu.

> Bước này cần Claude Code đã đăng nhập (menu tài khoản → Claude Code). Trên Windows, panel chat chạy Claude ở chế độ nền. Cũng có thể mở Claude Code trong thư mục `workspace\`, hoặc kết nối qua MCP (xem [MCP.md](MCP.md)).

## Tệp tạo ra

Mỗi template nằm ở `workspace/templates/<id>/`. Đây là dữ liệu của bạn, không đưa vào git.

| Tệp | Nội dung |
|---|---|
| `reference/source.*` | Video mẫu |
| `reference/sheet-shots-N.jpg`, `sheet-overview.jpg` | Bảng khung hình theo từng cảnh, và bảng khung hình cách đều kèm lời nói |
| `reference/frames/shot_NNN.jpg` | Một khung hình cho mỗi cảnh |
| `analysis.json` | Toàn bộ số đo: cảnh, nhịp, từng từ, khoảng lặng |
| `ANALYSIS.md` | Bức tranh tổng thể: số đo, luồng, giả thuyết vì sao video hiệu quả, những gì cần xem thêm |
| `TIMELINE.md` | Từng nhịp theo thời gian: cảnh, khung hình, màu, lời |
| `TEMPLATE.md` | Công thức để Claude làm video mới theo luồng này |
| `template.json`, `poster.jpg`, `skeleton/` | Dữ liệu hiển thị trong thư viện, và dự án khung |

Phần tự động **không đọc được chữ trên hình** (không có OCR). Kiểu phụ đề, tiêu đề, sticker và bố cục chỉ thấy được trên bảng khung hình. Khi Claude làm video theo template, Claude sẽ xem các ảnh đó và bổ sung mục "Quan sát thêm" vào ANALYSIS.md.

## Cho Claude (CLI / MCP)

- `node ../tools/vedit.mjs analyze <assetId|file> [--lang vi] [--model base] [--save "Tên"]`: phân tích video mẫu. Thêm `--save` để lưu luôn thành template.
- `node ../tools/vedit.mjs templates`: liệt kê template của bạn.
- Công cụ MCP: `analyze_reference_video`, `get_reference_analysis`, `save_template`, `list_templates`, `use_template`.
- Công thức dựng nằm ở mục "Template: Mẫu tự tạo (clone video)" trong `workspace/CLAUDE.md`.
