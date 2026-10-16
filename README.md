# Nông Trại DeFi

Game nông trại 2D để học DeFi trên Avalanche. Dự án cho **Team1 Vietnam UniHack 2026** (track *Game on L1*, topic 11 mở rộng).

Người chơi điều khiển nhân vật đi quanh làng. Mỗi công trình trong làng là một cơ chế DeFi thật. Trạng thái game chạy trên **Game L1** riêng (gas gần như bằng 0), tiền thật nằm ở **C-Chain**, hai bên nói chuyện qua **ICM (Teleporter)**.

> Trạng thái hiện tại: **prototype giao diện + mô phỏng**. Số dư, giá AVAX và giao dịch đều chạy trong trình duyệt, chưa có smart contract hay kết nối chain.

## Chạy prototype

Mở `prototype/index.html` bằng trình duyệt. Không cần cài gì.

- Di chuyển: `WASD` / phím mũi tên, hoặc chạm vào một khu trên bản đồ để nhân vật tự đi tới.
- Tương tác: đứng cạnh biển gỗ rồi bấm `E` (hoặc nút vàng ở dưới).
- `7×` tua nhanh thời gian, `Gây bão` ép giá AVAX giảm mạnh, `Bản thiết kế` xem kiến trúc.
- Debug trong console: `window.__farm` (`st`, `openZone`, `ACT`, `sim`).

## Các khu và cơ chế

| Khu | Cơ chế DeFi | Contract dự kiến | Chain |
|---|---|---|---|
| Ruộng rau | Cho vay stablecoin, rút bất cứ lúc nào | `LendingVault` | C-Chain |
| Vườn cây | Staking khóa 7 / 30 / 90 ngày (ớt, xoài, sầu riêng) | `TierVault` | C-Chain |
| Ao cá | LP USDC/AVAX, thời tiết lấy từ oracle giá (impermanent loss) | `PondLP` + `WeatherOracle` | C-Chain → L1 |
| Hợp tác xã | Thế chấp AVAX, vay USDC, thanh lý khi hệ số an toàn < 1 | `CoopLending` | C-Chain |
| Chợ phiên | AMM x·y = k, hiển thị trượt giá | DEX có sẵn trên Fuji | C-Chain |
| Nhà quản gia AI | Agent dùng session key, bị giới hạn bởi policy (hạn mức ngày, whitelist, kill switch); tư vấn trả phí qua x402 | `SmartAccount` + `PolicyModule` | C-Chain |
| Vườn bác Tư | "Trộm rau": hái điểm thưởng của hàng xóm, không đụng tiền gốc | `Points` | Game L1 |
| Cổng làng | Thông điệp xuyên chain | ICM sender / receiver | L1 ↔ C-Chain |

Không có token game, không có random drop: mọi thứ tất định, tránh rủi ro bị coi là cờ bạc khi pitch tại Việt Nam.

## Ba câu pitch phải trả lời

1. **Why on-chain?** Tiền nằm trong vault người chơi tự giữ. Quản gia AI bị giới hạn bằng contract, không phải bằng lời hứa.
2. **Why Avalanche?** Game state trên L1 riêng (gas ≈ 0), tiền thật ở C-Chain, ICM nối hai bên.
3. **Tiền từ đâu?** Yield thật từ protocol (Aave/Benqi trên Fuji), phí LP và quỹ tài trợ mùa vụ.

## Lộ trình

- [x] Prototype game 2D và mô phỏng cơ chế
- [ ] Contract C-Chain: `LendingVault`, `TierVault`, `CoopLending`, `SmartAccount` + `PolicyModule` (Foundry, kèm test)
- [ ] Game L1 (Avalanche CLI / Builder Hub) với `Farm`, `Plot`, `Points`
- [ ] Luồng ICM: gieo hạt trên L1 → deposit trên C-Chain → receipt về L1
- [ ] Nối prototype với Fuji qua embedded wallet
- [ ] Agent quản gia (rule-based + LLM giải thích) và endpoint tư vấn x402
- [ ] Pixel art thật thay cho đồ họa vẽ bằng code

## Mốc thời gian

- 02/11/2026: Opening Event
- 21/11/2026 23:59: hạn nộp bài
- 30/11/2026: Demo Day
