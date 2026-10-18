// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IYieldSource} from "../yield/IYieldSource.sol";

/// Nông Trại DeFi on a single chain (Fuji C-Chain), gasless through FarmForwarder.
///  - Ruộng rau: open lending, 4% APY.
///  - Vườn cây: tiered locks (7 / 30 / 90 game days at 6 / 9 / 14% APY) shown as crops.
///  - Game loop: water, collect, steal season points.
///  - Where the yield comes from: the owner parks idle USDC in an IYieldSource (a lending market) and
///    harvestYield() moves what it earned into the reward pool. Player exits pull it back when needed.
/// Every player action uses _msgSender(), so it works both as a normal tx and as a relayed one.
contract FarmGame is ERC2771Context, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR_DAYS = 365;
    uint256 public constant LEND_APY_BPS = 400;
    uint16 public constant MAX_ACTIVE_CROPS = 12;
    /// Vườn bác Tư: a built-in neighbour nobody holds a key for. It never guards and always has 3 points to pick,
    /// so a player alone in the village can still learn "hái trộm" and go on with the quests.
    address public constant NEIGHBOUR = address(uint160(uint256(keccak256("nong-trai.bac-tu"))));
    uint256 public constant NEIGHBOUR_POINTS = 3;

    enum Status {
        None,
        Growing,
        Harvested,
        Uprooted
    }

    struct Crop {
        address owner;
        uint8 tier;
        Status status;
        uint64 plantedAt;
        uint64 lastWateredDay;
        uint256 amount;
        uint256 payout;
    }

    struct Farmer {
        uint256 points;
        uint256 ripePoints;
        uint32 streak;
        uint64 lastWaterDay;
        uint64 lastStealDay;
        bool guarded;
        uint16 activeCrops;
    }

    struct Lend {
        uint256 principal;
        uint256 accrued;
        uint64 last;
    }

    IERC20 public immutable usdc;
    uint256 public immutable dayLength;
    address public owner;
    uint256 public rewardReserve;
    uint256 public totalLent;
    uint256 public totalLocked;
    uint256 public nextCropId = 1;
    IYieldSource public yieldSource;
    uint256 public invested;

    mapping(address => Lend) public lends;
    mapping(uint256 => Crop) public crops;
    mapping(address => uint256[]) private _cropsOf;
    mapping(address => Farmer) public farmers;

    event RewardsFunded(address indexed from, uint256 amount);
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event YieldClaimed(address indexed user, uint256 amount);
    event Planted(uint256 indexed cropId, address indexed owner, uint8 tier, uint256 amount);
    event CropClosed(uint256 indexed cropId, address indexed owner, Status status, uint256 payout, uint256 points);
    event Watered(uint256 indexed cropId, address indexed owner, uint256 ripePoints, uint32 streak);
    event Collected(address indexed owner, uint256 amount);
    event Stolen(address indexed thief, address indexed victim, uint256 amount);
    event GuardSet(address indexed owner, bool guarded);
    event OwnershipTransferred(address indexed previous, address indexed next);
    event YieldSourceSet(address indexed source);
    event Invested(uint256 amount, uint256 invested);
    event Divested(uint256 amount, uint256 invested);
    event YieldHarvested(uint256 amount, uint256 rewardReserve);

    error NotOwner();
    error ZeroAmount();
    error InsufficientPrincipal();
    error BadTier();
    error FarmFull();
    error NotYourCrop();
    error WrongStatus(Status status);
    error NotRipe(uint256 readyAt);
    error AlreadyWateredToday();
    error Guarded();
    error StealCooldown();
    error NothingToSteal();
    error NotAFarmer();
    error CannotStealFromYourself();
    error SourceInUse();
    error NoYieldSource();
    error ZeroAddress();

    constructor(address forwarder, address usdc_, uint256 dayLength_) ERC2771Context(forwarder) {
        usdc = IERC20(usdc_);
        dayLength = dayLength_;
        owner = msg.sender;
    }

    function transferOwnership(address next) external {
        if (_msgSender() != owner) revert NotOwner();
        if (next == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    // ---------- yield source (owner) ----------

    /// Switch sources once nothing is invested. Interest the old source still holds (earned after the last
    /// harvest) is pulled into the reward pool first, so switching never leaves money behind.
    function setYieldSource(address source) external onlyOwner nonReentrant {
        if (invested != 0) revert SourceInUse();
        // Best effort: a broken or paused old source must not block switching away from it.
        if (address(yieldSource) != address(0)) {
            try yieldSource.balance() returns (uint256 left) {
                if (left > 0) {
                    try yieldSource.withdraw(left) {
                        rewardReserve += left;
                        emit YieldHarvested(left, rewardReserve);
                    } catch {}
                }
            } catch {}
        }
        yieldSource = IYieldSource(source);
        emit YieldSourceSet(source);
    }

    /// Park idle USDC in the yield source. Player exits pull it back automatically if needed.
    function invest(uint256 amount) external onlyOwner nonReentrant {
        if (address(yieldSource) == address(0)) revert NoYieldSource();
        invested += amount;
        usdc.forceApprove(address(yieldSource), amount);
        yieldSource.deposit(amount);
        emit Invested(amount, invested);
    }

    function divest(uint256 amount) external onlyOwner nonReentrant {
        _divest(amount);
    }

    /// Anyone may call: what the source earned above the principal goes into the reward pool.
    function harvestYield() external nonReentrant returns (uint256 gain) {
        if (address(yieldSource) == address(0)) revert NoYieldSource();
        uint256 bal = yieldSource.balance();
        if (bal <= invested) return 0;
        gain = bal - invested;
        rewardReserve += gain;
        yieldSource.withdraw(gain);
        emit YieldHarvested(gain, rewardReserve);
    }

    modifier onlyOwner() {
        if (_msgSender() != owner) revert NotOwner();
        _;
    }

    function tierDays(uint8 tier) public pure returns (uint256) {
        return tier == 0 ? 7 : tier == 1 ? 30 : 90;
    }

    function tierApyBps(uint8 tier) public pure returns (uint256) {
        return tier == 0 ? 600 : tier == 1 ? 900 : 1400;
    }

    function today() public view returns (uint64) {
        return uint64(block.timestamp / dayLength);
    }

    function fundRewards(uint256 amount) external nonReentrant {
        rewardReserve += amount;
        usdc.safeTransferFrom(_msgSender(), address(this), amount);
        emit RewardsFunded(_msgSender(), amount);
    }

    // ---------- Ruộng rau ----------

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        address u = _msgSender();
        _accrue(u);
        lends[u].principal += amount;
        totalLent += amount;
        usdc.safeTransferFrom(u, address(this), amount);
        emit Deposited(u, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        address u = _msgSender();
        _accrue(u);
        Lend storage l = lends[u];
        if (amount == 0) revert ZeroAmount();
        if (amount > l.principal) revert InsufficientPrincipal();
        l.principal -= amount;
        totalLent -= amount;
        _pay(u, amount);
        emit Withdrawn(u, amount);
    }

    function claim() external nonReentrant returns (uint256 paid) {
        address u = _msgSender();
        _accrue(u);
        Lend storage l = lends[u];
        paid = _takeReward(l.accrued);
        l.accrued -= paid;
        if (paid > 0) _pay(u, paid);
        emit YieldClaimed(u, paid);
    }

    function pendingYield(address user) public view returns (uint256) {
        Lend memory l = lends[user];
        return l.accrued + (l.principal * LEND_APY_BPS * (block.timestamp - l.last)) / (BPS * YEAR_DAYS * dayLength);
    }

    // ---------- Vườn cây ----------

    function plant(uint8 tier, uint256 amount) external nonReentrant returns (uint256 cropId) {
        if (tier > 2) revert BadTier();
        if (amount == 0) revert ZeroAmount();
        address u = _msgSender();
        Farmer storage f = farmers[u];
        if (f.activeCrops >= MAX_ACTIVE_CROPS) revert FarmFull();
        f.activeCrops++;
        totalLocked += amount;
        cropId = nextCropId++;
        crops[cropId] = Crop(u, tier, Status.Growing, uint64(block.timestamp), 0, amount, 0);
        _cropsOf[u].push(cropId);
        usdc.safeTransferFrom(u, address(this), amount);
        emit Planted(cropId, u, tier, amount);
    }

    function readyAt(uint256 cropId) public view returns (uint256) {
        Crop memory c = crops[cropId];
        return c.plantedAt + tierDays(c.tier) * dayLength;
    }

    function cropYield(uint256 cropId) public view returns (uint256) {
        Crop memory c = crops[cropId];
        if (c.status != Status.Growing) return 0;
        uint256 elapsed = block.timestamp - c.plantedAt;
        uint256 cap = tierDays(c.tier) * dayLength;
        if (elapsed > cap) elapsed = cap;
        return (c.amount * tierApyBps(c.tier) * elapsed) / (BPS * YEAR_DAYS * dayLength);
    }

    function harvest(uint256 cropId) external nonReentrant {
        Crop storage c = _own(cropId);
        uint256 ripe = readyAt(cropId);
        if (block.timestamp < ripe) revert NotRipe(ripe);
        uint256 due = cropYield(cropId);
        uint256 got = _takeReward(due);
        // A short reward pool never eats the interest: what it cannot pay now is owed, and claim() pays it later.
        if (due > got) lends[c.owner].accrued += due - got;
        uint256 payout = c.amount + got;
        uint256 pts = c.amount / 1e6;
        farmers[c.owner].points += pts;
        _close(cropId, Status.Harvested, payout, pts);
    }

    /// Pull the crop early: principal back, yield forfeited.
    function uproot(uint256 cropId) external nonReentrant {
        Crop storage c = _own(cropId);
        _close(cropId, Status.Uprooted, c.amount, 0);
    }

    // ---------- game loop ----------

    function water(uint256 cropId) external {
        Crop storage c = _own(cropId);
        uint64 d = today();
        if (c.lastWateredDay == d) revert AlreadyWateredToday();
        c.lastWateredDay = d;
        Farmer storage f = farmers[c.owner];
        if (f.lastWaterDay != d) {
            f.streak = f.lastWaterDay + 1 == d ? f.streak + 1 : 1;
            f.lastWaterDay = d;
        }
        uint256 gain = 2 + (f.streak > 7 ? 7 : f.streak);
        f.ripePoints += gain;
        emit Watered(cropId, c.owner, gain, f.streak);
    }

    function collect() external {
        Farmer storage f = farmers[_msgSender()];
        uint256 n = f.ripePoints;
        f.ripePoints = 0;
        f.points += n;
        emit Collected(_msgSender(), n);
    }

    /// Only a farmer with a crop in the ground may steal, so fresh throwaway wallets cannot farm the
    /// gasless relay for free points.
    function steal(address victim) external {
        if (victim == _msgSender()) revert CannotStealFromYourself();
        Farmer storage v = farmers[victim];
        Farmer storage t = farmers[_msgSender()];
        if (t.activeCrops == 0) revert NotAFarmer();
        bool neighbour = victim == NEIGHBOUR;
        if (!neighbour && v.guarded) revert Guarded();
        uint64 d = today();
        if (t.lastStealDay == d && t.lastStealDay != 0) revert StealCooldown();
        uint256 n = neighbour ? NEIGHBOUR_POINTS : (v.ripePoints * 40) / 100;
        if (n == 0) revert NothingToSteal();
        t.lastStealDay = d;
        if (!neighbour) v.ripePoints -= n;
        t.points += n;
        emit Stolen(_msgSender(), victim, n);
    }

    function setGuard(bool guarded) external {
        farmers[_msgSender()].guarded = guarded;
        emit GuardSet(_msgSender(), guarded);
    }

    function cropsOf(address who) external view returns (uint256[] memory ids, Crop[] memory list) {
        ids = _cropsOf[who];
        list = new Crop[](ids.length);
        for (uint256 i; i < ids.length; i++) list[i] = crops[ids[i]];
    }

    // ---------- internals ----------

    function _own(uint256 cropId) private view returns (Crop storage c) {
        c = crops[cropId];
        if (c.owner != _msgSender()) revert NotYourCrop();
        if (c.status != Status.Growing) revert WrongStatus(c.status);
    }

    function _close(uint256 cropId, Status s, uint256 payout, uint256 pts) private {
        Crop storage c = crops[cropId];
        c.status = s;
        c.payout = payout;
        totalLocked -= c.amount;
        farmers[c.owner].activeCrops--;
        _pay(c.owner, payout);
        emit CropClosed(cropId, c.owner, s, payout, pts);
    }

    function _accrue(address u) private {
        Lend storage l = lends[u];
        if (l.last != 0) l.accrued += (l.principal * LEND_APY_BPS * (block.timestamp - l.last)) / (BPS * YEAR_DAYS * dayLength);
        l.last = uint64(block.timestamp);
    }

    function _pay(address to, uint256 amount) private {
        uint256 held = usdc.balanceOf(address(this));
        if (held < amount) _divest(amount - held);
        usdc.safeTransfer(to, amount);
    }

    function _divest(uint256 amount) private {
        if (amount > invested) amount = invested;
        if (amount == 0) return;
        invested -= amount;
        yieldSource.withdraw(amount);
        emit Divested(amount, invested);
    }

    function _takeReward(uint256 want) private returns (uint256 got) {
        got = want > rewardReserve ? rewardReserve : want;
        rewardReserve -= got;
    }
}
