// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMintableAsset {
    function mint(address to, uint256 amount) external;
}

/// Minimal Aave v3 pool for tests: 1:1 aTokens, and `accrue` adds interest to a holder.
contract MockAavePool is ERC20 {
    IERC20 public immutable asset;

    constructor(address asset_) ERC20("Mock aUSDC", "aUSDC") {
        asset = IERC20(asset_);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function supply(address, uint256 amount, address onBehalfOf, uint16) external {
        asset.transferFrom(msg.sender, address(this), amount);
        _mint(onBehalfOf, amount);
    }

    function withdraw(address, uint256 amount, address to) external returns (uint256) {
        _burn(msg.sender, amount);
        uint256 held = asset.balanceOf(address(this));
        if (held < amount) IMintableAsset(address(asset)).mint(address(this), amount - held);
        asset.transfer(to, amount);
        return amount;
    }

    function accrue(address holder, uint256 amount) external {
        _mint(holder, amount);
    }
}
