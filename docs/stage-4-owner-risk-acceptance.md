# Stage 4 owner risk acceptance

Recorded: 2026-07-29  
Scope: capped Robinhood Chain mainnet canary only

## Owner statement

> I accept proceeding to the capped three-launch mainnet canary without an
> independent third-party audit. I understand this overrides the documented
> independent-review gate. I authorize non-broadcast Stage 4 finalization, but I
> do not yet authorize a mainnet transaction.

## Exact artifact accepted

- Contract source commit:
  `740a473bd0f2830a17650be7a3b4008be1f82441`
- Contract digest:
  `7aab9e3b0c0c7066ee31e89807900e63112b0c4815338825e02f5d85fa4684c8`
- Canary limits: one approved creator, no creator-liquid allocation, exactly
  `0.01 ETH` native liquidity per launch, no more than three launches, factory
  deployed paused.

## What this exception does

- Records the owner’s informed decision to waive the independent third-party
  review gate for this capped canary.
- Authorizes read-only checks, fork rehearsals, unsigned transaction planning,
  and a temporary funding proposal.
- Leaves the `independentReview` manifest section empty because no independent
  review occurred.

## What this exception does not do

- It does not authorize funding the deployer.
- It does not authorize a Rabby signature or mainnet broadcast.
- It does not authorize changing `broadcast=false`, deployment approval, or
  final owner approval in the fail-closed manifest.
- It does not authorize resuming the factory after deployment.
- It does not authorize the first canary launch.
- It does not waive independent review for a public or replacement factory.

Fresh nonce, gas, balance, dependency-bytecode, fork, and unsigned-transaction
evidence must still be generated from the final committed tree. A separate,
explicit owner approval is required immediately before any mainnet transaction.
