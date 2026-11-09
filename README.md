# Ống khí động: khảo sát lực cản và lực nâng

Phòng thí nghiệm ống khí động 3D cho Vật lí 10 (KNTT), Bài 19 "Lực cản và lực nâng".

## Mở ứng dụng
- Dựng bản chạy: `npm install` rồi `npm run build` (cần mạng một lần để tải three và esbuild).
- Mở `dist/index.html` bằng cách bấm đúp, không cần máy chủ và không cần mạng.
- Chạy kiểm tra: `npm test`.

## Chia sẻ
- Đẩy dự án lên nhánh main của GitHub; workflow `.github/workflows/pages.yml` tự dựng và đăng dist/ lên GitHub Pages.
- Gửi đường dẫn Pages cho học sinh. Trong Zalo hoặc Facebook, nếu trang chậm, chọn "Mở bằng trình duyệt".

## Điều khiển
- Chọn mô hình ở thư viện hoặc tự lắp ở chế độ "Tự lắp".
- Thanh trượt tốc độ U và góc tới alpha; môi trường theo độ cao hoặc nhập T, p.
- Chế độ dòng chảy: khói, hạt, vector; bản đồ màu áp suất hoặc ma sát.
- Camera: tổng quan, bên hông, từ trên, vết hậu, bên trong.
- Đầu dò đo tốc độ và áp suất tại một điểm; ghim mô hình để so sánh lực.
- Nút âm thanh và hướng dẫn 5 bước (mở lại bất cứ lúc nào).
- Tốc độ hiển thị chậm hơn thực; mọi con số dùng tốc độ thật.
