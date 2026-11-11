# PROGRESS — nhánh nang-cap-dong-chay (đọc CLAUDE.md trước)

- [x] 1. Khói trắng phủ kín: `renderer.clear()` xoá dye bằng màu nền alpha 1 (lỗi thật, không phải SwiftShader) — lbm-gpu.js
- [x] 2. Không có xoáy Kármán trên GPU: (a) đọc vận tốc bằng fence không trả về → v_y = 0 đúng; (b) khung 2 s làm mô phỏng chậm 40 lần. Đã thay bằng vòng PBO + fence, đọc trực tiếp khi không có fence; dt tối đa 0,1 s
- [x] 3. Tốc độ nhìn thấy k đổi mượt (hằng số thời gian 0,9 s), không nhảy khi bộ điều tốc đổi mức
- [x] 4. Test chập chờn: ngưỡng thời gian thực (bake < 400 ms, 1,5 M mẫu/s) bị nhiễu khi các tệp test chạy song song -> chạy tuần tự + lấy tốt nhất trong 3 lần
- [x] 5. Bảng NACA đối chiếu: 0012 theo Sheldahl & Klimas Table 2 (OSTI 6548367); 2412 đọc từ đồ thị NACA Report 824 tr.136 (không có bảng số in) — xem đầu sections.js
- [x] St: trụ 0,21, cầu 0,215, tấm 0,21 (Re bộ giải 800 cho vật cạnh sắc) ở mức 0; ở mức bộ giải 4 tấm phẳng 0,24; giọt nước và cánh 2412 4° không xoáy; cánh 18° tách và xoáy
- [x] Khói sợi mảnh mềm (smoke.js shader + nozzle sigma)
- [x] Bộ điều chất lượng src/quality.js (13 bậc) + scene.setQuality; hình học tuần tạo nhẹ; ảnh thu nhỏ từng khung rảnh; watchdog không gây lỗi nghiêm trọng, chỉ hiện thông báo "Chế độ nhẹ" sau 3 lần treo > 4 s
- [x] Đo (Chromium SwiftShader 1000x640, bậc 12): 20 fps có giao diện DOM, tác vụ dài ~50-60 ms (một lần đọc đồng bộ 1 điểm ảnh ~30 ms là chi phí cố định của GPU phần mềm); 33 fps và 1 tác vụ dài khi ẩn giao diện. Muốn hết tác vụ > 50 ms cần giảm chi phí hợp thành giao diện DOM (phiên giao diện)
- [x] Firefox cài được qua Playwright nhưng không tạo được WebGL trong container (FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS): chưa đo được fps Firefox; đã sửa nguyên nhân thật của thông báo treo (Boot.loop không được gọi, resume đặt lastTick)
- [ ] Tác vụ > 50 ms còn lại ~50-60 ms (chờ GPU) với giao diện DOM; không có khi ẩn giao diện
- [x] Bảng ảnh docs/contact-sheet.png
- [ ] Gộp vào main, kiểm tra trang Pages
