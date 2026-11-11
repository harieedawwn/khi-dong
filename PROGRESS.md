# PROGRESS — nâng cấp mô hình, giao diện, ảnh thu nhỏ (đọc CLAUDE.md trước; "Đọc PROGRESS.md và làm tiếp")

Phiên này được phép sửa src/geom/ và bố cục giao diện (yêu cầu của giáo viên ghi đè dòng "không đụng" trong CLAUDE.md).
Công cụ mới: `tools/look.mjs` (ảnh kiểm tra nhiều hướng nhìn, không cần ống gió), `tools/meshcheck.mjs [id] [--sdf]` (kín nước + sdf), `tools/modelstats.mjs` (số đỉnh, CD@20), `tools/partstats.mjs id`.
Đối chiếu CD: `stats0` gốc (23 mô hình, CD@20 m/s): rocket_water .476, sounding .348, launcher .408, capsule 1.143, airliner .025, fighter .018, glider .019, prop .032, heli .544, wing .007/.008/.005, f1 .896, proto .453, sedan .292, suv .382, truck_box .75, truck_fairing .6, sphere .159, cyl 1.053, plate 1.17, rhombus .501, teardrop .054. Bảng in của physics.test không đổi (dùng info tay).

## 1. Mô hình (src/geom/parts.js, hull.js, kit.js, library.js, assemble.js)
- [x] Nền: hull (tiết diện B-spline, sdf nội suy), panel (kính/đèn chiếu lên bề mặt, decal không tính diện tích), strut, tube, revolve, wheel (lốp + vành + nan hoa + đĩa); assemble có bảng màu theo mô hình (parts.palette) + 8 tông + thuộc tính mat (độ nhám/kim loại); modelview + scene dùng makeModelMaterial
- [x] Xe đường bộ: sedan, SUV, xe tải thùng, xe tải ốp gió, xe đua thể thao (proto)
- [x] Máy bay: airliner, fighter, glider, prop
- [x] Trực thăng, F1 (halo, sidepod, cánh nhiều tầng)
- [x] Tên lửa (cánh biên dạng, vòi phun), khoang tàu; màu sơn cho hình học cơ bản (kích thước SPEC §6 giữ nguyên)
- [x] Mọi mô hình <= 40k đỉnh, meshcheck sạch, geom.test + physics.test xanh, bảng CD@20 giống stats0
- [x] docs/models-contact-sheet.png

## 2. Ảnh thu nhỏ tĩnh: tools/thumbs.mjs -> assets/thumbs/<id>.webp (<= 8 KB), build.mjs nhúng, picker dùng ảnh
- [x] làm

## 3. Tiêu đề: hộp trắng bo tròn giữa trên, tên trường đỏ phải trên, khung số đo ngay dưới; Be Vietnam Pro 800; điện thoại
- [x] làm

## 4. Nhìn rõ: bảng bên thu gọn được, dock gọn, tự khớp khung hình + chế độ cận cảnh, ẩn khung + kính ống, tốc độ phát 0,25x-1x + tạm dừng, nhãn mũi tên lực đúng tiếng Việt
- [x] làm

## 5. HANDOFF-flow: Áp suất hãm dư p0 − p∞, fShed khi > 0, huy hiệu (khủng hoảng lực cản / thất tốc / sau tới hạn), lời dẫn kịch bản siêu âm, đồ thị theo thời gian đặt lại khi đổi mô hình
- [x] làm

## 6. QA Playwright 360x740, 844x390, 768x1024, 1366x768, 1920x1080; cập nhật ACCEPTANCE.md; đẩy main; kiểm tra Pages
- [x] làm

## Đã làm xong (phiên này)
Tất cả mục trên đã đạt; xem ACCEPTANCE.md. Việc sau: thử điện thoại thật; sdf bánh/ống chính xác hơn; HUD làm tròn F nhỏ về 0.

## Đợt 2 (yêu cầu giáo viên: tên trường nổi bật + Tự lắp ghép đẹp như thư viện)
- [x] Tên trường: thẻ kem bo tròn, vạch đỏ 6 px bên trái, viền đỏ mảnh, bóng; chữ to hơn; khung số đo ngay dưới; điện thoại / máy tính bảng: thẻ nằm dưới hộp tiêu đề, trải ngang, không tràn
- [x] Builder dựng lại (src/geom/catalog.js): thân kín một khối bằng loft (mũi + thân + đuôi), vòi phun hình chuông cho đuôi cụt, kính buồng lái cho máy bay, cửa sổ tròn cho tên lửa; có bánh xe thì thân là hull xe (kit.carHull) có vòm bánh, kính, đèn pha / đèn hậu, lưới tản nhiệt, gương, bánh có vành; mũi (nón/ogive/bán cầu/phẳng) và đuôi (nhọn/bo/cụt) đổi kiểu mui, kính sau; thân tròn/bầu dục/hộp đổi độ bo vai
- [x] Màu sơn theo kiểu (paletteOf): xe xanh xám, máy bay trắng + đuôi xanh đậm, tên lửa trắng + mũi / cánh đỏ, giọt nước xanh nhạt; heatmap vẫn ghi đè
- [x] Nút "Dựng từ mẫu" (Tên lửa, Máy bay, Giọt nước, Ô tô) ở đầu tab builder; mẫu ô tô đổi đuôi bo + thân ngắn hơn
- [x] geom.test (552 mô hình, tối đa 39,7 nghìn đỉnh), physics.test xanh; meshcheck --builder --sdf sạch; thứ tự CD@20: giọt nước 0,061 < xe 0,144 < tấm 0,80, không NaN
- [x] Công cụ mới: tools/lookb.mjs (ảnh nhiều hướng cho mẫu / cấu hình builder), meshcheck --builder, qa.mjs --builder <mẫu>
- Ghi chú: geom.test cho phép cạnh dài nhất của thân xe tới 4,5 % L (mép vòm bánh, như xe thư viện); còn lại 1,5 %. Builder không có ảnh thu nhỏ (chỉ biểu tượng SVG), nên không phải cập nhật.
