// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The team's 2-of-3 multisig. It owns every contract that holds pooled money (FarmGame's reward pool and
/// yield source, FarmCoop's lending pool and price feed, FarmQuests' reward pool, FarmItems' admin), so no single
/// teammate can move those funds or change those settings alone.
/// Flow: one owner submits a call (and confirms it), a second owner confirms, then any owner executes it.
/// Confirmations are counted at execute time and only from current owners: after a lost or stolen key is
/// replaced, everything that key confirmed stops counting, so it can never be one of the two signatures.
/// Deliberately small so it can be read in one sitting; on mainnet the team would use Safe instead.
contract FarmMultisig {
    struct Call {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }

    address[] private _owners;
    mapping(address => bool) public isOwner;
    /// Bumped each time an address becomes an owner, so confirmations from an earlier term never come back.
    mapping(address => uint256) private _term;
    uint256 private _terms;
    uint256 public immutable threshold;
    Call[] private _calls;
    /// call id => owner => the owner's term when they confirmed (0 = not confirmed)
    mapping(uint256 => mapping(address => uint256)) private _confirmedIn;

    event Submitted(uint256 indexed id, address indexed owner, address indexed to, uint256 value, bytes data);
    event Confirmed(uint256 indexed id, address indexed owner);
    event Revoked(uint256 indexed id, address indexed owner);
    event Executed(uint256 indexed id);
    event OwnerReplaced(address indexed oldOwner, address indexed newOwner);
    event Received(address indexed from, uint256 amount);

    error NotOwner();
    error OnlySelf();
    error BadSetup();
    error NoSuchCall(uint256 id);
    error AlreadyExecuted(uint256 id);
    error AlreadyConfirmed(uint256 id);
    error NotConfirmed(uint256 id);
    error NotEnoughConfirmations(uint256 have, uint256 need);
    error CallFailed(bytes reason);

    constructor(address[] memory owners_, uint256 threshold_) {
        if (threshold_ < 2 || threshold_ > owners_.length) revert BadSetup();
        for (uint256 i; i < owners_.length; i++) {
            address o = owners_[i];
            if (o == address(0) || isOwner[o]) revert BadSetup();
            _addOwner(o);
            _owners.push(o);
        }
        threshold = threshold_;
    }

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    modifier pending(uint256 id) {
        if (id >= _calls.length) revert NoSuchCall(id);
        if (_calls[id].executed) revert AlreadyExecuted(id);
        _;
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    /// Proposes a call and counts the proposer's confirmation.
    function submit(address to, uint256 value, bytes calldata data) external onlyOwner returns (uint256 id) {
        id = _calls.length;
        _calls.push(Call(to, value, data, false));
        emit Submitted(id, msg.sender, to, value, data);
        _confirm(id);
    }

    function confirm(uint256 id) external onlyOwner pending(id) {
        _confirm(id);
    }

    function revoke(uint256 id) external onlyOwner pending(id) {
        if (!confirmedBy(id, msg.sender)) revert NotConfirmed(id);
        _confirmedIn[id][msg.sender] = 0;
        emit Revoked(id, msg.sender);
    }

    function execute(uint256 id) external onlyOwner pending(id) {
        uint256 have = confirmations(id);
        if (have < threshold) revert NotEnoughConfirmations(have, threshold);
        Call storage c = _calls[id];
        c.executed = true;
        emit Executed(id);
        (bool ok, bytes memory reason) = c.to.call{value: c.value}(c.data);
        if (!ok) revert CallFailed(reason);
    }

    /// Swaps a lost or leaving teammate's key. Only through the multisig itself (submit a call to this contract).
    function replaceOwner(address oldOwner, address newOwner) external {
        if (msg.sender != address(this)) revert OnlySelf();
        if (!isOwner[oldOwner] || newOwner == address(0) || isOwner[newOwner]) revert BadSetup();
        for (uint256 i; i < _owners.length; i++) if (_owners[i] == oldOwner) _owners[i] = newOwner;
        isOwner[oldOwner] = false;
        _term[oldOwner] = 0;
        _addOwner(newOwner);
        emit OwnerReplaced(oldOwner, newOwner);
    }

    // ---------- views ----------

    function owners() external view returns (address[] memory) {
        return _owners;
    }

    function callCount() external view returns (uint256) {
        return _calls.length;
    }

    function getCall(uint256 id) external view returns (Call memory) {
        if (id >= _calls.length) revert NoSuchCall(id);
        return _calls[id];
    }

    /// Whether `owner` has a confirmation on call `id` that still counts (current owner, current term).
    function confirmedBy(uint256 id, address owner) public view returns (bool) {
        uint256 t = _confirmedIn[id][owner];
        return t != 0 && isOwner[owner] && t == _term[owner];
    }

    /// Confirmations on call `id` from the current owners only.
    function confirmations(uint256 id) public view returns (uint256 n) {
        uint256 len = _owners.length;
        for (uint256 i; i < len; i++) if (confirmedBy(id, _owners[i])) n++;
    }

    function _addOwner(address o) private {
        isOwner[o] = true;
        _term[o] = ++_terms;
    }

    function _confirm(uint256 id) private {
        if (confirmedBy(id, msg.sender)) revert AlreadyConfirmed(id);
        _confirmedIn[id][msg.sender] = _term[msg.sender];
        emit Confirmed(id, msg.sender);
    }
}
