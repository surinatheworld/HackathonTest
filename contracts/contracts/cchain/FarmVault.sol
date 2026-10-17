// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICMApp, FarmMsg} from "../ICMApp.sol";

/// C-Chain side of Nông Trại DeFi. Holds the real USDC.
///  - Ruộng rau: open lending, 4% APY, withdraw any time.
///  - Vườn cây: tiered locks (7 / 30 / 90 game days at 6 / 9 / 14% APY), opened and closed by ICM
///    messages from FarmLand on the Game L1. The lock owner can also close it here directly
///    (claimLock / exitLock), so money never depends on a message being delivered.
/// Yield is paid from a reward reserve funded by sponsors (mock yield for the MVP).
contract FarmVault is ICMApp {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR_DAYS = 365;
    uint256 public constant LEND_APY_BPS = 400;

    IERC20 public immutable usdc;
    /// Seconds per game day. 86400 in production, shorter on testnet so demos ripen in minutes.
    uint256 public immutable dayLength;

    struct Lend {
        uint256 principal;
        uint256 accrued;
        uint64 last;
    }

    struct Lock {
        address user;
        uint8 tier;
        bool open;
        uint64 start;
        uint256 amount;
    }

    mapping(address => Lend) public lends;
    mapping(uint256 => Lock) public locks; // keyed by FarmLand crop id
    uint256 public rewardReserve;
    uint256 public totalLent;
    uint256 public totalLocked;
    /// Send receipts back to the L1. Off by default: some L1 nodes cannot verify C-Chain → L1 Warp
    /// messages, and FarmLand does not need receipts to work.
    bool public receiptsEnabled;

    event RewardsFunded(address indexed from, uint256 amount);
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event YieldClaimed(address indexed user, uint256 amount);
    event Locked(uint256 indexed cropId, address indexed user, uint8 tier, uint256 amount);
    event LockFailed(uint256 indexed cropId, address indexed user, uint8 reason);
    event Unlocked(uint256 indexed cropId, address indexed user, uint256 payout, bool early);

    error ZeroAmount();
    error InsufficientPrincipal();
    error NotYourLock();
    error LockClosed();
    error LockNotRipe();

    constructor(address teleporter_, address usdc_, uint256 dayLength_) ICMApp(teleporter_) {
        usdc = IERC20(usdc_);
        dayLength = dayLength_;
    }

    // ---------- tiers ----------

    function tierDays(uint8 tier) public pure returns (uint256) {
        return tier == 0 ? 7 : tier == 1 ? 30 : 90;
    }

    function tierApyBps(uint8 tier) public pure returns (uint256) {
        return tier == 0 ? 600 : tier == 1 ? 900 : 1400;
    }

    // ---------- sponsor pool ----------

    function fundRewards(uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        rewardReserve += amount;
        emit RewardsFunded(msg.sender, amount);
    }

    // ---------- Ruộng rau (lending) ----------

    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        _accrue(msg.sender);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        lends[msg.sender].principal += amount;
        totalLent += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        _accrue(msg.sender);
        Lend storage l = lends[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (amount > l.principal) revert InsufficientPrincipal();
        l.principal -= amount;
        totalLent -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claim() external returns (uint256 paid) {
        _accrue(msg.sender);
        Lend storage l = lends[msg.sender];
        paid = _takeReward(l.accrued);
        l.accrued -= paid;
        if (paid > 0) usdc.safeTransfer(msg.sender, paid);
        emit YieldClaimed(msg.sender, paid);
    }

    function pendingYield(address user) public view returns (uint256) {
        Lend memory l = lends[user];
        return l.accrued + _lendYield(l.principal, block.timestamp - l.last);
    }

    // ---------- Vườn cây (locks) ----------

    function lockYield(uint256 cropId) public view returns (uint256) {
        Lock memory k = locks[cropId];
        if (!k.open) return 0;
        uint256 elapsed = block.timestamp - k.start;
        uint256 cap = tierDays(k.tier) * dayLength;
        if (elapsed > cap) elapsed = cap;
        return (k.amount * tierApyBps(k.tier) * elapsed) / (BPS * YEAR_DAYS * dayLength);
    }

    function isRipe(uint256 cropId) public view returns (bool) {
        Lock memory k = locks[cropId];
        return k.open && block.timestamp >= k.start + tierDays(k.tier) * dayLength;
    }

    /// Collect a ripe lock directly on C-Chain (principal + yield), e.g. if the HARVEST message was lost.
    function claimLock(uint256 cropId) external {
        Lock storage k = locks[cropId];
        if (k.user != msg.sender) revert NotYourLock();
        if (!k.open) revert LockClosed();
        if (!isRipe(cropId)) revert LockNotRipe();
        _payout(cropId, false);
    }

    /// Leave a lock early directly on C-Chain: principal only, yield is forfeited.
    function exitLock(uint256 cropId) external {
        Lock storage k = locks[cropId];
        if (k.user != msg.sender) revert NotYourLock();
        if (!k.open) revert LockClosed();
        _payout(cropId, true);
    }

    function setReceiptsEnabled(bool on) external onlyOwner {
        receiptsEnabled = on;
    }

    // ---------- ICM ----------

    function _handle(bytes calldata message) internal override {
        (uint8 kind, uint256 cropId, address user, uint8 tier, uint256 amount) = FarmMsg.decode(message);
        if (kind == FarmMsg.PLANT) _plant(cropId, user, tier, amount);
        else if (kind == FarmMsg.HARVEST) _harvest(cropId, user, false);
        else if (kind == FarmMsg.UPROOT) _harvest(cropId, user, true);
    }

    /// Business failures never revert: a reverted ICM message would sit undelivered,
    /// so the L1 is told about the failure with a receipt instead.
    function _plant(uint256 cropId, address user, uint8 tier, uint256 amount) private {
        uint8 reason;
        if (locks[cropId].start != 0) reason = 1;
        else if (tier > 2) reason = 2;
        else if (amount == 0) reason = 3;
        else {
            // `user` is the L1 player who signed the PLANT there; only FarmLand on the registered L1 can send it.
            // slither-disable-next-line arbitrary-send-erc20
            try usdc.transferFrom(user, address(this), amount) returns (bool ok) {
                if (!ok) reason = 4;
            } catch {
                reason = 4; // no allowance or balance on C-Chain
            }
        }
        if (reason != 0) {
            emit LockFailed(cropId, user, reason);
            _receipt(FarmMsg.PLANT_FAILED, cropId, user, tier, reason);
            return;
        }
        locks[cropId] = Lock({user: user, tier: tier, open: true, start: uint64(block.timestamp), amount: amount});
        totalLocked += amount;
        emit Locked(cropId, user, tier, amount);
        _receipt(FarmMsg.PLANTED, cropId, user, tier, amount);
    }

    function _harvest(uint256 cropId, address user, bool early) private {
        Lock storage k = locks[cropId];
        if (!k.open || k.user != user || (!early && !isRipe(cropId))) {
            // Lock stays as it is; the owner can claimLock / exitLock here later.
            _receipt(FarmMsg.HARVEST_FAILED, cropId, user, k.tier, 0);
            return;
        }
        _payout(cropId, early);
    }

    function _payout(uint256 cropId, bool early) private {
        Lock storage k = locks[cropId];
        uint256 payout = k.amount;
        if (!early) payout += _takeReward(lockYield(cropId));
        k.open = false;
        totalLocked -= k.amount;
        usdc.safeTransfer(k.user, payout);
        emit Unlocked(cropId, k.user, payout, early);
        _receipt(early ? FarmMsg.UPROOTED : FarmMsg.HARVESTED, cropId, k.user, k.tier, payout);
    }

    function _receipt(uint8 kind, uint256 cropId, address user, uint8 tier, uint256 amount) private {
        if (receiptsEnabled) _send(kind, cropId, user, tier, amount);
    }

    // ---------- internals ----------

    function _accrue(address user) private {
        Lend storage l = lends[user];
        if (l.last != 0) l.accrued += _lendYield(l.principal, block.timestamp - l.last);
        l.last = uint64(block.timestamp);
    }

    function _lendYield(uint256 principal, uint256 dt) private view returns (uint256) {
        return (principal * LEND_APY_BPS * dt) / (BPS * YEAR_DAYS * dayLength);
    }

    function _takeReward(uint256 want) private returns (uint256 got) {
        got = want > rewardReserve ? rewardReserve : want;
        rewardReserve -= got;
    }
}
