// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/// Testnet-only USDC stand-in that accepts gasless calls (faucet, approve) via FarmForwarder.
/// Only the deployer mints (to fund the farm's pools). Players get 1,000 from the faucet once an hour per wallet.
contract GaslessUSDC is ERC20, ERC2771Context {
    uint256 public constant FAUCET_AMOUNT = 1_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    address public immutable minter;
    mapping(address => uint256) public nextFaucetAt;

    error NotMinter();
    error NotAPlayer();
    error FaucetCooldown(uint256 nextAt);

    constructor(address forwarder) ERC20("Farm Test USDC", "USDC") ERC2771Context(forwarder) {
        minter = msg.sender;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
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
