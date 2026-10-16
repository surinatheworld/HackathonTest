# Nông Trại DeFi

Game nông trại 2D để học DeFi trên Avalanche. Dự án cho **Team1 Vietnam UniHack 2026** (track *Game on L1*, topic 11 mở rộng).

Người chơi điều khiển nhân vật đi quanh làng. Mỗi công trình trong làng là một cơ chế DeFi thật. Trạng thái game chạy trên **Game L1** riêng (gas gần như bằng 0), tiền thật nằm ở **C-Chain**, hai bên nói chuyện qua **ICM (Teleporter)**.

> Trạng thái: contract đã viết và có test (11/11 pass), chạy end-to-end offline bằng `npm run local`. Deploy lên Fuji + Game L1 làm theo [docs/DEPLOY.md](docs/DEPLOY.md).

## Đã deploy

Owner của mọi contract là ví dự án `0x54A2276F134d3Cfaa7572BC326092fABa6352888`. Script deploy bằng ví test, sau đó chuyển owner sang ví dự án (`scripts/handover.js`). Một ngày game dài 60 giây. Source trên Fuji đã được verify trên Snowtrace.

| Contract | Chain | Địa chỉ |
|---|---|---|
| FarmVault | Fuji C-Chain | [`0x08fF981e08406C51919a308E0C98b6236f34a75d`](https://testnet.snowtrace.io/address/0x08fF981e08406C51919a308E0C98b6236f34a75d#code) |
| MockUSDC | Fuji C-Chain | [`0x4cCD2fb3BF5EE5F28622fc75D98bE8D4D96d6802`](https://testnet.snowtrace.io/address/0x4cCD2fb3BF5EE5F28622fc75D98bE8D4D96d6802#code) |
| ButlerAccount | Fuji C-Chain | [`0x02bae56fc883c07842fa85D93BA4eCC6766DdD98`](https://testnet.snowtrace.io/address/0x02bae56fc883c07842fa85D93BA4eCC6766DdD98#code) |
| FarmLand | Farm L1 v2 (`384487`) | `0x4A241A4BCf34F0FFE4ff28Cc641058CFCB87CBa8` |

Farm L1 v2: blockchainID `2SUS4cu2V7ZzwkhNohBGbJbkqP4orFvHLkKL1Hx3AMbX9wrEiE`, RPC `https://nodes-prod.43.207.73.245.sslip.io/ext/bc/2SUS4cu2V7ZzwkhNohBGbJbkqP4orFvHLkKL1Hx3AMbX9wrEiE/rpc`. Node managed của Builder Console hết hạn sau khoảng 3 ngày (19/10/2026). Đổi sang L1 mới thì owner gọi `setRemote`, không phải deploy lại Fuji.

**ICM chạy thật:** trồng cây #1 trên Farm L1 v2 (tx L1 `0x6bceca36b50117fbe641a465c120d3b01e7cc4f88d2f44da82a674fdada87eec`), relayer của nhóm chuyển thư sang Fuji trong 6,9 giây, FarmVault khóa 10 USDC ([tx Fuji](https://testnet.snowtrace.io/tx/0x75626ea57a928c5c3127dc28153a2cfd27ca2d0654321ffc0b16cd69527c6023)). Relayer: `npm run relayer` (xem docs/DEPLOY.md).

Bộ contract đầu tiên (FarmVault `0x0D53…Cc7D`, FarmLand `0xD268…94A5`) thuộc thiết kế cũ, cần biên nhận C-Chain → L1, nay không dùng nữa.

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

Deploy contract bằng ví của bạn: **https://hanazono-b9s.pages.dev/deploy.html** (xem [docs/DEPLOY.md](docs/DEPLOY.md)).

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

## Giới hạn pháp lý tại Việt Nam

Đề bài yêu cầu pitch phải nêu đúng giới hạn pháp lý. Dự án được thiết kế để nằm trong các giới hạn sau:

- **Chỉ chạy trên testnet.** Fuji và Farm L1 là mạng thử nghiệm. USDC trong game là token test do chính dự án mint, không có giá trị và không quy đổi ra tiền thật.
- **Không phát hành token, không gọi vốn.** Không có token game, không ICO/IDO, không bán vật phẩm. Quỹ thưởng là USDC test do nhà tài trợ hoặc nhóm nạp vào.
- **Không dùng tài sản mã hóa làm phương tiện thanh toán.** Theo pháp luật hiện hành, chỉ VND là phương tiện thanh toán hợp pháp. Game không bán hàng hóa hay dịch vụ lấy crypto.
- **Không có yếu tố may rủi.** Không random drop, không lootbox, không quay thưởng. Lợi nhuận tính theo công thức công khai. "Điểm mùa" chỉ là điểm thưởng, không đổi ra tiền hay tài sản, nên không có tính chất cờ bạc hay trò chơi có thưởng.
- **Không phải sản phẩm đầu tư hay tư vấn tài chính.** Lãi suất là mô phỏng để học cách DeFi vận hành. Quản gia AI chỉ thực hiện rule do người dùng đặt, không đưa khuyến nghị đầu tư.
- **Dữ liệu cá nhân.** Game không thu thập họ tên, email hay số điện thoại. Chỉ có địa chỉ ví công khai trên chain.
- **Nếu đưa lên mainnet** thì phải đáp ứng thêm:
  - Khung thí điểm thị trường tài sản mã hóa (Nghị quyết 05/2025/NQ-CP) chỉ cho phép giao dịch qua tổ chức được cấp phép.
  - Game online phải được cấp phép theo Nghị định 147/2024/NĐ-CP và không được cho quy đổi vật phẩm hay điểm ra tiền.
  - Luật Công nghiệp công nghệ số (hiệu lực từ 01/01/2026) có quy định riêng về tài sản số.

> Phần này là định hướng thiết kế để pitch, không phải tư vấn pháp lý. Trước khi ra mắt thật, cần nhờ luật sư kiểm tra lại các văn bản hiện hành.

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
