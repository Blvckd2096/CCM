# Cưới chúng mình — Quản lý khách mời đám cưới

Web app tĩnh, không máy chủ, không tài khoản, không quảng cáo.
Dữ liệu lưu trên máy bằng IndexedDB. Cài đặt nhỏ (tab gần nhất) lưu bằng LocalStorage.

## Chức năng đã làm thật (không phải demo giao diện)

- 2 tab **Nhà trai** (xanh pastel) / **Nhà gái** (hồng pastel), dữ liệu riêng hoàn toàn, không trộn.
  Mở lại app sẽ về đúng tab gần nhất.
- Nhóm mặc định: Gia đình, Họ hàng, Bạn cấp 2, Bạn cấp 3, Bạn đại học, Bạn bè,
  Đồng nghiệp, Hàng xóm, Khác. Thêm / đổi tên / xóa / lên-xuống thứ tự / chuyển khách giữa các nhóm.
  Xóa nhóm có khách: bắt buộc chọn nhóm đích để chuyển khách sang, không tự làm mất dữ liệu.
- Khách mời: tên bắt buộc, nhóm, đã mời/chưa mời (chạm 1 lần), tiền mừng, mình chưa mừng dịp gì / mình đã mừng cưới / chơi đầy tháng / đám hiếu / thăm ốm + tự thêm trạng thái mới (chạm 1 lần để đổi vòng, 3 ô 1 hàng), ghi chú.
- Tiền mừng: nhập tay, định dạng kiểu Việt Nam (500.000), chấp nhận dấu chấm/phẩy khi nhập,
  lưu dạng số nguyên VNĐ. **Để trống = chưa xác định, khác 0 đồng.**
  Nút nhập nhanh: 200K / 300K / 500K / 1M, chọn xong vẫn sửa lại được.
  Trạng thái mừng là riêng, **không cộng vào tổng tiền mừng nhận được**.
- Ghi chú nhiều dòng, xem trước ngắn trong danh sách, sửa trong Chi tiết, lưu khi rời ô nhập.
- Thống kê tự cập nhật ngay: tổng khách, đã mời, chưa mời, tổng tiền mừng,
  số khách có tiền mừng, chưa cưới, đã mừng, chơi đầy tháng, chưa nhập tiền.
  Tổng tiền hiển thị cả dạng đầy đủ (25.500.000 VNĐ) và dạng rút gọn (25,5 triệu).
  Có tổng hợp 2 bên riêng: nhà trai, nhà gái, cả hai bên — không cộng trùng khách.
- Tìm kiếm theo tên/ghi chú, lọc theo nhóm, trạng thái mời, trạng thái mừng.
- Danh sách gọn: mỗi khách chỉ hiện tên, trạng thái mời và tiền mừng; ghi chú, nhập nhanh,
  chuyển nhóm nằm trong “Chi tiết”.
- Sao lưu: Cài đặt → Xuất sao lưu (JSON) gồm cả 2 bên, mọi nhóm và trạng thái.
  Nhập sao lưu: kiểm tra định dạng trước, rồi chọn **Gộp** hoặc **Thay thế** (thay thế có xác nhận riêng).
- PWA: manifest + Service Worker, cài Thêm vào Màn hình chính trên iPhone, dùng offline
  sau lần tải thành công đầu tiên.
- Nhạc nền và Ảnh nền: **Sắp ra mắt**, nút hiện rõ là chưa triển khai, không có nút giả.

## Chạy thử trên máy tính

```bash
cd cuoi-chung-minh
python3 -m http.server 8000
# Mở http://localhost:8000
```

Không mở trực tiếp bằng `file://` rồi kỳ vọng Service Worker chạy đủ — Service Worker
cần HTTPS hoặc localhost.

## Đưa lên GitHub Pages

1. Tạo repo mới trên GitHub, đẩy toàn bộ thư mục này lên nhánh chính.
2. Vào repo → Settings → Pages → Build and deployment → Source: Deploy from a branch
   → Branch: main, Folder: / (root) → Save.
3. Đợi GitHub cấp địa chỉ `https://<tên-tài-khoản>.github.io/<tên-repo>/`.
4. Mở địa chỉ đó bằng Safari trên iPhone, đợi tải xong 1 lần.

## Cài trên iPhone

1. Mở app bằng Safari (không dùng trình duyệt trong ứng dụng khác).
2. Bấm Chia sẻ → **Thêm vào Màn hình chính** → Thêm.
3. Mở app từ biểu tượng mới trên màn hình chính.

## Kiểm tra offline

1. Mở app 1 lần khi có mạng để Service Worker lưu tài nguyên.
2. Bật Chế độ máy bay, mở lại app từ màn hình chính.
3. Thêm/sửa khách, tắt app, mở lại — dữ liệu vẫn còn vì lưu bằng IndexedDB trên máy.

## Sao lưu / khôi phục

- Xuất: Cài đặt → Xuất sao lưu (JSON) → lưu file vào iCloud Drive / gửi qua AirDrop / Zalo cho máy còn lại.
- Khôi phục: trên máy nhận, Cài đặt → Nhập sao lưu (JSON) → chọn file → chọn Gộp hoặc Thay thế.
- Lưu ý thật: 2 iPhone dùng 2 cơ sở dữ liệu độc lập. Không có máy chủ nên không tự đồng bộ.
  Cách chuyển dữ liệu giữa 2 máy là xuất/nhập JSON ở trên.

## Giới hạn thực tế của iOS Safari

- IndexedDB có thể bị xóa nếu người dùng xóa dữ liệu trang web, hoặc khi dung lượng
  thiết bị quá đầy. Vì vậy hãy xuất JSON định kỳ, nhất là trước ngày cưới.
- PWA trên iOS vẫn chạy qua WebKit, một số tính năng trình duyệt khác có thể khác Android.
  App này cố tình chỉ dùng API phổ biến trên Safari: IndexedDB, LocalStorage, Service Worker,
  không dùng API chỉ có trên Android.
- Nhạc nền không tự phát khi mở app nếu Safari chặn phát tự động — tính năng này đang
  để “Sắp ra mắt” thay vì làm nút giả.

## Cấu trúc file

- `index.html` — giao diện chính
- `style.css` — giao diện mobile-first, Safe Area iPhone
- `app.js` — nghiệp vụ, trạng thái, tính tổng, tương tác
- `db.js` — IndexedDB, chuẩn hóa tiền, kiểm tra dữ liệu
- `manifest.json` — cấu hình PWA
- `service-worker.js` — bộ nhớ đệm offline
- `icons/` — biểu tượng app
