// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICMApp, FarmMsg} from "../ICMApp.sol";

/// Game L1 side of Nông Trại DeFi. Holds game state only, never money.
///  - plant / harvest / uproot send an ICM message to FarmVault on C-Chain and wait for a receipt.
///  - water, collect and steal are dense, gas-free-ish game actions that stay on the L1.
contract FarmLand is ICMApp {
    enum Status {
        None,
        Pending, // PLANT sent, waiting for C-Chain receipt
        Growing,
        Harvesting, // HARVEST or UPROOT sent, waiting for receipt
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

    // ---------- crops (cross-chain) ----------

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
            status: Status.Pending,
            plantedAt: 0,
            lastWateredDay: 0,
            amount: amount,
            payout: 0
        });
        _cropsOf[msg.sender].push(cropId);
        emit Planted(cropId, msg.sender, tier, amount);
        _send(FarmMsg.PLANT, cropId, msg.sender, tier, amount);
    }

    function harvest(uint256 cropId) external {
        Crop storage c = _own(cropId, Status.Growing);
        uint256 ripeAt = c.plantedAt + tierDays(c.tier) * dayLength;
        if (block.timestamp < ripeAt) revert NotRipe(ripeAt);
        _setStatus(cropId, Status.Harvesting, 0);
        _send(FarmMsg.HARVEST, cropId, msg.sender, c.tier, c.amount);
    }

    /// Pull the crop early: principal comes back, all yield is lost.
    function uproot(uint256 cropId) external {
        Crop storage c = _own(cropId, Status.Growing);
        _setStatus(cropId, Status.Harvesting, 0);
        _send(FarmMsg.UPROOT, cropId, msg.sender, c.tier, c.amount);
    }

    function _handle(bytes calldata message) internal override {
        (uint8 kind, uint256 cropId,,, uint256 amount) = FarmMsg.decode(message);
        Crop storage c = crops[cropId];
        if (c.owner == address(0)) return;
        if (kind == FarmMsg.PLANTED && c.status == Status.Pending) {
            c.plantedAt = uint64(block.timestamp);
            _setStatus(cropId, Status.Growing, 0);
        } else if (kind == FarmMsg.PLANT_FAILED && c.status == Status.Pending) {
            farmers[c.owner].activeCrops--;
            _setStatus(cropId, Status.Failed, 0);
        } else if (kind == FarmMsg.HARVESTED && c.status == Status.Harvesting) {
            farmers[c.owner].activeCrops--;
            farmers[c.owner].points += amount / 1e6; // 1 season point per USDC harvested
            _setStatus(cropId, Status.Harvested, amount);
        } else if (kind == FarmMsg.UPROOTED && c.status == Status.Harvesting) {
            farmers[c.owner].activeCrops--;
            _setStatus(cropId, Status.Uprooted, amount);
        } else if (kind == FarmMsg.HARVEST_FAILED && c.status == Status.Harvesting) {
            _setStatus(cropId, Status.Growing, 0);
        }
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

    function readyAt(uint256 cropId) external view returns (uint256) {
        Crop memory c = crops[cropId];
        return c.plantedAt == 0 ? 0 : c.plantedAt + tierDays(c.tier) * dayLength;
    }

    // ---------- internals ----------

    function _own(uint256 cropId, Status need) private view returns (Crop storage c) {
        c = crops[cropId];
        if (c.owner != msg.sender) revert NotYourCrop();
        if (c.status != need) revert WrongStatus(c.status);
    }

    function _setStatus(uint256 cropId, Status s, uint256 payout) private {
        crops[cropId].status = s;
        if (payout != 0) crops[cropId].payout = payout;
        emit CropStatus(cropId, s, payout);
    }
}
