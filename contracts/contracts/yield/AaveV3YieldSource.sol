// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldSource} from "./IYieldSource.sol";

interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

/// Mainnet adapter: supplies FarmGame's idle USDC to Aave v3 on Avalanche C-Chain and lets the game
/// withdraw principal plus interest. The aToken balance grows by itself, so balance() is the claim.
contract AaveV3YieldSource is IYieldSource {
    using SafeERC20 for IERC20;

    IAavePool public immutable pool;
    IERC20 public immutable asset;
    IERC20 public immutable aToken;
    address public immutable client;

    error NotClient();

    constructor(address pool_, address asset_, address aToken_, address client_) {
        pool = IAavePool(pool_);
        asset = IERC20(asset_);
        aToken = IERC20(aToken_);
        client = client_;
    }

    modifier onlyClient() {
        if (msg.sender != client) revert NotClient();
        _;
    }

    function deposit(uint256 amount) external onlyClient {
        asset.safeTransferFrom(msg.sender, address(this), amount);
        asset.forceApprove(address(pool), amount);
        pool.supply(address(asset), amount, address(this), 0);
    }

    function withdraw(uint256 amount) external onlyClient {
        pool.withdraw(address(asset), amount, msg.sender);
    }

    function balance() external view returns (uint256) {
        return aToken.balanceOf(address(this));
    }
}
