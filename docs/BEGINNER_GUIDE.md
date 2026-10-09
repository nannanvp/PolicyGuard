# Understand PolicyGuard before presenting it

## The problem in one paragraph

A former insurance agent may exploit information obtained in a previous job to persuade a customer that a bonus is being withheld and a second policy is needed to recover it. PolicyGuard gives the customer a consistent place to verify the original bonus conditions, payment history and the original agent's departure. The currently authorised agent and insurer support details remain visible. The system records cancellation fees before the customer confirms. It cannot prevent a phone call or revoke information someone copied earlier.

## Eight ideas you need

1. **Blockchain:** an ordered history of blocks. Each block identifies its parent by hash. Changing an earlier block's recorded content would invalidate the links to its descendants.
2. **Hash:** a fixed-length fingerprint of data. PolicyGuard stores a SHA-256 fingerprint of the exact policy document. Even a whitespace change can produce a different fingerprint. A hash is not encryption and does not prove whether an underlying promise is truthful.
3. **Ethereum account:** a signing key and address. Each registered user gets a distinct address. The local server holds the key, checks the session and permissions, then signs an allowed action for that user.
4. **Transaction:** a signed request to change chain state. A premium payment has a sender, nonce, destination, input and gas. Its receipt says whether execution succeeded and records emitted events.
5. **Smart contract:** Solidity code executed by the Ethereum virtual machine. `CustomerLedger` enforces financial rules; `AgentLedger` enforces employment and assignment rules. The UI cannot edit the fixed numbers.
6. **Event:** a contract's structured record of something that happened, such as `PremiumPaid` or `EmploymentChanged`. The relay observes successful events and sends the corresponding update to the other chain.
7. **Off-chain database:** SQLite stores things that should not be public chain data: names, phone numbers, password hashes, login sessions, notifications and work queues. It also stores exact policy documents whose hashes are anchored on-chain.
8. **Consensus:** agreement among independent network participants. These local Ganache chains automatically produce development blocks; they do not demonstrate a distributed PoW, PoS or PBFT network. The explorer checks recorded links and receipts, not independent consensus.

## Follow one premium payment

1. The signed-in customer opens their own policy and confirms the next numbered premium.
2. The API checks their session, role, CSRF token and policy ownership. It saves an operation ID and request key.
3. The server signs with that customer's distinct key. It saves the exact signed transaction before broadcasting to customer chain 1337.
4. `CustomerLedger` checks the policy is active, the instalment is the expected next one, the policy has unpaid instalments and the test balance is sufficient.
5. Successful execution reduces the test balance and emits `PremiumPaid`. A failed transaction changes no contract state; it may still consume gas if it was mined.
6. The relay records the source event and delivers a summary transaction to agent chain 1338 using the restricted relay key.
7. The current employed agent's dashboard and the customer's notifications reflect the payment. Repeating the same request or delivery does not take the premium twice.

The source can be confirmed while the mirror is still pending. This is why the interface shows a synchronisation state.

## Follow an agent resignation

The agent confirms resignation. Their own key calls `AgentLedger.resign`. Employment becomes resigned on chain 1338; the contract chooses replacements for their customers by lowest customer count and then agent ID. API permissions consult this authoritative chain, so old sessions cannot keep customer access while the customer-chain mirror catches up. Open interfaces receive an access-change signal and clear their customer data. The customer still sees the original agent's identity and departure, plus the replacement's details. If nobody is employed, the app shows awaiting reassignment and insurer support; the next approved agent receives eligible waiting customers.

## Read a block in the explorer

Select a chain, open a block and compare these fields:

- **Number:** position in that chain. Block numbers from two different chains are not one global sequence.
- **Hash / parent hash:** the current block's identifier and its predecessor's identifier.
- **Previous → current → next:** the following block's `parentHash` must match the current block's `hash`. A block does not contain its next hash. The newest block has no next block yet.
- **Timestamp:** the chain's recorded block time.
- **Transaction count:** empty blocks are expected because the development miner uses a two-second interval.
- **State root, transactions root, receipts root:** commitments returned by Ethereum RPC, shown as real values. The app does not independently recompute the tries.
- **Gas used / limit:** Ethereum execution measurements; separate from INR premium, fee and refund values.

Open a transaction to see its sender, destination, decoded action, nonce, receipt status, block membership, confirmations and events. A source/destination link is evidence of a relay update, not proof of a trustless bridge.

## Where the syllabus fits

This mapping comes from the supplied BACSE350 syllabus; the concrete PolicyGuard examples are project design choices.

| Syllabus area | Project demonstration | Honest boundary |
|---|---|---|
| Module 1: components, headers, identifiers, linking, transaction aggregation and validation | Actual block headers, parent links, receipt membership and development mining | No multi-node consensus implementation or chain-selection experiment |
| Module 2: keys, addresses, wallets and transaction lifecycle | Distinct Ethereum accounts, locally managed signing keys, nonce, transaction and receipt | Ethereum's account model is not Bitcoin UTXOs; no Bitcoin implementation is claimed |
| Module 3: Solidity design, deployment and Ethereum application | Two contracts, access modifiers, storage, events and deployment | Hyperledger is discussed in the syllabus but not needed for this Ethereum implementation |
| Module 4: security, privacy, governance and limits | Role checks, departed-agent revocation, off-chain PII, replay protection, administrator approval | No claim that blockchain prevents all scams or makes a trusted administrator unnecessary |
| Module 5: design methodology, hybrid storage, finance/payments | On-chain paise ledger and hashes with SQLite profiles/documents/work queues | No IPFS, public money movement or real insurance claims |

## Suggested two-person explanation

One team member explains the problem, customer journey, agent approval, policy numbers and SQLite/authentication. The other explains contracts, source/mirror authority, events, retries and block/receipt inspection. Both should understand the cancellation calculation and the distinction between blockchain immutability and access control.

Start reading the source in this order: `contracts/CustomerLedger.sol`, `contracts/AgentLedger.sol`, `lib/application.js`, `app-server.js`, then `public/portal.js`. For the classroom walkthrough, follow [DEMO_GUIDE.md](DEMO_GUIDE.md).

## Questions you may be asked

**Why two chains?** The requested design separates financial authority from employment authority and demonstrates event-driven interaction. A single chain would be simpler for a real small system; two chains add relay trust, delay and recovery work.

**Can an administrator change an issued premium or bonus?** There is no contract setter or API editor for issued terms. Local administrators who control the machine and backups still control the overall development environment; this is not a public immutable deployment.

**Why SQLite as well as blockchain?** Login sessions and contact information do not need public replicated history. Contract rules and lifecycle events benefit from verifiable ordered records. A document's off-chain text can be checked against its on-chain fingerprint.

**Is the cancellation fee a government rule?** No. It is the explicitly disclosed academic rule for this project: 10% of paid premiums, with the bonus forfeited. No actual regulation is modelled.

**How do we show maturity without waiting years?** The automated acceptance test advances an isolated test chain to immediately before and exactly at maturity, checks unpaid-premium restrictions and a one-time claim. Normal application dates are not editable. Show the recorded evidence rather than changing classroom policy terms.

**Can the former agent still remember a customer's details?** Yes. Access revocation prevents future access through this application. It cannot undo earlier knowledge, screenshots, exports or data copied outside it.
