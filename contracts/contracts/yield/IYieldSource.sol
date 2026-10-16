// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Where FarmGame parks idle USDC to earn the yield it pays out. One client (the game) per source.
interface IYieldSource {
    /// Pulls `amount` of the asset from the caller.
    function deposit(uint256 amount) external;
    /// Sends `amount` of the asset back to the caller.
    function withdraw(uint256 amount) external;
    /// Everything the caller can withdraw: principal plus earned yield.
    function balance() external view returns (uint256);
}
