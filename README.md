# PolicyGuard — Sahana Life

A working academic insurance application with Customer, Agent and Administrator portals, built for **BACSE350: Blockchain Architecture and Design**. It uses two persistent local Ethereum chains, Solidity, Node.js, ethers, SQLite and plain JavaScript.

The project addresses the supplied scam scenario by making original policy terms, bonus conditions and an agent's current employment independently inspectable in the application. A departed agent loses application access; customers retain their original onboarding history and see their replacement agent. This cannot erase data someone previously copied or prevent off-platform phone scams.

## One-file setup for your teammate (Windows)

**Download [SETUP_POLICYGUARD.bat](https://raw.githubusercontent.com/nannanvp/PolicyGuard/main/SETUP_POLICYGUARD.bat), save it as a `.bat` file, and double-click it.** No Git, GitHub login, Node.js installation or administrator access is required. Windows 10/11, 64-bit, and an internet connection for first setup are required.

The setup downloads this public repository, installs a private Node.js 24 runtime after verifying its official SHA-256 checksum, installs the locked dependencies, and prepares the same fictional customer/agent portfolios. It opens the website and creates a **PolicyGuard** desktop shortcut for future use. The **PolicyGuard Login Details** shortcut opens the fresh sample passwords generated on that laptop.

The application is installed under `%LOCALAPPDATA%\PolicyGuard`. Each laptop has independent accounts, balances, signing keys and blockchain history. The sample usernames and starting plans match, but passwords are newly generated. Neither laptop shares its private keys through GitHub. Once setup finishes, normal use works offline. Rerunning setup preserves the existing project and its data; it does not silently update contract source or reset the chains.

See [teammate setup and troubleshooting](docs/TEAMMATE_SETUP.md). Users who prefer to clone and install manually can follow the steps below.

## Start on this Windows computer

1. Double-click **`START_POLICYGUARD.cmd`**.
2. Wait for `PolicyGuard ready`, then open **http://127.0.0.1:3000**.
3. Choose Customer or Agent. The administrator link is at the top of the landing page.
4. Keep the launcher window open. Press **Ctrl+C** to stop safely; starting again restores the same accounts and blockchain history.

Use Node.js **24 or newer**. The launcher also recognises the bundled Node runtime on this computer. Dependencies are already installed in this workspace; on another computer run `npm install` once. After installation, ordinary operation does not need internet access, MetaMask, a public RPC service or real money. Do not run two instances against the same data directory.

**Initial administrator:** username `admin`; the generated password is in **`data/INITIAL_ADMIN.txt`**. There is no public administrator sign-up. Private passwords and signing keys must stay out of a submitted source archive.

## Optional fictional sample accounts

Stop the server, then double-click **`SETUP_SAMPLE_DATA.cmd`**. This creates two employed agents, two customers and three policies only when there are no existing customer or agent accounts. Repeating successful setup leaves the accounts and passwords unchanged; it never resets your application.

| Portal | Username | Initial portfolio |
|---|---|---|
| Customer | `sample_krishnan` | Growth and Assurance |
| Customer | `sample_meera` | Long-Term |
| Agent | `sample_ananya` | Krishnan's policies |
| Agent | `sample_vikram` | Meera's policy |

The generated sample password is in **`data/SAMPLE_ACCOUNTS.txt`**. These people and contact details are fictional. The setup does not resign anyone or cancel policies for you. Use separate browser profiles or an incognito window to show customer and agent sessions at the same time; ordinary tabs share one login cookie.

## What is implemented

- Separate registration and login, salted password hashes, persistent server sessions, CSRF checks and login throttling.
- Administrator approval/rejection, employed-agent portfolios, authoritative resignation and automatic reassignment, including an awaiting-replacement state.
- Immutable issued terms; sequential annual premiums; cancellation quotes, exact fees and refunds; maturity eligibility and one-time settlement.
- Customer dashboards, maturity countdowns, original/current agent contacts, read-only agent dashboards, notifications and exact-document fingerprint verification.
- Two Ethereum chains with separate persistent databases and a two-second mining interval. A persistent, idempotent local relay links customer activity and agent employment/assignments.
- Real block and receipt inspection, previous/current/next navigation, transaction decoding, cross-chain references and recorded-link integrity checks.
- Responsive emerald/ivory interfaces with operation progress, confirmations, loading, empty and error states.

The expanded scope and evidence are tracked in [the milestone checklist](docs/MILESTONE_CHECKLIST.md). The old prototype's completion estimate no longer applies.

## Fixed academic financial rules

| Plan | Annual premium | Term | Bonus when fully paid and mature | Total maturity benefit |
|---|---:|---:|---:|---:|
| Assurance | ₹12,000 | 1 year | ₹1,000 | ₹13,000 |
| Growth | ₹25,000 | 3 years | ₹10,000 | ₹85,000 |
| Long-Term | ₹40,000 | 5 years | ₹40,000 | ₹2,40,000 |

Every customer receives ₹5,00,000 in **non-withdrawable test credit once**. Amounts are integer paise on-chain. An academic year is exactly 365 days. The first annual premium is collected at purchase; later premiums can be paid in advance, in order. Cancellation before maturity retains 10% of premiums paid, returns 90% and forfeits the bonus. After maturity, outstanding premiums must be paid before claiming once. These are project rules, not Indian government or insurance-regulatory rules. Ethereum gas is separate test ETH.

## Read and present the project

- [Beginner guide](docs/BEGINNER_GUIDE.md): concepts, course mapping and how to explain the code.
- [Presentation walkthrough](docs/DEMO_GUIDE.md): a practical customer/agent/admin journey for class.
- [Architecture and design](docs/PROJECT_NOTES.md): authority, storage, contracts, synchronisation and limitations.
- [Acceptance evidence](docs/TEST_RESULTS.md): commands, tested behaviours and screenshots.
- [Milestone checklist](docs/MILESTONE_CHECKLIST.md): completed scope and remaining production work.

## Tests

```powershell
npm test
npm run test:ui
$env:POLICYGUARD_MOBILE='1'
npm run test:ui
```

The API/contract suite uses only the installed application dependencies. Browser tests require Playwright and Chromium; this computer's bundled Playwright/browser are detected automatically. On another computer, install a test runner with `npm install --no-save playwright` and `npx playwright install chromium`. `POLICYGUARD_BROWSER` can name an installed browser executable. Test data is isolated under `test-output/`; tests do not modify `data/`. Automated maturity tests advance only their isolated chain clock. There is no clock/reset/scenario control in the application.

## Source map and persistence

| Location | Responsibility |
|---|---|
| `app-server.js` | Authenticated HTTP API, sessions, permissions, explorer and static files |
| `lib/application.js` | Operations, relay, assignment notifications and policy read models |
| `lib/storage.js` | SQLite, password hashing and encrypted signing-key storage |
| `lib/network.js` | Solidity compilation, persistent chains and link checks |
| `contracts/CustomerLedger.sol` | Customer credit, immutable terms, payments and settlement |
| `contracts/AgentLedger.sol` | Employment, servicing assignments and mirrored financial summaries |
| `public/portal.*` | Plain-JavaScript application interface |
| `scripts/sample-data.js` | Optional non-destructive fictional account setup |
| `data/` | Private application state; back up as one unit while stopped |
| Earlier prototype | Preserved in the original development workspace; omitted from the public repository |

`server.js` and `START_DEMO.cmd` are compatibility entry points to the new application. The old unrestricted endpoints are not served.

**Backup:** stop the application and copy the entire `data/` folder, including `app.sqlite`, `secret.key`, both chain directories and credential files. Retain the matching contract source/version. Restore the whole backup together. Missing chain files, missing application storage or a changed contract source produces a recovery error instead of silently deploying replacement contracts. There is no reset button. Use a different `POLICYGUARD_DATA` path for a deliberately separate installation; that path must not already be an empty/incomplete directory.

If port 3000 is occupied, stop the other instance or set `$env:PORT='3001'` before `npm start`. The normal server binds only to `127.0.0.1`. It is not configured for internet hosting. A Ganache µWS fallback notice is informational; the supported JavaScript fallback is used with the installed Node runtime.

This academic version uses locally managed signing keys and a trusted relay. Real insurance claims, payment gateways, regulatory integration, independent wallet custody, public-chain deployment and distributed consensus remain outside its scope.
