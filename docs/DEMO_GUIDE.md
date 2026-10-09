# Classroom presentation walkthrough

Allow about 10–15 minutes. This is a persistent application: the actions below remain recorded after you stop it. The guide does not require resetting or changing financial rules.

## Prepare before class

1. Open `data/SAMPLE_ACCOUNTS.txt` and `data/INITIAL_ADMIN.txt` privately. Do not project the passwords or show private keys.
2. Run `START_POLICYGUARD.cmd`; open http://127.0.0.1:3000 after the ready message.
3. Use a normal browser for the customer and an incognito window or separate browser profile for the agent. Ordinary tabs share a login cookie. Use another profile for the administrator if needed.
4. Read `BEGINNER_GUIDE.md`, particularly source/mirror authority, the cancellation calculation and the consensus limitation.

If no sample accounts exist, stop the application and run `SETUP_SAMPLE_DATA.cmd` once. It does not overwrite existing customer accounts. You can also use normal sign-up and administrator approval to prepare your own fictional accounts.

## 1. Establish the customer view

Choose Customer and log in as `sample_krishnan`. Show the Growth and Assurance policies, available test balance, instalment status and maturity countdown. Open Growth. Point out fixed premium, promised bonus, issue/maturity dates, annual schedule and the original/current servicing agent. At initial setup both agents on this customer are Ananya Rao.

Explain: “The customer can verify the original promise here. A separate policy is not required to release this policy's bonus. Its eligibility is all premiums paid and the recorded maturity date.”

## 2. Show authentication and insurer approval

Open the Agent sign-up screen and register a new fictional agent with a fresh username. Show that the account is pending and has no customer portfolio, plans or explorer navigation. In the administrator portal, review the pending profile and approve it. Follow the operation until synchronised; return to the applicant's session and show the new employed state. Approval is a transaction on agent chain 1338 and employment is mirrored to customer chain 1337.

Newly approved agents are eligible replacements. Reassignment chooses the least-loaded current agent, so approving an extra agent here can change who receives Krishnan's portfolio later. That is expected.

## 3. Record a normal payment

In Krishnan's Growth policy, choose the next annual premium and confirm. Wait for synchronised status. The initial Growth premium was ₹25,000. After paying the second one, premiums paid are ₹50,000 and the test balance is lower by ₹25,000. Show the corresponding history and agent notification.

The extra annual instalment may be paid in advance; it does not shorten the three-year maturity date. If you have already rehearsed this step, pay only a remaining instalment or buy a fresh Growth policy. The app prevents exceeding the policy's count.

## 4. Verify the document

Use the original document text in the policy detail to verify a match. Change a bonus amount or even one character in the text area and verify again. Show the mismatch. This comparison changes only the submitted text; it never edits the on-chain policy or saved original document.

## 5. Show resignation and replacement

Log in as `sample_ananya` in the separate agent browser profile. Open the assigned customer portfolio. Open a second tab in that same agent profile to demonstrate that both sessions lose customer access.

Go to Employment, choose Resign, review the impact and confirm. Wait for the confirmed departure. Both tabs remove customer information; only the agent's own employment record remains. A saved portfolio/explorer URL cannot restore access.

Refresh the customer policy if needed. Ananya remains the original onboarding agent and is marked resigned. The current agent is the lowest-loaded employed replacement, with their contact details. The financial terms and payments have not changed. If no replacement is employed, the customer sees “Awaiting reassignment” and insurer support; approving an agent resolves it automatically.

Resignation is permanent in this application. For another presentation, register a fresh agent and customer rather than trying to reinstate the departed agent.

## 6. Preview and confirm cancellation

Before maturity, open Preview cancellation on Growth. With two ₹25,000 premiums paid, the quote is:

| Item | Amount |
|---|---:|
| Premiums paid | ₹50,000 |
| Fee, 10% | ₹5,000 |
| Refund, 90% | ₹45,000 |
| Bonus forfeited | ₹10,000 |

Review the actual quote shown if you have made a different number of payments. Acknowledge it and confirm. Show the closed policy, restored test balance, exact fee/refund and the current agent's updated policy/notification. A duplicate request cannot refund again.

Explain that the fee is the project's pre-disclosed academic rule. No government “three-month bonus” rule or real insurer regulation is claimed.

## 7. Inspect both chains

Open the customer's Blockchain explorer. On customer chain 1337, use **View contract transactions** to find meaningful activity even when recent blocks are empty. Open a payment/cancellation transaction and show its receipt, gas, sender, decoded action and events. Follow its cross-chain destination reference to agent chain 1338.

Open a block and inspect previous/current/next. Match current `parentHash` to previous `hash`, and next `parentHash` to current `hash`. Run the block-link check over a displayed range. Explain that the latest block currently has no successor and that the check validates recorded links and receipt membership, not distributed consensus.

## 8. Persistence and maturity evidence

Stop the server with Ctrl+C, restart it, and sign in again. Show that policies, departure, assignments, notifications and chain history remain. Do not delete `data/`.

Maturity is tested in isolated automated chains, where the suite moves to one second before and exactly at maturity. It verifies cancellation boundaries, arrears, full-payment eligibility, payment caps and a single settlement. Show `docs/TEST_RESULTS.md` and `artifacts/v2/acceptance-test-output.txt` rather than suggesting the ordinary UI can accelerate a multi-year policy.

End by stating the boundary: two real local Ethereum ledgers, a trusted server/relay, test credit and locally managed signers. Real premium collection, actual claims, regulator integration and public-chain deployment are outside this version.
