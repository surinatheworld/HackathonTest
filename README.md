# Nông Trại DeFi

Game nông trại 2D để học DeFi trên Avalanche Fuji testnet, làm cho Team1 Vietnam UniHack 2026. Mọi tiền trong game là tiền test, không có giá trị.

## Cách chơi

1. Mở https://hanazono-b9s.pages.dev/
2. Bấm **Kết nối ví** → **Ví trong game** (không cần cài ví, không cần AVAX).
3. Vào **Ruộng rau**, bấm **Nhận 1.000 USDC test**.
4. Đi quanh làng bằng **WASD / mũi tên** (hoặc chạm vào một khu), bấm **E** để mở:
   - **Ruộng rau**: gửi tiền lấy lãi, rút lúc nào cũng được.
   - **Vườn cây**: trồng ớt / xoài / sầu riêng, chờ chín rồi thu hoạch gốc + lãi.
   - **Ao cá**, **Chợ phiên**: góp tiền vào ao, đổi USDC ↔ gAVAX.
   - **Hợp tác xã**: gửi gAVAX, vay USDC.
   - **Nhiệm vụ**, **Kho đồ**: làm lần lượt 18 nhiệm vụ để học từng bước.

Một ngày trong game dài 60 giây. Không kết nối ví thì game chạy ở chế độ mô phỏng.

## Cài đặt và chạy trên máy

Cần Node.js 20 trở lên.

```bash
git clone https://github.com/surinatheworld/HackathonTest.git
cd HackathonTest/contracts
npm install
npm test        # chạy test các contract
npm run local   # mở http://localhost:8790: chuỗi local + game, không cần ví thật
```

Muốn deploy lại lên Fuji, xem [docs/DEPLOY.md](docs/DEPLOY.md).
