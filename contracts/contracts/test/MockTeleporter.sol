// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITeleporterReceiver, TeleporterMessageInput} from "../interfaces/ITeleporter.sol";

/// Test double for TeleporterMessenger + relayer: queues messages and delivers them on demand,
/// tagging each with the sender's pretend blockchain ID.
contract MockTeleporter {
    struct Envelope {
        bytes32 sourceChainID;
        address from;
        bytes32 destinationChainID;
        address to;
        bytes message;
    }

    mapping(address => bytes32) public chainOf;
    Envelope[] private _queue;
    uint256 public head;

    function setChain(address app, bytes32 chainID) external {
        chainOf[app] = chainID;
    }

    function sendCrossChainMessage(TeleporterMessageInput calldata input) external returns (bytes32) {
        _queue.push(
            Envelope(chainOf[msg.sender], msg.sender, input.destinationBlockchainID, input.destinationAddress, input.message)
        );
        return bytes32(_queue.length);
    }

    function pending() external view returns (uint256) {
        return _queue.length - head;
    }

    function deliverNext() external {
        Envelope memory e = _queue[head++];
        ITeleporterReceiver(e.to).receiveTeleporterMessage(e.sourceChainID, e.from, e.message);
    }

    /// Lets tests forge a message from any sender to check the receiver's guards.
    function forge(address to, bytes32 sourceChainID, address from, bytes calldata message) external {
        ITeleporterReceiver(to).receiveTeleporterMessage(sourceChainID, from, message);
    }
}
