# HANDOFF-flow — cho phiên làm giao diện (nhánh nang-cap-dong-chay)

## Việc phiên giao diện cần làm
1. Ô "Áp lực mặt trước": `results.surface.frontPa` nay là áp suất hãm dư p0 − p∞ (luôn dương), `frontN` là lực áp suất lên mặt đón gió. Nên đổi sang tên rõ `stagPa` ("Áp suất hãm dư p0 − p∞") và `windwardN` ("Lực áp suất mặt đón gió"). `windwardMeanPa` (có thể âm) không nên hiện cho học sinh.
2. Tần số tách xoáy: readouts chỉ hiện `fShed` khi `regime.wake === 'street'`. Cánh thất tốc và tấm nghiêng nay có `fShed > 0` với wake `'irregular'`; nên hiện khi `fShed > 0`, và ghi "theo chiều cao chiếu" (`Dshed`).
3. Cờ mới trong `results.aero`: `dragCrisis` (đang trong khủng hoảng lực cản: F không tỉ lệ v²), `postCritical`, `stalled`. Nên có huy hiệu cảnh báo trên đồ thị F(v).
4. `src/config.js` (đã sửa đúng 2 dòng): kịch bản "Lực cản và tốc độ" đổi `modelId: 'sphere'` thành `'plate'`, `sub` thành "Tấm phẳng, đồ thị F theo v". Lí do: cầu D 0,30 m đi qua khủng hoảng lực cản ở 10-17 m/s, CD tụt từ 0,45 xuống 0,16; tấm phẳng có CD 1,17 không phụ thuộc Re nên F ∝ v² đúng trên cả thang (test kiểm 2-80 m/s).
5. Kịch bản "Vượt tốc độ âm thanh": lời dẫn nói "sóng xung kích hình nón" nhưng rocket_sounding có mũi tròn nên `flow.shock().type === 'bow'` (sóng cong tách khỏi mũi, tiệm cận góc Mach). Nên sửa lời dẫn hoặc dùng mô hình mũi nhọn.
6. HUD "Mô phỏng chậm ×": `results.slow` đã gồm hệ số k của bộ giải (`flow.visScale()`); không cần sửa, nhưng số này nay đổi theo mô hình và mức điều tốc.
7. `package.json`: đã thêm `test/plane.test.mjs` vào `npm test`.
8. Dòng "giả định" cho người dùng (SPEC 7) cần câu: khói ở mặt phẳng giữa là lời giải 2D quanh thiết diện mô hình ở số Reynolds thu nhỏ; số đo lấy từ số liệu công bố.

## API mới (chi tiết ở SPEC 5)
- `flow.plane`, `flow.visScale()`, `flow.probe().speedTrue`.
- `flow.plane.stats()` để hiện mức điều tốc; `flow.plane.setGovernor(false)` + `_setLevel(n)` để ghim mức khi chụp ảnh.
- `view.lines`, `view.density`, `view.smokeColor` vẫn dùng như cũ; rake 'plane' vẽ lớp khói của bộ giải, rake 'grid' vẽ dải khói 3D.

## Giới hạn đã biết
- Thiết diện mô hình 3D (cầu, xe, tên lửa) được giải như vật 2D: dòng bị đẩy lệch mạnh hơn thực tế 3D, vết hậu hình cầu giống hình trụ.
- "Ít nhất 24 ô trên kích thước nhỏ nhất" chỉ đạt với vật tù (cầu, trụ, giọt nước). Cánh: bề dày khoảng 11 ô (dây cung 91 ô); tấm phẳng dày 0,012 m nhỏ hơn 1,5 ô nên được làm dày lên 1,6 ô trong bộ giải.
- Bước/khung hình bị chặn theo tier (low 960 bước/s). Vật nhỏ ở gió mạnh chạy chậm hơn U_vis danh nghĩa (k < 1; cánh ở 20 m/s k ≈ 0,4).
- M > 1: bộ giải tắt, không có vết hậu trong mặt phẳng.
- Bảng NACA 0012 / 2412 trong `src/physics/sections.js` được nhập lại từ trí nhớ về Sheldahl & Klimas và Abbott & von Doenhoff, chưa đối chiếu bản in. Test "tái tạo điểm nguồn" chỉ kiểm phép tra bảng, không kiểm số liệu gốc.
- Tham số ánh xạ chế độ (`TUNE` trong plane.js: Re bộ giải 28 / 190 / 600 / 300, hệ số trượt thành 0,85 / 0,6) chỉnh bằng mắt trên bản CPU; chưa đo GPU trên điện thoại thật.
