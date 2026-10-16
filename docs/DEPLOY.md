# Deploy: Fuji C-Chain + fee manager trả gas hộ

## 1. Bật fee manager trên Cloudflare Pages (bắt buộc, làm một lần)

Fee manager là file `functions/api/relay.js`. Cloudflare Pages tự nhận thư mục `functions/` khi build, không cần lệnh build. Nó chỉ cần **khóa của ví trả gas** dưới dạng biến môi trường được mã hoá:

1. Mở dashboard Cloudflare → **Workers & Pages** → project **hanazono** → **Settings** → **Variables and Secrets** (hoặc **Environment variables**).
2. Ở môi trường **Production**, bấm **Add** và chọn loại **Secret** (Encrypt):
   - Variable name: `RELAYER_PRIVATE_KEY`
   - Value: khóa riêng của ví trả gas `0x2683F2Ef9bF63F0C123D5232Cd651a6B6978f4FC`. Khóa này là dòng `PRIVATE_KEY=` trong `contracts/.env` trên máy đã deploy. Đây là ví testnet, không giữ tiền thật.
3. (Không bắt buộc) Thêm biến thường `FUJI_RPC_URL` nếu muốn dùng RPC khác RPC công khai.
4. Vào **Deployments**, bấm **Retry deployment** trên bản mới nhất, hoặc push một commit bất kỳ, để Pages nạp biến mới.
5. Kiểm tra: mở https://hanazono-b9s.pages.dev/api/relay. Phải thấy `"ready": true` và địa chỉ `0x2683…f4FC`.

Khi chưa có secret: người chơi dùng **MetaMask** vẫn chơi được, game tự chuyển sang tự trả gas. **Ví trong game** thì sẽ báo "Fee manager chưa bật".

**Nạp gas cho fee manager:** gửi AVAX test (Fuji) vào `0x2683F2Ef9bF63F0C123D5232Cd651a6B6978f4FC`. Phí trên Fuji rất thấp nên 0,3 AVAX đủ cho rất nhiều lượt.

**Chính sách của fee manager** (`functions/_lib/relay-core.js`):
- Chỉ trả gas cho hàm người chơi trên FarmGame, FarmCoop, FarmPond, GaslessUSDC và GaslessAVAX. Hàm owner như `invest`, `setOracle` thì owner tự trả gas.
- `approve` USDC chỉ được tới FarmGame, FarmCoop hoặc FarmPond. `approve` gAVAX chỉ được tới FarmCoop hoặc FarmPond.
- `value = 0`, gas tối đa 800.000, hạn request tối đa 1 giờ.
- Chữ ký, nonce và hạn được kiểm tra trên chain qua `FarmForwarder.verify`.
- Mô phỏng lời gọi trước khi gửi để trả lý do lỗi rõ ràng.

## 2. Deploy lại contract (khi cần)

```bash
cd contracts
npm install
npm run wallet          # tạo PRIVATE_KEY (ví deploy + trả gas) và AGENT_PRIVATE_KEY trong .env
# nạp Fuji AVAX cho ví deploy, đặt OWNER_ADDRESS=0x… (ví dự án) trong .env
npm run deploy:gasless  # toàn bộ contract, nạp quỹ thưởng, HTX, Ao cá, cấp quyền agent, chuyển owner
npm run verify:fuji     # verify source trên Snowtrace
npm run smoke:gasless   # ví mới 0 AVAX: ruộng, vườn, HTX, ao cá qua fee manager
npm run butler:demo     # agent AI trong hạn mức, lệnh prompt injection bị revert
npm run test:fork       # test trên chính các contract đã deploy
```

`deploy:gasless` tự chuyển owner của FarmGame và ButlerAccount sang `OWNER_ADDRESS`, rồi ghi lại `prototype/chain-config.js` và `functions/_lib/relay-config.js`. Commit và push hai file này để Pages dùng địa chỉ mới.

`npm run smoke:gasless -- https://hanazono-b9s.pages.dev/api/relay` chạy cùng bài kiểm tra qua fee manager trên Pages, thay vì chạy fee manager trên máy.

`SMOKE_LOCAL=1 npm run smoke:gasless` chạy cùng bài kiểm tra trên `npx hardhat node`, sau khi đã chạy `npx hardhat run scripts/deploy-local.js --network localhost`.

## 2b. Demo "hạn hán" trên sân khấu

Hợp tác xã đọc giá thật từ Chainlink, nên bình thường không thể cho giá AVAX sập theo ý muốn. Muốn demo thanh lý thì tạm chuyển HTX sang `DemoPriceFeed`. Việc chuyển này **chỉ owner** (ví `0x54A2…2888` của bạn) làm được, và ví cần một ít AVAX Fuji để trả gas.

1. Mở [FarmCoop trên Snowtrace](https://testnet.snowtrace.io/address/0x850aE1CF266CF902E443a82f1d94C3d94753d946#writeContract), mục **Write Contract**, bấm **Connect to Web3** bằng MetaMask (ví `0x54A2…2888`, mạng Fuji).
2. Gọi `setOracle`:
   - `oracle_` = `0x5ce867f0c55CAFeb5b0F370Ad10532116Bc45079` (DemoPriceFeed)
   - `maxPriceAge_` = `86400`

   Bấm **Write** và ký.
3. Trong game: nhận gAVAX, gửi 10 gAVAX vào kho thóc, vay gần tối đa.
4. Trên máy: `npm run drought -- 6`, giá AVAX về $6. Panel HTX báo hệ số an toàn dưới 1,0.
5. `npm run drought -- liquidate`: bot thanh lý trả nợ thay và lấy gAVAX kèm 10% phạt. Trên Snowtrace sẽ thấy event `Liquidated`.
6. Xong demo: `npm run drought -- reset`, rồi gọi lại `setOracle` với:
   - `oracle_` = `0x5498BB86BC934c8D34FDA08E81D444153d0D06aD` (Chainlink AVAX/USD)
   - `maxPriceAge_` = `172800`

## 2c. Rà bảo mật bằng Slither

Máy dùng để deploy chưa có Python nên chưa chạy được Slither. Tự chạy như sau:

```bash
# Cài Python 3.11+ từ python.org (tick "Add python.exe to PATH"), rồi:
pip install slither-analyzer
cd contracts
npx hardhat compile
slither . --filter-paths "node_modules|contracts/l1|contracts/test|ICMApp|FarmVault|MockUSDC"
```

Các điểm đã kiểm tra bằng test (`test/coop-pond.test.js`, `test/gasless.test.js`):
- Không rút cạn được quỹ thưởng: lãi bị chặn ở mức quỹ còn, gốc luôn trả đủ.
- Tối đa 12 cây mỗi vườn. Không trộm được của chính mình. Ví chưa trồng cây không được trộm.
- Chữ ký không phát lại được, không ai ký thay người khác được, request hết hạn bị từ chối.
- Giá Chainlink cũ thì không cho vay. Không nợ thì vẫn rút được thế chấp. Chỉ thanh lý được khi hệ số dưới 1,0.
- Ao cá có kiểm tra trượt giá. Ví người tạo pool bị khóa 1.000 share để không ai thổi phồng được giá share.
- Khóa phiên của agent tự hết hạn.

Kết quả Slither dạng "reentrancy" trên FarmCoop/FarmPond/FarmGame chủ yếu là báo nhầm: token là ERC-20 của chính dự án, không có hook gọi lại. Lỗi mức High hoặc Medium khác thì mở issue và báo cho người làm Blockchain.

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
