// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFarmGameView {
    function crops(uint256 id)
        external
        view
        returns (address owner, uint8 tier, uint8 status, uint64 plantedAt, uint64 lastWateredDay, uint256 amount, uint256 payout);
    function farmers(address who)
        external
        view
        returns (uint256 points, uint256 ripePoints, uint32 streak, uint64 lastWaterDay, uint64 lastStealDay, bool guarded, uint16 activeCrops);
    function lends(address who) external view returns (uint256 principal, uint256 accrued, uint64 last);
    function today() external view returns (uint64);
    function readyAt(uint256 cropId) external view returns (uint256);
    function dayLength() external view returns (uint256);
}

interface IFarmCoopView {
    function debtOf(address user) external view returns (uint256);
    function healthOf(address user) external view returns (uint256);
}

interface IFarmPondView {
    function sharesOf(address user) external view returns (uint256);
}

/// Kho đồ: everything a player owns that is not money, as ERC-1155 tokens on Fuji.
///  - Nông sản (produce) from harvested orchard crops. Token id = kind * 1e9 + the day the crop ripened, and a batch
///    spoils SHELF_DAYS game days after that day, however late it is harvested or claimed, so nobody hoards produce.
///  - Huy hiệu mùa vụ (badges): earned by doing a DeFi lesson, checked on-chain, soulbound (never move).
///  - Đồ trang trí (cosmetics): bought with season points or crafted from produce.
///  - Chợ đổi đồ: item-for-item offers held in escrow by this contract; a points fee per item unit.
/// Items never move outside the market (no gifts, no transferFrom), so the fee cannot be dodged, and nothing here
/// can be exchanged for USDC. No randomness anywhere. Gasless through FarmForwarder like the rest of the farm.
contract FarmItems is ERC1155, ERC2771Context, ReentrancyGuard {
    // ---------- ids ----------
    uint256 public constant KIND = 1e9; // produce id = kind * KIND + day
    uint256 public constant CHILI = 1;
    uint256 public constant MANGO = 2;
    uint256 public constant DURIAN = 3;
    uint256 public constant SHELF_DAYS = 7;

    uint256 public constant BADGE_SEED = 1001; // first deposit in Ruộng rau
    uint256 public constant BADGE_PATIENCE = 1002; // harvested a 90-day durian
    uint256 public constant BADGE_FISH = 1003; // kept liquidity in Ao cá for FISH_DAYS, checked in every day
    uint256 public constant BADGE_SAFE = 1004; // borrowed with health >= 1.5 at every daily check-in for SAFE_DAYS
    uint256 public constant BADGE_DILIGENT = 1005; // watering streak >= STREAK_DAYS
    uint256 public constant BADGE_MASTER = 1006; // all five lesson badges
    uint256 public constant TROPHY = 1007; // top of a season, awarded by the owner, max 10 per season

    uint256 public constant HAT_RED = 2001;
    uint256 public constant HAT_GREEN = 2002;
    uint256 public constant HAT_GOLD = 2003;
    uint256 public constant LANTERNS = 2004;
    uint256 public constant FLOWER_HEDGE = 2005;
    uint256 public constant FRUIT_TRAY = 2006; // Mâm ngũ quả, crafted only

    uint256 public constant FISH_DAYS = 3;
    uint256 public constant SAFE_DAYS = 3;
    uint256 public constant SAFE_HEALTH_BPS = 15_000;
    uint256 public constant STREAK_DAYS = 7;
    uint256 public constant TROPHIES_PER_SEASON = 10;
    uint256 public constant MAX_LEGS = 4;

    IFarmGameView public immutable game;
    IFarmCoopView public immutable coop;
    IFarmPondView public immutable pond;
    address public owner;

    /// points fee per item unit given in a trade (both sides pay for what they give); owner can change it, 0 = free
    uint256 public feePerUnit = 1;
    uint256 public feePool; // points collected from trades, shown as the season prize pool
    mapping(uint256 => uint256) public price; // cosmetic id => points, 0 = not for sale
    mapping(address => uint256) public spent; // season points spent in the shop and on fees
    mapping(uint256 => bool) public claimedCrop;
    /// Cheap facts for FarmQuests, so quests never scan a player's whole history.
    mapping(address => bool) public gotProduce; // claimed produce at least once
    mapping(address => uint256) public offersMade; // market offers posted
    mapping(address => uint64) public fishSince;
    mapping(address => uint64) public fishSeen; // last day the player checked in at Ao cá
    mapping(address => uint256) public fishShares; // pond shares at the start; holding fewer restarts the clock
    mapping(address => uint64) public safeSince;
    mapping(address => uint64) public safeSeen; // last day the player checked in at Hợp tác xã
    mapping(address => uint256) public hatOf;
    mapping(uint256 => uint256) public trophiesAwarded; // season => count
    mapping(uint256 => mapping(address => bool)) public trophyWinner;

    // produce batches each player has held, so the UI can list them without an indexer
    mapping(address => uint256[]) private _batches;
    mapping(address => mapping(uint256 => bool)) private _knownBatch;

    struct Offer {
        address maker;
        address taker; // 0 = anyone
        uint64 expires;
        bool open;
        uint256[] giveIds; // concrete ids held in escrow
        uint256[] giveAmts;
        uint256[] wantIds; // produce as kind * KIND (any fresh batch of that kind), cosmetics as their id
        uint256[] wantAmts;
    }
    Offer[] private _offers;
    bool private _moving; // set while this contract moves items itself (escrow, trades)

    event OwnershipTransferred(address indexed previous, address indexed next);
    event FeeSet(uint256 feePerUnit);
    event PriceSet(uint256 indexed id, uint256 points);
    event HarvestClaimed(address indexed user, uint256 indexed cropId, uint256 indexed itemId, uint256 amount);
    event BadgeEarned(address indexed user, uint256 indexed badgeId);
    event WatchStarted(address indexed user, uint256 indexed badgeId, uint64 day);
    event TrophyAwarded(uint256 indexed season, address indexed user);
    event Bought(address indexed user, uint256 indexed id, uint256 amount, uint256 points);
    event Crafted(address indexed user, uint256 indexed id);
    event HatEquipped(address indexed user, uint256 indexed id);
    event Discarded(address indexed user, uint256 indexed id, uint256 amount);
    event OfferMade(uint256 indexed offerId, address indexed maker, address indexed taker, uint64 expires, uint256 fee);
    event OfferTaken(uint256 indexed offerId, address indexed taker, uint256 fee);
    event OfferCancelled(uint256 indexed offerId);

    error NotOwner();
    error ZeroAddress();
    error NotTransferable();
    error NotYourCrop();
    error NotHarvested();
    error AlreadyClaimed();
    error AlreadyEarned();
    error NotEligible();
    error NotForSale();
    error NotEnoughPoints(uint256 have, uint256 need);
    error Spoiled(uint256 id);
    error NotTradable(uint256 id);
    error BadOffer();
    error OfferClosed();
    error OfferExpired();
    error NotForYou();
    error WrongItem(uint256 want, uint256 got);
    error SeasonFull();
    error NotAHat();

    constructor(address forwarder, address game_, address coop_, address pond_)
        ERC1155("")
        ERC2771Context(forwarder)
    {
        game = IFarmGameView(game_);
        coop = IFarmCoopView(coop_);
        pond = IFarmPondView(pond_);
        owner = _msgSender();
        price[HAT_RED] = 20;
        price[HAT_GREEN] = 20;
        price[HAT_GOLD] = 150;
        price[LANTERNS] = 40;
        price[FLOWER_HEDGE] = 60;
    }

    modifier onlyOwner() {
        if (_msgSender() != owner) revert NotOwner();
        _;
    }

    // ---------- admin ----------

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    function setFee(uint256 perUnit) external onlyOwner {
        feePerUnit = perUnit;
        emit FeeSet(perUnit);
    }

    function setPrice(uint256 id, uint256 points) external onlyOwner {
        if (!_isCosmetic(id) || id == FRUIT_TRAY) revert NotForSale();
        price[id] = points;
        emit PriceSet(id, points);
    }

    /// End of a season: the owner hands the trophy to the top players (ranked off-chain from public events).
    function awardSeason(uint256 season, address[] calldata winners) external onlyOwner {
        for (uint256 i; i < winners.length; i++) {
            address w = winners[i];
            if (trophyWinner[season][w]) continue;
            if (trophiesAwarded[season] >= TROPHIES_PER_SEASON) revert SeasonFull();
            trophiesAwarded[season]++;
            trophyWinner[season][w] = true;
            _mint(w, TROPHY, 1, "");
            emit TrophyAwarded(season, w);
        }
    }

    // ---------- views ----------

    function today() public view returns (uint64) {
        return game.today();
    }

    function kindOf(uint256 id) public pure returns (uint256) {
        return id / KIND;
    }

    function isProduce(uint256 id) public pure returns (bool) {
        uint256 k = id / KIND;
        return k >= CHILI && k <= DURIAN;
    }

    function isFresh(uint256 id) public view returns (bool) {
        return isProduce(id) && uint256(today()) <= (id % KIND) + SHELF_DAYS;
    }

    /// Season points still available: earned in FarmGame (they only ever go up) minus what was spent here.
    function pointsOf(address user) public view returns (uint256) {
        (uint256 pts,,,,,,) = game.farmers(user);
        return pts > spent[user] ? pts - spent[user] : 0;
    }

    /// Everything a player holds: badges, cosmetics, then produce batches (spoiled ones included, so they can be thrown away).
    function itemsOf(address user) external view returns (uint256[] memory ids, uint256[] memory amounts) {
        uint256[] memory fixedIds = new uint256[](13);
        for (uint256 i; i < 7; i++) fixedIds[i] = 1001 + i;
        for (uint256 i; i < 6; i++) fixedIds[7 + i] = 2001 + i;
        uint256[] storage b = _batches[user];
        uint256 n;
        for (uint256 i; i < fixedIds.length; i++) if (balanceOf(user, fixedIds[i]) > 0) n++;
        for (uint256 i; i < b.length; i++) if (balanceOf(user, b[i]) > 0) n++;
        ids = new uint256[](n);
        amounts = new uint256[](n);
        uint256 k;
        for (uint256 i; i < fixedIds.length; i++) {
            uint256 bal = balanceOf(user, fixedIds[i]);
            if (bal > 0) {
                ids[k] = fixedIds[i];
                amounts[k] = bal;
                k++;
            }
        }
        for (uint256 i; i < b.length; i++) {
            uint256 bal = balanceOf(user, b[i]);
            if (bal > 0) {
                ids[k] = b[i];
                amounts[k] = bal;
                k++;
            }
        }
    }

    function offerCount() external view returns (uint256) {
        return _offers.length;
    }

    function offer(uint256 offerId) external view returns (Offer memory) {
        return _offers[offerId];
    }

    // ---------- nông sản ----------

    /// Produce for a harvested orchard crop, once per crop: chili 3, mango 2, durian 1, plus 1 per 50 USDC planted (max +4).
    function claimHarvest(uint256 cropId) external nonReentrant returns (uint256 itemId, uint256 amount) {
        address u = _msgSender();
        (address cropOwner, uint8 tier, uint8 status,,, uint256 planted,) = game.crops(cropId);
        if (cropOwner != u) revert NotYourCrop();
        if (status != 2) revert NotHarvested();
        if (claimedCrop[cropId]) revert AlreadyClaimed();
        claimedCrop[cropId] = true;
        uint256 extra = planted / 50e6;
        amount = (tier == 0 ? 3 : tier == 1 ? 2 : 1) + (extra > 4 ? 4 : extra);
        // Dated by the day the crop ripened, not the day it is claimed, so produce cannot be kept fresh by waiting.
        itemId = (uint256(tier) + 1) * KIND + game.readyAt(cropId) / game.dayLength();
        gotProduce[u] = true;
        _mint(u, itemId, amount, "");
        emit HarvestClaimed(u, cropId, itemId, amount);
    }

    /// Throw away spoiled (or unwanted) produce to tidy the inventory.
    function discard(uint256 id, uint256 amount) external {
        if (!isProduce(id)) revert NotTradable(id);
        _burn(_msgSender(), id, amount);
        emit Discarded(_msgSender(), id, amount);
    }

    // ---------- huy hiệu ----------

    /// Start, or keep going, the clock for the badges that need time: call it once every game day (a check-in).
    /// Missing a day restarts the clock. Ao cá also restarts if the player holds fewer pond shares than at the
    /// start; Hợp tác xã needs an open loan with health >= 1.5 at every check-in. Only the player's own state
    /// counts, so nobody else (e.g. by repaying a little of their debt) can reset it.
    function startWatch(uint256 badgeId) external {
        address u = _msgSender();
        uint64 d = today();
        if (badgeId == BADGE_FISH) {
            uint256 shares = pond.sharesOf(u);
            if (shares == 0) revert NotEligible();
            if (fishSince[u] == 0 || d > fishSeen[u] + 1 || shares < fishShares[u]) {
                fishSince[u] = d;
                fishShares[u] = shares;
            }
            fishSeen[u] = d;
        } else if (badgeId == BADGE_SAFE) {
            if (coop.debtOf(u) == 0 || coop.healthOf(u) < SAFE_HEALTH_BPS) revert NotEligible();
            if (safeSince[u] == 0 || d > safeSeen[u] + 1) safeSince[u] = d;
            safeSeen[u] = d;
        } else {
            revert NotEligible();
        }
        emit WatchStarted(u, badgeId, d);
    }

    function canEarn(address u, uint256 badgeId, uint256 arg) public view returns (bool) {
        if (balanceOf(u, badgeId) > 0) return false;
        if (badgeId == BADGE_SEED) {
            (uint256 principal,,) = game.lends(u);
            return principal > 0;
        }
        if (badgeId == BADGE_PATIENCE) {
            (address o, uint8 tier, uint8 status,,,,) = game.crops(arg);
            return o == u && tier == 2 && status == 2;
        }
        if (badgeId == BADGE_FISH) {
            uint64 s = fishSince[u];
            uint64 d = today();
            return s != 0 && d >= s + FISH_DAYS && d <= fishSeen[u] + 1 && pond.sharesOf(u) >= fishShares[u];
        }
        if (badgeId == BADGE_SAFE) {
            uint64 s = safeSince[u];
            uint64 d = today();
            return s != 0 && d >= s + SAFE_DAYS && d <= safeSeen[u] + 1 && coop.debtOf(u) > 0
                && coop.healthOf(u) >= SAFE_HEALTH_BPS;
        }
        if (badgeId == BADGE_DILIGENT) {
            (,, uint32 streak,,,,) = game.farmers(u);
            return streak >= STREAK_DAYS;
        }
        if (badgeId == BADGE_MASTER) {
            for (uint256 id = BADGE_SEED; id <= BADGE_DILIGENT; id++) if (balanceOf(u, id) == 0) return false;
            return true;
        }
        return false;
    }

    /// arg is the crop id for BADGE_PATIENCE, ignored otherwise.
    function claimBadge(uint256 badgeId, uint256 arg) external {
        address u = _msgSender();
        if (balanceOf(u, badgeId) > 0) revert AlreadyEarned();
        if (!canEarn(u, badgeId, arg)) revert NotEligible();
        _mint(u, badgeId, 1, "");
        emit BadgeEarned(u, badgeId);
    }

    // ---------- đồ trang trí ----------

    function buy(uint256 id, uint256 amount) external nonReentrant {
        uint256 p = price[id];
        if (p == 0 || amount == 0) revert NotForSale();
        address u = _msgSender();
        _spend(u, p * amount);
        _mint(u, id, amount, "");
        emit Bought(u, id, amount, p * amount);
    }

    /// Mâm ngũ quả: 3 chili + 2 mango + 1 durian, all fresh.
    function craftFruitTray(uint256 chiliId, uint256 mangoId, uint256 durianId) external nonReentrant {
        if (kindOf(chiliId) != CHILI || kindOf(mangoId) != MANGO || kindOf(durianId) != DURIAN) revert BadOffer();
        if (!isFresh(chiliId)) revert Spoiled(chiliId);
        if (!isFresh(mangoId)) revert Spoiled(mangoId);
        if (!isFresh(durianId)) revert Spoiled(durianId);
        address u = _msgSender();
        _burn(u, chiliId, 3);
        _burn(u, mangoId, 2);
        _burn(u, durianId, 1);
        _mint(u, FRUIT_TRAY, 1, "");
        emit Crafted(u, FRUIT_TRAY);
    }

    /// Wear a hat you own (0 = the plain nón lá).
    function equipHat(uint256 id) external {
        address u = _msgSender();
        if (id != 0) {
            if (id < HAT_RED || id > HAT_GOLD) revert NotAHat();
            if (balanceOf(u, id) == 0) revert NotEligible();
        }
        hatOf[u] = id;
        emit HatEquipped(u, id);
    }

    // ---------- chợ đổi đồ ----------

    /// What each side hands over. give: concrete ids the maker puts in escrow. want: produce as kind * KIND (any fresh
    /// batch of that kind) or a cosmetic id.
    struct Legs {
        uint256[] giveIds;
        uint256[] giveAmts;
        uint256[] wantIds;
        uint256[] wantAmts;
    }

    function makeOffer(Legs calldata legs, address taker, uint256 durationDays) external nonReentrant returns (uint256 offerId) {
        if (durationDays == 0 || durationDays > 7) revert BadOffer();
        address u = _msgSender();
        if (taker == u) revert BadOffer();
        uint256 fee = _checkLegs(legs) * feePerUnit;
        _spend(u, fee);
        feePool += fee;
        _move(u, address(this), legs.giveIds, legs.giveAmts);
        Offer storage o = _offers.push();
        o.maker = u;
        o.taker = taker;
        o.expires = uint64(block.timestamp + durationDays * _dayLength());
        o.open = true;
        o.giveIds = legs.giveIds;
        o.giveAmts = legs.giveAmts;
        o.wantIds = legs.wantIds;
        o.wantAmts = legs.wantAmts;
        offerId = _offers.length - 1;
        offersMade[u]++;
        emit OfferMade(offerId, u, taker, o.expires, fee);
    }

    /// Validates both sides and returns the units the maker gives (the fee base).
    function _checkLegs(Legs calldata legs) private view returns (uint256 units) {
        uint256 ng = legs.giveIds.length;
        uint256 nw = legs.wantIds.length;
        if (ng == 0 || nw == 0 || ng > MAX_LEGS || nw > MAX_LEGS || ng != legs.giveAmts.length || nw != legs.wantAmts.length) revert BadOffer();
        for (uint256 i; i < ng; i++) {
            _checkTradable(legs.giveIds[i]);
            if (legs.giveAmts[i] == 0) revert BadOffer();
            units += legs.giveAmts[i];
        }
        for (uint256 i; i < nw; i++) {
            uint256 w = legs.wantIds[i];
            if (!(w % KIND == 0 && isProduce(w)) && !_isTradableCosmetic(w)) revert NotTradable(w);
            if (legs.wantAmts[i] == 0) revert BadOffer();
        }
    }

    /// payIds: for each wanted leg, the concrete id the taker hands over (a fresh batch of the wanted kind, or the cosmetic).
    function acceptOffer(uint256 offerId, uint256[] calldata payIds) external nonReentrant {
        Offer storage o = _offers[offerId];
        if (!o.open) revert OfferClosed();
        if (block.timestamp > o.expires) revert OfferExpired();
        address u = _msgSender();
        if (u == o.maker || (o.taker != address(0) && o.taker != u)) revert NotForYou();
        uint256 nw = o.wantIds.length;
        if (payIds.length != nw) revert BadOffer();
        uint256 units;
        for (uint256 i; i < nw; i++) {
            uint256 w = o.wantIds[i];
            uint256 p = payIds[i];
            if (w % KIND == 0 && isProduce(w)) {
                if (kindOf(p) != kindOf(w) || !isProduce(p)) revert WrongItem(w, p);
                if (!isFresh(p)) revert Spoiled(p);
            } else if (p != w) {
                revert WrongItem(w, p);
            }
            units += o.wantAmts[i];
        }
        for (uint256 i; i < o.giveIds.length; i++) if (isProduce(o.giveIds[i]) && !isFresh(o.giveIds[i])) revert Spoiled(o.giveIds[i]);
        uint256 fee = units * feePerUnit;
        _spend(u, fee);
        feePool += fee;
        o.open = false;
        _move(u, o.maker, payIds, o.wantAmts);
        _move(address(this), u, o.giveIds, o.giveAmts);
        emit OfferTaken(offerId, u, fee);
    }

    /// The maker can always cancel; anyone can close an expired offer, which returns the items to the maker.
    function cancelOffer(uint256 offerId) external nonReentrant {
        Offer storage o = _offers[offerId];
        if (!o.open) revert OfferClosed();
        if (_msgSender() != o.maker && block.timestamp <= o.expires) revert NotForYou();
        o.open = false;
        _move(address(this), o.maker, o.giveIds, o.giveAmts);
        emit OfferCancelled(offerId);
    }

    // ---------- internals ----------

    function _dayLength() private view returns (uint256) {
        // the same game-day length FarmGame uses
        return IDayLength(address(game)).dayLength();
    }

    function _isCosmetic(uint256 id) private pure returns (bool) {
        return id >= HAT_RED && id <= FRUIT_TRAY;
    }

    function _isTradableCosmetic(uint256 id) private pure returns (bool) {
        return _isCosmetic(id);
    }

    function _checkTradable(uint256 id) private view {
        if (isProduce(id)) {
            if (id % KIND == 0) revert NotTradable(id);
            if (!isFresh(id)) revert Spoiled(id);
        } else if (!_isTradableCosmetic(id)) {
            revert NotTradable(id); // badges and trophies are soulbound
        }
    }

    function _spend(address u, uint256 points) private {
        if (points == 0) return;
        uint256 have = pointsOf(u);
        if (have < points) revert NotEnoughPoints(have, points);
        spent[u] += points;
    }

    function _move(address from, address to, uint256[] memory ids, uint256[] memory amts) private {
        _moving = true;
        _update(from, to, ids, amts);
        _moving = false;
    }

    /// Items only change hands through this contract (mint, burn, escrow, trades): no gifts and no transferFrom,
    /// so trading always goes through the market and its fee.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (from != address(0) && to != address(0) && !_moving) revert NotTransferable();
        super._update(from, to, ids, values);
        if (to != address(0) && to != address(this)) {
            for (uint256 i; i < ids.length; i++) {
                uint256 id = ids[i];
                if (isProduce(id) && !_knownBatch[to][id]) {
                    _knownBatch[to][id] = true;
                    _batches[to].push(id);
                }
            }
        }
    }

    function setApprovalForAll(address, bool) public pure override {
        revert NotTransferable();
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
}

interface IDayLength {
    function dayLength() external view returns (uint256);
}
