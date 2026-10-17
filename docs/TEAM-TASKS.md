# Phân công kỹ thuật (3 người)

| Vai trò | Người | Sở hữu (chỉ người này sửa) |
|---|---|---|
| Blockchain | (bạn) | `contracts/`, `prototype/chain.js`, `prototype/chain-config.js`, `prototype/artifacts.js`, `functions/_lib/relay-config.js` |
| Gameplay | Người 2 | `index.html` (canvas, nhân vật, khu vực, panel, UI), ảnh và âm thanh |
| Backend | Người 3 | `functions/` (trừ `relay-config.js`), cấu hình Cloudflare (secret, KV, Worker), service quản gia AI |

## Ranh giới giữa ba phần

- **Gameplay chỉ gọi `CH.*` trong `prototype/chain.js`**, không tự viết ABI hay gọi contract. Cần hành động mới thì nhờ Blockchain thêm hàm vào `chain.js`.
- **Contract thêm hàm mới thì Blockchain báo selector cho Backend.** Fee manager (`functions/_lib/relay-core.js`) chỉ trả gas cho các hàm có trong whitelist.
- **Blockchain viết `docs/EVENTS.md`** liệt kê event và tham số. Backend dựa vào đó để làm indexer và API.
- **Backend công bố định dạng JSON của mỗi API** (`/api/leaderboard`, …) trước khi Gameplay làm giao diện. Khi API chưa xong, Gameplay dùng dữ liệu giả cùng định dạng.
- **Khóa bí mật:**
  - Chỉ Blockchain giữ `contracts/.env` (khóa deploy và khóa agent).
  - `RELAYER_PRIVATE_KEY` chỉ nằm trong secret của Cloudflare.
  - Không ai commit `.env` hay dán khóa vào chat.

## Blockchain (bạn)

| Ưu tiên | Việc | Trạng thái |
|---|---|---|
| P0 | Đưa **Hợp tác xã** (FarmCoop, giá Chainlink) và **Ao cá** (FarmPond, x·y=k) lên contract, kèm test | ✅ 17/10, đã nối vào game |
| P0 | Rà event, viết `docs/EVENTS.md` | ✅ `CropClosed` có thêm `owner` và `points` |
| P0 | Test biên bảo mật (rút cạn quỹ thưởng, trộm, 12 cây, replay, giá cũ, trượt giá) | ✅ 39 test. Slither: 0 High, đã vá hết reentrancy (xem `docs/SECURITY.md`) |
| P0 | Deploy lại, verify, cập nhật config, chạy `test:fork` và `smoke:gasless` | ✅ 6 test fork qua, smoke qua Pages qua |
| P1 | Nguồn lãi: `IYieldSource`, `MockYieldSource` trên Fuji, `AaveV3YieldSource` cho mainnet | ✅ Aave v3 không có pool trên Fuji nên adapter được test bằng pool giả |
| P1 | Quản gia: session key tự hết hạn | ✅ Hạn 60 ngày (đến 15/12/2026) |
| P1 | Demo hạn hán: `npm run drought -- 6`, rồi `npm run drought -- liquidate` | ✅ Owner phải `setOracle` trước, xem `docs/DEPLOY.md` mục 2b |
| P2 | Mùa vụ (reset điểm theo mùa), NFT huy hiệu cho top bảng xếp hạng | Chưa làm |

**Đã sẵn cho Backend**:
- Bot thanh lý: `scripts/drought.js` (hàm `liquidateAll`) là bản mẫu, đã đọc log qua Routescan.
- Bot cân giá Ao cá: so `FarmPond.poolPrice()` với `FarmCoop.price()`. Mô tả trong `docs/EVENTS.md`.
- Fee manager đã có whitelist cho FarmCoop, FarmPond và gAVAX.

**Đã sẵn cho Gameplay**: `CH.coopDeposit/coopWithdraw/coopBorrow/coopRepay/coopLiquidate`, `CH.pondAdd/pondOut/pondSwap`, `CH.avaxFaucet`, cùng dữ liệu `CH.data.coop`, `CH.data.pond`, `CH.data.gavax`.

## Gameplay (Người 2)

| Ưu tiên | Việc | Xong khi |
|---|---|---|
| P0 | **Hướng dẫn chơi lần đầu** (~60 giây): dẫn nhân vật tới Cổng làng → nhận USDC → trồng cây → thu hoạch | Người lạ chơi được mà không cần ai giải thích |
| P0 | **Phản hồi giao dịch**: trạng thái đang ký → fee manager → đã xác nhận, toast có link Snowtrace, lỗi tiếng Việt dễ hiểu | Mọi hành động on-chain đều có phản hồi rõ |
| P0 | **Điều khiển trên điện thoại**: joystick hoặc chạm để đi, canvas co giãn theo màn hình | Chơi trọn vòng trên điện thoại |
| P0 | Hình ảnh: sprite nhân vật và cây theo giai đoạn lớn, ngày/đêm theo `dayLength`, âm thanh khi thu hoạch | Đủ đẹp để quay video demo |
| P0 | Giao diện Hợp tác xã và Ao cá: làm trước bằng mô phỏng, nối `CH.*` khi Blockchain xong | Dùng dữ liệu on-chain |
| P1 | Panel bảng xếp hạng, danh sách hàng xóm để ghé thăm hoặc trộm (dùng API của Backend) | Hiện dữ liệu thật |
| P1 | Nhiệm vụ hằng ngày (tưới 3 cây, ghé 1 hàng xóm), hiển thị phần thưởng | Có trên giao diện |
| P2 | Bản tiếng Anh cho giám khảo | Có nút chuyển ngôn ngữ |

## Backend (Người 3)

| Ưu tiên | Việc | Xong khi |
|---|---|---|
| P0 | **Hàng đợi nonce cho fee manager**: chỉ có một ví trả gas, và RPC công khai của Fuji không cho thấy giao dịch đang chờ. Nhiều người gửi cùng lúc thì trùng nonce: hiện `relay-core.js` chờ giao dịch lên chain rồi gửi lại nếu bị bỏ, nên vẫn đúng nhưng chậm (6 người cùng lúc thì người cuối đợi khoảng 40 giây). Cách sửa: cấp nonce tuần tự bằng một Durable Object, hoặc dùng nhiều ví trả gas, chọn ví theo địa chỉ người chơi | 6 người gửi cùng lúc, ai cũng xong trong khoảng 3 giây |
| P0 | **Giới hạn fee manager**: số lượt và gas mỗi ví, mỗi IP mỗi ngày (Cloudflare KV), trả `429` kèm thông báo tiếng Việt | Một ví spam không rút cạn được ví trả gas |
| P0 | **Cảnh báo số dư ví trả gas**: Worker riêng chạy Cron (Pages Functions không có Cron), báo Discord/Telegram khi dưới 0,1 AVAX | Nhận được cảnh báo thử |
| P0 | **Indexer và API**: `/api/leaderboard`, `/api/farmers`, `/api/activity`. Đọc event bằng `getLogs` chia đoạn (Fuji giới hạn 100 block mỗi lần) hoặc Routescan API, cache vào KV | Gameplay gọi được, phản hồi dưới 500 ms |
| P0 | Thống kê cho pitch: số giao dịch gasless, số người chơi, tổng gas đã trả hộ | Có số liệu thật để đưa vào slide |
| P1 | **Ví Privy**: thêm bước build cho Pages (hiện không có), nút đăng nhập phối hợp với Gameplay, fee manager kiểm tra token Privy | Đăng nhập bằng email, chơi không cần gas |
| P1 | **Service quản gia AI**: nhận lệnh chat → LLM ra ý định → gọi `ButlerAccount.execute` bằng khóa agent (lưu làm secret) | Demo trên giao diện: lệnh hợp lệ chạy, lệnh injection bị contract chặn |
| P2 | Log lỗi tập trung, trang admin xem lượt relay | Có thể bỏ nếu thiếu thời gian |

## Lịch

| Thời gian | Mục tiêu |
|---|---|
| Đến 1/11 | Chốt ranh giới ở trên, `docs/EVENTS.md`, định dạng JSON của API. Ai cũng bắt đầu việc P0 |
| 2–8/11 | Xong P0 trên nhánh riêng, chạy được bằng `npm run local` |
| 9–15/11 | Ghép lại trên `main`, làm P1, deploy lại contract một lần cuối |
| 16–19/11 | Ngừng thêm tính năng: sửa lỗi, chơi thử chéo, quay video demo |
| 20–21/11 | Nộp bài (hạn 23:59 ngày 21/11) |
| 23–30/11 | Nếu vào chung kết: chỉnh demo và pitch cho Demo Day |

## Cách làm việc với Git

- Mỗi người một nhánh (`bc/…`, `game/…`, `be/…`), mở PR vào `main`. `main` chính là bản production trên Pages.
- Cloudflare Pages tự tạo link preview cho mỗi nhánh. Thử trên preview trước khi merge.
- Chạy `cd contracts && npm test` trước khi merge thay đổi về contract hoặc fee manager.
- Chạy toàn bộ trên máy: `cd contracts && npm run local` → http://localhost:8790 (Hardhat node, contract, fee manager và game).
