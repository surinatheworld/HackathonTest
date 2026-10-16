// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

interface IPriceFeed {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// Hợp tác xã: gAVAX in the granary as collateral, borrow USDC "fertiliser" against it.
/// Priced by Chainlink AVAX/USD on Fuji. Borrow up to 60% of the collateral value; once debt passes
/// 75% anyone may repay it and take the collateral plus a 10% penalty. Debt grows at 8% APR,
/// counted in game days like the rest of the farm. Gasless through FarmForwarder.
contract FarmCoop is ERC2771Context {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR_DAYS = 365;
    uint256 public constant LTV_BPS = 6_000;
    uint256 public constant LIQ_THRESHOLD_BPS = 7_500;
    uint256 public constant LIQ_PENALTY_BPS = 1_000;
    uint256 public constant BORROW_APR_BPS = 800;

    struct Position {
        uint256 collateral; // gAVAX, 18 decimals
        uint256 debt; // USDC, 6 decimals, interest included up to `last`
        uint64 last;
    }

    IERC20 public immutable usdc;
    IERC20 public immutable avax;
    uint256 public immutable dayLength;
    address public owner;
    IPriceFeed public oracle;
    uint256 public maxPriceAge;
    uint256 public totalCollateral;

    mapping(address => Position) public positions;

    event OracleSet(address indexed oracle, uint256 maxPriceAge);
    event LiquidityFunded(address indexed from, uint256 amount);
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount, uint256 debt);
    event Repaid(address indexed user, address indexed payer, uint256 amount, uint256 debt);
    event Liquidated(address indexed user, address indexed liquidator, uint256 debtRepaid, uint256 collateralSeized);

    error NotOwner();
    error ZeroAmount();
    error InsufficientCollateral();
    error ExceedsBorrowLimit(uint256 maxBorrow);
    error NoDebt();
    error NotLiquidatable(uint256 healthBps);
    error StalePrice(uint256 updatedAt);
    error BadPrice();
    error NoLiquidity(uint256 available);

    constructor(address forwarder, address usdc_, address avax_, address oracle_, uint256 maxPriceAge_, uint256 dayLength_)
        ERC2771Context(forwarder)
    {
        usdc = IERC20(usdc_);
        avax = IERC20(avax_);
        dayLength = dayLength_;
        owner = msg.sender;
        oracle = IPriceFeed(oracle_);
        maxPriceAge = maxPriceAge_;
    }

    // ---------- admin ----------

    function transferOwnership(address next) external {
        if (_msgSender() != owner) revert NotOwner();
        owner = next;
    }

    /// Switch feeds, e.g. to a demo feed to stage a "drought" (price crash) on stage.
    function setOracle(address oracle_, uint256 maxPriceAge_) external {
        if (_msgSender() != owner) revert NotOwner();
        oracle = IPriceFeed(oracle_);
        maxPriceAge = maxPriceAge_;
        emit OracleSet(oracle_, maxPriceAge_);
    }

    function fund(uint256 amount) external {
        usdc.safeTransferFrom(_msgSender(), address(this), amount);
        emit LiquidityFunded(_msgSender(), amount);
    }

    // ---------- price ----------

    /// AVAX price in USD with 8 decimals.
    function price() public view returns (uint256) {
        (, int256 answer,, uint256 updatedAt,) = oracle.latestRoundData();
        if (answer <= 0) revert BadPrice();
        if (block.timestamp > updatedAt + maxPriceAge) revert StalePrice(updatedAt);
        uint8 d = oracle.decimals();
        return d == 8 ? uint256(answer) : d > 8 ? uint256(answer) / 10 ** (d - 8) : uint256(answer) * 10 ** (8 - d);
    }

    /// Collateral value in USDC (6 decimals): 18 + 8 - 20 = 6.
    function collateralValue(uint256 amount) public view returns (uint256) {
        return (amount * price()) / 1e20;
    }

    // ---------- player ----------

    function depositCollateral(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        address u = _msgSender();
        avax.safeTransferFrom(u, address(this), amount);
        positions[u].collateral += amount;
        totalCollateral += amount;
        emit CollateralDeposited(u, amount);
    }

    function withdrawCollateral(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        address u = _msgSender();
        Position storage p = _accrue(u);
        if (amount > p.collateral) revert InsufficientCollateral();
        p.collateral -= amount;
        totalCollateral -= amount;
        // Without debt the price is not needed, so collateral can always come home even if the feed stalls.
        if (p.debt > 0 && p.debt > _limit(p.collateral)) revert ExceedsBorrowLimit(_limit(p.collateral));
        avax.safeTransfer(u, amount);
        emit CollateralWithdrawn(u, amount);
    }

    function borrow(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        address u = _msgSender();
        Position storage p = _accrue(u);
        uint256 limit = _limit(p.collateral);
        if (p.debt + amount > limit) revert ExceedsBorrowLimit(limit > p.debt ? limit - p.debt : 0);
        uint256 available = usdc.balanceOf(address(this));
        if (amount > available) revert NoLiquidity(available);
        p.debt += amount;
        usdc.safeTransfer(u, amount);
        emit Borrowed(u, amount, p.debt);
    }

    /// Repay your own debt, or anyone's (e.g. a friend). Overpaying is capped at the debt.
    function repay(address user, uint256 amount) external returns (uint256 paid) {
        Position storage p = _accrue(user);
        if (p.debt == 0) revert NoDebt();
        paid = amount > p.debt ? p.debt : amount;
        if (paid == 0) revert ZeroAmount();
        usdc.safeTransferFrom(_msgSender(), address(this), paid);
        p.debt -= paid;
        emit Repaid(user, _msgSender(), paid, p.debt);
    }

    /// Anyone (a keeper bot or another player) repays the whole debt of an unhealthy position and
    /// takes collateral worth that debt plus the penalty, capped at what the position holds.
    function liquidate(address user) external returns (uint256 seized) {
        Position storage p = _accrue(user);
        if (p.debt == 0) revert NoDebt();
        uint256 h = _health(p);
        if (h >= BPS) revert NotLiquidatable(h);
        uint256 debt = p.debt;
        uint256 px = price();
        seized = (debt * (BPS + LIQ_PENALTY_BPS) * 1e20) / (BPS * px);
        if (seized > p.collateral) seized = p.collateral;
        address liquidator = _msgSender();
        usdc.safeTransferFrom(liquidator, address(this), debt);
        p.debt = 0;
        p.collateral -= seized;
        totalCollateral -= seized;
        avax.safeTransfer(liquidator, seized);
        emit Liquidated(user, liquidator, debt, seized);
    }

    // ---------- views ----------

    function debtOf(address user) public view returns (uint256) {
        Position memory p = positions[user];
        return p.debt + _interest(p);
    }

    /// Health in basis points: 10_000 = exactly at the liquidation line, below that = liquidatable.
    function healthOf(address user) external view returns (uint256) {
        Position memory p = positions[user];
        p.debt += _interest(p);
        return _health(p);
    }

    function positionOf(address user)
        external
        view
        returns (uint256 collateral, uint256 debt, uint256 value, uint256 maxBorrow, uint256 healthBps)
    {
        Position memory p = positions[user];
        p.debt += _interest(p);
        collateral = p.collateral;
        debt = p.debt;
        value = collateralValue(p.collateral);
        uint256 limit = (value * LTV_BPS) / BPS;
        maxBorrow = limit > debt ? limit - debt : 0;
        healthBps = _health(p);
    }

    // ---------- internals ----------

    function _limit(uint256 collateral) private view returns (uint256) {
        return (collateralValue(collateral) * LTV_BPS) / BPS;
    }

    function _health(Position memory p) private view returns (uint256) {
        if (p.debt == 0) return type(uint256).max;
        return (collateralValue(p.collateral) * LIQ_THRESHOLD_BPS) / p.debt;
    }

    function _interest(Position memory p) private view returns (uint256) {
        if (p.debt == 0 || p.last == 0) return 0;
        return (p.debt * BORROW_APR_BPS * (block.timestamp - p.last)) / (BPS * YEAR_DAYS * dayLength);
    }

    function _accrue(address u) private returns (Position storage p) {
        p = positions[u];
        p.debt += _interest(p);
        p.last = uint64(block.timestamp);
    }
}
