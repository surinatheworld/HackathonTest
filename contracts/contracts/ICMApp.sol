// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITeleporterMessenger, ITeleporterReceiver, TeleporterMessageInput, TeleporterFeeInfo} from
    "./interfaces/ITeleporter.sol";

/// Message kinds shared by FarmLand (Game L1) and FarmVault (C-Chain).
library FarmMsg {
    // L1 -> C-Chain
    uint8 internal constant PLANT = 1;
    uint8 internal constant HARVEST = 2;
    uint8 internal constant UPROOT = 3;
    // C-Chain -> L1
    uint8 internal constant PLANTED = 11;
    uint8 internal constant PLANT_FAILED = 12;
    uint8 internal constant HARVESTED = 13;
    uint8 internal constant HARVEST_FAILED = 14;
    uint8 internal constant UPROOTED = 15;

    function encode(uint8 kind, uint256 cropId, address user, uint8 tier, uint256 amount)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(kind, cropId, user, tier, amount);
    }

    function decode(bytes calldata data)
        internal
        pure
        returns (uint8 kind, uint256 cropId, address user, uint8 tier, uint256 amount)
    {
        return abi.decode(data, (uint8, uint256, address, uint8, uint256));
    }
}

/// Pairs one contract with exactly one contract on one other chain over ICM.
/// Only messages from that remote contract, delivered by TeleporterMessenger, are accepted.
abstract contract ICMApp is ITeleporterReceiver {
    ITeleporterMessenger public immutable teleporter;
    address public owner;
    bytes32 public remoteChainID;
    address public remoteAddress;
    /// Gas the destination must give receiveTeleporterMessage. Handling PLANT measured ~383k with a mock
    /// messenger (it pulls USDC and sends a receipt back), so keep a wide margin; the owner can tune it.
    uint256 public requiredGasLimit = 1_000_000;

    event RemoteSet(bytes32 chainID, address remote);
    event MessageSent(bytes32 messageID, uint8 kind, uint256 cropId);

    error NotOwner();
    error NotTeleporter();
    error UnknownSender();
    error RemoteAlreadySet();
    error RemoteNotSet();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address teleporter_) {
        teleporter = ITeleporterMessenger(teleporter_);
        owner = msg.sender;
    }

    function setRemote(bytes32 chainID, address remote) external onlyOwner {
        if (remoteAddress != address(0)) revert RemoteAlreadySet();
        remoteChainID = chainID;
        remoteAddress = remote;
        emit RemoteSet(chainID, remote);
    }

    function setRequiredGasLimit(uint256 gasLimit) external onlyOwner {
        requiredGasLimit = gasLimit;
    }

    function transferOwnership(address next) external onlyOwner {
        owner = next;
    }

    function receiveTeleporterMessage(bytes32 sourceBlockchainID, address originSenderAddress, bytes calldata message)
        external
    {
        if (msg.sender != address(teleporter)) revert NotTeleporter();
        if (sourceBlockchainID != remoteChainID || originSenderAddress != remoteAddress) revert UnknownSender();
        _handle(message);
    }

    function _send(uint8 kind, uint256 cropId, address user, uint8 tier, uint256 amount) internal {
        if (remoteAddress == address(0)) revert RemoteNotSet();
        bytes32 id = teleporter.sendCrossChainMessage(
            TeleporterMessageInput({
                destinationBlockchainID: remoteChainID,
                destinationAddress: remoteAddress,
                feeInfo: TeleporterFeeInfo({feeTokenAddress: address(0), amount: 0}),
                requiredGasLimit: requiredGasLimit,
                allowedRelayerAddresses: new address[](0),
                message: FarmMsg.encode(kind, cropId, user, tier, amount)
            })
        );
        emit MessageSent(id, kind, cropId);
    }

    function _handle(bytes calldata message) internal virtual;
}
