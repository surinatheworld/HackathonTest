# Chuẩn bị lên mainnet

Thể lệ UniHack 2026 cấm nhận tiền thật, nên dự án **chỉ chạy trên Fuji**. Tài liệu này ghi lại những gì đã sẵn sàng và những gì còn thiếu nếu sau này lên Avalanche C-Chain mainnet. Nó không phải kế hoạch ra mắt.

## Đã diễn tập (không tốn tiền thật)

`npm run test:mainnet-fork` chạy trên một bản sao C-Chain mainnet ngay trên máy, với USDC thật (Circle), Aave v3 thật và Chainlink AVAX/USD thật:

- Quỹ thưởng gửi 40.000 USDC vào Aave v3 qua `AaveV3YieldSource`. Sau 30 ngày có lãi thật, và `harvestYield` chỉ chuyển phần lãi vào quỹ thưởng.
- Người chơi trồng cây và gieo hạt khi phần lớn tiền đang nằm ở Aave, rồi vẫn rút về đủ gốc lẫn lãi.
- Owner rút toàn bộ tiền khỏi Aave được.
- FarmCoop đọc đúng feed Chainlink AVAX/USD mainnet, với WAVAX làm tài sản thế chấp.

| Thành phần | Mainnet |
|---|---|
| USDC (Circle) | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` |
| Aave v3 Pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| aAvaUSDC | `0x625E7708f30cA75bfd92586e17077590C60eb4cD` |
| Chainlink AVAX/USD | `0x0A77230d17318075983913bC2145DB16C7366156` |
| WAVAX | `0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7` |

## Phải đổi trước khi lên mainnet

1. **Pháp lý trước tiên.** Xem mục "Giới hạn pháp lý tại Việt Nam" trong README (Nghị quyết 05/2025/NQ-CP, Nghị định 147/2024/NĐ-CP). Chưa có giấy phép thì không mở cho người dùng thật.
2. **Bỏ token test.** Không còn `faucet()` hay `mint()`. FarmGame, FarmQuests, FarmCoop dùng USDC thật. Ao cá và Hợp tác xã dùng WAVAX thay cho gAVAX.
3. **Quỹ thưởng nhiệm vụ** đổi từ USDC sang điểm mùa hoặc đồ trang trí, để vật phẩm và phần thưởng không quy đổi ra tiền.
4. **Nguồn lãi:** `setYieldSource(AaveV3YieldSource)` thay cho `MockYieldSource`.
5. **Bỏ DemoPriceFeed**, chỉ dùng Chainlink. Màn "hạn hán" chỉ còn ở testnet.
6. **Quyền owner:** dùng Safe 2/3 (hoặc FarmMultisig đã có test) cho mọi contract giữ tiền, kèm timelock cho `setYieldSource`, `setOracle` và `withdrawPool`.
7. **Fee manager:** nạp AVAX thật cho các ví trả gas, giữ hạn mức theo ví và theo IP, thêm cảnh báo khi số dư thấp. Khóa bí mật chỉ nằm trong secret của Cloudflare.
8. **Audit** bên ngoài cho FarmGame, FarmCoop, FarmPond, FarmQuests và ButlerAccount. CI đã có Slither, test bất biến ngẫu nhiên và test fork.
9. **Mỗi người chơi một ButlerAccount riêng** (factory), không dùng chung quản gia mẫu.
