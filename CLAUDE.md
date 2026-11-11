# CLAUDE.md — ống khí động (Vật lí 10, Bài 19)

Hợp đồng: `SPEC.md`. Dòng chảy / khói: `HANDOFF-flow.md`. Tiến độ: `PROGRESS.md` ("Đọc PROGRESS.md và làm tiếp").
Không đụng `src/geom/` và bố cục giao diện (`src/ui/`, `src/styles.css`) — phiên giao diện sở hữu.

## Lệnh
```bash
npm ci                      # cài (three, esbuild); Playwright có sẵn toàn cục
npm run build               # dist/ (app.js + index.html). KHÔNG đọc dist/
npm test                    # 34 test, ~2 phút (chạy tuần tự, --test-concurrency=1); chỉ xem dòng "not ok"
npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"
```
## Chụp / đo (Chromium + SwiftShader, phải `npm run build` trước)
```bash
node tools/shot.mjs --model cylinder --U 10 --camera side --q 0 --ticks 400 --out shots/x.png   # chụp 800x500, ẩn giao diện
node tools/shot.mjs --model cylinder --U 10 --st 900 --D 0.12 --xs 0.3,0.6                      # đo St ở vệt sau (tua nhanh, không vẽ)
node tools/shot.mjs --model wing_2412 --alpha 18 --level 0 --st 700 --xs 0.4,0.8                # --level ghim mức bộ giải 0-4
node tools/perf.mjs --secs 12 [--noui 1] [--q 12]       # fps thật, tác vụ >50 ms, lỗi console
node tools/prof.mjs --secs 8                            # hàm tốn CPU luồng chính nhất
node tools/sheet.mjs && python3 tools/sheet.py          # docs/contact-sheet.png
```
`--browser firefox` chạy Firefox nếu đã cài (`npx playwright install firefox`).
URL: `?tier=low|high`, `?q=N` ghim bậc chất lượng N (0-12; `auto` mặc định), `?soft=0` bỏ nhận diện WebGL phần mềm.
`window.__app` = { ctx, scene, tick, quality, results, ... }; `tick(dt)` tua nhanh một khung không vẽ.

## Bẫy đã gặp
- Chrome chỉ báo fence xong sau một task sau; vòng lặp chặt (không nhả vòng sự kiện) không bao giờ thấy dữ liệu mới. Công cụ đo nhả vòng sự kiện mỗi tick.
- `renderer.clear()` dùng màu nền sảnh alpha 1: mọi render target dye phải xoá bằng alpha 0 (lỗi "tấm trắng").
- WebGL phần mềm không có back pressure: CPU chạy trước GPU nhiều khung, mọi `readPixels` sau đó chờ cả đống việc. `scene.setQuality({pace:true})` chặn bằng một lần đọc 1 điểm ảnh đầu mỗi khung.
- Mỗi tick ở bậc 12 vẫn ~50 ms khi có giao diện DOM (hợp thành phần mềm tốn ~17 ms/khung); ẩn `#app` thì ~33 ms.
