# TASK

## [x] Phase 1 — Sửa lỗi UI + khói không biến mất + chất lượng khói
- seg(): đặt --n/--i (src/ui/controls.js).
- Nhãn "Sau tới hạn" chuyển vào góc phải trên vùng vẽ biểu đồ.
- Khói khối: hộp y ±0.70, bước ds ≥ (t1-t0)/uSteps, nhảy gấp đôi ở mẫu rỗng, break chỉ khi đã ra khỏi lớp và đi xa z=0.
- view.smokeQ: auto|flat|low|mid|high (flat = khói 2D cũ; bước 18/30/56).

## [x] Phase 2 — Nút cài đặt ⚙ + sắp xếp UI gọn
- Nút ⚙ (aria-label "Cài đặt") ở cụm nút góc trên trái.
- Dock chỉ giữ: Tốc độ gió, Góc tấn α, Tạm dừng/tốc độ phát, Kiểu dòng khí, Góc nhìn, Thí nghiệm gợi ý; mặc định thu gọn.
- Bảng Cài đặt (sheet trên điện thoại, panel nổi trên máy tính; đóng bằng X, Esc, chạm nền): Chất lượng (đồ hoạ, Khói smokeQ); Khói (màu, mật độ, số dòng, độ dày, độ xoắn, giá phun); Hiển thị (lực, sóng xung kích, khung/kính ống, bản đồ nhiệt); Không khí và Đầu dò; Âm thanh.
- Lưu lựa chọn vào localStorage (try/catch).
- Ràng buộc: không đổi vật lý, tiếng Việt đủ dấu, vùng chạm ≥ 44px, không tràn ở 360px, không dùng API lạ.
