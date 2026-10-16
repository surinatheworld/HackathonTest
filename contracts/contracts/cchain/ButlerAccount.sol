// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Nhà quản gia AI: a minimal smart account whose AI agent only holds a session key.
/// Every agent call must match an owner-defined rule (target + selector, optional pinned
/// first argument) and stay under a daily spending cap. The owner can revoke the agent at once.
contract ButlerAccount {
    struct Rule {
        bool allowed;
        uint8 amountArg; // 1-based index of the uint256 argument counted against the cap; 0 = none
        address firstArg; // if set, the first argument must equal this address (e.g. approve spender)
    }

    address public owner;
    address public agent;
    bool public agentActive;
    uint256 public dailyCap;
    uint256 public spentToday;
    uint256 public spendDay;
    uint256 public immutable dayLength;

    mapping(address => mapping(bytes4 => Rule)) public rules;

    event AgentSet(address indexed agent, uint256 dailyCap);
    event AgentRevoked(address indexed agent);
    event RuleSet(address indexed target, bytes4 indexed selector, bool allowed, uint8 amountArg, address firstArg);
    event Executed(address indexed by, address indexed target, bytes4 indexed selector, uint256 counted);

    error NotOwner();
    error NotAuthorized();
    error AgentIsRevoked();
    error CallNotAllowed(address target, bytes4 selector);
    error ArgumentNotAllowed(address expected, address got);
    error DailyCapExceeded(uint256 requested, uint256 remaining);
    error CallFailed(bytes reason);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, uint256 dayLength_) {
        owner = owner_;
        dayLength = dayLength_;
    }

    function setAgent(address agent_, uint256 dailyCap_) external onlyOwner {
        agent = agent_;
        dailyCap = dailyCap_;
        agentActive = true;
        emit AgentSet(agent_, dailyCap_);
    }

    /// Hand the account to its real owner after a scripted setup.
    function transferOwnership(address next) external onlyOwner {
        owner = next;
    }

    /// Kill switch.
    function revokeAgent() external onlyOwner {
        agentActive = false;
        emit AgentRevoked(agent);
    }

    function setRule(address target, bytes4 selector, bool allowed, uint8 amountArg, address firstArg)
        external
        onlyOwner
    {
        rules[target][selector] = Rule(allowed, amountArg, firstArg);
        emit RuleSet(target, selector, allowed, amountArg, firstArg);
    }

    function remainingToday() public view returns (uint256) {
        if (block.timestamp / dayLength != spendDay) return dailyCap;
        return dailyCap > spentToday ? dailyCap - spentToday : 0;
    }

    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        uint256 counted;
        if (msg.sender != owner) {
            if (msg.sender != agent) revert NotAuthorized();
            if (!agentActive) revert AgentIsRevoked();
            counted = _checkPolicy(target, data);
        }
        bool ok;
        (ok, result) = target.call(data);
        if (!ok) revert CallFailed(result);
        emit Executed(msg.sender, target, bytes4(data[:4]), counted);
    }

    function _checkPolicy(address target, bytes calldata data) private returns (uint256 amount) {
        bytes4 sel = bytes4(data[:4]);
        Rule memory r = rules[target][sel];
        if (!r.allowed) revert CallNotAllowed(target, sel);
        if (r.firstArg != address(0)) {
            address got = abi.decode(data[4:36], (address));
            if (got != r.firstArg) revert ArgumentNotAllowed(r.firstArg, got);
        }
        if (r.amountArg != 0) {
            uint256 start = 4 + 32 * (uint256(r.amountArg) - 1);
            amount = abi.decode(data[start:start + 32], (uint256));
            uint256 d = block.timestamp / dayLength;
            if (d != spendDay) {
                spendDay = d;
                spentToday = 0;
            }
            uint256 left = dailyCap > spentToday ? dailyCap - spentToday : 0;
            if (amount > left) revert DailyCapExceeded(amount, left);
            spentToday += amount;
        }
    }
}
