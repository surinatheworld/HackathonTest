// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Minimal copies of the ICM (Teleporter) interfaces from ava-labs/icm-contracts.
// TeleporterMessenger lives at 0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf on every chain.

struct TeleporterFeeInfo {
    address feeTokenAddress;
    uint256 amount;
}

struct TeleporterMessageInput {
    bytes32 destinationBlockchainID;
    address destinationAddress;
    TeleporterFeeInfo feeInfo;
    uint256 requiredGasLimit;
    address[] allowedRelayerAddresses;
    bytes message;
}

interface ITeleporterMessenger {
    function sendCrossChainMessage(TeleporterMessageInput calldata messageInput) external returns (bytes32);
}

interface ITeleporterReceiver {
    function receiveTeleporterMessage(bytes32 sourceBlockchainID, address originSenderAddress, bytes calldata message)
        external;
}

/// Warp precompile, used only to read this chain's own blockchain ID.
interface IWarpMessenger {
    function getBlockchainID() external view returns (bytes32);
}
