# Nông Trại DeFi

Game nông trại 2D để học DeFi trên Avalanche. Dự án cho **Team1 Vietnam UniHack 2026** (topic 11, DeFi Farm).

Người chơi điều khiển nhân vật đi quanh làng. Mỗi công trình là một cơ chế DeFi thật, chạy trên **Avalanche Fuji C-Chain**. Người chơi **không cần cài ví, không cần AVAX**: đăng nhập bằng *ví trong game*, mọi thao tác chỉ cần ký, còn **fee manager** của game trả gas hộ.

**Chơi:** https://hanazono-b9s.pages.dev/ → bấm **Kết nối ví** → **Ví trong game** → vào Ruộng rau bấm **Nhận 1.000 USDC test**.

## Kiến trúc

```
 Trình duyệt người chơi                     Cloudflare Pages                 Fuji C-Chain
 ┌──────────────────────┐   ký EIP-712     ┌──────────────────────┐  tx   ┌─────────────────────────┐
 │ Game 2D (index.html) │ ───────────────▶ │ Fee manager          │ ────▶ │ FarmForwarder (ERC-2771)│
 │ Ví trong game        │   (miễn phí)     │ functions/api/relay  │ trả   │   ├─▶ FarmGame ──▶ nguồn lãi
 │ hoặc MetaMask / Core │                  │ chỉ chuyển tiếp lệnh │ gas   │   ├─▶ FarmCoop ◀── Chainlink
 └──────────────────────┘                  │ tới contract game    │       │   ├─▶ FarmPond (x·y=k)  │
                                           └──────────────────────┘       │   └─▶ USDC, gAVAX test  │
                                                                          │ ButlerAccount (agent AI)│
                                                                          └─────────────────────────┘
```

- **FarmGame**:
  - Ruộng rau: cho vay 4%/năm.
  - Vườn cây: khóa 7/30/90 ngày game với lãi 6/9/14%.
  - Vòng chơi: tưới, chuỗi ngày, gom và trộm điểm mùa. Chỉ ví đang có cây mới được trộm, nên ví ảo tạo ra hàng loạt không cày được điểm qua fee manager.
  - Nguồn lãi: tiền nhàn rỗi được gửi vào một `IYieldSource` (trên Fuji là `MockYieldSource`, trên mainnet là `AaveV3YieldSource`). `harvestYield()` chuyển phần lãi kiếm được vào quỹ thưởng.
  - Mọi hàm dùng `_msgSender()`, nên chạy được cả khi gửi trực tiếp lẫn khi gửi qua fee manager.
- **FarmCoop** (Hợp tác xã): gửi gAVAX làm thế chấp, vay USDC tối đa 60% giá trị theo giá **Chainlink AVAX/USD** trên Fuji, lãi vay 8%/năm. Khi nợ vượt 75% giá trị, bất kỳ ai cũng có thể trả nợ thay và nhận gAVAX kèm 10% phạt. Giá cũ hơn 2 ngày thì không cho vay.
- **FarmPond** (Ao cá và Chợ phiên): pool x·y = k USDC/gAVAX, phí 0,3% chia cho người thả cá. `zapIn`/`zapOut` cho người chỉ có USDC. Impermanent loss trong game là thật.
- **FarmForwarder**: `ERC2771Forwarder` của OpenZeppelin. Kiểm tra chữ ký, nonce (chống phát lại) và hạn của request.
- **Fee manager** (`functions/api/relay.js`): Cloudflare Pages Function.
  - Chỉ trả gas cho các hàm người chơi trên contract của game. `approve` chỉ được tới contract của game.
  - Có trần gas, và hạn request tối đa 1 giờ.
  - Mô phỏng lệnh trước khi gửi để báo lỗi rõ ràng (ví dụ "Cây chưa chín").
- **Ví trong game**: khóa lưu trên trình duyệt, chỉ dùng cho testnet, sao lưu được. Ví chỉ ký dữ liệu, nên thay bằng ví nhúng như **Privy** về sau không phải đổi contract.
- **ButlerAccount**: ví của quản gia AI. Agent chỉ có session key, tự hết hạn sau 60 ngày, bị giới hạn bởi rule, hạn mức ngày và kill switch.

Event của mọi contract (cho indexer và bot) xem [docs/EVENTS.md](docs/EVENTS.md).

## Đã deploy trên Fuji C-Chain

Bản thứ ba (đã vá theo Slither, xem [docs/SECURITY.md](docs/SECURITY.md)), deploy ngày 17/10/2026. Owner là ví dự án `0x54A2276F134d3Cfaa7572BC326092fABa6352888`. Một ngày game dài 60 giây. Source đã verify trên Snowtrace.

| Contract | Địa chỉ |
|---|---|
| FarmGame | [`0x01443baD9354683eE2691cD8aDD88e34c557055F`](https://testnet.snowtrace.io/address/0x01443baD9354683eE2691cD8aDD88e34c557055F#code) |
| FarmCoop | [`0x51958d71f28F516C599Fcc4Dd71C4976A3E97aAf`](https://testnet.snowtrace.io/address/0x51958d71f28F516C599Fcc4Dd71C4976A3E97aAf#code) |
| FarmPond | [`0x33bA73746cCbe75eE5967Afa2EBfE07F6F543A37`](https://testnet.snowtrace.io/address/0x33bA73746cCbe75eE5967Afa2EBfE07F6F543A37#code) |
| GaslessUSDC | [`0x794659AB388EEec7f80038191bA763f900CE1978`](https://testnet.snowtrace.io/address/0x794659AB388EEec7f80038191bA763f900CE1978#code) |
| GaslessAVAX (gAVAX) | [`0xa1e8250Bcbab7436252e3c25764f8898913E7c1C`](https://testnet.snowtrace.io/address/0xa1e8250Bcbab7436252e3c25764f8898913E7c1C#code) |
| FarmForwarder | [`0x7dD93fef1ce942f11fc72E5BD7F53f749A028636`](https://testnet.snowtrace.io/address/0x7dD93fef1ce942f11fc72E5BD7F53f749A028636#code) |
| ButlerAccount | [`0xf60e1a6869d4d9C59F6e012D9ae4F14f08205293`](https://testnet.snowtrace.io/address/0xf60e1a6869d4d9C59F6e012D9ae4F14f08205293#code) |
| MockYieldSource | [`0x25578A396c89a410EF49a888314911A031185caA`](https://testnet.snowtrace.io/address/0x25578A396c89a410EF49a888314911A031185caA#code) |
| DemoPriceFeed | [`0xcaB8a5Ac5B5280B2D5b51EB5dF25958cF1dD602B`](https://testnet.snowtrace.io/address/0xcaB8a5Ac5B5280B2D5b51EB5dF25958cF1dD602B#code) |
| Chainlink AVAX/USD (Fuji) | `0x5498BB86BC934c8D34FDA08E81D444153d0D06aD` |
| Ví trả gas của fee manager | `0x2683F2Ef9bF63F0C123D5232Cd651a6B6978f4FC` |

Lúc deploy:
- Quỹ thưởng có 50.000 USDC, trong đó 40.000 USDC gửi vào nguồn lãi.
- Hợp tác xã có 50.000 USDC để cho vay.
- Ao cá có 20.000 USDC và 2.015,1 gAVAX, theo giá Chainlink lúc đó là $9,93.

**Bằng chứng trên Fuji** (`npm run smoke:gasless`, một ví mới, từ đầu đến cuối 0 AVAX):
- Ruộng rau và Vườn cây: faucet ([tx](https://testnet.snowtrace.io/tx/0xe32707387cf8a79ed084360589fba4474167f524de6adf1a07aec73788eacd25)), trồng 10 USDC ([tx](https://testnet.snowtrace.io/tx/0x91d94f198613b982bb54ef0e7bc58436d9d2854b85251743dd00285d34fa8d34)), gửi 50 USDC vào Ruộng rau ([tx](https://testnet.snowtrace.io/tx/0x99e95b3fba78d8395c788f29342a2b6ce379991fafcf022692b74a8d9bd7e3a8)).
- Hợp tác xã: gửi 5 gAVAX ([tx](https://testnet.snowtrace.io/tx/0xf2c8a59bd369f13530c930b2c3f1a75d43e351726a6194a06be3dae27f607d12)), vay 10 USDC ([tx](https://testnet.snowtrace.io/tx/0xac904fd0e9c7cfaeaaba3b9a218f7e5ef8f05ada56452352479d9b9e5575999e)).
- Ao cá: thả 100 USDC ([tx](https://testnet.snowtrace.io/tx/0x0a49c7e7d06ac2b752871e6a11df1b383f63c7de656236d4b27c6c0d18de850a)).
- Fee manager từ chối `approve` tới ví lạ (HTTP 403).
- Quản gia AI (`npm run butler:demo`): gửi 50 USDC trong hạn mức ([tx](https://testnet.snowtrace.io/tx/0xb8e728ab9b493ce37daa05e0b6dfebb189575bdb8b061c815a0b5bfb6a82a55f)). Ba lệnh do prompt injection bị contract chặn: `CallNotAllowed`, `ArgumentNotAllowed`, `DailyCapExceeded`.

Các bản trước vẫn còn trên Fuji, xem `contracts/deployments/fuji-gasless.json` trong `git log`.

## Cấu trúc

```
index.html                      Game 2D (canvas)
prototype/chain.js              Ví trong game / MetaMask, ký EIP-712, gửi qua fee manager
prototype/chain-config.js       Địa chỉ contract (sinh bởi deploy-gasless.js)
functions/api/relay.js          Fee manager (Cloudflare Pages Function)
functions/_lib/relay-core.js    Chính sách + gửi giao dịch, dùng chung cho Pages và server local
contracts/contracts/gasless/    FarmGame, FarmCoop, FarmPond, FarmForwarder, GaslessUSDC, GaslessAVAX
contracts/contracts/yield/      IYieldSource, MockYieldSource, AaveV3YieldSource
contracts/contracts/oracle/     DemoPriceFeed (dàn cảnh hạn hán khi demo)
contracts/contracts/cchain/     ButlerAccount (+ FarmVault, MockUSDC của bản L1 cũ)
contracts/contracts/l1/         FarmLand (bản L1 cũ, xem docs/L1-ARCHIVE.md)
contracts/test/                 gasless, coop-pond, farm (L1), fork/fuji.fork.js
docs/DEPLOY.md                  Deploy, fee manager, Cloudflare, demo hạn hán
docs/EVENTS.md                  Event cho indexer và bot
docs/TEAM-TASKS.md              Phân công kỹ thuật
docs/SECURITY.md                Kết quả Slither và các tình huống đã test
```

## Chạy nhanh

```bash
cd contracts
npm install
npm test            # 39 test
npm run test:fork   # 6 test trên chính các contract đang chạy ở Fuji
npm run local       # http://localhost:8790, chuỗi local + fee manager local
```

Trong game: **WASD / mũi tên** để đi, hoặc chạm vào một khu. **E** để mở. **Bản thiết kế** để xem kiến trúc. Khi đã kết nối ví, mọi khu trừ Quản gia đều dùng contract thật. Contract quản gia được demo bằng `npm run butler:demo`.

## Các khu và cơ chế

| Khu | Cơ chế DeFi | Trạng thái |
|---|---|---|
| Ruộng rau | Cho vay stablecoin, rút bất cứ lúc nào | On-chain (FarmGame) |
| Vườn cây | Khóa 7 / 30 / 90 ngày (ớt, xoài, sầu riêng) | On-chain (FarmGame) |
| Vườn bác Tư | Tưới, chuỗi ngày, trộm điểm thưởng (không đụng tiền gốc) | On-chain (FarmGame) |
| Cổng làng | Fee manager trả gas hộ | On-chain (FarmForwarder + /api/relay) |
| Nhà quản gia AI | Session key, hạn mức ngày, whitelist, kill switch | On-chain (ButlerAccount, demo bằng script) |
| Ao cá | LP x·y = k USDC/gAVAX, phí 0,3%, impermanent loss thật | On-chain (FarmPond) |
| Hợp tác xã | Thế chấp gAVAX, vay USDC theo giá Chainlink, thanh lý | On-chain (FarmCoop) |
| Chợ phiên | Swap trong Ao cá, trượt giá tối đa 1% | On-chain (FarmPond) |

Không có token game, không có random drop: mọi thứ tất định.

## Ba câu pitch phải trả lời

1. **Why on-chain?** Tiền nằm trong contract và chỉ chủ ví điều khiển được bằng chữ ký. Quản gia AI bị giới hạn bằng contract, không phải bằng lời hứa.
2. **Why Avalanche?** C-Chain finality dưới 2 giây và phí rất thấp, nên fee manager trả gas cho cả những thao tác nhỏ như tưới cây. Người chơi mới không cần biết gas là gì, và game lên mobile được.
3. **Tiền từ đâu?**
   - Lãi từ thị trường cho vay: FarmGame gửi tiền nhàn rỗi vào `IYieldSource`. Trên Fuji là bản mock, trên mainnet là adapter Aave v3 đã viết sẵn và có test.
   - Phí 0,3% của Ao cá trả cho người thả cá.
   - Lãi vay 8% ở Hợp tác xã.
   - Quỹ tài trợ mùa vụ.

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
- [x] Hợp tác xã (Chainlink, thanh lý) và Ao cá (x·y = k) trên contract
- [x] Nguồn lãi `IYieldSource`: mock trên Fuji, adapter Aave v3 cho mainnet
- [ ] Ví nhúng Privy (App ID đã có), giữ nguyên contract và fee manager
- [ ] Bot thanh lý, bot cân giá Ao cá theo Chainlink, indexer cho bảng xếp hạng
- [ ] Giới hạn lượt trả gas theo người chơi (Cloudflare KV), pixel art thật

## Lịch sử: bản Game L1

Bản đầu tiên dùng Farm L1 riêng và ICM (Teleporter) giữa L1 và Fuji. Thư L1 → Fuji đã chạy thật, nhưng hạ tầng testnet managed gặp lỗi: relayer managed không chạy, và node L1 ngừng ra block khi có thư Fuji → L1. Theo góp ý của mentor, dự án chuyển sang Fuji C-Chain cùng fee manager. Chi tiết và mã nguồn bản L1 xem [docs/L1-ARCHIVE.md](docs/L1-ARCHIVE.md).

## Mốc thời gian

- 02/11/2026: Opening Event
- 21/11/2026 23:59: hạn nộp bài
- 30/11/2026: Demo Day
