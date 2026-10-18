# Rà soát bảo mật contract

Ngày 17/10/2026. Phạm vi gồm:
- `contracts/gasless/`: FarmGame, FarmCoop, FarmPond, FarmForwarder, GaslessUSDC, GaslessAVAX
- `contracts/yield/`
- `contracts/oracle/`
- `contracts/cchain/ButlerAccount.sol`

Bản L1 cũ và các mock dùng cho test nằm ngoài phạm vi.

## Slither 0.11.6

```bash
pip install slither-analyzer
cd contracts
slither . --filter-paths "node_modules|contracts/l1|contracts/test|ICMApp|FarmVault|MockUSDC|interfaces" \
  --exclude-informational --exclude-optimization
```

| Mức | Lần chạy đầu | Sau khi sửa | Ghi chú |
|---|---|---|---|
| High | 0 | 0 | |
| Medium: `reentrancy-no-eth` | 8 | **0** | Đã thêm `ReentrancyGuard` cho mọi hàm có chuyển token trong FarmGame, FarmCoop, FarmPond. Đổi thứ tự thành ghi state trước, chuyển token sau. |
| Medium: `divide-before-multiply` | 1 | **0** | Sửa cách tính `FarmPond.positionOf().valueUsdc`. |
| Medium: `uninitialized-local` | 1 | **0** | `ButlerAccount.execute`: khởi tạo `counted = 0`. |
| Medium: `unused-return` | 2 | 1 | `AaveV3YieldSource.withdraw` giờ kiểm tra số tiền rút được. Mục còn lại là `FarmCoop.price()` cố ý bỏ qua `roundId`, `startedAt` và `answeredInRound`. |
| Medium: `incorrect-equality` | 10 | 10 | Báo nhầm: các phép so sánh bằng `==` là logic game (`tier == 0`, `lastWateredDay == today`, `debt == 0`), không phải so sánh số dư. |
| Low: `missing-zero-check` | 9 | 5 | Đã thêm kiểm tra địa chỉ 0 cho các hàm `transferOwnership`, `setOracle`, `setAgent`. Các mục còn lại nằm ở constructor, do script deploy truyền địa chỉ. |
| Low: `events-maths` | 3 | 0 | Thêm event cho `DemoPriceFeed` và `MockYieldSource`. |
| Low: `timestamp` | 24 | 24 | Game tính theo ngày (`block.timestamp / dayLength`). Validator chỉ lệch được vài giây, không ảnh hưởng. |

### FarmItems (Kho đồ), thêm ngày 17/10/2026

Slither: 0 High, không có reentrancy (mọi hàm thay đổi trạng thái có `nonReentrant`). Có 8 mục Medium, tất cả là báo nhầm:
- `uninitialized-local`: biến đếm bắt đầu từ 0 theo mặc định.
- `unused-return`: cố ý chỉ lấy vài trường khi đọc `crops`, `farmers`, `lends` của FarmGame.

13 test riêng (`test/items.test.js`) kiểm tra:
- Nông sản chỉ nhận được một lần cho mỗi cây, và hỏng sau 7 ngày.
- Không tặng được vật phẩm, không `approve` được.
- Huy hiệu được kiểm tra trên chain và không đổi được.
- Điểm mùa không âm.
- Phí đổi đồ không lách được bằng cách chia nhỏ.
- Đồ được giữ hộ (escrow) và trả lại khi huỷ hoặc hết hạn.
- Cúp mùa vụ tối đa 10 mỗi mùa.
- Chạy được gasless.

### FarmQuests (Nhiệm vụ)

- Có owner (bản đang chạy: ví deploy; từ lần deploy tới: ví owner, không bao giờ là ví trả gas). Owner chỉ rút được thưởng chưa dùng, không sửa được tiến độ hay phần thưởng đang nợ.
- Chỉ ví người chơi (trực tiếp hoặc qua forwarder) nhận được thưởng; một contract không thể tự làm người chơi. Lưu ý: nhiều ví tạo sẵn ngoài mạng vẫn chơi được, kể cả gom chung trong một lần gọi `executeBatch` của forwarder (có test).
- Trần chi thưởng: tối đa 1.000 USDC rời quỹ mỗi giờ (cả `complete` và `claimOwed`), phần vượt được ghi nợ. Một giao dịch không làm cạn quỹ được, và mỗi lần nạp quỹ dùng được lâu hơn.
- Hết quỹ thì vẫn qua nhiệm vụ, thưởng được ghi nợ và trả sau bằng `claimOwed()`.
- Mỗi nhiệm vụ chỉ nhận được một lần, theo đúng thứ tự.
- Điều kiện được đọc trực tiếp từ FarmGame, FarmCoop, FarmPond và FarmItems.
- Test trong `test/quests.test.js`: đi hết 18 nhiệm vụ, không nhảy cóc, chạy được gasless, chơi một mình vẫn qua nhiệm vụ Hái trộm (vườn bác Tư), 110 ví trong một giao dịch chỉ lấy được 1.000 USDC.

## Các tình huống có test (101 test thường, 12 test fork)

- **Quỹ thưởng không bị rút cạn**: lãi chỉ trả tới mức quỹ còn, gốc luôn được trả đủ, phần lãi thiếu được ghi lại để nhận sau (`coop-pond.test.js`).
- **Tiền test**: chỉ ví deploy in được; vòi mỗi ví 1 lần/giờ; một contract không tự nhận vòi được (`tokens.test.js`). Nhiều ví tạo sẵn thì vẫn nhận được, xem Giới hạn đã biết.
- **Fee manager không bị lạm dụng**:
  - Chữ ký không dùng lại được. Không ai ký thay người khác được. Request hết hạn bị từ chối (`gasless.test.js`).
  - Ví chưa trồng cây không được trộm điểm. Đi kèm whitelist hàm, trần gas, và chặn `approve` tới ví lạ (smoke test: HTTP 403).
- **Hợp tác xã**:
  - Giá Chainlink cũ hơn 2 ngày thì không cho vay.
  - Không còn nợ thì vẫn rút được thế chấp kể cả khi oracle ngừng.
  - Chỉ thanh lý được khi hệ số an toàn dưới 1,0.
  - Chỉ owner được đổi oracle.
- **Ao cá**:
  - Có kiểm tra trượt giá cho swap, zap và vớt cá.
  - 1.000 share đầu tiên bị khóa vĩnh viễn, để người tạo pool không thổi phồng được giá share.
  - Impermanent loss được test với giá thật.
- **Nguồn lãi**:
  - Chỉ FarmGame gọi được nguồn lãi.
  - Không đổi được nguồn lãi khi còn tiền đang gửi trong đó.
  - Khi người chơi rút, game tự lấy tiền về từ nguồn lãi.
- **Quản gia tự động** (chưa dùng mô hình AI, bị giới hạn bằng hợp đồng):
  - Rule theo contract và hàm, có ghim tham số đầu tiên.
  - Có hạn mức mỗi ngày và kill switch.
  - Session key tự hết hạn.

## Giới hạn đã biết (testnet)

- Vòi tiền test vẫn mở cho mọi ví (1 lần/giờ mỗi ví), nên người có nhiều ví vẫn cày được tiền test và điểm mùa. Nhiều ví tạo sẵn ngoài mạng còn gom được vào một giao dịch qua `executeBatch` của forwarder (kiểm tra "không phải contract" chỉ chặn việc một contract làm người chơi). Quỹ nhiệm vụ có trần 1.000 USDC mỗi giờ nên không bị rút cạn trong một lần. Cách xử lý khi quỹ bị rút: `npm run top-up:quests` (quỹ nhiệm vụ), `FarmCoop.fund` (Hợp tác xã), `FarmGame.fundRewards` (quỹ thưởng). Bản mainnet cần đăng nhập bằng Privy kèm giới hạn lượt cho mỗi người.
- Ví rỗng không trộm điểm được, nhưng vẫn lách được bằng một cây rất nhỏ.
- `MockYieldSource` trả lãi từ quỹ lãi nạp sẵn (100.000 USDC test), không in thêm; hết quỹ thì ngừng trả lãi. Trên mainnet dùng `AaveV3YieldSource`, và phải kiểm toán độc lập trước khi giữ tiền thật.
- Khóa trả gas nằm trên Cloudflare, nên phải coi là có thể lộ. Vì vậy ví trả gas chỉ giữ AVAX trả gas: `deploy:gasless` dừng nếu ví deploy (ví duy nhất in được tiền test, giữ DemoPriceFeed) hay owner trùng với ví trả gas, và `fund:relayers` chỉ nạp cho ví có trong `relay-config.js`. (Bản đang chạy trên Fuji vẫn dùng chung một ví cho tới lần deploy lại.)
- Giới hạn tần suất của fee manager (theo ví, theo IP) và ngân sách gas theo giờ được đếm riêng ở từng trung tâm dữ liệu Cloudflare, nên kẻ phá dùng nhiều nơi trên thế giới được nhiều lượt hơn. Gas trên Fuji rẻ nên chưa phải vấn đề; mainnet cần bộ đếm chung (Durable Object hoặc KV).
- Trang web chỉ chạy script của chính game (CSP `script-src`, script nội tuyến chỉ chạy theo mã băm, xem `_headers`). Thư viện Privy tải từ esm.sh, chưa khóa bản build; bản mainnet nên tự lưu thư viện trên site.
- `DemoPriceFeed` do deployer điều khiển. Hợp tác xã chỉ dùng nó khi owner chủ động gọi `setOracle` để demo, bình thường dùng thẳng Chainlink.
