// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/// Fee manager entry point: players sign an EIP-712 ForwardRequest, our relayer submits it and pays gas.
contract FarmForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("NongTraiDeFi") {}
}
