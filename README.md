# Nông Trại DeFi

Game nông trại 2D để học DeFi trên Avalanche. Dự án cho **Team1 Vietnam UniHack 2026** (topic 11, DeFi Farm).

Người chơi điều khiển nhân vật đi quanh làng. Mỗi công trình là một cơ chế DeFi thật, chạy trên **Avalanche Fuji C-Chain**. Người chơi **không cần cài ví, không cần AVAX**: đăng nhập bằng *ví trong game*, mọi thao tác chỉ cần ký, còn **fee manager** của game trả gas hộ.

**Chơi:** https://hanazono-b9s.pages.dev/ → bấm **Kết nối ví** → **Ví trong game** → vào Ruộng rau bấm **Nhận 1.000 USDC test**.

## Kiến trúc

```
 Trình duyệt người chơi                     Cloudflare Pages                 Fuji C-Chain
 ┌──────────────────────┐   ký EIP-712     ┌──────────────────────┐  tx   ┌─────────────────────────┐
 │ Game 2D (index.html) │ ───────────────▶ │ Fee manager          │ ────▶ │ FarmForwarder (ERC-2771)│
 │ Ví trong game        │   (miễn phí)     │ functions/api/relay  │ trả   │   ├─▶ FarmGame          │
 │ hoặc MetaMask / Core │                  │ chỉ chuyển tiếp lệnh │ gas   │   └─▶ GaslessUSDC       │
 └──────────────────────┘                  │ tới contract game    │       │ ButlerAccount (agent AI)│
                                           └──────────────────────┘       └─────────────────────────┘
```

- **FarmGame**: Ruộng rau (cho vay 4%/năm), Vườn cây (khóa 7/30/90 ngày game, 6/9/14%), tưới, chuỗi ngày, gom và trộm điểm mùa. Mọi hàm dùng `_msgSender()`, nên chạy được cả khi gửi trực tiếp lẫn khi gửi qua fee manager.
- **FarmForwarder**: `ERC2771Forwarder` của OpenZeppelin. Kiểm tra chữ ký, nonce (chống phát lại) và hạn của request.
- **Fee manager** (`functions/api/relay.js`): Cloudflare Pages Function. Chỉ trả gas cho FarmGame và GaslessUSDC, `approve` chỉ được tới FarmGame, có trần gas và hạn request tối đa 1 giờ. Mô phỏng lệnh trước khi gửi để báo lỗi rõ ràng (ví dụ "Cây chưa chín").
- **Ví trong game**: khóa lưu trên trình duyệt, chỉ dùng cho testnet, sao lưu được. Ví chỉ ký dữ liệu, nên thay bằng ví nhúng như **Privy** về sau không phải đổi contract.
- **ButlerAccount**: ví của quản gia AI. Agent chỉ có session key, bị giới hạn bởi rule, hạn mức ngày và kill switch.

## Đã deploy trên Fuji C-Chain

Owner: ví dự án `0x54A2276F134d3Cfaa7572BC326092fABa6352888`. Một ngày game dài 60 giây. Source đã verify trên Snowtrace.

| Contract | Địa chỉ |
|---|---|
| FarmGame | [`0xEa6351629bf8b11f1d6B303e29781cD99723234F`](https://testnet.snowtrace.io/address/0xEa6351629bf8b11f1d6B303e29781cD99723234F#code) |
| GaslessUSDC | [`0xC76C1B20EC95389d8418AFE3f1600A1dE8BbC219`](https://testnet.snowtrace.io/address/0xC76C1B20EC95389d8418AFE3f1600A1dE8BbC219#code) |
| FarmForwarder | [`0xda504CC0E7eA94d7aB97F0c0b03bBA1A1D8b0368`](https://testnet.snowtrace.io/address/0xda504CC0E7eA94d7aB97F0c0b03bBA1A1D8b0368#code) |
| ButlerAccount | [`0x685F5a5840ACa1Fac6884c7E49998071B6A74c06`](https://testnet.snowtrace.io/address/0x685F5a5840ACa1Fac6884c7E49998071B6A74c06#code) |
| Ví trả gas của fee manager | `0x2683F2Ef9bF63F0C123D5232Cd651a6B6978f4FC` |

**Đã chạy thật trên Fuji** (`npm run smoke:gasless`): một ví mới với 0 AVAX đã nhận USDC ([0xac17e981…](https://testnet.snowtrace.io/tx/0xac17e98148f0e373512a24b1b084938a3eeb8bb8539f754a8418f3f0fff42d4d)), approve ([0x56f421cc…](https://testnet.snowtrace.io/tx/0x56f421cc77db2844d116b93fcf461286fb3d160840d21285ef3d67dfb1bf376f)), trồng 10 USDC ([0x0ac80ec8…](https://testnet.snowtrace.io/tx/0x0ac80ec871a2c73c996ff6295643dbe5f92038c39805f3fedad4348b4cf35ef3)) và gửi 50 USDC vào Ruộng rau ([0xda9d7781…](https://testnet.snowtrace.io/tx/0xda9d7781568931197056d9fd91371036017ec357e33411569378f2861c4c6cd3)), cuối cùng vẫn 0 AVAX. Quản gia AI (`npm run butler:demo`) gửi 50 USDC trong hạn mức ([0xb842766d…](https://testnet.snowtrace.io/tx/0xb842766d72f9ee7e63f95ca9a9ffabc9c4a76c4176ce4799d7acc36ee5357447)), còn các lệnh bị prompt injection đều revert.

## Cấu trúc

```
index.html                      Game 2D (canvas)
prototype/chain.js              Ví trong game / MetaMask, ký EIP-712, gửi qua fee manager
prototype/chain-config.js       Địa chỉ contract (sinh bởi deploy-gasless.js)
functions/api/relay.js          Fee manager (Cloudflare Pages Function)
functions/_lib/relay-core.js    Chính sách + gửi giao dịch, dùng chung cho Pages và server local
contracts/contracts/gasless/    FarmGame, FarmForwarder, GaslessUSDC
contracts/contracts/cchain/     ButlerAccount (+ FarmVault, MockUSDC của bản L1 cũ)
contracts/contracts/l1/         FarmLand (bản L1 cũ, xem docs/L1-ARCHIVE.md)
contracts/test/                 gasless.test.js, farm.test.js, fork/fuji.fork.js
docs/DEPLOY.md                  Deploy, fee manager, Cloudflare
```

## Chạy nhanh

```bash
cd contracts
npm install
npm test            # 26 test
npm run test:fork   # 3 test trên chính các contract đang chạy ở Fuji
npm run local       # http://localhost:8790, chuỗi local + fee manager local
```

Trong game: **WASD / mũi tên** để đi, hoặc chạm vào một khu. **E** để mở. **Bản thiết kế** để xem kiến trúc. Ao cá, Chợ phiên, Hợp tác xã và Quản gia trong game vẫn là mô phỏng. Contract quản gia thật được demo bằng `npm run butler:demo`.

## Các khu và cơ chế

| Khu | Cơ chế DeFi | Trạng thái |
|---|---|---|
| Ruộng rau | Cho vay stablecoin, rút bất cứ lúc nào | On-chain (FarmGame) |
| Vườn cây | Khóa 7 / 30 / 90 ngày (ớt, xoài, sầu riêng) | On-chain (FarmGame) |
| Vườn bác Tư | Tưới, chuỗi ngày, trộm điểm thưởng (không đụng tiền gốc) | On-chain (FarmGame) |
| Cổng làng | Fee manager trả gas hộ | On-chain (FarmForwarder + /api/relay) |
| Nhà quản gia AI | Session key, hạn mức ngày, whitelist, kill switch | On-chain (ButlerAccount, demo bằng script) |
| Ao cá | LP, thời tiết theo oracle giá (impermanent loss) | Mô phỏng |
| Hợp tác xã | Thế chấp AVAX, vay USDC, thanh lý | Mô phỏng |
| Chợ phiên | AMM x·y = k, trượt giá | Mô phỏng |

Không có token game, không có random drop: mọi thứ tất định.

## Ba câu pitch phải trả lời

1. **Why on-chain?** Tiền nằm trong contract và chỉ chủ ví điều khiển được bằng chữ ký. Quản gia AI bị giới hạn bằng contract, không phải bằng lời hứa.
2. **Why Avalanche?** C-Chain finality dưới 2 giây và phí rất thấp, nên fee manager trả gas cho cả những thao tác nhỏ như tưới cây. Người chơi mới không cần biết gas là gì, và game lên mobile được.
3. **Tiền từ đâu?** Yield từ protocol (bản MVP dùng quỹ thưởng tài trợ, bước tiếp theo nối Aave/Benqi), phí LP và quỹ tài trợ mùa vụ.

## Giới hạn pháp lý tại Việt Nam

Đề bài yêu cầu pitch phải nêu đúng giới hạn pháp lý. Dự án được thiết kế để nằm trong các giới hạn sau:

- **Chỉ chạy trên testnet.** Avalanche Fuji là mạng thử nghiệm. USDC trong game là token test do chính dự án mint, không có giá trị và không quy đổi ra tiền thật.
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

- [x] Game 2D, mô phỏng đầy đủ các cơ chế
- [x] FarmGame trên Fuji: cho vay, khóa theo mức, vòng chơi hằng ngày
- [x] Fee manager trả gas hộ (ERC-2771 + Cloudflare Pages Function), ví trong game không cần cài
- [x] ButlerAccount: agent AI có guardrail, chạy thật trên Fuji
- [x] Verify source trên Snowtrace, test fork trên contract thật
- [ ] Ví nhúng Privy (App ID đã có), giữ nguyên contract và fee manager
- [ ] Yield thật từ Aave/Benqi, đưa Hợp tác xã và Ao cá lên contract
- [ ] Giới hạn lượt trả gas theo người chơi (Cloudflare KV), pixel art thật

## Lịch sử: bản Game L1

Bản đầu tiên dùng Farm L1 riêng và ICM (Teleporter) giữa L1 và Fuji. Thư L1 → Fuji đã chạy thật, nhưng hạ tầng testnet managed gặp lỗi: relayer managed không chạy, và node L1 ngừng ra block khi có thư Fuji → L1. Theo góp ý của mentor, dự án chuyển sang Fuji C-Chain cùng fee manager. Chi tiết và mã nguồn bản L1 xem [docs/L1-ARCHIVE.md](docs/L1-ARCHIVE.md).

## Mốc thời gian

- 02/11/2026: Opening Event
- 21/11/2026 23:59: hạn nộp bài
- 30/11/2026: Demo Day
