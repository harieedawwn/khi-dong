# ACCEPTANCE — trạng thái: CHƯA HOÀN TẤT

Chặn: môi trường làm việc không có gói `three` và không có mạng (npm: ENOTFOUND), nên không dựng được dist/app.js, không chạy test geom, không chạy hai checker, không chụp ảnh. Mục chưa kiểm được ghi "CHƯA KIỂM", không ghi PASS.

Test đã chạy: physics 11/11 PASS, flow 15/15 PASS (gồm bake luồng chính khi không có Worker), geom: không chạy được (thiếu three).
Sửa trong P1: sphereCD thiếu số hạng Morrison 0,25·(Re/1e6)/(1+Re/1e6); bảng trụ [2e5] 1,2 -> 1,0 (khởi đầu khủng hoảng); dung sai test "sphere 2U" 1% -> 5% (đúng SPEC 9.5).

| # | Kết quả | Bằng chứng |
|---|---------|-----------|
| 1 | CHƯA KIỂM | cần dist + trình duyệt |
| 2 | CHƯA KIỂM | cần check_devices.mjs |
| 3 | CHƯA KIỂM | cần chạy ứng dụng |
| 4 | CHƯA KIỂM, nghi FAIL với cầu | cầu D 0,30 m ở 20 m/s: Re 4,11e5 (đã qua khủng hoảng), CD 0,159, vết hậu "irregular", không phải "street". Trụ (Re 1,64e5) và tấm: "street". Cánh 2412: 6° "none", 20° "irregular" |
| 5 | PASS (số) | tấm 40/20 m/s = 4,000; sedan = 4,015; rho 5 km/0 = 0,601, lực sedan = 0,592. Lưu ý: cánh 2412 ở 5° cho 4,60 (CD đổi theo Re) |
| 6 | PASS (số) | CD@20: giọt nước 0,054 < cầu 0,159 < trụ 1,053 < tấm 1,170; xe tải ốp 0,60 < thùng 0,75; sedan 0,291 < SUV 0,38 |
| 7 | PASS (số) | CL(0°) = 0,220; L/D cực đại 59,7 tại 4,5°; CLmax 1,11 tại 14,5°, CL(19°) = 0,67 |
| 8 | CHƯA KIỂM | cần heatmap hiển thị |
| 9 | PHẦN SỐ PASS, hình CHƯA KIỂM | rocket_sounding M 1,50: góc Mach 41,8° (= asin(1/1,5)), CD_wave 0,307, flow "supersonic" |
| 10 | CHƯA KIỂM | cần giao diện |
| 11 | CHƯA KIỂM | cần giao diện |
| 12 | CHƯA KIỂM | cần điện thoại thật |
