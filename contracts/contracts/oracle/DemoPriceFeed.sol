// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Chainlink-shaped feed whose owner sets the price. Used in tests and, on Fuji, to stage a
/// "drought" (price crash) during a demo via FarmCoop.setOracle.
contract DemoPriceFeed {
    address public owner;
    int256 public answer;
    uint256 public updatedAt;
    uint8 public constant decimals = 8;

    error NotOwner();

    constructor(int256 answer_) {
        owner = msg.sender;
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function setPrice(int256 answer_) external {
        if (msg.sender != owner) revert NotOwner();
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function transferOwnership(address next) external {
        if (msg.sender != owner) revert NotOwner();
        owner = next;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
