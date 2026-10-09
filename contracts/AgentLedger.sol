// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Employment and servicing assignments; no personal data is stored here.
contract AgentLedger {
    address public immutable administrator;
    address public immutable relay;
    struct Agent { uint256 id; uint8 status; uint256 changedAt; } // 0 pending, 1 employed, 2 resigned, 3 rejected
    struct PolicySummary {
        address holder; address onboardingAgent; uint8 plan; uint256 annualPremium;
        uint256 yearsCount; uint256 bonus; uint256 issuedAt; uint256 paid; uint8 status; uint256 fee; uint256 returnedAmount;
    }
    mapping(address => Agent) public agents;
    address[] private agentList;
    address[] private customerList;
    mapping(address => bool) private knownCustomer;
    mapping(address => address) public assignments;
    mapping(address => uint256) public customerCounts;
    mapping(bytes32 => PolicySummary) public policies;
    mapping(bytes32 => bool) public applied;
    event OperationApplied(bytes32 indexed operationId);
    event EmploymentChanged(address indexed agent, uint8 status, uint256 changedAt);
    event AssignmentChanged(address indexed customer, address indexed previousAgent, address indexed currentAgent);
    event PolicyMirrored(bytes32 indexed policyId, bytes32 indexed sourceEvent);

    constructor(address relayAddress) { administrator = msg.sender; relay = relayAddress; }
    modifier once(bytes32 operationId) {
        require(operationId != bytes32(0) && !applied[operationId], "Operation already applied");
        applied[operationId] = true; _; emit OperationApplied(operationId);
    }
    modifier onlyRelay() { require(msg.sender == relay, "Only relay"); _; }

    function decideAgent(address agent, uint256 agentId, bool approved, bytes32 operationId) external once(operationId) {
        require(msg.sender == administrator, "Only administrator");
        require(agent != address(0) && agentId > 0, "Invalid agent");
        require(agents[agent].status == 0, "Application already decided");
        agents[agent] = Agent(agentId, approved ? 1 : 3, block.timestamp);
        if (approved) agentList.push(agent);
        emit EmploymentChanged(agent, approved ? 1 : 3, block.timestamp);
        if (approved) {
            for (uint256 i = 0; i < customerList.length; i++) {
                if (assignments[customerList[i]] == address(0)) assign(customerList[i], selectAgent());
            }
        }
    }

    function selectAgent() public view returns (address best) {
        for (uint256 i = 0; i < agentList.length; i++) {
            address candidate = agentList[i];
            if (agents[candidate].status != 1) continue;
            if (best == address(0) || customerCounts[candidate] < customerCounts[best] ||
                (customerCounts[candidate] == customerCounts[best] && agents[candidate].id < agents[best].id)) best = candidate;
        }
    }
    function suggestAgent(address customer) external view returns (address) {
        address current = assignments[customer];
        return agents[current].status == 1 ? current : selectAgent();
    }
    function assign(address customer, address agent) private {
        address previous = assignments[customer];
        if (previous == agent) return;
        if (previous != address(0)) customerCounts[previous]--;
        if (agent != address(0)) customerCounts[agent]++;
        assignments[customer] = agent;
        emit AssignmentChanged(customer, previous, agent);
    }
    function resign(bytes32 operationId) external once(operationId) {
        require(agents[msg.sender].status == 1, "Not an employed agent");
        agents[msg.sender].status = 2;
        agents[msg.sender].changedAt = block.timestamp;
        emit EmploymentChanged(msg.sender, 2, block.timestamp);
        for (uint256 i = 0; i < customerList.length; i++) {
            if (assignments[customerList[i]] == msg.sender) assign(customerList[i], selectAgent());
        }
    }

    function mirrorPurchase(bytes32 sourceEvent, bytes32 policyId, address holder, address onboardingAgent,
        uint8 plan, uint256 premium, uint256 yearsCount, uint256 bonus, uint256 issuedAt) external onlyRelay once(sourceEvent) {
        require(policies[policyId].holder == address(0), "Policy already mirrored");
        policies[policyId] = PolicySummary(holder, onboardingAgent, plan, premium, yearsCount, bonus, issuedAt, 0, 0, 0, 0);
        if (!knownCustomer[holder]) { knownCustomer[holder] = true; customerList.push(holder); }
        if (agents[assignments[holder]].status != 1) assign(holder, selectAgent());
        emit PolicyMirrored(policyId, sourceEvent);
    }
    function mirrorPayment(bytes32 sourceEvent, bytes32 policyId, uint256 totalPaid) external onlyRelay once(sourceEvent) {
        require(policies[policyId].holder != address(0), "Policy not mirrored yet");
        require(policies[policyId].status == 0 && totalPaid > policies[policyId].paid, "Invalid payment order");
        policies[policyId].paid = totalPaid;
        emit PolicyMirrored(policyId, sourceEvent);
    }
    function mirrorClose(bytes32 sourceEvent, bytes32 policyId, uint8 status, uint256 fee, uint256 returnedAmount) external onlyRelay once(sourceEvent) {
        require(policies[policyId].holder != address(0) && policies[policyId].status == 0, "Policy unavailable");
        require(status == 1 || status == 2, "Invalid closure");
        policies[policyId].status = status;
        policies[policyId].fee = fee;
        policies[policyId].returnedAmount = returnedAmount;
        emit PolicyMirrored(policyId, sourceEvent);
    }
}
