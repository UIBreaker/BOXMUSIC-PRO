# 🎵 BOXMUSIC-PRO - Retro Pixel OS Music Player & Android App

Ứng dụng nghe nhạc cá nhân phong cách Retro Pixel OS & Music Box tuyệt đẹp, hỗ trợ cả Web PWA và bản cài đặt Android APK (`Boxmusic-Pro.apk`). Cho phép nghe nhạc 100% offline, tìm kiếm và tải nhạc từ khắp nơi trên thế giới.

---

## ✨ Tính Năng Nổi Bật

1. **Nghe nhạc 100% Offline (Không cần mạng):**
   - Lưu trữ nhạc trực tiếp vào bộ nhớ nội bộ của trình duyệt/ứng dụng qua **IndexedDB**.
   - Khi không có mạng Wi-Fi hoặc 4G, ứng dụng vẫn mở lên và phát nhạc bình thường nhờ **Service Worker**.
   - Hỗ trợ phát nhạc trong nền và điều khiển ngoài màn hình khóa (Lock Screen / Trung tâm điều khiển) qua **MediaSession API**.

2. **Tìm kiếm và tải nhạc thế giới:**
   - Tìm kiếm bài hát, ca sĩ, giai điệu bất kỳ trên toàn cầu.
   - Nghe thử trực tuyến trước khi tải.
   - Nút **Tải về (📥)**: Chuyển toàn bộ dữ liệu âm thanh và ảnh bìa bài hát vào bộ nhớ máy để nghe bất kỳ lúc nào.

3. **Nạp nhạc MP3 / MP4 từ máy:**
   - Nút **"+ Thêm MP3/MP4 từ máy"** cho phép chọn trực tiếp các file nhạc (`.mp3`, `.m4a`, `.mp4`, `.wav`) đã có sẵn trên điện thoại hoặc máy tính của bạn.

4. **Giao diện Mobile tối giản & Tinh tế:**
   - Thiết kế chuẩn Dark Mode hiện đại, tối ưu cho màn hình cảm ứng điện thoại.
   - Thanh mini-player tiện lợi khi lướt và bảng điều khiển Full Player với đĩa xoay nghệ thuật, thanh tua nhạc, trộn bài (Shuffle), lặp lại (Repeat).
   - Quản lý danh sách yêu thích ❤️ và dung lượng lưu trữ (MB).

---

## 🚀 Hướng Dẫn Khởi Chạy

### 1. Khởi động ứng dụng trên máy tính

Mở terminal tại thư mục này và chạy:
```bash
npm start
```

Terminal sẽ hiển thị địa chỉ IP nội bộ cùng **mã QR**.

### 2. Mở trên điện thoại

1. Đảm bảo điện thoại và máy tính đang kết nối **chung một mạng Wi-Fi**.
2. Mở ứng dụng Máy ảnh (Camera) trên điện thoại và **quét mã QR** hiển thị trên terminal máy tính (hoặc mở trình duyệt trên điện thoại và truy cập địa chỉ IP hiện ở console, ví dụ: `http://192.168.1.15:3000`).

### 3. Cài đặt thành App trên điện thoại (Không cần App Store / CH Play)

- **Trên iPhone (Safari):**
  1. Bấm vào nút **Chia sẻ** (biểu tượng hình vuông có mũi tên hướng lên ở thanh dưới).
  2. Cuộn xuống và chọn **"Thêm vào MH chính" (Add to Home Screen)**.
  3. Bấm **Thêm**. Biểu tượng Boxmusic sẽ xuất hiện trên màn hình chính như một ứng dụng độc lập!

- **Trên Android (Chrome):**
  1. Bấm vào biểu tượng **3 chấm** ở góc trên bên phải.
  2. Chọn **"Cài đặt ứng dụng"** hoặc **"Thêm vào Màn hình chính"**.
  3. Xác nhận cài đặt.

---

## 🛠️ Công Nghệ Sử Dụng

- **Frontend:** HTML5, Modern CSS (Glassmorphism & Dark Mode), Vanilla JavaScript ES6+, Web App Manifest, Service Worker Caching.
- **Lưu trữ Offline:** IndexedDB API (Lưu file âm thanh dạng Blob + Metadata + Ảnh bìa).
- **Backend:** Node.js, Express, `yt-search`, `yt-dlp` (Stream audio m4a siêu nhẹ, tốc độ cao).
