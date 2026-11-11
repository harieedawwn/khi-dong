# ACCEPTANCE — trạng thái: ĐẠT (kiểm bằng Chromium + SwiftShader; chưa thử điện thoại thật, Safari iOS, Zalo)

Kiểm lần cuối: `npm test` 34/34 đạt (physics 11, flow 15, geom 8, plane); bảng CD in ra của physics.test không đổi (dùng info tay).
`node tools/meshcheck.mjs --sdf`: mọi chi tiết dòng chảy kín nước (mỗi cạnh dùng đúng 2 lần, thể tích dương), sdf đúng dấu (trừ bánh xe, ống, thanh, tròn xoay: sdf xấp xỉ có khoang rỗng nên bỏ qua phép thử tia).
`node tools/modelstats.mjs`: số đỉnh lớn nhất 36,5 nghìn (xe tải ốp gió) <= 40 nghìn; mọi mô hình trong giới hạn SPEC §3; CD@20 m/s sau khi dựng lại lệch <= 4 % so với bản cũ.
`node tools/qa.mjs`: 360x740, 844x390, 768x1024, 1366x768, 1920x1080: không cuộn trang, không chữ bị cắt, không hộp / chữ chồng nhau (ảnh ở shots/qa, không đưa vào git).

| # | Kết quả | Bằng chứng |
|---|---------|-----------|
| 1 | ĐẠT (Chromium) | dist/index.html mở được không cần máy chủ; không lỗi console ngoài cảnh báo GPU của SwiftShader |
| 2 | ĐẠT | tools/qa.mjs ở 5 cỡ màn hình: không cuộn, không cắt, không chồng |
| 3 | ĐẠT | đổi mô hình chạy hoạt ảnh <= 400 ms; ảnh thu nhỏ là ảnh tĩnh nhúng sẵn, không dựng khi chạy |
| 4 | ĐẠT | cầu D 0,30 m ở 20 m/s: Re 4,1e5, vệt hỗn loạn (đã qua khủng hoảng, huy hiệu "Khủng hoảng lực cản" hiện khi đang trong dải); trụ, tấm: xoáy Kármán; cánh 2412 thất tốc ở 18°: huy hiệu "Thất tốc", fShed 18,9 Hz theo chiều cao chiếu |
| 5 | ĐẠT | tấm 40/20 m/s = 4,00; F tỉ lệ ρ; độ cao lớn hơn thì lực nhỏ hơn |
| 6 | ĐẠT | CD@20: giọt nước 0,054 < cầu 0,159 < trụ 1,053 < tấm 1,170; xe tải ốp 0,60 < thùng 0,75; sedan 0,292 < SUV 0,382 |
| 7 | ĐẠT | wing_2412: CL(0°) = 0,22; L/D cực đại gần 4,5°; thất tốc sau ~15° |
| 8 | ĐẠT (số + ảnh) | bản đồ áp suất: đỏ ở điểm hãm, xanh nơi dòng nhanh; heatmap ghi đè màu sơn, tắt thì trả màu sơn |
| 9 | ĐẠT (số) | rocket_sounding M 1,5: góc Mach 41,8°, mũi tròn nên sóng cong; lời dẫn kịch bản đã sửa (không còn "hình nón") |
| 10 | ĐẠT | đồ thị theo thời gian đặt lại khi đổi mô hình; so sánh, đường F(v) có huy hiệu chế độ |
| 11 | ĐẠT | hướng dẫn <= 5 bước, mở lại được; nút âm thanh; không emoji |
| 12 | CHƯA KIỂM | cần điện thoại thật (>= 30 fps, tier low) |

Thay đổi chính của đợt này: thân xe / tàu dựng từ tiết diện spline (src/geom/hull.js, kit.js), kính và đèn phủ bề mặt, bánh xe có vành, màu sơn riêng từng mô hình (assemble: parts.palette, thuộc tính mat); ảnh thu nhỏ tĩnh (tools/thumbs.mjs -> assets/thumbs/*.webp <= 8 KB, build.mjs nhúng); tiêu đề hộp trắng + tên trường + khung số đo (Be Vietnam Pro 800); bảng bên và dock thu gọn được; khung hình tự khớp theo mô hình (vùng trống giữa các bảng) + cận cảnh; ẩn khung thép và kính ống; phát dòng khí 0,25-1x và tạm dừng; nhãn lực "F cản", "F nâng"; mục HANDOFF-flow.
Giới hạn còn lại: sdf của bánh xe, ống, thanh và khối tròn xoay là xấp xỉ.
