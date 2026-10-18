# Nông Trại DeFi

[![CI](https://github.com/surinatheworld/HackathonBlockchain/actions/workflows/ci.yml/badge.svg)](https://github.com/surinatheworld/HackathonBlockchain/actions/workflows/ci.yml)

Game nông trại 2D để học DeFi trên Avalanche, làm cho **Team1 Vietnam UniHack 2026** (topic 11, DeFi Farm).

> **Dự án đã dừng (10/2026).** Repo được giữ lại làm kỷ niệm. Game vẫn chạy trên Fuji testnet cho tới khi hết AVAX trả gas, mọi tiền trong game là tiền test, không có giá trị.

**Chơi thử:** https://hanazono-b9s.pages.dev/ → **Kết nối ví** → **Ví trong game** → vào Ruộng rau bấm **Nhận 1.000 USDC test**.

## Ý tưởng

Sinh viên Việt Nam lớn lên với game nông trại nhưng thấy DeFi khô khan. Game biến mỗi khái niệm DeFi thành một việc nhà nông quen thuộc:

| Trong game | Ngoài đời (DeFi) |
|---|---|
| Ruộng rau: gieo hạt, thu lãi | Gửi tiền cho vay, rút lúc nào cũng được |
| Vườn cây: ớt 7 ngày, xoài 30 ngày, sầu riêng 90 ngày | Khóa kỳ hạn, khóa lâu lãi cao; nhổ sớm thì mất lãi, không mất gốc |
| Ao cá: thả cá, vớt cá | Góp tiền vào pool x·y=k, nhận phí đổi tiền, chịu tổn thất tạm thời |
| Hợp tác xã: gửi thóc, vay phân bón | Vay thế chấp theo giá Chainlink, có thanh lý |
| Chợ phiên | Đổi tiền trong pool, chống trượt giá |
| Nhà quản gia | Ví tự động bị giới hạn bằng hợp đồng: hạn mức ngày, danh sách được phép, nút tắt |
| Kho đồ, nhiệm vụ, huy hiệu | 18 bài học từ dễ đến khó, contract tự kiểm tra |

Không có token game, không quay thưởng ngẫu nhiên, vật phẩm và điểm không đổi ra tiền.

## Cách hoạt động

```
 Trình duyệt                       Cloudflare Pages                  Avalanche Fuji C-Chain
 ┌──────────────────┐  ký EIP-712  ┌──────────────────┐  trả gas  ┌───────────────────────────┐
 │ Game 2D (canvas) │ ───────────▶ │ Fee manager      │ ────────▶ │ FarmForwarder (ERC-2771)  │
 │ Ví trong game,   │  (miễn phí)  │ /api/relay       │           │  ├─ FarmGame ─▶ nguồn lãi  │
 │ Privy, MetaMask  │              │ Indexer làng     │ ◀──────── │  ├─ FarmCoop ◀─ Chainlink  │
 └──────────────────┘              │ /api/village     │ Data API  │  ├─ FarmPond, FarmItems   │
                                   └──────────────────┘           │  └─ FarmQuests, Butler    │
                                                                  └───────────────────────────┘
```

- **Không cần ví, không cần AVAX:** người chơi chỉ ký, fee manager trả gas hộ (ERC-2771). Phí trên Avalanche gần như bằng 0 nên trả hộ được cả những việc nhỏ như tưới cây.
- **Tiền lãi từ đâu:** tiền nhàn rỗi được gửi vào một nguồn lãi (trên Fuji là bản mô phỏng trả từ quỹ có sẵn; adapter Aave v3 thật đã chạy thử trên bản sao mainnet). Thưởng thêm lấy từ quỹ có giới hạn, hết quỹ thì dừng, không in thêm tiền.
- **Công nghệ Avalanche:** Fuji C-Chain, Avalanche Data API (bảng tin, bảng xếp hạng làng), Chainlink AVAX/USD trên Fuji. Bản đầu tiên chạy trên L1 riêng và đã gửi thật một thư ICM sang Fuji, xem [docs/L1-ARCHIVE.md](docs/L1-ARCHIVE.md).

## Contract trên Fuji

Bản cuối, deploy ngày 18/10/2026, source đã verify trên Snowtrace. Một ngày game dài 60 giây.

| Contract | Địa chỉ |
|---|---|
| FarmGame | [`0x7B15cA22181fB2Af2Ff917029aac7c2762E00de7`](https://testnet.snowtrace.io/address/0x7B15cA22181fB2Af2Ff917029aac7c2762E00de7#code) |
| FarmCoop | [`0xb5d5Dc33fEa8F1039a2Aad494fFfeE8E66FA6b1f`](https://testnet.snowtrace.io/address/0xb5d5Dc33fEa8F1039a2Aad494fFfeE8E66FA6b1f#code) |
| FarmPond | [`0x221FAcc3c67b3CC27C6201420b391a3a56037EdD`](https://testnet.snowtrace.io/address/0x221FAcc3c67b3CC27C6201420b391a3a56037EdD#code) |
| FarmItems | [`0x3B00C43b50abCea3da10D011f615A86CBEDcA387`](https://testnet.snowtrace.io/address/0x3B00C43b50abCea3da10D011f615A86CBEDcA387#code) |
| FarmQuests | [`0xDC24c3709D330652130F7692E6b46673DcbDbCd8`](https://testnet.snowtrace.io/address/0xDC24c3709D330652130F7692E6b46673DcbDbCd8#code) |
| ButlerAccount | [`0xba5201E9De888356612E508ECEB5F4563e8E2fb7`](https://testnet.snowtrace.io/address/0xba5201E9De888356612E508ECEB5F4563e8E2fb7#code) |
| FarmForwarder | [`0x7712F60E50a910717167DBd6136CBEc05e55F798`](https://testnet.snowtrace.io/address/0x7712F60E50a910717167DBd6136CBEc05e55F798#code) |
| GaslessUSDC | [`0xaB3BC36C05cE1f2660358A6ce1936eB76E7fC0a8`](https://testnet.snowtrace.io/address/0xaB3BC36C05cE1f2660358A6ce1936eB76E7fC0a8#code) |
| GaslessAVAX | [`0x932Ca0f7D0f804f40D68e098925E3d1D5bc71Bf4`](https://testnet.snowtrace.io/address/0x932Ca0f7D0f804f40D68e098925E3d1D5bc71Bf4#code) |
| MockYieldSource | [`0xE3ce94DF448fDFc86d1aaD313ae0dE5e5cF48d5B`](https://testnet.snowtrace.io/address/0xE3ce94DF448fDFc86d1aaD313ae0dE5e5cF48d5B#code) |
| DemoPriceFeed | [`0xA6125D51a1BF1C8a1deaa3d1cFC358aad1BA7A75`](https://testnet.snowtrace.io/address/0xA6125D51a1BF1C8a1deaa3d1cFC358aad1BA7A75#code) |

**Bằng chứng chạy thật** (do script ghi lại, không sửa tay):

<!-- proof:start -->
- Một ví mới, 0 AVAX từ đầu đến cuối (`npm run smoke:gasless`, fee manager trả gas): nhận USDC test ([tx](https://testnet.snowtrace.io/tx/0x49f60c969d2fca6165fa3ae4d041b5ded9b7a609be52d3fa830302bca3c4fc05)), trồng 10 USDC ([tx](https://testnet.snowtrace.io/tx/0xcc4e3d3a46daf958b3a01e1b2b9addee5084f52e48a715557b0de5ab2fa16701)), gửi 50 USDC vào Ruộng rau ([tx](https://testnet.snowtrace.io/tx/0xf64bbfd15c550088eeee61a810b82c206f38f1bfd7999c0fbdfe64daad40a7d2)), gửi 5 gAVAX ở Hợp tác xã ([tx](https://testnet.snowtrace.io/tx/0x6e816dc4e416760662d31e4715201fb33a3dcf22c3f76f2e708c125f1e79f1c0)), vay 10 USDC ([tx](https://testnet.snowtrace.io/tx/0xdc8e89e98b3c89b3039f9c7c8a5b9bdf63205dffdf7ac44ebaaf6a07e005f4e4)), thả 100 USDC xuống Ao cá ([tx](https://testnet.snowtrace.io/tx/0x86f6c5037020199cbee71b67edf7190a67fc8b6a2f0f4fdeda81074eb946f798)).
- Quản gia tự động (`npm run butler:demo`): quản gia gửi 50.0 USDC trong hạn mức ([tx](https://testnet.snowtrace.io/tx/0xd66984e7ae32d88cff148d0a25c692ea3dfc99bb87a1f8f79c28033489b384f7)), lệnh chuyển hết tiền cho kẻ lạ bị hợp đồng chặn ([tx](https://testnet.snowtrace.io/tx/0xfee4e6307090d9b01dd119d7a28a0f17939fbc56717f81d740482a9d0ada93b0)).
<!-- proof:end -->

## Chạy trên máy

```bash
cd contracts
npm install
npm test          # 101 test, kèm fuzz bất biến cho các quỹ tiền
npm run local     # http://localhost:8790: chuỗi local + fee manager local, không cần ví thật
```

Trong game: **WASD / mũi tên** để đi, **E** để mở một khu, nút **Thiết kế** để xem kiến trúc. Không kết nối ví thì game chạy ở chế độ mô phỏng.

Deploy lại từ đầu xem [docs/DEPLOY.md](docs/DEPLOY.md). Các script deploy cần khóa ví testnet trong `contracts/.env` (tạo bằng `npm run wallet`, không bao giờ commit).

## Cấu trúc

```
index.html, prototype/      Game 2D (canvas), ví trong game, ký EIP-712
functions/                  Cloudflare Pages Functions: fee manager (/api/relay), indexer làng (/api/village)
contracts/contracts/        Solidity: gasless/ (game), yield/, oracle/, governance/ (multisig), l1/ + cchain/ (bản L1 cũ)
contracts/test/             Test Hardhat, fuzz bất biến, test trên bản sao Fuji và mainnet
docs/                       Deploy, event, bảo mật, ghi chép bản L1
```

## Hành trình

- **Bản 1 (L1 riêng + ICM):** game chạy trên Farm L1, tiền ở C-Chain, đồng bộ bằng ICM. Thư L1 → Fuji đã chạy thật bằng relayer tự viết, nhưng relayer có sẵn của testnet không hoạt động ([ava-labs/builders-hub#4761](https://github.com/ava-labs/builders-hub/issues/4761)). Theo góp ý của mentor, dự án chuyển sang Fuji C-Chain cùng fee manager.
- **Bản 2–5 (Fuji, gasless):** thêm Hợp tác xã, Ao cá, Kho đồ, nhiệm vụ, quản gia, indexer làng.
- **Soát lỗi:** nhiều vòng AI soát chéo và một AI đóng vai giám khảo chấm theo thể lệ UniHack (khoảng 74/100). Các lỗ hổng tìm được (in tiền test tự do, rút cạn quỹ nhiệm vụ, trả gas hai lần cho một chữ ký, phá huy hiệu người khác…) đều đã sửa và có test, chi tiết trong [docs/SECURITY.md](docs/SECURITY.md).
- **Bài học từ mentor:** giám khảo nhìn game bằng con mắt GameFi nên dễ hiểu nhầm thành "chơi để kiếm tiền", và chỉ có khoảng 3 phút để thuyết phục. Nhóm quyết định dừng dự án và chuyển sang hướng khác.

## Pháp lý

Dự án chỉ chạy trên testnet: USDC trong game là token test tự phát hành, không có giá trị, không có token game, vật phẩm không đổi ra tiền và không có yếu tố may rủi. Nếu đưa lên mainnet sẽ phải đáp ứng khung thí điểm tài sản mã hóa (Nghị quyết 05/2025/NQ-CP), giấy phép game online (Nghị định 147/2024/NĐ-CP) và Luật Công nghiệp công nghệ số. Đây không phải tư vấn pháp lý.
