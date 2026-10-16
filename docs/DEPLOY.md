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
- Chỉ trả gas cho FarmGame và GaslessUSDC. `approve` chỉ được tới FarmGame.
- `value = 0`, gas tối đa 800.000, hạn request tối đa 1 giờ.
- Chữ ký, nonce và hạn được kiểm tra trên chain qua `FarmForwarder.verify`.
- Mô phỏng lời gọi trước khi gửi để trả lý do lỗi rõ ràng.

## 2. Deploy lại contract (khi cần)

```bash
cd contracts
npm install
npm run wallet          # tạo PRIVATE_KEY (ví deploy + trả gas) và AGENT_PRIVATE_KEY trong .env
# nạp Fuji AVAX cho ví deploy, đặt OWNER_ADDRESS=0x… (ví dự án) trong .env
npm run deploy:gasless  # FarmForwarder, GaslessUSDC, FarmGame (+50.000 USDC quỹ thưởng), ButlerAccount
npm run verify:fuji     # verify source trên Snowtrace
npm run smoke:gasless   # ví mới 0 AVAX: faucet, approve, plant, deposit qua fee manager
npm run butler:demo     # agent AI trong hạn mức, lệnh prompt injection bị revert
npm run test:fork       # test trên chính các contract đã deploy
```

`deploy:gasless` tự chuyển owner của FarmGame và ButlerAccount sang `OWNER_ADDRESS`, rồi ghi lại `prototype/chain-config.js` và `functions/_lib/relay-config.js`. Commit và push hai file này để Pages dùng địa chỉ mới.

`npm run smoke:gasless -- https://hanazono-b9s.pages.dev/api/relay` chạy cùng bài kiểm tra qua fee manager trên Pages, thay vì chạy fee manager trên máy.

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
