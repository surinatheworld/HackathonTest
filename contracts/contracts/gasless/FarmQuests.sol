// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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
    function crops(uint256 id)
        external
        view
        returns (address owner, uint8 tier, uint8 status, uint64 plantedAt, uint64 lastWateredDay, uint256 amount, uint256 payout);
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
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function gotProduce(address user) external view returns (bool);
    function offersMade(address user) external view returns (uint256);
}

/// Nhiệm vụ: 18 quests in 5 chapters, easy to hard, unlocked one at a time. Each one is checked on-chain from the
/// state of the farm contracts, so nobody can claim a quest they did not do. Rewards are paid from a reward pool the
/// team funds up front (a marketing budget held by this contract), never minted. When the pool runs dry the player
/// still moves on to the next quest and the reward is owed, paid by claimOwed() once the pool is topped up, so an
/// empty pool never freezes the learning path. The owner (the deployer today, the team multisig later) can only take
/// unused rewards back; it cannot change anyone's progress or what they are owed.
contract FarmQuests is ERC2771Context, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant COUNT = 18;

    IQuestGame public immutable game;
    IQuestCoop public immutable coop;
    IQuestPond public immutable pond;
    IQuestItems public immutable items;
    IERC20 public immutable usdc;

    /// number of quests completed; the next one to do is quest number `progress[user]`
    mapping(address => uint256) public progress;
    /// rewards earned while the pool was empty, not paid yet
    mapping(address => uint256) public owed;

    event QuestCompleted(address indexed user, uint256 indexed quest, uint256 reward);
    event RewardOwed(address indexed user, uint256 indexed quest, uint256 amount);
    event OwedPaid(address indexed user, uint256 amount, uint256 stillOwed);
    event PoolWithdrawn(address indexed to, uint256 amount);

    error AllDone();
    error NotDoneYet(uint256 quest);
    error RewardPoolEmpty(uint256 available, uint256 needed);
    error NotAPlayer();
    error NothingOwed();

    constructor(address forwarder, address game_, address coop_, address pond_, address items_, address usdc_)
        ERC2771Context(forwarder)
        Ownable(msg.sender)
    {
        game = IQuestGame(game_);
        coop = IQuestCoop(coop_);
        pond = IQuestPond(pond_);
        items = IQuestItems(items_);
        usdc = IERC20(usdc_);
    }

    /// Test USDC (6 decimals) for each quest, growing with difficulty.
    function rewardOf(uint256 q) public pure returns (uint256) {
        uint16[18] memory r = [uint16(10), 10, 10, 10, 20, 20, 20, 20, 30, 40, 50, 30, 30, 30, 50, 80, 100, 200];
        return q < COUNT ? uint256(r[q]) * 1e6 : 0;
    }

    /// Whether `u` has done quest `q` right now (quests are still claimed in order). Every check costs the same
    /// gas however long the player has played: quests 2 and 4 look only at the crop `hint` names (find one with
    /// hintFor), the others read a single value.
    function check(address u, uint256 q, uint256 hint) public view returns (bool) {
        // Chương 1: Làm quen
        if (q == 0) return usdc.balanceOf(u) > 0; // Nhận tiền thử
        if (q == 1) return _lent(u) >= 10e6; // Gieo hạt ở Ruộng rau
        if (q == 2) return _ownCrop(u, hint, false); // Trồng cây đầu tiên
        if (q == 3) return _streak(u) >= 1; // Tưới cây
        // Chương 2: Chăm vườn
        if (q == 4) return _ownCrop(u, hint, true); // Thu hoạch một cây
        if (q == 5) return _points(u) >= 10; // Có 10 điểm mùa
        if (q == 6) return items.gotProduce(u); // Nhận nông sản vào Kho đồ
        if (q == 7) return _hasCosmetic(u); // Mua đồ trang trí
        // Chương 3: Tài chính
        if (q == 8) return pond.sharesOf(u) > 0; // Thả cá ở Ao cá
        if (q == 9) return coop.debtOf(u) > 0; // Vay ở Hợp tác xã
        if (q == 10) return coop.debtOf(u) == 0; // Trả hết nợ (only reachable after quest 9)
        // Chương 4: Làng xóm
        if (q == 11) return items.offersMade(u) > 0; // Đăng một đề nghị đổi đồ
        if (q == 12) return _stole(u); // Hái trộm vườn hàng xóm
        if (q == 13) return _guarded(u); // Thuê người giữ vườn
        // Chương 5: Bậc thầy
        if (q == 14) return items.balanceOf(u, 1005) > 0; // Huy hiệu Nông dân chăm chỉ
        if (q == 15) return items.balanceOf(u, 1004) > 0; // Huy hiệu Vay an toàn
        if (q == 16) return items.balanceOf(u, 1002) > 0; // Huy hiệu Kiên nhẫn
        if (q == 17) return items.balanceOf(u, 1006) > 0; // Huy hiệu Lão nông
        return false;
    }

    /// Complete the current quest and take its reward. `hint` is a crop id for quests 2 and 4 (see hintFor), else 0.
    /// Only a wallet may play, directly or through the forwarder (which only runs requests a wallet signed): a contract
    /// cannot create throwaway "players" in one transaction and farm the pool with them.
    function complete(uint256 hint) external nonReentrant returns (uint256 quest, uint256 reward) {
        if (msg.sender != tx.origin && !isTrustedForwarder(msg.sender)) revert NotAPlayer();
        address u = _msgSender();
        quest = progress[u];
        if (quest >= COUNT) revert AllDone();
        if (!check(u, quest, hint)) revert NotDoneYet(quest);
        reward = rewardOf(quest);
        progress[u] = quest + 1;
        emit QuestCompleted(u, quest, reward);
        if (usdc.balanceOf(address(this)) < reward) {
            owed[u] += reward;
            emit RewardOwed(u, quest, reward);
        } else {
            usdc.safeTransfer(u, reward);
        }
    }

    /// Collect rewards that were owed while the pool was empty: as much as the pool holds now.
    function claimOwed() external nonReentrant returns (uint256 paid) {
        address u = _msgSender();
        uint256 due = owed[u];
        if (due == 0) revert NothingOwed();
        uint256 pool = usdc.balanceOf(address(this));
        paid = due < pool ? due : pool;
        if (paid == 0) revert RewardPoolEmpty(0, due);
        owed[u] = due - paid;
        emit OwedPaid(u, paid, due - paid);
        usdc.safeTransfer(u, paid);
    }

    /// USDC left in the reward pool.
    function rewardPool() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// Takes unused rewards back (e.g. at the end of a season). Anyone can fund the pool with a plain transfer.
    function withdrawPool(address to, uint256 amount) external onlyOwner {
        emit PoolWithdrawn(to, amount);
        usdc.safeTransfer(to, amount);
    }

    /// The current quest and whether it can be claimed now (for the game UI).
    function status(address u) external view returns (uint256 quest, bool ready, uint256 reward) {
        quest = progress[u];
        if (quest < COUNT) {
            (ready,) = hintFor(u, quest);
            reward = rewardOf(quest);
        }
    }

    /// For the UI only (eth_call, no gas limit that matters): finds the hint complete() needs. It scans the
    /// player's crops, which is why complete() itself never does.
    function hintFor(address u, uint256 q) public view returns (bool ready, uint256 hint) {
        if (q == 2 || q == 4) {
            (uint256[] memory ids, IQuestGame.Crop[] memory list) = game.cropsOf(u);
            for (uint256 i; i < ids.length; i++) {
                if (q == 2 || list[i].status == 2) return (true, ids[i]);
            }
            return (false, 0);
        }
        return (check(u, q, 0), 0);
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
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

    /// The crop exists and is `u`'s (and, if `harvested`, was harvested).
    function _ownCrop(address u, uint256 cropId, bool harvested) private view returns (bool) {
        (address o,, uint8 st,,,,) = game.crops(cropId);
        return o == u && (!harvested || st == 2);
    }

    function _hasCosmetic(address u) private view returns (bool) {
        for (uint256 id = 2001; id <= 2006; id++) if (items.balanceOf(u, id) > 0) return true;
        return false;
    }
}
