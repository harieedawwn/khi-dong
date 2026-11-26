# TASK — đợt 3 (thay toàn bộ phase cũ)

Quy tắc chung (mọi phase):
- Đầu phiên: `git fetch origin && git checkout -B main origin/main`. Cuối phiên: đánh dấu [x], commit, `git push origin HEAD:main`.
- Không subagent, không tìm web. Không đọc dist/. Chỉ mở file phase liệt kê, tìm bằng grep.
- Kiểm chứng: `npm run build`; tối đa 2 ảnh `tools/shot.mjs`. `npm test` CHỈ khi phase có sửa src/geom/ hoặc src/physics/.
- Không đổi vật lý/bộ giải. Tiếng Việt đủ dấu. Vùng chạm ≥ 44px trên cảm ứng (`@media (pointer:coarse)`), không tràn ngang ở 360px.
- Báo ≤ 5 dòng rồi dừng.

## [x] P1 — Giao diện gọn, nhỏ hơn, thoáng khung 3D (Sonnet 5.5 · medium)
Files: src/styles.css, src/ui/shell.js, src/ui/readouts.js, src/ui/builder.js, src/ui/controls.js (chỉ phần cần).
1. Tên trường KHÔNG BAO GIỜ xuống dòng: `.school` `white-space:nowrap; width:max-content; max-width:100%`; cỡ chữ tự co theo chỗ trống:
   thêm hàm `fitOneLine(el, minPx=10, maxPx)` trong shell.js (ResizeObserver trên #topRight + resize): đặt font-size = max, nếu scrollWidth > clientWidth thì co theo tỉ lệ clientWidth/scrollWidth (1 lần đo, không vòng lặp). Bỏ `text-wrap:balance` của .school. Áp dụng luôn cho `.plate__title` (tiêu đề giữa) nếu nó cũng xuống dòng.
2. Thu nhỏ UI máy tính ~15–20%: biến `--ui` trong :root (1 desktop, 0.9 tablet), dùng cho padding/gap/font của các panel. Cụm nút góc trái 36px trên chuột (44px khi pointer:coarse). Panel trái rộng tối đa ~300px (đang ~420px), chiều cao theo nội dung (`height:auto; max-height: calc(100dvh - …); overflow:auto`), không còn khoảng trống lớn ở đáy. Tiêu đề giữa và thẻ tên trường nhỏ hơn, padding gọn. Chữ thân ≥ 13px, chữ phụ ≥ 11px.
3. "Dựng từ mẫu": thay chữ bằng icon SVG nội tuyến (nét, 20px, `stroke=currentColor`, không emoji): tên lửa, máy bay, giọt nước, ô tô, đặt lại (mũi tên vòng). Nút vuông 36px (44 trên cảm ứng), cùng 1 hàng, giữ `aria-label` + `title` = tên cũ. Nhãn "Dựng từ mẫu" đặt trên hàng, chữ nhỏ.
4. Bỏ thẻ HUD nổi (#hud: F cản, F nâng, v, "Mô phỏng chậm ×…") khỏi #topRight. Đưa F cản / F nâng / v thành một hàng số liệu gọn ở ĐẦU panel phải (#readouts) — luôn thấy khi panel mở. "Mô phỏng chậm ×N" chuyển thành chữ nhỏ cạnh nút tốc độ phát trong dock. Không còn ghi chú nổi nào khác trên khung 3D (kiểm tra cả cái "viên thuốc" tối nhỏ ở góc dưới trái khung 3D, ~x500 y1020 ở 1920×1080: xác định là gì, bỏ hoặc đưa vào panel).
5. Sửa `.seg` trong builder: nút chưa chọn ("Có" ở Bánh xe) đang gần như vô hình — chữ phải đủ tương phản trên nền sáng.
Done when: build ok; ảnh 1920×1080 và 360×780: tên trường 1 dòng, không HUD nổi, panel trái gọn; không tràn ở 360px.

## [x] P2 — Ống ngắn lại, bỏ khung thép, khung kính sạch (Sonnet 5.5 · medium)
Files: src/render/scene.js (+ preset camera nếu có, grep "camera"/"fit"). Không đổi X0/X1/YH/ZH (vùng thử = miền bộ giải).
1. Rút ngắn hai đầu, vẫn đọc ra là ống thu hẹp + ống loe: `CX0 -6.4 → -4.7`, `CZ0 2.0 → 1.8`, `CY0 1.45 → 1.3`; `DX1 5.4 → 4.5`, `HX1 6.3 → 5.1`. Kiểm tra các vật bám theo CX0/DX1/HX1 (screenPlane lưới tổ ong ở CX0+…, vành mặt bích, quạt, csec) vẫn nằm đúng, lưới thứ tư (CX0+1.1) vẫn trong ống thu. Camera tổng quan/khung vừa phải ôm sát ống mới (không chừa khoảng trống thừa).
2. Bỏ toàn bộ sườn thép quanh vùng thử: vòng `RIB_X` (thanh trên/dưới/hông, mặt bích, bu lông) và 4 thanh dọc "long rails". Thay bằng: 2 vành mỏng tối (dày 0.03, màu 0x3A4048) ôm mép kính tại x = X0 và X1 nơi nối với ống thu/ống loe; mép kính dọc 4 cạnh là nẹp rất mảnh (0.015) màu tối, nhám. Giữ chân đỡ + dầm dưới sàn + hộp cân lực (nằm dưới, không che).
3. Kính: giữ, nhưng sạch: độ mờ/phản xạ thấp, không loá; mặt kính phía camera (front) giảm thêm opacity khi camera nhìn gần vuông góc mặt đó. Nếu với tier low kính vẫn làm khó nhìn thì tier low tắt kính, chỉ còn nẹp mép (Q.glass đã có sẵn).
4. Giữ giá phun khói và ống dẫn xuyên tường.
Done when: build ok; 2 ảnh (`--camera side`, góc chéo): thấy rõ mô hình + khói, không thanh nào cắt ngang vùng thử, ống ngắn gọn, vẫn trông thật.

## [ ] P3 — Sửa Tự lắp ghép + viền mô hình răng cưa (Sonnet 5.5 · medium)
Files: src/ui/builder.js, src/geom/{catalog,assemble,hull,parts}.js (ĐƯỢC SỬA trong phase này; phải chạy `npm test`), src/render/smoke.js (khoảng dòng 262-300).
1. Lựa chọn hiển thị phải khớp mô hình: bấm mẫu "Ô tô" hiện ra Thân = "Tròn" và Bánh xe = "Không" trong khi xe có bánh. Sửa nguồn sự thật (TEMPLATES[k].builder ↔ cách assemble dựng hull) để tab nào cũng phản ánh đúng. Kiểm tra cả 4 mẫu × 5 tab.
2. Với thân kiểu xe (car/truck hull) chỉ hiện các lựa chọn/thanh trượt có ý nghĩa (mở rộng `relevant()` và lọc option): không cho mũi ogive dài 0,6 m trên ô tô; giới hạn chiều dài mũi/đuôi hợp lý theo loại thân. Mục tiêu: kéo hết thanh vẫn ra hình hợp lý, không lố.
3. Ô tô: cửa kính đang là mảng đen đặc → vật liệu kính tối hơi trong, có phản chiếu nhẹ (không đen tuyền); khối nhỏ lạc giữa cửa (gương/tay nắm) đặt đúng vị trí hoặc bỏ. Đường viền thân không có bậc.
4. Viền mô hình răng cưa khi có khói: depth pass khói đang ở nửa độ phân giải + NearestFilter (smoke.js ~283-284). Tier high: toàn độ phân giải. Tier low: giữ nửa nhưng trong DFRAG/VFRAG so độ sâu với 4 mẫu lân cận (lấy xa nhất) để không lộ bậc.
5. Thanh trượt nào không có tác dụng với lựa chọn hiện tại thì ẩn (đã có relevant(); bổ sung chỗ còn thiếu).
Done when: `npm test` không có "not ok"; build ok; ảnh góc chéo mẫu Ô tô có khói: viền mượt, kính không đen đặc, tab khớp mô hình.
