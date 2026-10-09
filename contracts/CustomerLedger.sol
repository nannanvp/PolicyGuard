// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Academic INR ledger. Amounts are integer paise, not ETH or real money.
contract CustomerLedger {
    address public immutable administrator;
    address public immutable relay;
    uint256 public constant YEAR = 365 days;
    struct Policy {
        address holder;
        address onboardingAgent;
        uint8 plan;
        uint256 annualPremium;
        uint256 yearsCount;
        uint256 bonus;
        uint256 issuedAt;
        bytes32 termsHash;
        uint256 instalmentsPaid;
        uint8 status; // 0 active, 1 cancelled, 2 settled
        uint256 fee;
        uint256 returnedAmount;
    }
    mapping(bytes32 => Policy) private policies;
    mapping(address => uint256) public balances;
    mapping(address => bool) public customers;
    mapping(address => bool) public employed;
    mapping(address => address) public servicingAgent;
    mapping(bytes32 => bool) public applied;
    event OperationApplied(bytes32 indexed operationId);
    event CustomerRegistered(address indexed customer, uint256 credit);
    event PolicyPurchased(bytes32 indexed policyId, address indexed holder, address indexed onboardingAgent,
        uint8 plan, uint256 annualPremium, uint256 yearsCount, uint256 bonus, uint256 issuedAt, bytes32 termsHash);
    event PremiumPaid(bytes32 indexed policyId, address indexed holder, uint256 instalment, uint256 amount, uint256 totalPaid);
    event PolicyClosed(bytes32 indexed policyId, address indexed holder, uint8 status, uint256 fee, uint256 refund, uint256 bonusPaid);
    event MirrorApplied(bytes32 indexed sourceEvent);

    constructor(address relayAddress) { administrator = msg.sender; relay = relayAddress; }
    modifier once(bytes32 operationId) {
        require(operationId != bytes32(0) && !applied[operationId], "Operation already applied");
        applied[operationId] = true;
        _;
        emit OperationApplied(operationId);
    }
    modifier onlyRelay() { require(msg.sender == relay, "Only relay"); _; }

    function registerCustomer(address customer, bytes32 operationId) external once(operationId) {
        require(msg.sender == administrator, "Only administrator");
        require(customer != address(0) && !customers[customer], "Customer already registered");
        customers[customer] = true;
        balances[customer] = 50000000;
        emit CustomerRegistered(customer, 50000000);
    }

    function planTerms(uint8 plan) public pure returns (uint256 premium, uint256 yearsCount, uint256 bonus) {
        if (plan == 1) return (1200000, 1, 100000);
        if (plan == 2) return (2500000, 3, 1000000);
        require(plan == 3, "Unknown plan");
        return (4000000, 5, 4000000);
    }

    function purchase(bytes32 policyId, uint8 plan, address agent, bytes32 documentHash, bytes32 operationId) external once(operationId) {
        require(customers[msg.sender], "Only registered customer");
        require(policyId != bytes32(0) && policies[policyId].holder == address(0), "Policy already exists");
        require(employed[agent], "Agent is not employed");
        require(servicingAgent[msg.sender] == address(0) || servicingAgent[msg.sender] == agent, "Use current servicing agent");
        require(documentHash != bytes32(0), "Missing document hash");
        (uint256 premium, uint256 yearsCount, uint256 bonus) = planTerms(plan);
        require(balances[msg.sender] >= premium, "Insufficient test balance");
        balances[msg.sender] -= premium;
        policies[policyId] = Policy(msg.sender, agent, plan, premium, yearsCount, bonus,
            block.timestamp, documentHash, 1, 0, 0, 0);
        emit PolicyPurchased(policyId, msg.sender, agent, plan, premium, yearsCount, bonus, block.timestamp, documentHash);
        emit PremiumPaid(policyId, msg.sender, 1, premium, premium);
    }

    function getPolicy(bytes32 policyId) public view returns (Policy memory) {
        require(policies[policyId].holder != address(0), "Policy not found");
        return policies[policyId];
    }

    function payPremium(bytes32 policyId, uint256 expectedInstalment, bytes32 operationId) external once(operationId) {
        Policy storage policy = policies[policyId];
        require(policy.holder == msg.sender, "Only policyholder");
        require(policy.status == 0, "Policy is closed");
        require(policy.instalmentsPaid < policy.yearsCount, "All premiums paid");
        require(expectedInstalment == policy.instalmentsPaid + 1, "Instalment changed");
        require(balances[msg.sender] >= policy.annualPremium, "Insufficient test balance");
        balances[msg.sender] -= policy.annualPremium;
        policy.instalmentsPaid++;
        emit PremiumPaid(policyId, msg.sender, policy.instalmentsPaid, policy.annualPremium,
            policy.instalmentsPaid * policy.annualPremium);
    }

    function cancellationQuote(bytes32 policyId) public view returns (uint256 paid, uint256 fee, uint256 refund) {
        Policy memory policy = getPolicy(policyId);
        require(policy.status == 0, "Policy is closed");
        require(block.timestamp < policy.issuedAt + policy.yearsCount * YEAR, "Matured; use settlement");
        paid = policy.instalmentsPaid * policy.annualPremium;
        fee = paid / 10;
        refund = paid - fee;
    }

    function cancel(bytes32 policyId, bytes32 documentHash, uint256 expectedPaid, uint256 expectedFee,
        bytes32 operationId) external once(operationId) {
        Policy storage policy = policies[policyId];
        require(policy.holder == msg.sender, "Only policyholder");
        require(policy.termsHash == documentHash, "Terms acknowledgement mismatch");
        (uint256 paid, uint256 fee, uint256 refund) = cancellationQuote(policyId);
        require(paid == expectedPaid && fee == expectedFee, "Quote changed; review again");
        policy.status = 1;
        policy.fee = fee;
        policy.returnedAmount = refund;
        balances[msg.sender] += refund;
        emit PolicyClosed(policyId, msg.sender, 1, fee, refund, 0);
    }

    function claim(bytes32 policyId, bytes32 operationId) external once(operationId) {
        Policy storage policy = policies[policyId];
        require(policy.holder == msg.sender, "Only policyholder");
        require(policy.status == 0, "Policy is closed");
        require(block.timestamp >= policy.issuedAt + policy.yearsCount * YEAR, "Not mature yet");
        require(policy.instalmentsPaid == policy.yearsCount, "Outstanding premiums");
        uint256 amount = policy.annualPremium * policy.yearsCount + policy.bonus;
        policy.status = 2;
        policy.returnedAmount = amount;
        balances[msg.sender] += amount;
        emit PolicyClosed(policyId, msg.sender, 2, 0, amount, policy.bonus);
    }

    function mirrorEmployment(bytes32 sourceEvent, address agent, bool active) external onlyRelay once(sourceEvent) {
        employed[agent] = active;
        emit MirrorApplied(sourceEvent);
    }
    function mirrorAssignment(bytes32 sourceEvent, address customer, address agent) external onlyRelay once(sourceEvent) {
        servicingAgent[customer] = agent;
        emit MirrorApplied(sourceEvent);
    }
}
