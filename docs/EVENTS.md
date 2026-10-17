# Event on-chain (cho Backend làm indexer)

Địa chỉ các contract nằm trong `prototype/chain-config.js` (khóa `cchain.*`) và `contracts/deployments/fuji-gasless.json`. ABI đầy đủ có trong `prototype/artifacts.js`, hoặc tạo lại bằng `cd contracts && npm run export-web`.

## Quy ước

- **Đơn vị**:
  - USDC có 6 chữ số thập phân (`1 USDC = 1_000_000`).
  - gAVAX có 18 chữ số thập phân.
  - Giá có 8 chữ số thập phân, giống feed Chainlink.
  - Điểm mùa (`points`, `ripePoints`) là số nguyên, không có phần thập phân.
- **Người chơi**: mọi giao dịch đi qua fee manager nên `tx.from` là ví trả gas `0x2683…f4FC`, không phải người chơi. Luôn lấy địa chỉ người chơi từ **tham số của event**.
- **Ngày game**: `day = floor(block.timestamp / dayLength)`, với `dayLength` lấy trong `chain-config.js` (hiện là 60 giây).
- **Đọc log trên Fuji**:
  - RPC công khai `api.avax-test.network` chỉ cho `eth_getLogs` **tối đa 100 block mỗi lần**, tức khoảng 3 phút. Dùng nó để đọc bám theo block mới.
  - Đọc lịch sử thì dùng Routescan (API của Snowtrace): `https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api?module=logs&action=getLogs&address=<contract>&topic0=<topic>&fromBlock=<startBlock>&toBlock=latest&page=1&offset=1000`. Mỗi trang tối đa 1.000 log. Có ví dụ chạy được trong `contracts/scripts/drought.js` (hàm `liquidateAll`).
  - Điểm bắt đầu là block lúc deploy, lấy từ `startBlock` trong `contracts/deployments/fuji-gasless.json`.

## FarmGame (`cchain.game`)

| Event | Tham số | Ý nghĩa |
|---|---|---|
| `Planted` | `cropId` (indexed), `owner` (indexed), `tier`, `amount` | Trồng cây. `tier` 0/1/2 = 7/30/90 ngày, APY 6/9/14% |
| `CropClosed` | `cropId` (indexed), `owner` (indexed), `status`, `payout`, `points` | `status` 2 = thu hoạch (gốc + lãi), 3 = nhổ sớm (chỉ gốc). `points` là điểm mùa được cộng khi thu hoạch |
| `Watered` | `cropId` (indexed), `owner` (indexed), `ripePoints`, `streak` | Tưới cây, `ripePoints` là số điểm chín vừa được cộng |
| `Collected` | `owner` (indexed), `amount` | Gom điểm chín thành điểm mùa |
| `Stolen` | `thief` (indexed), `victim` (indexed), `amount` | Hái trộm 40% điểm chín của hàng xóm |
| `GuardSet` | `owner` (indexed), `guarded` | Bật/tắt người giữ vườn |
| `Deposited` | `user` (indexed), `amount` | Gửi USDC vào Ruộng rau |
| `Withdrawn` | `user` (indexed), `amount` | Rút gốc khỏi Ruộng rau |
| `YieldClaimed` | `user` (indexed), `amount` | Nhận lãi Ruộng rau |
| `RewardsFunded` | `from` (indexed), `amount` | Nạp quỹ thưởng |
| `YieldSourceSet` | `source` (indexed) | Owner đổi nguồn lãi |
| `Invested` / `Divested` | `amount`, `invested` | Tiền nhàn rỗi vào/ra nguồn lãi |
| `YieldHarvested` | `amount`, `rewardReserve` | Lãi thật từ nguồn lãi chuyển vào quỹ thưởng |
| `OwnershipTransferred` | `previous` (indexed), `next` (indexed) | Đổi owner |

**Bảng xếp hạng**: điểm mùa của một ví = tổng `Collected.amount` + tổng `CropClosed.points` + tổng `Stolen.amount` khi ví là `thief`. Kiểm tra chéo bằng `farmers(address).points`.

## FarmCoop (`cchain.coop`)

| Event | Tham số | Ý nghĩa |
|---|---|---|
| `CollateralDeposited` | `user` (indexed), `amount` | Gửi gAVAX vào kho thóc |
| `CollateralWithdrawn` | `user` (indexed), `amount` | Rút gAVAX |
| `Borrowed` | `user` (indexed), `amount`, `debt` | Vay phân bón (USDC). `debt` là nợ sau khi vay, đã gồm lãi |
| `Repaid` | `user` (indexed), `payer` (indexed), `amount`, `debt` | Trả nợ (người khác trả hộ cũng được) |
| `Liquidated` | `user` (indexed), `liquidator` (indexed), `debtRepaid`, `collateralSeized` | Thanh lý |
| `OracleSet` | `oracle` (indexed), `maxPriceAge` | Đổi feed giá |
| `LiquidityFunded` | `from` (indexed), `amount` | Nạp USDC cho HTX cho vay |

**Bot thanh lý (việc của Backend)**: định kỳ gọi `healthOf(user)` cho các ví còn nợ. Ví nào dưới `10000` thì gọi `liquidate(user)` bằng một ví bot có USDC và đã `approve` cho FarmCoop. Bot nhận gAVAX trị giá nợ cộng 10%.

## FarmPond (`cchain.pond`)

| Event | Tham số | Ý nghĩa |
|---|---|---|
| `LiquidityAdded` | `user` (indexed), `usdcIn`, `avaxIn`, `shares` | Thả cá (thêm thanh khoản) |
| `LiquidityRemoved` | `user` (indexed), `usdcOut`, `avaxOut`, `shares` | Vớt cá |
| `Swapped` | `user` (indexed), `usdcIn` (true = mua gAVAX), `amountIn`, `amountOut` | Swap. `zapIn`/`zapOut` cũng phát event này cho phần được swap |

**Bot cân giá (tùy chọn, việc của Backend)**: so `poolPrice()` với `FarmCoop.price()`. Lệch quá 2% thì `swap` một lượng nhỏ để kéo giá pool về giá Chainlink.

## ButlerAccount (`cchain.butler`)

| Event | Tham số | Ý nghĩa |
|---|---|---|
| `AgentSet` | `agent` (indexed), `dailyCap`, `validUntil` | Cấp khóa phiên cho agent AI, hết hạn lúc `validUntil` |
| `AgentRevoked` | `agent` (indexed) | Owner thu hồi |
| `RuleSet` | `target` (indexed), `selector` (indexed), `allowed`, `amountArg`, `firstArg` | Thêm/sửa rule |
| `Executed` | `by` (indexed), `target` (indexed), `selector` (indexed), `counted` | Agent hoặc owner chạy một lệnh. `counted` là số USDC tính vào hạn mức |

## FarmItems (`cchain.items`): Kho đồ

ERC-1155. Id: nông sản = `loại × 1e9 + ngày thu hoạch` (loại 1 ớt, 2 xoài, 3 sầu riêng; hỏng sau 7 ngày game), huy hiệu 1001–1007, đồ trang trí 2001–2006. Ngoài các event dưới đây còn có `TransferSingle`/`TransferBatch` chuẩn ERC-1155.

| Event | Tham số | Ý nghĩa |
|---|---|---|
| `HarvestClaimed` | `user`, `cropId`, `itemId` (indexed), `amount` | Nhận nông sản của cây đã thu hoạch |
| `BadgeEarned` | `user`, `badgeId` (indexed) | Nhận huy hiệu (không chuyển được) |
| `WatchStarted` | `user`, `badgeId` (indexed), `day` | Bắt đầu tính ngày cho huy hiệu Người nuôi cá / Vay an toàn |
| `TrophyAwarded` | `season`, `user` (indexed) | Owner trao Cúp mùa vụ (tối đa 10 mỗi mùa) |
| `Bought` | `user`, `id` (indexed), `amount`, `points` | Mua đồ trang trí bằng điểm mùa |
| `Crafted` | `user`, `id` (indexed) | Ghép Mâm ngũ quả |
| `HatEquipped` | `user`, `id` (indexed) | Đội nón (0 = nón thường) |
| `Discarded` | `user`, `id` (indexed), `amount` | Bỏ nông sản |
| `OfferMade` | `offerId`, `maker`, `taker` (indexed), `expires`, `fee` | Đăng đề nghị đổi đồ. `taker` = 0 là công khai. Đọc chi tiết bằng `offer(offerId)` |
| `OfferTaken` | `offerId`, `taker` (indexed), `fee` | Đổi xong |
| `OfferCancelled` | `offerId` (indexed) | Huỷ hoặc hết hạn, đồ về lại người đăng |

**Bảng đổi đồ**: `offerCount()` rồi `offer(i)` cho các id mới nhất; đề nghị còn mở khi `open && expires >= now`. Điểm mùa còn dùng được: `pointsOf(address)` (điểm FarmGame trừ phần đã tiêu ở đây).

## Token

`GaslessUSDC` (`cchain.usdc`) và `GaslessAVAX` (`cchain.gavax`) là ERC-20 chuẩn: `Transfer(from, to, value)`, `Approval(owner, spender, value)`. Lần nhận faucet là `Transfer` từ `0x0000…0000`.
