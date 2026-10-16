// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/// Testnet-only wrapped AVAX stand-in for the game (collateral and pool asset). Players hold no real AVAX,
/// so the faucet and approve go through FarmForwarder like every other action.
contract GaslessAVAX is ERC20, ERC2771Context {
    uint256 public constant FAUCET_AMOUNT = 20e18;

    constructor(address forwarder) ERC20("Farm Test AVAX", "gAVAX") ERC2771Context(forwarder) {}

    function faucet() external {
        _mint(_msgSender(), FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external {
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
