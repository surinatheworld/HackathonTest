# Nông Trại DeFi

Game nông trại 2D để học DeFi trên Avalanche. Dự án cho **Team1 Vietnam UniHack 2026** (track *Game on L1*, topic 11 mở rộng).

Người chơi điều khiển nhân vật đi quanh làng. Mỗi công trình trong làng là một cơ chế DeFi thật. Trạng thái game chạy trên **Game L1** riêng (gas gần như bằng 0), tiền thật nằm ở **C-Chain**, hai bên nói chuyện qua **ICM (Teleporter)**.

> Trạng thái: contract đã viết và có test (11/11 pass), chạy end-to-end offline bằng `npm run local`. Deploy lên Fuji + Game L1 làm theo [docs/DEPLOY.md](docs/DEPLOY.md).

## Cấu trúc

```
contracts/                 Hardhat project
  contracts/l1/FarmLand.sol        Game L1: luống, cây, điểm, tưới, trộm điểm
  contracts/cchain/FarmVault.sol   C-Chain: cho vay 4%, khóa 7/30/90 ngày, quỹ thưởng
  contracts/cchain/ButlerAccount.sol  Ví quản gia AI: session key, rule, hạn mức, kill switch
  contracts/ICMApp.sol             Ghép cặp 2 contract qua TeleporterMessenger
  test/farm.test.js                Luồng ICM hai chiều, lending, game loop, guardrail
  scripts/                         deploy, link, smoke test, butler demo, local dev server
index.html                 Game 2D (canvas), mở thẳng hoặc qua GitHub Pages
prototype/                 chain.js (ethers v6) + chain-config.js cho chế độ on-chain
docs/DEPLOY.md             Hướng dẫn L1 + ICM Relayer trên Builder Console
```

## Chạy nhanh

```bash
cd contracts
npm install
npm test          # 11 test
npm run local     # mở http://localhost:8790/?wallet=dev
```

Chơi online: **https://hanazono-b9s.pages.dev/** (Cloudflare Pages, tự cập nhật khi push lên `main`). Chỉ xem giao diện mô phỏng offline: mở thẳng `index.html`.

- Di chuyển: `WASD` / phím mũi tên, hoặc chạm vào một khu trên bản đồ để nhân vật tự đi tới.
- Tương tác: đứng cạnh biển gỗ rồi bấm `E` (hoặc nút vàng ở dưới).
- `7×` tua nhanh thời gian, `Gây bão` ép giá AVAX giảm mạnh, `Bản thiết kế` xem kiến trúc.
- **Kết nối ví**: Ruộng rau, Vườn cây, Vườn hàng xóm chuyển sang contract thật.
- Debug trong console: `window.__farm` (`st`, `openZone`, `ACT`, `sim`), `window.FarmChain`.

## Các khu và cơ chế

| Khu | Cơ chế DeFi | Contract dự kiến | Chain |
|---|---|---|---|
| Ruộng rau | Cho vay stablecoin, rút bất cứ lúc nào | `FarmVault` ✓ | C-Chain |
| Vườn cây | Staking khóa 7 / 30 / 90 ngày (ớt, xoài, sầu riêng) | `FarmVault` + `FarmLand` qua ICM ✓ | L1 → C-Chain |
| Ao cá | LP USDC/AVAX, thời tiết lấy từ oracle giá (impermanent loss) | `PondLP` + `WeatherOracle` | C-Chain → L1 |
| Hợp tác xã | Thế chấp AVAX, vay USDC, thanh lý khi hệ số an toàn < 1 | `CoopLending` | C-Chain |
| Chợ phiên | AMM x·y = k, hiển thị trượt giá | DEX có sẵn trên Fuji | C-Chain |
| Nhà quản gia AI | Agent dùng session key, bị giới hạn bởi policy (hạn mức ngày, whitelist, kill switch); tư vấn trả phí qua x402 | `ButlerAccount` ✓ | C-Chain |
| Vườn bác Tư | "Trộm rau": hái điểm thưởng của hàng xóm, không đụng tiền gốc | `FarmLand` ✓ | Game L1 |
| Cổng làng | Thông điệp xuyên chain | `ICMApp` ✓ | L1 ↔ C-Chain |

Không có token game, không có random drop: mọi thứ tất định, tránh rủi ro bị coi là cờ bạc khi pitch tại Việt Nam.

## Ba câu pitch phải trả lời

1. **Why on-chain?** Tiền nằm trong vault người chơi tự giữ. Quản gia AI bị giới hạn bằng contract, không phải bằng lời hứa.
2. **Why Avalanche?** Game state trên L1 riêng (gas ≈ 0), tiền thật ở C-Chain, ICM nối hai bên.
3. **Tiền từ đâu?** Yield thật từ protocol (Aave/Benqi trên Fuji), phí LP và quỹ tài trợ mùa vụ.

## Lộ trình

- [x] Prototype game 2D và mô phỏng cơ chế
- [x] Contract C-Chain: `FarmVault` (lending + 3 tier), `ButlerAccount` (guardrail), kèm test
- [x] Contract Game L1: `FarmLand` (crop, điểm, streak, trộm điểm)
- [x] Luồng ICM hai chiều: plant / harvest / uproot ↔ receipt
- [x] Nối game với ví (Core / MetaMask) cho Ruộng rau, Vườn cây, Vườn hàng xóm
- [x] Chạy offline end-to-end (`npm run local`)
- [ ] Tạo Farm L1 + ICM Relayer trên Builder Console, deploy Fuji (xem docs/DEPLOY.md)
- [ ] Đưa Ao cá (LP), Hợp tác xã (vay thế chấp) lên contract
- [ ] Agent quản gia chạy thật (rule-based + LLM giải thích) và endpoint tư vấn x402
- [ ] Pixel art thật thay cho đồ họa vẽ bằng code

## Mốc thời gian

- 02/11/2026: Opening Event
- 21/11/2026 23:59: hạn nộp bài
- 30/11/2026: Demo Day
