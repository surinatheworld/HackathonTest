// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldSource} from "./IYieldSource.sol";

/// Testnet stand-in for Aave v3's USDC supply market: pays a fixed APR (counted in game days) that mirrors what Aave
/// pays on mainnet. The interest comes from an interest reserve the team funds up front with a plain transfer, never
/// from minting: once the reserve is used up, the source stops paying interest and principal stays whole.
/// On mainnet the game points at AaveV3YieldSource instead (rehearsed in test/fork/mainnet.fork.js).
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

    event Deposited(uint256 amount, uint256 principal);
    event Withdrawn(uint256 amount, uint256 principal);

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
        principal += amount;
        emit Deposited(amount, principal);
        asset.safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) external onlyClient {
        _accrue();
        if (amount > earned) {
            principal -= amount - earned;
            earned = 0;
        } else {
            earned -= amount;
        }
        emit Withdrawn(amount, principal);
        asset.safeTransfer(msg.sender, amount);
    }

    function balance() external view returns (uint256) {
        return principal + earned + _pending();
    }

    /// USDC the team put aside to pay interest that has not been earned yet.
    function interestReserve() public view returns (uint256) {
        uint256 held = asset.balanceOf(address(this));
        return held > principal + earned ? held - principal - earned : 0;
    }

    function _pending() private view returns (uint256) {
        uint256 due = (principal * aprBps * (block.timestamp - last)) / (BPS * YEAR_DAYS * dayLength);
        uint256 left = interestReserve();
        return due < left ? due : left;
    }

    function _accrue() private {
        earned += _pending();
        last = block.timestamp;
    }
}
