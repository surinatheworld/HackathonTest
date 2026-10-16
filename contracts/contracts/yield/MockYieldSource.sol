// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldSource} from "./IYieldSource.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// Testnet stand-in for a lending market (Aave, Benqi): pays a fixed APR, counted in game days, by minting
/// test USDC. On mainnet the game would point at AaveV3YieldSource instead; FarmGame does not change.
contract MockYieldSource is IYieldSource {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR_DAYS = 365;

    IERC20 public immutable asset;
    address public immutable client;
    uint256 public immutable aprBps;
    uint256 public immutable dayLength;
    uint256 public principal;
    uint256 public earned;
    uint256 public last;

    error NotClient();

    constructor(address asset_, address client_, uint256 aprBps_, uint256 dayLength_) {
        asset = IERC20(asset_);
        client = client_;
        aprBps = aprBps_;
        dayLength = dayLength_;
        last = block.timestamp;
    }

    modifier onlyClient() {
        if (msg.sender != client) revert NotClient();
        _;
    }

    function deposit(uint256 amount) external onlyClient {
        _accrue();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        principal += amount;
    }

    function withdraw(uint256 amount) external onlyClient {
        _accrue();
        if (amount > earned) {
            principal -= amount - earned;
            earned = 0;
        } else {
            earned -= amount;
        }
        uint256 held = asset.balanceOf(address(this));
        if (held < amount) IMintable(address(asset)).mint(address(this), amount - held);
        asset.safeTransfer(msg.sender, amount);
    }

    function balance() external view returns (uint256) {
        return principal + earned + _pending();
    }

    function _pending() private view returns (uint256) {
        return (principal * aprBps * (block.timestamp - last)) / (BPS * YEAR_DAYS * dayLength);
    }

    function _accrue() private {
        earned += _pending();
        last = block.timestamp;
    }
}
