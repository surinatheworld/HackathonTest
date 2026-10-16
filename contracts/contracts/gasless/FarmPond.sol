// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/// Ao cá: a constant-product pool for USDC/gAVAX (x·y = k, 0.3% fee to liquidity providers).
/// "Thả cá" adds liquidity, "vớt cá" removes it, and the impermanent loss players see is the real one.
/// The USDC-only entry and exit (zapIn / zapOut) swap half through the pool itself, so a player
/// who only holds USDC can still join. Gasless through FarmForwarder.
contract FarmPond is ERC2771Context, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 30;
    uint256 private constant BPS = 10_000;
    uint256 public constant MINIMUM_SHARES = 1_000;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable usdc;
    IERC20 public immutable avax;
    uint256 public reserveUsdc;
    uint256 public reserveAvax;
    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;

    event LiquidityAdded(address indexed user, uint256 usdcIn, uint256 avaxIn, uint256 shares);
    event LiquidityRemoved(address indexed user, uint256 usdcOut, uint256 avaxOut, uint256 shares);
    event Swapped(address indexed user, bool usdcIn, uint256 amountIn, uint256 amountOut);

    error ZeroAmount();
    error Slippage(uint256 got, uint256 min);
    error InsufficientShares();
    error EmptyPool();

    constructor(address forwarder, address usdc_, address avax_) ERC2771Context(forwarder) {
        usdc = IERC20(usdc_);
        avax = IERC20(avax_);
    }

    // ---------- liquidity ----------

    /// Add both tokens. The first deposit sets the price; later ones take gAVAX at the pool ratio
    /// (up to maxAvax) for the USDC given.
    function addLiquidity(uint256 usdcAmount, uint256 maxAvax, uint256 minShares)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (usdcAmount == 0) revert ZeroAmount();
        address u = _msgSender();
        uint256 avaxAmount = totalShares == 0 ? maxAvax : (usdcAmount * reserveAvax + reserveUsdc - 1) / reserveUsdc;
        if (avaxAmount == 0) revert ZeroAmount();
        if (avaxAmount > maxAvax) revert Slippage(maxAvax, avaxAmount);
        shares = _mint(u, usdcAmount, avaxAmount);
        if (shares < minShares) revert Slippage(shares, minShares);
        usdc.safeTransferFrom(u, address(this), usdcAmount);
        avax.safeTransferFrom(u, address(this), avaxAmount);
    }

    /// USDC only: swap the right part to gAVAX inside the pool, then add both.
    function zapIn(uint256 usdcAmount, uint256 minShares) external nonReentrant returns (uint256 shares) {
        if (usdcAmount == 0) revert ZeroAmount();
        if (totalShares == 0) revert EmptyPool();
        address u = _msgSender();
        uint256 swapIn = _zapSwapAmount(reserveUsdc, usdcAmount);
        uint256 avaxOut = _out(swapIn, reserveUsdc, reserveAvax);
        reserveUsdc += swapIn;
        reserveAvax -= avaxOut;
        emit Swapped(u, true, swapIn, avaxOut);
        shares = _mint(u, usdcAmount - swapIn, avaxOut);
        if (shares < minShares) revert Slippage(shares, minShares);
        usdc.safeTransferFrom(u, address(this), usdcAmount);
    }

    function removeLiquidity(uint256 shares, uint256 minUsdc, uint256 minAvax)
        external
        nonReentrant
        returns (uint256 usdcOut, uint256 avaxOut)
    {
        address u = _msgSender();
        (usdcOut, avaxOut) = _burn(u, shares);
        if (usdcOut < minUsdc) revert Slippage(usdcOut, minUsdc);
        if (avaxOut < minAvax) revert Slippage(avaxOut, minAvax);
        usdc.safeTransfer(u, usdcOut);
        avax.safeTransfer(u, avaxOut);
    }

    /// Exit to USDC only: remove, then sell the gAVAX part back into the pool.
    function zapOut(uint256 shares, uint256 minUsdc) external nonReentrant returns (uint256 usdcOut) {
        address u = _msgSender();
        (uint256 fromPool, uint256 avaxPart) = _burn(u, shares);
        uint256 sold = _out(avaxPart, reserveAvax, reserveUsdc);
        reserveAvax += avaxPart;
        reserveUsdc -= sold;
        emit Swapped(u, false, avaxPart, sold);
        usdcOut = fromPool + sold;
        if (usdcOut < minUsdc) revert Slippage(usdcOut, minUsdc);
        usdc.safeTransfer(u, usdcOut);
    }

    // ---------- trading ----------

    /// Chợ phiên and arbitrage keepers use this to pull the pool price back to the oracle price.
    function swap(bool usdcIn, uint256 amountIn, uint256 minOut) external nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();
        if (totalShares == 0) revert EmptyPool();
        address u = _msgSender();
        if (usdcIn) {
            amountOut = _out(amountIn, reserveUsdc, reserveAvax);
            if (amountOut < minOut) revert Slippage(amountOut, minOut);
            reserveUsdc += amountIn;
            reserveAvax -= amountOut;
            usdc.safeTransferFrom(u, address(this), amountIn);
            avax.safeTransfer(u, amountOut);
        } else {
            amountOut = _out(amountIn, reserveAvax, reserveUsdc);
            if (amountOut < minOut) revert Slippage(amountOut, minOut);
            reserveAvax += amountIn;
            reserveUsdc -= amountOut;
            avax.safeTransferFrom(u, address(this), amountIn);
            usdc.safeTransfer(u, amountOut);
        }
        emit Swapped(u, usdcIn, amountIn, amountOut);
    }

    // ---------- views ----------

    function quote(bool usdcIn, uint256 amountIn) external view returns (uint256) {
        return usdcIn ? _out(amountIn, reserveUsdc, reserveAvax) : _out(amountIn, reserveAvax, reserveUsdc);
    }

    /// Pool price of 1 gAVAX in USDC, 8 decimals (same scale as the Chainlink feed).
    function poolPrice() public view returns (uint256) {
        if (reserveAvax == 0) return 0;
        return (reserveUsdc * 1e20) / reserveAvax;
    }

    /// A player's share of the pool, and its value in USDC at the pool price.
    function positionOf(address user)
        external
        view
        returns (uint256 shares, uint256 usdcPart, uint256 avaxPart, uint256 valueUsdc)
    {
        shares = sharesOf[user];
        if (totalShares == 0) return (shares, 0, 0, 0);
        usdcPart = (reserveUsdc * shares) / totalShares;
        avaxPart = (reserveAvax * shares) / totalShares;
        valueUsdc = (reserveUsdc * shares * 2) / totalShares;
    }

    // ---------- internals ----------

    function _mint(address u, uint256 usdcIn, uint256 avaxIn) private returns (uint256 shares) {
        if (totalShares == 0) {
            shares = Math.sqrt(usdcIn * avaxIn);
            if (shares <= MINIMUM_SHARES) revert ZeroAmount();
            // Locked forever so the first depositor cannot inflate the share price.
            sharesOf[DEAD] = MINIMUM_SHARES;
            totalShares = MINIMUM_SHARES;
            shares -= MINIMUM_SHARES;
        } else {
            shares = Math.min((usdcIn * totalShares) / reserveUsdc, (avaxIn * totalShares) / reserveAvax);
        }
        if (shares == 0) revert ZeroAmount();
        sharesOf[u] += shares;
        totalShares += shares;
        reserveUsdc += usdcIn;
        reserveAvax += avaxIn;
        emit LiquidityAdded(u, usdcIn, avaxIn, shares);
    }

    function _burn(address u, uint256 shares) private returns (uint256 usdcOut, uint256 avaxOut) {
        if (shares == 0) revert ZeroAmount();
        if (shares > sharesOf[u]) revert InsufficientShares();
        usdcOut = (reserveUsdc * shares) / totalShares;
        avaxOut = (reserveAvax * shares) / totalShares;
        sharesOf[u] -= shares;
        totalShares -= shares;
        reserveUsdc -= usdcOut;
        reserveAvax -= avaxOut;
        emit LiquidityRemoved(u, usdcOut, avaxOut, shares);
    }

    function _out(uint256 amountIn, uint256 rIn, uint256 rOut) private pure returns (uint256) {
        uint256 inWithFee = amountIn * (BPS - FEE_BPS);
        return (inWithFee * rOut) / (rIn * BPS + inWithFee);
    }

    /// Part of `amount` to swap so the remainder matches the new pool ratio (Uniswap V2 zap formula, 0.3% fee).
    function _zapSwapAmount(uint256 r, uint256 amount) private pure returns (uint256) {
        return (Math.sqrt(r * (r * 3_988_009 + amount * 3_988_000)) - r * 1_997) / 1_994;
    }
}
