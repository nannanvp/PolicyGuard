# PolicyGuard v2 — recorded acceptance evidence

Validated on this Windows workspace on 9 October 2026 with Node.js 24.19.0, ethers 6.15.0, Ganache 7.9.2 and Solidity 0.8.30. Browser tests use Playwright with the installed Chromium headless shell. The recorded output belongs to the expanded application, not the archived v1 prototype.

## Results

| Suite | Result | Evidence |
|---|---|---|
| API, contracts, security and recovery | **21 passed, 0 failed** | [Complete test output](../artifacts/v2/acceptance-test-output.txt) |
| Desktop browser journey, 1440×1050 | **12 checks passed**, no browser JavaScript errors | [Structured results](../artifacts/v2/browser-results.json) |
| Full mobile browser journey, 390×844 | **12 checks passed**, no browser JavaScript errors | [Structured results](../artifacts/v2/mobile/browser-results.json) |
| Windows optional sample launcher | Creates 2 agents, 2 customers and 3 policies; repeating setup retains existing accounts/passwords | `START_POLICYGUARD.cmd --sample` executed successfully twice |
| Running installation | Sample login and existing portfolio, both chain IDs, actual 2/2/2-second recent block intervals and valid block links | [Installation smoke result](../artifacts/v2/installation-smoke.json) |

The automated suites use isolated databases under `test-output/`, with immediate development mining to keep tests quick. The application and optional sample setup use the normal two-second interval. The suites never reset normal application data. Maturity tests advance their own isolated chain, not the application clock.

## What the 21 API/contract tests verify

1. Administrator login, separate registration and one-time customer credit.
2. Duplicate usernames, wrong passwords, incorrect portal and unauthorised roles rejected.
3. Cross-origin writes and missing CSRF tokens rejected.
4. Approval recorded on the agent chain; privileges remain pending while the relay is paused and become available only after the employment mirror is confirmed.
5. Fixed plan purchase, least-loaded assignment, balance debit and original document hash.
6. Cross-customer reads, agent financial writes and forged user-ID attempts rejected.
7. Sequential premiums, idempotent request replay and rejection of stale instalments.
8. Additional policies retain a customer's employed servicing agent.
9. Original document matches; modified content does not.
10. Resignation denies old sessions, endpoints and self-reinstatement; preserves original agent and assigns replacement.
11. Cancellation requires acknowledgement, retains 10%, refunds 90% once and notifies the current agent.
12. No-replacement state and automatic assignment after a new agent is approved.
13. Contract-level rejection of unauthorised administrator/relay calls and repeated source effects.
14. Actual chain IDs, block links, latest-block boundary, receipts and cross-chain references.
15. Detection of deliberately corrupted parent hashes and receipt membership indices in checker inputs.
16. Restart preserves accounts, sessions, policy references, deployments, balances and unfinished relay work; repeated delivery adds no duplicate notifications.
17. One second before and exactly at maturity; no early claim, outstanding premiums, instalment cap and one-time settlement.
18. Interrupted source broadcast persists signed bytes/hash; restart broadcasts the same transaction and charges once.
19. Rejected applicant restrictions and login throttling after repeated incorrect passwords.
20. Sensitive agent endpoints return no customer data when authoritative employment verification fails.
21. Incomplete persisted storage raises a recovery error instead of replacing history.

## Browser journey, run separately at both sizes

The browser creates two agent applicants, approves them as administrator, registers a customer, purchases Growth, pays the second premium, verifies and alters the document comparison, resigns the onboarding agent while two agent tabs are open, inspects replacement details, cancels with the exact ₹5,000 fee/₹45,000 refund, checks the replacement's notification, then inspects both chains and real receipts. Assertions cover removal of customer screens and denied old agent API access. The mobile run uses 390×844 from the start for all three roles, not just a resized final screenshot.

| Screen | Desktop evidence | Mobile evidence |
|---|---|---|
| Role choice | [Landing](../artifacts/v2/landing.png) | [Landing](../artifacts/v2/mobile/landing.png) |
| Customer overview | [Dashboard](../artifacts/v2/customer-dashboard.png) | [Dashboard](../artifacts/v2/mobile/customer-dashboard.png) |
| Agent portfolio | [Portfolio](../artifacts/v2/agent-portfolio.png) | [Portfolio](../artifacts/v2/mobile/agent-portfolio.png) |
| Administrator | [Approvals](../artifacts/v2/admin-approvals.png) | [Approvals](../artifacts/v2/mobile/admin-approvals.png) |
| Original and replacement agents | [Policy](../artifacts/v2/policy-reassignment.png) | [Policy](../artifacts/v2/mobile/policy-reassignment.png) |
| Cancellation quote | [Fee/refund confirmation](../artifacts/v2/cancellation-preview.png) | [Fee/refund confirmation](../artifacts/v2/mobile/cancellation-preview.png) |
| Resigned agent | [Own history only](../artifacts/v2/resigned-agent.png) | [Own history only](../artifacts/v2/mobile/resigned-agent.png) |
| Previous / current / next | [Block explorer](../artifacts/v2/block-explorer.png) | [Block explorer](../artifacts/v2/mobile/block-explorer.png) |
| Transaction receipt | [Receipt](../artifacts/v2/transaction-receipt.png) | [Receipt](../artifacts/v2/mobile/transaction-receipt.png) |

## Reproduce

```powershell
npm test
npm run test:ui
$env:POLICYGUARD_MOBILE='1'
npm run test:ui
Remove-Item Env:POLICYGUARD_MOBILE
```

The API/contract test has no browser requirement. See the README for installing Playwright on another computer or selecting `POLICYGUARD_BROWSER`. Browser screenshots and JSON reports are overwritten with the latest successful run; earlier failed-run screenshots, if retained, are diagnostics and are not passing evidence.

## Limits of the evidence

These are functional acceptance and selected security/recovery tests, not an independent security audit, load test or proof of public-chain finality. Simulated faults cover relay interruption/repetition, a failed source broadcast and unavailable employment verification. Deliberately corrupted responses are injected into the integrity checker, not into the real chain database. No real payment, real insurance claim or regulatory integration was tested because those are outside this version.
