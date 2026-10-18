# Deploy: Fuji C-Chain + fee manager trả gas hộ

## 1. Bật fee manager trên Cloudflare Pages (bắt buộc, làm một lần)

Fee manager là file `functions/api/relay.js`. Cloudflare Pages tự nhận thư mục `functions/` khi build, không cần lệnh build. Nó chỉ cần **khóa của ví trả gas** dưới dạng biến môi trường được mã hoá:

1. Mở dashboard Cloudflare → **Workers & Pages** → project **hanazono** → **Settings** → **Variables and Secrets** (hoặc **Environment variables**).
2. Ở môi trường **Production**, bấm **Add** và chọn loại **Secret** (Encrypt):
   - Variable name: `RELAYER_PRIVATE_KEY`
   - Value: khóa riêng của ví trả gas, là dòng `RELAYER_PRIVATE_KEY=` trong `contracts/.env`. Đây là ví testnet, chỉ giữ AVAX trả gas. **Không bao giờ** đưa `PRIVATE_KEY` (ví deploy, ví duy nhất in được tiền test) lên Cloudflare.
3. (Không bắt buộc) Thêm biến thường `FUJI_RPC_URL` nếu muốn dùng RPC khác RPC công khai.
4. Vào **Deployments**, bấm **Retry deployment** trên bản mới nhất, hoặc push một commit bất kỳ, để Pages nạp biến mới.
5. Kiểm tra: mở https://hanazono-b9s.pages.dev/api/relay. Phải thấy `"ready": true` và địa chỉ ví trả gas.

Khi chưa có secret: người chơi dùng **MetaMask** vẫn chơi được, game tự chuyển sang tự trả gas. **Ví trong game** thì sẽ báo "Fee manager chưa bật".

**Nạp gas cho fee manager:** `npm run fund:relayers` (ví deploy nạp cho các ví trả gas có trong `relay-config.js`), hoặc gửi AVAX test (Fuji) vào ví trả gas (địa chỉ hiện ở `/api/relay`). Phí trên Fuji rất thấp nên 0,3 AVAX đủ cho rất nhiều lượt.

**Chính sách của fee manager** (`functions/_lib/relay-core.js`):
- Chỉ trả gas cho hàm người chơi trên FarmGame, FarmCoop, FarmPond, GaslessUSDC và GaslessAVAX. Hàm owner như `invest`, `setOracle` thì owner tự trả gas.
- `approve` USDC chỉ được tới FarmGame, FarmCoop hoặc FarmPond. `approve` gAVAX chỉ được tới FarmCoop hoặc FarmPond.
- `value = 0`, gas tối đa 800.000, hạn request tối đa 15 phút.
- Chữ ký, nonce và hạn được kiểm tra trên chain qua `FarmForwarder.verify`.
- Mô phỏng lời gọi trước khi gửi để trả lý do lỗi rõ ràng.

**Sửa script trong `index.html`?** Chạy `npm run csp` trong `contracts/` để cập nhật mã băm trong `_headers`, nếu không trình duyệt sẽ chặn script đó (test `site-and-scripts.test.js` báo lỗi trước).

## 2. Deploy lại contract (khi cần)

```bash
cd contracts
npm install
npm run wallet -- --split-relayer  # lần đầu sau Vòng 4: khóa cũ thành RELAYER_PRIVATE_KEY (ví trả gas, giữ nguyên AVAX),
                                   # tạo PRIVATE_KEY mới (ví deploy, chỉ ở máy này) và AGENT_PRIVATE_KEY
# nạp Fuji AVAX cho ví deploy mới, đặt OWNER_ADDRESS=0x… (ví dự án) trong .env
# ví trả gas lấy từ RELAYER_PRIVATE_KEY (hoặc đặt RELAYER_ADDRESSES=0x…,0x…); deploy dừng nếu trùng ví deploy hay owner
npm run deploy:gasless  # toàn bộ contract, nạp quỹ thưởng, HTX, Ao cá, cấp quyền agent, chuyển owner
npm run verify:fuji     # verify source trên Snowtrace
npm run smoke:gasless   # ví mới 0 AVAX: ruộng, vườn, HTX, ao cá qua fee manager (ghi tx vào deployments/fuji-proof.json)
BUTLER_ONCHAIN_ATTACK=1 npm run butler:demo  # quản gia gửi tiền trong hạn mức, lệnh lừa bị hợp đồng chặn (cũng ghi tx)
npm run proof:readme    # viết lại phần "Bằng chứng trên Fuji" trong README và link tx bị chặn trong game
npm run test:fork       # test trên chính các contract đã deploy
```

`deploy:gasless` tự chuyển owner của FarmGame, FarmCoop, FarmItems, FarmQuests và ButlerAccount sang `OWNER_ADDRESS` (DemoPriceFeed ở lại với ví deploy), ghi địa chỉ vườn bác Tư vào cấu hình game, rồi ghi lại `prototype/chain-config.js` và `functions/_lib/relay-config.js`. Commit và push hai file này để Pages dùng địa chỉ mới.

`npm run smoke:gasless -- https://hanazono-b9s.pages.dev/api/relay` chạy cùng bài kiểm tra qua fee manager trên Pages, thay vì chạy fee manager trên máy.

`SMOKE_LOCAL=1 npm run smoke:gasless` chạy cùng bài kiểm tra trên `npx hardhat node`, sau khi đã chạy `npx hardhat run scripts/deploy-local.js --network localhost`.

## 2b. Demo "hạn hán" trên sân khấu

Hợp tác xã đọc giá thật từ Chainlink, nên bình thường không thể cho giá AVAX sập theo ý muốn. Muốn demo thanh lý thì tạm chuyển HTX sang `DemoPriceFeed`. Việc chuyển này **chỉ owner** (ví `0x54A2…2888` của bạn) làm được, và ví cần một ít AVAX Fuji để trả gas.

1. Mở [FarmCoop trên Snowtrace](https://testnet.snowtrace.io/address/0x51958d71f28F516C599Fcc4Dd71C4976A3E97aAf#writeContract), mục **Write Contract**, bấm **Connect to Web3** bằng MetaMask (ví `0x54A2…2888`, mạng Fuji).
2. Gọi `setOracle`:
   - `oracle_` = `0xcaB8a5Ac5B5280B2D5b51EB5dF25958cF1dD602B` (DemoPriceFeed)
   - `maxPriceAge_` = `86400`

   Bấm **Write** và ký.
3. Trong game: nhận gAVAX, gửi 10 gAVAX vào kho thóc, vay gần tối đa.
4. Trên máy: `npm run drought -- 6`, giá AVAX về $6. Panel HTX báo hệ số an toàn dưới 1,0.
5. `npm run drought -- liquidate`: bot thanh lý trả nợ thay và lấy gAVAX kèm 10% phạt. Trên Snowtrace sẽ thấy event `Liquidated`.
6. Xong demo: `npm run drought -- reset`, rồi gọi lại `setOracle` với:
   - `oracle_` = `0x5498BB86BC934c8D34FDA08E81D444153d0D06aD` (Chainlink AVAX/USD)
   - `maxPriceAge_` = `172800`

Diễn tập trước toàn bộ kịch bản trên bản fork của Fuji (không cần khóa, không đụng chain thật): `npm run rehearse:drought`.

## 2c. Rà bảo mật bằng Slither

Đã chạy Slither 0.11.6 ngày 17/10/2026. Kết quả, các lỗi đã sửa và lệnh để chạy lại có trong [SECURITY.md](SECURITY.md).

## 3. Chạy offline

```bash
cd contracts
npm run local           # http://localhost:8790
```

Lệnh này khởi động một Hardhat node, deploy cả bộ contract, chạy fee manager local bằng chính `relay-core.js`, rồi phục vụ game. Vào **Kết nối ví → Ví trong game** để chơi không cần gas.

## 4. Cloudflare Pages

- Cấu hình project: Framework preset **None**, Build command **để trống**, Build output directory **`/`**.
- `functions/` được Pages tự dựng thành Pages Functions. `functions/_lib/ethers.min.js` là bản build ESM của ethers v6.13.4 đặt sẵn trong repo, nên không cần bước build.
- `_headers` tắt cache cho trang và cấu hình.
- Luôn chia sẻ link production `https://hanazono-b9s.pages.dev/`. Link dạng `<mã>.hanazono-b9s.pages.dev` là bản cố định của một commit cũ.
