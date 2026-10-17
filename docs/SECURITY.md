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

## Các tình huống có test (52 test thường, 6 test fork)

- **Quỹ thưởng không bị rút cạn**: lãi chỉ trả tới mức quỹ còn, gốc luôn được trả đủ (`coop-pond.test.js`).
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
- **Quản gia AI**:
  - Rule theo contract và hàm, có ghim tham số đầu tiên.
  - Có hạn mức mỗi ngày và kill switch.
  - Session key tự hết hạn.

## Giới hạn đã biết (testnet)

- USDC và gAVAX test ai cũng mint được qua faucet, nên điểm mùa có thể bị cày bằng nhiều ví. Bản mainnet cần đăng nhập bằng Privy kèm giới hạn lượt cho mỗi người (việc của Backend).
- `MockYieldSource` tạo lãi bằng cách tự mint USDC test. Trên mainnet dùng `AaveV3YieldSource`, và phải kiểm toán độc lập trước khi giữ tiền thật.
- `DemoPriceFeed` do deployer điều khiển. Hợp tác xã chỉ dùng nó khi owner chủ động gọi `setOracle` để demo, bình thường dùng thẳng Chainlink.
