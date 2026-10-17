// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IQuestGame {
    struct Crop {
        address owner;
        uint8 tier;
        uint8 status;
        uint64 plantedAt;
        uint64 lastWateredDay;
        uint256 amount;
        uint256 payout;
    }
    function cropsOf(address who) external view returns (uint256[] memory ids, Crop[] memory list);
    function farmers(address who)
        external
        view
        returns (uint256 points, uint256 ripePoints, uint32 streak, uint64 lastWaterDay, uint64 lastStealDay, bool guarded, uint16 activeCrops);
    function lends(address who) external view returns (uint256 principal, uint256 accrued, uint64 last);
}

interface IQuestCoop {
    function debtOf(address user) external view returns (uint256);
}

interface IQuestPond {
    function sharesOf(address user) external view returns (uint256);
}

interface IQuestItems {
    struct Offer {
        address maker;
        address taker;
        uint64 expires;
        bool open;
        uint256[] giveIds;
        uint256[] giveAmts;
        uint256[] wantIds;
        uint256[] wantAmts;
    }
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function itemsOf(address user) external view returns (uint256[] memory ids, uint256[] memory amounts);
    function offerCount() external view returns (uint256);
    function offer(uint256 offerId) external view returns (Offer memory);
}

interface IQuestToken {
    function balanceOf(address who) external view returns (uint256);
    function mint(address to, uint256 amount) external;
}

/// Nhiệm vụ: 18 quests in 5 chapters, easy to hard, unlocked one at a time. Each one is checked on-chain from the
/// state of the farm contracts, so nobody can claim a quest they did not do. The reward is test USDC, minted from the
/// testnet token; on mainnet the reward would be season points or cosmetics, never money.
contract FarmQuests is ERC2771Context, ReentrancyGuard {
    uint256 public constant COUNT = 18;
    uint256 private constant KIND = 1e9;
    uint256 private constant OFFER_SCAN = 100;

    IQuestGame public immutable game;
    IQuestCoop public immutable coop;
    IQuestPond public immutable pond;
    IQuestItems public immutable items;
    IQuestToken public immutable usdc;

    /// number of quests completed; the next one to do is quest number `progress[user]`
    mapping(address => uint256) public progress;

    event QuestCompleted(address indexed user, uint256 indexed quest, uint256 reward);

    error AllDone();
    error NotDoneYet(uint256 quest);

    constructor(address forwarder, address game_, address coop_, address pond_, address items_, address usdc_)
        ERC2771Context(forwarder)
    {
        game = IQuestGame(game_);
        coop = IQuestCoop(coop_);
        pond = IQuestPond(pond_);
        items = IQuestItems(items_);
        usdc = IQuestToken(usdc_);
    }

    /// Test USDC (6 decimals) for each quest, growing with difficulty.
    function rewardOf(uint256 q) public pure returns (uint256) {
        uint16[18] memory r = [uint16(10), 10, 10, 10, 20, 20, 20, 20, 30, 40, 50, 30, 30, 30, 50, 80, 100, 200];
        return q < COUNT ? uint256(r[q]) * 1e6 : 0;
    }

    /// Whether `u` has done quest `q` right now (quests are still claimed in order).
    function check(address u, uint256 q) public view returns (bool) {
        // Chương 1: Làm quen
        if (q == 0) return usdc.balanceOf(u) > 0; // Nhận tiền thử
        if (q == 1) return _lent(u) >= 10e6; // Gieo hạt ở Ruộng rau
        if (q == 2) return _cropCount(u) > 0; // Trồng cây đầu tiên
        if (q == 3) return _streak(u) >= 1; // Tưới cây
        // Chương 2: Chăm vườn
        if (q == 4) return _harvested(u, 255); // Thu hoạch một cây
        if (q == 5) return _points(u) >= 10; // Có 10 điểm mùa
        if (q == 6) return _hasProduce(u); // Nhận nông sản vào Kho đồ
        if (q == 7) return _hasCosmetic(u); // Mua đồ trang trí
        // Chương 3: Tài chính
        if (q == 8) return pond.sharesOf(u) > 0; // Thả cá ở Ao cá
        if (q == 9) return coop.debtOf(u) > 0; // Vay ở Hợp tác xã
        if (q == 10) return coop.debtOf(u) == 0; // Trả hết nợ (only reachable after quest 9)
        // Chương 4: Làng xóm
        if (q == 11) return _madeOffer(u); // Đăng một đề nghị đổi đồ
        if (q == 12) return _stole(u); // Hái trộm vườn hàng xóm
        if (q == 13) return _guarded(u); // Thuê người giữ vườn
        // Chương 5: Bậc thầy
        if (q == 14) return items.balanceOf(u, 1005) > 0; // Huy hiệu Nông dân chăm chỉ
        if (q == 15) return items.balanceOf(u, 1004) > 0; // Huy hiệu Vay an toàn
        if (q == 16) return items.balanceOf(u, 1002) > 0; // Huy hiệu Kiên nhẫn
        if (q == 17) return items.balanceOf(u, 1006) > 0; // Huy hiệu Lão nông
        return false;
    }

    /// Complete the current quest and take its reward.
    function complete() external nonReentrant returns (uint256 quest, uint256 reward) {
        address u = _msgSender();
        quest = progress[u];
        if (quest >= COUNT) revert AllDone();
        if (!check(u, quest)) revert NotDoneYet(quest);
        progress[u] = quest + 1;
        reward = rewardOf(quest);
        usdc.mint(u, reward);
        emit QuestCompleted(u, quest, reward);
    }

    /// The current quest and whether it can be claimed now (for the game UI).
    function status(address u) external view returns (uint256 quest, bool ready, uint256 reward) {
        quest = progress[u];
        if (quest < COUNT) {
            ready = check(u, quest);
            reward = rewardOf(quest);
        }
    }

    // ---------- checks ----------

    function _lent(address u) private view returns (uint256 principal) {
        (principal,,) = game.lends(u);
    }

    function _farmer(address u)
        private
        view
        returns (uint256 points, uint32 streak, uint64 lastStealDay, bool guarded)
    {
        (points,, streak,, lastStealDay, guarded,) = game.farmers(u);
    }

    function _points(address u) private view returns (uint256 p) {
        (p,,,) = _farmer(u);
    }

    function _streak(address u) private view returns (uint32 s) {
        (, s,,) = _farmer(u);
    }

    function _stole(address u) private view returns (bool) {
        (,, uint64 d,) = _farmer(u);
        return d != 0;
    }

    function _guarded(address u) private view returns (bool g) {
        (,,, g) = _farmer(u);
    }

    function _cropCount(address u) private view returns (uint256) {
        (uint256[] memory ids,) = game.cropsOf(u);
        return ids.length;
    }

    /// tier 255 = any tier
    function _harvested(address u, uint8 tier) private view returns (bool) {
        (, IQuestGame.Crop[] memory list) = game.cropsOf(u);
        for (uint256 i; i < list.length; i++) if (list[i].status == 2 && (tier == 255 || list[i].tier == tier)) return true;
        return false;
    }

    function _hasProduce(address u) private view returns (bool) {
        (uint256[] memory ids,) = items.itemsOf(u);
        for (uint256 i; i < ids.length; i++) {
            uint256 k = ids[i] / KIND;
            if (k >= 1 && k <= 3) return true;
        }
        return false;
    }

    function _hasCosmetic(address u) private view returns (bool) {
        for (uint256 id = 2001; id <= 2006; id++) if (items.balanceOf(u, id) > 0) return true;
        return false;
    }

    /// Looks at the latest OFFER_SCAN market offers for one made by `u`.
    function _madeOffer(address u) private view returns (bool) {
        uint256 n = items.offerCount();
        uint256 stop = n > OFFER_SCAN ? n - OFFER_SCAN : 0;
        for (uint256 i = n; i > stop; i--) if (items.offer(i - 1).maker == u) return true;
        return false;
    }
}
