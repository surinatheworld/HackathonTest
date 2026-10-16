# Deploy lên Avalanche: Fuji C-Chain + Game L1 + ICM Relayer

Kiến trúc:

```
 Game L1 (Farm L1)                         Fuji C-Chain
 ┌────────────────────┐   ICM / Teleporter  ┌───────────────────────┐
 │ FarmLand           │ ── PLANT ─────────▶ │ FarmVault             │
 │  plots, crops,     │ ◀──── PLANTED ───── │  khóa USDC theo tier  │
 │  points, steal     │ ── HARVEST ───────▶ │  trả gốc + lãi        │
 │  (gas ≈ 0)         │ ◀─── HARVESTED ──── │  quỹ thưởng tài trợ   │
 └────────────────────┘        ▲            │ ButlerAccount (agent) │
                               │            │ MockUSDC (faucet)     │
                        ICM Relayer         └───────────────────────┘
                     (Builder Console)
```

TeleporterMessenger có cùng địa chỉ `0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf` trên mọi chain. Fuji đã có sẵn; L1 của mình phải deploy thêm. Relayer là dịch vụ off-chain: nếu không chạy relayer, thư được gửi đi nhưng không bao giờ tới nơi.

## Cách nhanh nhất: deploy bằng ví của bạn trên web

Mở **https://hanazono-b9s.pages.dev/deploy.html**, kết nối Core/MetaMask bằng ví dự án `0x54A2276F134d3Cfaa7572BC326092fABa6352888`, rồi bấm lần lượt:

1. **Deploy lên Fuji**: MockUSDC, FarmVault (nạp 50.000 USDC test vào quỹ thưởng), ButlerAccount và 3 rule. Khoảng 9 lần ký, tốn 0,1–0,2 AVAX.
2. **Farm L1**: điền RPC URL và Chain ID từ My L1 Dashboard, bấm **Kiểm tra L1** (kiểm tra RPC, chainId và TeleporterMessenger), rồi **Deploy FarmLand**.
3. **Nối hai chain**: 2 lần ký `setRemote`.
4. **Quản gia AI**: cấp session key cho ví agent (mặc định `0x6fC6866A2bcD264ABd80640D72659d0336A1550c`, khóa nằm trong `contracts/.env` của nhóm) với hạn mức 200 USDC/ngày, nạp 500 USDC test vào ButlerAccount, và gửi 0,1 AVAX làm gas cho agent. Nút **Thu hồi ngay** là kill switch.

Ví bạn là deployer và owner của mọi contract. Trang không bao giờ hỏi private key. Tiến trình được lưu trong trình duyệt: đóng trang giữa chừng thì mở lại và bấm tiếp, các bước đã xong sẽ tự bỏ qua. Mới xong Fuji thì game đã chơi on-chain được Ruộng rau trên trình duyệt đó.

Để mọi người cùng chơi, commit cấu hình. Người trong nhóm có repo chạy:

```bash
cd contracts
npm run sync-config -- 0x54A2276F134d3Cfaa7572BC326092fABa6352888 --l1-rpc <RPC URL của Farm L1>
```

Sau đó, cũng trong `contracts/`:

```bash
npm run verify:fuji   # công khai source MockUSDC, FarmVault, ButlerAccount trên testnet.snowtrace.io
npm run butler:demo   # agent gửi tiền trong hạn mức, lệnh bị prompt injection bị revert
```

Script sync-config tìm contract mà ví đã tạo trên Fuji, đọc địa chỉ FarmLand từ FarmVault, rồi ghi `prototype/chain-config.js`. Commit và push file đó, Cloudflare Pages sẽ cập nhật sau khoảng 1 phút. Cách khác là sao chép nội dung ở bước 5 của trang deploy.

Các bước dưới đây là cách deploy bằng script (ví deploy riêng trong `.env`), dùng khi không deploy trên web.

## 0. Chạy thử offline trước (không cần testnet)

```bash
cd contracts
npm install
npm test
npm run local
```

Mở `http://localhost:8790/?wallet=dev`. Lệnh này chạy một Hardhat node, deploy toàn bộ contract, một relayer giả lập chuyển thư ICM mỗi 2 giây, và một ví dev không cần MetaMask. Bỏ `?wallet=dev` nếu muốn dùng MetaMask/Core trỏ vào `http://127.0.0.1:8545` (chainId 31337).

## 1. Tạo ví deploy (chỉ dùng cho testnet)

```bash
cd contracts
npm run wallet
```

Lệnh này in ra **Deployer address** và **Agent address**, khóa được lưu vào `contracts/.env` (đã gitignore). Không bao giờ dùng ví này cho tiền thật.

## 2. Lấy AVAX test trên Fuji

Builder Console → **Testnet Faucet**: gửi Fuji AVAX tới Deployer address. Khoảng 1–2 AVAX là đủ cho toàn bộ deploy và demo.

## 3. Tạo Game L1

Builder Console → **Create L1** (đăng nhập bằng tài khoản Builder Hub):

- Tên: `Farm L1`, token gas: `FARM`, chọn một chainId chưa ai dùng.
- Ở phần genesis / phân bổ token: thêm **Deployer address** với một lượng FARM lớn để trả gas.
- Bật ICM nếu có tuỳ chọn. Nếu không, sau khi tạo xong vào **Cross-Chain → ICM Setup** để deploy **TeleporterMessenger** và **TeleporterRegistry** lên L1.
- Dùng **Testnet Infrastructure → Testnet Nodes** nếu cần node được quản lý. Ghi lại **RPC URL** và **chainId** từ **My L1 Dashboard**.

## 4. Bật ICM Relayer

Builder Console → **Testnet Infrastructure → ICM Relayer**:

- Chọn hai chain: **Fuji C-Chain** và **Farm L1**, chiều relay **cả hai hướng**.
- Nếu console yêu cầu, nạp gas cho địa chỉ relayer trên cả hai chain (AVAX trên Fuji, FARM trên L1).

## 5. Điền `.env`

```
L1_RPC_URL=<RPC URL từ My L1 Dashboard>
L1_CHAIN_ID=<chainId của Farm L1>
L1_NAME=Farm L1
L1_TOKEN_SYMBOL=FARM
DAY_LENGTH=60
```

`DAY_LENGTH=60` nghĩa là 1 ngày game = 60 giây: cây ớt (7 ngày) chín sau 7 phút, vừa đủ để demo trước giám khảo.

## 6. Deploy và nối hai chain

```bash
npm run deploy
```

Lệnh này lần lượt:

1. `deploy:fuji`: MockUSDC, FarmVault (nạp 50.000 USDC vào quỹ thưởng), ButlerAccount với các rule.
2. `deploy:l1`: FarmLand. Script dừng lại báo lỗi nếu TeleporterMessenger chưa có trên L1.
3. `link:fuji` và `link:l1`: ghép FarmVault ↔ FarmLand bằng blockchainID đọc từ Warp precompile, rồi sinh `prototype/chain-config.js`.

Địa chỉ được lưu ở `contracts/deployments/fuji.json` và `farml1.json`.

## 7. Kiểm tra end-to-end

```bash
npm run smoke
```

Script trồng 1 cây ớt trên L1 và chờ biên nhận ICM từ C-Chain (tối đa 3 phút). Nếu hết giờ, kiểm tra lại relayer ở bước 4.

```bash
npm run butler:demo
```

Chỉ dùng ví agent (`AGENT_PRIVATE_KEY`), nên owner phải cấp quyền trước ở bước 4 của deploy.html (hoặc gọi `setAgent`). Quản gia AI gửi tiền vào Ruộng rau trong hạn mức. Sau đó thử một lệnh bị prompt injection, chuyển hết USDC ra ngoài, và bị `ButlerAccount` revert ngay trên Fuji.

## 8. Chơi trên testnet

Mở `index.html` qua GitHub Pages (Settings → Pages → nhánh `main`, thư mục gốc). Đừng chạy `npx serve` ở thư mục gốc trên máy mình, vì nó sẽ phục vụ luôn `contracts/.env`; chạy local thì dùng `npm run local`. Bấm **Kết nối ví** (Core hoặc MetaMask). Ví sẽ tự thêm Fuji và Farm L1 nếu chưa có.

- **Ruộng rau**: deposit, claim, withdraw thật trên Fuji.
- **Vườn cây**: trồng trên L1, thư ICM sang Fuji khóa USDC, biên nhận về L1. Có thêm tưới, nhổ sớm, thu hoạch.
- **Vườn hàng xóm**: gom điểm, thuê người giữ vườn, hái trộm điểm của địa chỉ bạn bè trên L1.
- Ao cá, Chợ phiên, Hợp tác xã và Quản gia trong game vẫn chạy mô phỏng. Contract quản gia thật được demo bằng `npm run butler:demo`.

## Relayer: dùng relayer của nhóm, không dùng relayer managed

Thực tế trên testnet (16/10/2026):
- Cả 3 relayer managed tạo trên Builder Console đều báo **Unreachable** và không chuyển thư nào.
- Node managed của Farm L1 v2 **ngừng ra block** khi mempool có giao dịch mang thư Warp từ Fuji. Thay giao dịch đó bằng giao dịch thường thì chain chạy lại ngay.

Vì vậy thiết kế được chỉnh như sau:
- **FarmLand chạy optimistic**: trồng, thu hoạch hay nhổ đều cập nhật trên L1 ngay, rồi gửi **một thư ICM L1 → C-Chain**.
- **FarmVault là nguồn sự thật về tiền.** Game đọc trạng thái khóa trực tiếp trên Fuji. Biên nhận C-Chain → L1 mặc định tắt (`setReceiptsEnabled`).
- **Lối thoát**: `claimLock` / `exitLock` cho chủ cây rút thẳng trên Fuji nếu thư bị lạc.
- **Đổi L1 không phải deploy lại Fuji**: owner gọi lại `setRemote`.

Chạy relayer của nhóm (cần ví trong `.env` có AVAX trên Fuji và token gas trên L1):

```bash
cd contracts
FUJI_RPC_URL=https://avalanche-fuji-c-chain-rpc.publicnode.com npm run relayer
```

Relayer đọc thư Teleporter trên L1, xin chữ ký qua dịch vụ gom chữ ký công khai của Avalanche (Glacier), rồi gọi `receiveCrossChainMessage` trên Fuji, kèm thư Warp đã ký trong access list. Chiều ngược lại chỉ bật khi đặt `RELAYER_C_TO_L1=1`. Lần chạy đầu tiên trên Fuji, relayer đã chuyển thành công thư trồng cây #1: [tx](https://testnet.snowtrace.io/tx/0xd79167ab71bba9c75a3c84c48436939aefa21df443a7143a96f5e0d0d89235a0).

## Kiểm tra trên bản fork của Fuji

```bash
npm run test:fork
```

Lệnh này fork Fuji về máy rồi chạy thử trên **chính các contract đã deploy**: kiểm tra cấu hình, luồng cho vay (gửi, nhận lãi, rút), chỉ TeleporterMessenger thật mới được giao thông điệp, owner nâng `requiredGasLimit`, và quản gia (cấp quyền, gửi tiền trong hạn mức, các lệnh bị prompt injection bị revert, kill switch). Test giả làm ví owner nên không cần private key. Luồng ICM thì không chạy được trên fork vì Hardhat không có Warp precompile; phần đó phải thử trên Farm L1 thật.

## 9. Verify source trên Snowtrace

```bash
npm run verify:fuji
```

Lệnh này verify MockUSDC, FarmVault và ButlerAccount qua API Etherscan-compatible của Routescan. Bytecode mà deploy.html dùng được xuất từ đúng lần compile này (`npm run export-web`), nên source luôn khớp. Mỗi lần sửa contract phải chạy lại `export-web` trước khi deploy. FarmLand trên Farm L1 chỉ verify được nếu L1 có explorer hỗ trợ API tương tự.

## 10. Cloudflare Pages

Site đang chạy tại **https://hanazono-b9s.pages.dev/**, tự build lại mỗi lần push lên `main`.

- Cài đặt project: Framework preset **None**, Build command **để trống**, Build output directory **`/`**. Không cần bước build: `index.html` nằm ở thư mục gốc, `prototype/chain.js` và `prototype/chain-config.js` được tải kèm.
- Link dạng `https://<mã>.hanazono-b9s.pages.dev` là **bản deploy cố định của một commit cũ**, không bao giờ được cập nhật. Khi chia sẻ cho giám khảo, luôn dùng link production ở trên.
- Sau khi `npm run deploy` sinh `prototype/chain-config.js` mới, commit và push file đó. Pages build lại trong khoảng 1 phút. File `_headers` tắt cache cho trang và config, nên người chơi nhận địa chỉ contract mới ngay.
- Chế độ on-chain cần ví trình duyệt (Core hoặc MetaMask). RPC của Farm L1 phải cho phép gọi từ trình duyệt (CORS). Node của Builder Console mặc định cho phép. Nếu tự chạy node, đặt `--http-allowed-origins="*"`.
- `.env` nằm trong `.gitignore` nên không bao giờ lên GitHub hay Pages.

## Đối chiếu yêu cầu chương trình (topic 11, DeFi Farm)

| Yêu cầu MVP | Trong repo |
|---|---|
| Game L1 dựng bằng Avalanche tooling: plot, crop, lớn theo thời gian | `FarmLand.sol` trên Farm L1 tạo từ Builder Console |
| Vault trên C-Chain với 3 tier khóa (mock yield) | `FarmVault.sol`: 7 / 30 / 90 ngày, 6 / 9 / 14%, quỹ thưởng tài trợ |
| Một luồng ICM: trồng trên L1 → deposit trên C-Chain, thu hoạch → claim yield | PLANT / PLANTED, HARVEST / HARVESTED, hai chiều, có test |
| Frontend game 2D + dev toggle nén thời gian | `index.html`, `prototype/`, `DAY_LENGTH` |
| Chạy trên Avalanche (L1 riêng, Fuji hoặc C-Chain) | Fuji C-Chain + Farm L1 |
| Demo được | `npm run local` (offline) và testnet |
| Bonus | ButlerAccount (agent guardrail, kill switch), tưới / streak / trộm điểm trên L1 |
| Nêu đúng giới hạn pháp lý tại Việt Nam | README, mục "Giới hạn pháp lý tại Việt Nam" |
| Gas cho ICM | `requiredGasLimit` = 1.000.000; test giả lập Teleporter cấp đúng hạn mức này |
