# Expanded milestone checklist

This checklist replaces the completion estimate for the earlier single-screen prototype. It evaluates the expanded **customer / agent / administrator application with two linked chains**, as requested. Each row is an acceptance area, not an equally sized percentage of engineering effort.

| # | Accepted journey | Implemented behaviour | Verification |
|---|---|---|---|
| 1 | Registration, login and role separation | Role landing, separate forms, unique usernames, password hashes, persisted sessions, CSRF checks and throttling | API/contract suite; desktop and mobile browsers |
| 2 | Pending agent and administrator approval | No customer access while pending; admin approve/reject transaction; employment mirror | API/contract suite; desktop and mobile browsers |
| 3 | Purchase, annual premiums, immutable terms and ownership | Three fixed plans, first premium, next-instalment checks, fixed dates/bonus/hash, own-customer access | API/contract suite; desktop and mobile browsers |
| 4 | Agent read-only portfolio | Assigned profiles, terms, durations, payment activity, projected benefits and closed-policy fees | API/contract suite; desktop and mobile browsers |
| 5 | Resignation revokes access | Authoritative chain checks, no self-reinstatement, old sessions/URLs denied, two open tabs cleared, fail-closed access | API/contract suite; desktop and mobile browsers |
| 6 | Reassignment and onboarding history | Least-loaded replacement, original agent retained, replacement contact details, waiting state, assignment after approval | API/contract suite; desktop and mobile browsers for replacement journey |
| 7 | Cancellation and exact fee/refund | Acknowledged current quote, 10% fee, 90% refund once, forfeited bonus, current-agent notifications | API/contract suite; desktop and mobile browsers |
| 8 | Countdown and maturity boundaries | 365-day years, payment count, no early claim, no cancellation at maturity, arrears allowed, one-time claim | Isolated chain boundary tests; countdown/payment UI in both browser sizes |
| 9 | Genuine blockchain explorer | Both chains, paginated blocks, real roots/receipts/gas, previous/current/next, decoded inputs/events, relay links, integrity check | API/contract suite; corrupted-check-input tests; desktop/mobile explorer |
| 10 | Interrupted/repeated cross-chain delivery | Persistent event/jobs, retry and replay identifiers, source/destination hashes, no duplicate debits or notifications | Relay pause/restart/replay tests; signed-source interruption/restart test |
| 11 | Persistence and recovery | Accounts, keys, sessions, documents, notifications, contracts, chain history and queues retained; incomplete storage rejected | Restart tests; Windows sample setup and repeated-setup check |
| 12 | Responsive complete portal journey | Customer, agent and admin flow at desktop and mobile sizes, no browser JS errors, confirmation/empty/error/progress states | 12 recorded browser checks at 1440×1050 and again at 390×844 |

**Result: all 12 acceptance areas have an implemented path and recorded verification.** This meets the requested 60–80% working milestone's core functional requirement and goes beyond a shared demonstration screen. It is not an assertion that a real insurance product is 100% finished. A numeric total-project percentage would require a separately agreed estimate for work outside these acceptance areas.

Additional delivery items are present: the single Windows application launcher, optional non-destructive sample setup, beginner explanation, architecture notes, syllabus mapping, classroom walkthrough, test logs and screenshots. The earlier prototype is retained under `archive/v1/` and is not served by the current application.

## Explicitly outside this version

- Real insurer underwriting, claims assessment or disbursement.
- Real payment collection, bank accounts or withdrawals.
- Government, IRDAI, KYC, regulatory or real-insurer integration.
- Public Ethereum deployment, a distributed validator/consensus network or a trustless bridge.
- Independent customer wallet custody, hardware wallets or MetaMask onboarding.
- Production scale, external security audit, high availability and a full operations/account-recovery platform.

The implemented safeguards reduce misleading policy representations and revoke future access through this application. They do not stop off-platform scams or recover customer data already copied by someone.
