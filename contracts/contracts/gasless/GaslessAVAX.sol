// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/// Testnet-only wrapped AVAX stand-in for the game (collateral and pool asset). Players hold no real AVAX,
/// so the faucet and approve go through FarmForwarder like every other action. Only the deployer mints (to seed
/// the pond). Players get 20 from the faucet once an hour per wallet.
contract GaslessAVAX is ERC20, ERC2771Context {
    uint256 public constant FAUCET_AMOUNT = 20e18;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    address public immutable minter;
    mapping(address => uint256) public nextFaucetAt;

    error NotMinter();
    error NotAPlayer();
    error FaucetCooldown(uint256 nextAt);

    constructor(address forwarder) ERC20("Farm Test AVAX", "gAVAX") ERC2771Context(forwarder) {
        minter = msg.sender;
    }

    /// Only a wallet, directly or through the forwarder (which only runs requests a wallet signed), so a contract
    /// cannot create throwaway "players" in one transaction and take the faucet once for each of them.
    function faucet() external {
        if (msg.sender != tx.origin && !isTrustedForwarder(msg.sender)) revert NotAPlayer();
        address u = _msgSender();
        uint256 nextAt = nextFaucetAt[u];
        if (block.timestamp < nextAt) revert FaucetCooldown(nextAt);
        nextFaucetAt[u] = block.timestamp + FAUCET_COOLDOWN;
        _mint(u, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        _mint(to, amount);
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
