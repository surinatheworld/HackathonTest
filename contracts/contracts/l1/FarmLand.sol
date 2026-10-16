// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICMApp, FarmMsg} from "../ICMApp.sol";

/// Game L1 side of Nông Trại DeFi. Holds game state only, never money.
///
/// Crops are optimistic: plant / harvest / uproot update the game state at once and send one ICM
/// message (L1 → C-Chain) that makes FarmVault lock or pay the real USDC. FarmVault is the source of
/// truth for money, and the game UI reads it directly. Receipts back from C-Chain are optional: if a
/// relayer delivers them, they reconcile the game state (e.g. a plant that could not pull USDC).
/// This keeps the game playable on L1s whose nodes cannot verify C-Chain → L1 Warp messages.
///
/// water, collect and steal are dense, near-free game actions that stay on the L1.
contract FarmLand is ICMApp {
    enum Status {
        None,
        Pending, // unused since optimistic crops; kept so status codes stay stable
        Growing,
        Harvesting, // unused, see above
        Harvested,
        Uprooted,
        Failed
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
        uint256 points; // collected season points
        uint256 ripePoints; // grown but not yet collected; neighbours can steal 40%
        uint32 streak;
        uint64 lastWaterDay;
        uint64 lastStealDay;
        bool guarded; // has a butler watching the garden
        uint16 activeCrops;
    }

    uint16 public constant MAX_ACTIVE_CROPS = 12;
    /// Extra game days a crop waits on the L1 before harvest, so the C-Chain lock (which starts when
    /// the ICM message lands) is ripe by the time the HARVEST message arrives.
    uint256 public constant SETTLE_DAYS = 2;
    uint256 public immutable dayLength;
    uint256 public nextCropId = 1;

    mapping(uint256 => Crop) public crops;
    mapping(address => uint256[]) private _cropsOf;
    mapping(address => Farmer) public farmers;

    event Planted(uint256 indexed cropId, address indexed owner, uint8 tier, uint256 amount);
    event CropStatus(uint256 indexed cropId, Status status, uint256 payout);
    event Watered(uint256 indexed cropId, address indexed owner, uint256 ripePoints, uint32 streak);
    event Collected(address indexed owner, uint256 amount);
    event Stolen(address indexed thief, address indexed victim, uint256 amount);
    event GuardSet(address indexed owner, bool guarded);

    error BadTier();
    error ZeroAmount();
    error NotYourCrop();
    error WrongStatus(Status status);
    error NotRipe(uint256 readyAt);
    error AlreadyWateredToday();
    error FarmFull();
    error Guarded();
    error StealCooldown();
    error NothingToSteal();

    constructor(address teleporter_, uint256 dayLength_) ICMApp(teleporter_) {
        dayLength = dayLength_;
    }

    function tierDays(uint8 tier) public pure returns (uint256) {
        return tier == 0 ? 7 : tier == 1 ? 30 : 90;
    }

    function today() public view returns (uint64) {
        return uint64(block.timestamp / dayLength);
    }

    function readyAt(uint256 cropId) public view returns (uint256) {
        Crop memory c = crops[cropId];
        return c.plantedAt == 0 ? 0 : c.plantedAt + (tierDays(c.tier) + SETTLE_DAYS) * dayLength;
    }

    // ---------- crops (L1 → C-Chain over ICM) ----------

    /// Before planting, approve FarmVault for `amount` USDC on C-Chain with the same address.
    function plant(uint8 tier, uint256 amount) external returns (uint256 cropId) {
        if (tier > 2) revert BadTier();
        if (amount == 0) revert ZeroAmount();
        Farmer storage f = farmers[msg.sender];
        if (f.activeCrops >= MAX_ACTIVE_CROPS) revert FarmFull();
        f.activeCrops++;
        cropId = nextCropId++;
        crops[cropId] = Crop({
            owner: msg.sender,
            tier: tier,
            status: Status.Growing,
            plantedAt: uint64(block.timestamp),
            lastWateredDay: 0,
            amount: amount,
            payout: 0
        });
        _cropsOf[msg.sender].push(cropId);
        emit Planted(cropId, msg.sender, tier, amount);
        emit CropStatus(cropId, Status.Growing, 0);
        _send(FarmMsg.PLANT, cropId, msg.sender, tier, amount);
    }

    function harvest(uint256 cropId) external {
        Crop storage c = _own(cropId, Status.Growing);
        uint256 ripeAt = readyAt(cropId);
        if (block.timestamp < ripeAt) revert NotRipe(ripeAt);
        _close(cropId, Status.Harvested);
        farmers[msg.sender].points += c.amount / 1e6; // 1 season point per USDC grown to term
        _send(FarmMsg.HARVEST, cropId, msg.sender, c.tier, c.amount);
    }

    /// Pull the crop early: FarmVault returns the principal, all yield is lost.
    function uproot(uint256 cropId) external {
        Crop storage c = _own(cropId, Status.Growing);
        _close(cropId, Status.Uprooted);
        _send(FarmMsg.UPROOT, cropId, msg.sender, c.tier, c.amount);
    }

    /// Optional receipts from FarmVault. Only reconcile; never required for the game to move on.
    function _handle(bytes calldata message) internal override {
        (uint8 kind, uint256 cropId,,, uint256 amount) = FarmMsg.decode(message);
        Crop storage c = crops[cropId];
        if (c.owner == address(0)) return;
        if (kind == FarmMsg.PLANT_FAILED && c.status == Status.Growing) {
            _close(cropId, Status.Failed);
        } else if ((kind == FarmMsg.HARVESTED || kind == FarmMsg.UPROOTED) && amount != 0) {
            c.payout = amount;
            emit CropStatus(cropId, c.status, amount);
        }
        // HARVEST_FAILED needs no action: the lock stays open on C-Chain and the owner can claim it
        // there with FarmVault.claimLock.
    }

    // ---------- daily game loop (L1 only) ----------

    function water(uint256 cropId) external {
        Crop storage c = _own(cropId, Status.Growing);
        uint64 d = today();
        if (c.lastWateredDay == d) revert AlreadyWateredToday();
        c.lastWateredDay = d;
        Farmer storage f = farmers[msg.sender];
        if (f.lastWaterDay != d) {
            f.streak = f.lastWaterDay + 1 == d ? f.streak + 1 : 1;
            f.lastWaterDay = d;
        }
        uint256 gain = 2 + (f.streak > 7 ? 7 : f.streak);
        f.ripePoints += gain;
        emit Watered(cropId, msg.sender, gain, f.streak);
    }

    function collect() external {
        Farmer storage f = farmers[msg.sender];
        uint256 n = f.ripePoints;
        f.ripePoints = 0;
        f.points += n;
        emit Collected(msg.sender, n);
    }

    /// "Trộm rau": take 40% of a neighbour's uncollected points. Never touches money.
    function steal(address victim) external {
        Farmer storage v = farmers[victim];
        Farmer storage t = farmers[msg.sender];
        if (v.guarded) revert Guarded();
        uint64 d = today();
        if (t.lastStealDay == d && t.lastStealDay != 0) revert StealCooldown();
        uint256 n = (v.ripePoints * 40) / 100;
        if (n == 0) revert NothingToSteal();
        t.lastStealDay = d;
        v.ripePoints -= n;
        t.points += n;
        emit Stolen(msg.sender, victim, n);
    }

    function setGuard(bool guarded) external {
        farmers[msg.sender].guarded = guarded;
        emit GuardSet(msg.sender, guarded);
    }

    // ---------- views ----------

    function cropsOf(address owner_) external view returns (uint256[] memory ids, Crop[] memory list) {
        ids = _cropsOf[owner_];
        list = new Crop[](ids.length);
        for (uint256 i; i < ids.length; i++) {
            list[i] = crops[ids[i]];
        }
    }

    // ---------- internals ----------

    function _own(uint256 cropId, Status need) private view returns (Crop storage c) {
        c = crops[cropId];
        if (c.owner != msg.sender) revert NotYourCrop();
        if (c.status != need) revert WrongStatus(c.status);
    }

    function _close(uint256 cropId, Status s) private {
        Crop storage c = crops[cropId];
        c.status = s;
        farmers[c.owner].activeCrops--;
        emit CropStatus(cropId, s, 0);
    }
}
