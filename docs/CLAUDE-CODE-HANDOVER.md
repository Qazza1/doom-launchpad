# DoomStreak / Doom Launchpad — Claude Code Handover

Last updated: 2026-08-01

This document is the authoritative handover for continuing Doom Launchpad in
Claude Code. Read it completely before changing code.

## Copy-paste prompt for Claude Code

```text
You are taking over development of DoomStreak's Doom Launchpad from Codex.

Your working repository is:
C:\Users\golis\Desktop\doomstreak-site\doom-launchpad

GitHub:
https://github.com/Qazza1/doom-launchpad

Start from the latest remote `stage4-deployment-prep` branch and work from its
head. The contract sources are frozen by digest in `config/review-artifact.json`;
CI fails if `src/` stops matching it, so any contract change must re-freeze that
file in the same commit.

First:
1. Open and read `docs/CLAUDE-CODE-HANDOVER.md` completely.
2. Inspect `git status`, the current branch, HEAD, tags, and recent history.
3. Read the roadmap, architecture/specification, threat model, audit checklist,
   Stage 3 and Stage 4 documents, canonical configuration, contracts, deployment
   scripts, and tests identified in the handover.
4. Run the repository's local verification command before editing:
   powershell -ExecutionPolicy Bypass -File .\tools\verify-local.ps1
5. Do not deploy, fund an address, sign, or broadcast any transaction. The
   contracts are already live; see the mainnet state section immediately below.

READ THIS FIRST. THE CONTRACTS ARE LIVE ON MAINNET AND THE CANARY IS RUNNING.

All four contracts are deployed on Robinhood Chain (4663). The factory was
RESUMED on 2026-08-01 and is open now. Canary launch 1 is done and every observer
invariant holds; two launches remain within the contract cap of three. Stages 3.1
to 3.4 and Stage 4 are complete.

Launch 1 state, for orientation only:

- Token DCT1 `0xbebf865056a3fe9914e9edeaddd6ed763309ddb6`
- Pool `0x515b8e7271b81a20c9f5e1a69f96565a22db945d`, position 548289 held by the
  PositionLocker
- Escrow `0x19b0780f01567c1c05349a1d8a113042c4cd07ed` holding 600,000,000 DCT1,
  GM streak open at 0/3
- Launch transaction
  `0xf46332c0645743a1c8b0baec50ab5bc72efa08e62f25bdaa52821772b747044c`, block
  25352820

Read `docs/stage-5-launch-1-review.md` before anything touching launch 2. It
records the evidence and the blockers that are still open.

You are NOT authorized to: execute a canary launch, pause or resume the factory,
sign or broadcast any transaction, request or load a private key, deploy
replacements, withdraw fees, or create reward campaigns. Launches 2 and 3 each
require a separate, explicit owner approval given immediately before that action.
This document is not that approval, and neither is any earlier message in a
conversation.

All work is read-only, non-broadcast, fail-closed, and test-first.

Deployed addresses (verified on chain and on Blockscout):
- DoomRewards        0x615f6E6B0AEA7Ac94F4391424aF601F9290dd9dC
- PositionLocker     0xdaE01c32131fF283f403b4C1fD71018Fa31cfAC0
- V3LiquidityManager 0xbf36be8861ca4fe9920B10fc526E3fD039F88519
- DoomLaunchFactory  0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE

Full deployment record, receipts, and verification evidence:
`config/robinhood-mainnet-stage4-deployment.json` and
`docs/stage-4-mainnet-deployment-evidence.md`.

The economics are frozen at 0% creator at launch / 40% permanent liquidity /
60% GM escrow, escrow released one equal share per check-in, a 1% creation fee,
and a 70/15/15 creator/treasury/rewards split on WETH LP fees.

The owner accepted proceeding to the capped three-launch canary without an
independent third-party audit. That waiver covers this unchanged contract digest
and the capped canary only. It does not cover a replacement or public factory,
and it does not authorize resume or launch. See
`docs/stage-4-owner-risk-acceptance.md`.

Contract sources are frozen at commit `740a473` with digest
`7aab9e3b0c0c7066ee31e89807900e63112b0c4815338825e02f5d85fa4684c8`. Do not modify
`src/` or re-freeze `config/review-artifact.json` unless the owner explicitly
authorizes a new contract version. A source change now means the deployed
contracts no longer match the repository.

When changing anything, expect downstream consumers to break. The economics
rework silently broke the canary observer's custody check, both opt-in fork
tests, and the indexer event declarations. Check `tools/`, `integration/`, the
fork tests, and the `stage34-indexer` repository every time.

Maintain these hard boundaries:
- No live signing or broadcasting without a later, explicit owner instruction
  after every Stage 4 gate is complete.
- Never ask for, store, print, or commit seed phrases, private keys, RPC URLs,
  Telegram tokens, API keys, or other secrets.
- Never import the SafePal seed/private key into Rabby.
- The factory is open for the capped canary. Do not pause or resume it without an
  explicit owner instruction; both directions are owner decisions, and the keeper
  manifest must be updated in the same sitting.
- The two one-time bindings are irreversible. Preserve the exact deployment
  order and stop on any receipt or postcondition mismatch.
- Never guess Robinhood Chain or Uniswap V3-compatible addresses.
- Do not populate final nonce, predicted contract addresses, gas, or required
  funding in the canonical manifest from the current snapshot. Those values
  become stale when the deployer nonce, block, gas, or code changes.
- Do not merge this branch to main, fund the Rabby deployer, change the factory's
  pause state, or execute canary launch 2 or 3 without explicit owner approval
  given immediately before the action.
- Any contract source change invalidates the frozen review artifact. Re-freeze
  `config/review-artifact.json` in the same commit; after an independent review
  it also requires focused re-review.

Use the economics, addresses, deployment order, validation evidence, roadmap,
and file inventory in `docs/CLAUDE-CODE-HANDOVER.md` exactly. If repository code
contradicts the handover, stop, show the evidence, and resolve the discrepancy
without making a mainnet assumption.
```

## Current repository state

- Local repository:
  `C:\Users\golis\Desktop\doomstreak-site\doom-launchpad`
- GitHub: <https://github.com/Qazza1/doom-launchpad>
- Active branch: `stage4-deployment-prep`
- Work from the head of `origin/stage4-deployment-prep` with a clean tree. The
  same commits are also pushed to `main`.
- Sibling repositories: `..\stage34-indexer` (production indexer and public API)
  and `..` itself (the static DoomStreak website).
- The contract artifact is frozen by digest in `config/review-artifact.json`, not
  by a tag. `tools/review/package.mjs --ref HEAD` regenerates the manifest, and CI
  fails if `src/` no longer matches the frozen digest.

Useful checkpoints:

- `1f5e48f` — Stage 5 operations ready (branch head, also on main)
- `740a473` — frozen deployed contract source, digest `7aab9e3b…`
- `44d435a` — approved deployment plan
- `551a27f` — paused Robinhood mainnet deployment recorded
- `a51fb7c` — indexer event contract and its both-directions guard
- `91f781c` — Death Watch feed engine
- `e240417` — fork tests updated to the new economics and passing live
- `736ad27` — review artifact re-frozen by digest
- `733895f` — economics reworked to 0/40/60 with staggered release
- `61e7c2b` — Stage 5 canary launch observer
- `6fd12e2` — post-deployment verifier through two providers
- `0d1feaa` — funding-refresh worksheet
- `62a50d1` — passed wallet transaction preview recorded
- `f2dee52` — exact localhost deployment preview

Important tags:

- `stage-3-baseline`
- `stage-3.1-audit-candidate`
- `stage-3.2-rewards-ops`
- `stage-3.3-keeper-monitoring`
- `stage-3.4-indexer-public-ui`

CI runs for every push are at
<https://github.com/Qazza1/doom-launchpad/actions>.

## Product vision

DoomStreak is becoming a launcher-first memecoin platform for Robinhood Chain,
with analytics and the existing NFT commitment game forming the trust,
retention, and revenue layers.

The differentiator is not another generic Pump.fun clone. A launch commits a
fixed creator allocation to a three-day "GM" survival mechanic:

- The creator receives nothing at launch.
- 40% provides permanent Uniswap V3-compatible liquidity.
- 60% enters GM escrow, released one equal share per check-in.
- The creator checks in once per day for three days.
- If the streak survives, the escrowed allocation is released to the creator.
- If the streak fails, the unreleased escrow moves to the separate DoomRewards
  vault for later NFT-holder rewards. Honoured check-ins are not clawed back.

The public experience should eventually make launching a token the main page:
simple and fast like successful memecoin launchpads, but styled as DoomStreak
and backed by serious risk, creator-history, liquidity, and freshness data.

The existing NFT game remains important. It is the current business and future
access layer. The long-term plan is to give NFT holders reward distributions
and gated access to advanced analytics or other paid features.

## Frozen product and economic decisions

### Addresses

- Existing DoomStreak NFT:
  `0xB1b37dca046d0e70D9F5de673202D69c7DEF9be6`
- Deployer / operator / approved creator:
  `0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F`
- General treasury and NFT holder excluded from rewards:
  `0x9038C3AB7caE02a8aae730E705fdF7a15945eb7E`
- Campaign manager:
  `0x4F81E3939232815e3C98B124A17BaC75304C82D8`
- Unclaimed-rewards recipient:
  `0x4F81E3939232815e3C98B124A17BaC75304C82D8`
- Emergency guardian:
  `0x3EeF0a7Ee9420a1035a4541582B384bc4405A439`

The deployer is an existing dedicated Rabby account created specifically for
this project. It is not the missing SafePal hardware wallet.

### Robinhood Chain and V3-compatible dependencies

- Chain ID: `4663`
- Wrapped native token:
  `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
- V3 Factory:
  `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`
- NonfungiblePositionManager:
  `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3`
- Pool fee tier: `10000` / 1%
- Tick spacing: `200`
- Liquidity range: full range

Do not replace or supplement these addresses with guessed router, quoter, or
vendor addresses. Re-verify dependencies from authoritative network evidence
before a production deployment.

### Supply and GM commitment

- Token supply allocation:
  - 0% creator at launch
  - 40% permanent V3 liquidity
  - 60% GM escrow
- Required check-ins: 3
- Frequency: one check-in per day
- Grace period: 12 hours
- Failed escrow allocation: 100% of the unreleased remainder to DoomRewards
- LP position: permanently locked; there is no owner release path

### Fees and rewards

- Creation fee: 1% of the native liquidity actually used
- Creation-fee split:
  - 50% general treasury
  - 50% DoomRewards
- LP WETH fees while the creator remains eligible:
  - 70% creator
  - 15% treasury
  - 15% DoomRewards
- LP WETH fees after default or missed finalizable deadline:
  - 0% creator
  - 15% treasury
  - 85% DoomRewards
- Launch-token side LP fees:
  - 100% DoomRewards
- NFT supply of zero is expected because no NFTs have been minted yet.
- Rewards stay in DoomRewards for a future NFT-holder snapshot.
- The treasury address is excluded from NFT reward entitlement.
- Unclaimed rewards are recycled inside DoomRewards.
- DoomRewards remains separate from the general treasury.

### Canary limits

- Exact native liquidity per canary launch: `0.01 ETH`
- Maximum canary launches: 3
- Aggregate canary liquidity cap: `0.03 ETH`
- Factory starts paused.
- Resuming it is a separate owner decision after deployment review.

## Contract architecture

Core sources:

- `src/DoomToken.sol`
- `src/GmEscrow.sol`
- `src/DoomRewards.sol`
- `src/PositionLocker.sol`
- `src/V3LiquidityManager.sol`
- `src/DoomLaunchFactory.sol`

Responsibility summary:

- `DoomToken` is the launched fixed-supply token.
- `GmEscrow` implements the three-check-in commitment and redirects failed
  allocations to DoomRewards.
- `DoomRewards` is the isolated NFT-holder distribution vault.
- `PositionLocker` permanently holds V3 LP NFTs and accounts for fees.
- `V3LiquidityManager` creates and initializes the pool, mints the permanent
  LP position, and registers it with the locker.
- `DoomLaunchFactory` coordinates creation, allocation, escrow, fee routing,
  liquidity creation, launch limits, pausing, and authorization.

### Exact deployment sequence

The planned production sequence contains exactly six transactions:

1. Deploy `DoomRewards`.
2. Deploy `PositionLocker`.
3. Deploy `V3LiquidityManager`.
4. Call `PositionLocker.bindRegistrar(manager)`.
5. Deploy `DoomLaunchFactory`.
6. Call `V3LiquidityManager.bindFactory(factory)`.

Both binding calls are intentionally one-time and irreversible. Transaction
order, nonce, predicted addresses, receipts, code, constructor arguments, and
postconditions must be checked after every transaction. Stop immediately if
anything differs. The deployed factory must remain paused.

## What has been completed

### Stage 3.1 — security/economics audit candidate

- The economics and permanent-liquidity design were rebuilt.
- The earlier review's implementable security remediations were incorporated.
- Unit, fuzz, invariant, reentrancy, permission, accounting, deadline,
  Merkle-claim, and locker postcondition coverage exists.
- The tagged `stage-3.1-audit-candidate` is historical and superseded.
- The current review baseline is commit `733895f6b07b4f68d58841b8e0840274e22a8276`
  with the contract digest recorded in `config/review-artifact.json`.
- Independent external review remains a mainnet gate.

### Stage 3.2 — rewards operations

- Deterministic NFT-holder rewards tooling and documentation exist.
- Treasury exclusion and unclaimed-reward recycling are specified.
- Rewards tooling tests pass.

### Stage 3.3 — keeper and Telegram monitoring

- Read-only keeper monitoring exists.
- Telegram setup and delivery were tested successfully by the owner.
- Monitoring remains read-only.
- Telegram tokens and chat IDs are secrets and must not be committed.

### Stage 3.4 — indexer and public UI

- Additive indexer/API schemas and event handling were prepared.
- A read-only launchpad canary panel was added to the site.
- The existing analytics and NFT game were preserved.
- The site and Railway indexer were integrated without enabling launch writes.
- Launch actions remain disabled until deployment and canary gates pass.

### Stage 4 — completed preparation gates

- Dual-RPC preflight passed using Alchemy primary and QuickNode fallback.
- The owner reported: `RPC preflight passed.`
- Rabby control verification passed for
  `0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F`.
- The signed verification was checked and deliberately discarded rather than
  stored.
- The owner reported: `Rabby control verification passed`.
- A read-only Robinhood mainnet fork rehearsal passed using the dedicated
  Alchemy configuration.
- No signer or private key was loaded.
- No transaction was signed, stored, or broadcast.
- The exact six-transaction localhost deployment preview was implemented and
  passed against committed source `f2dee52`.

## Exact localhost deployment-preview evidence

Feature files:

- `script/PreviewRobinhoodDeployment.s.sol`
- `test/PreviewRobinhoodDeploymentSafety.t.sol`
- `tools/deployment/localhost-preview.mjs`
- `tools/deployment/localhost-preview.ps1`
- `tools/deployment/test/localhost-preview.test.mjs`
- `docs/stage-4-localhost-preview.md`

Safety model:

- Starts Anvil on `127.0.0.1:18545`.
- Forks Robinhood Chain read-only.
- Confirms that the target is local Anvil with the expected chain ID.
- Copies the real deployer's pending nonce.
- Sets the distinctive local-only sentinel balance
  `123456789012345678901 wei`.
- Solidity requires that sentinel before `vm.startBroadcast`.
- Uses only the locally unlocked impersonated deployer.
- Does not load a key, ask Rabby to sign, or write upstream.
- Executes the exact six planned transactions locally.
- Verifies sequential nonces, CREATE predictions, successful receipts, code,
  factory paused state, and both bindings.
- Writes a secret-sanitized ignored report to
  `tools/deployment/output/latest-report.json`.

Committed-run snapshot:

- Generated: `2026-07-25T11:53:28.960Z`
- Source commit:
  `f2dee520ac1d5c16059f47bf80e8791bbe6bc66d`
- Fork block: `18988889`
- Pending deployer nonce: `0`
- Observed deployer balance: `0.0005 ETH`

Transaction evidence:

| Nonce | Action | Predicted address | Gas used | Planned gas limit |
|---:|---|---|---:|---:|
| 0 | Deploy DoomRewards | `0x615f6E6B0AEA7Ac94F4391424aF601F9290dd9dC` | 1,002,237 | 1,302,908 |
| 1 | Deploy PositionLocker | `0xdaE01c32131fF283f403b4C1fD71018Fa31cfAC0` | 1,664,106 | 2,163,337 |
| 2 | Deploy V3LiquidityManager | `0xbf36be8861ca4fe9920B10fc526E3fD039F88519` | 1,518,199 | 1,973,658 |
| 3 | bindRegistrar | n/a | 49,335 | 68,143 |
| 4 | Deploy DoomLaunchFactory | `0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE` | 4,602,092 | 5,982,719 |
| 5 | bindFactory | n/a | 49,312 | 68,112 |

Totals and fee snapshot:

- Total gas used: `8,885,281`
- Total planned gas limit: `11,558,877`
- Observed gas price: `0.082332 gwei`
- Base fee: `82,184,000 wei`
- Priority fee: `0`
- Conservative max-fee ceiling: `0.164368 gwei`
- Maximum cost before buffer: `0.001899909494736 ETH`
- Snapshot requirement with 25% buffer: `0.00237488686842 ETH`
- Snapshot shortfall at the observed balance:
  `0.00187488686842 ETH`
- All local postconditions passed.

These addresses and funding numbers are evidence, not final production values.
Do not fund from this snapshot. Re-run the dual-RPC preflight and localhost
preview immediately before the owner approves funding. A nonce change changes
the predicted CREATE addresses.

## Current validation status

- 75 Solidity tests passed; 2 opt-in fork tests skipped by the normal gate, 77
  total.
- Both fork tests passed against live Robinhood Chain state on 2026-07-28 with
  the reworked economics.
- 65 Node deployment-tool tests passed.
- 17 Death Watch tests, 8 indexer-event contract tests, 11 canary-observer
  tests, 6 review-artifact tests.
- 8 rewards-tool tests, 13 keeper-tool tests.
- Contract runtime-size checks passed:
  - `DoomLaunchFactory`: 21,035 bytes; internal limit 23,500
  - `V3LiquidityManager`: 6,520 bytes; internal limit 12,000
  - `PositionLocker`: 7,268 bytes; internal limit 12,000

Primary local validation command:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\verify-local.ps1
```

Workspace Foundry binaries are pinned under:

`C:\Users\golis\Desktop\doomstreak-site\.tools\foundry-v1.7.1`

Node.js v24.15.0 is installed.

## Current manifest state

Canonical manifest:

`config/stage4-deployment-manifest.json`

It is intentionally fail-closed:

- status: `draft_fail_closed`
- enabled: `false`
- broadcast: `false`
- mainnet deployment approved: `false`
- final owner approval recorded: `false`
- Rabby control verification: recorded as complete
- Rabby transaction rehearsal: recorded as complete, passed 2026-07-25 on an
  isolated chain with all six gas figures matching the impersonated preview
- independent review: incomplete
- nonce, gas, production transaction, deployed-address, and verification
  fields: intentionally empty

Do not set deployment approval or broadcast flags during engineering work.

## What is being worked on now

Everything is deployed and verified, the factory is resumed, and the capped
canary is in progress with one launch done. Operations are live and read-only.

Running in production:

- **Keeper** on Railway (`doom-launchpad-keeper`), read-only, no signing key, two
  RPC providers, persistent alert state. It sees launch 1, its permanent-lock
  check passes, and a local dry run against the reconciled config reports zero
  active alerts. See `docs/keeper-operations.md`.
- **Indexer** on Railway (`OnchainDiligence-indexer`), read-only — **currently
  stalled**. It stopped at block 25352711, 109 blocks before launch 1 was mined,
  reports `status: stalled` with a request timeout, and has never indexed the
  launch. This is the largest open item.
- **Public site** with the Death Watch survival feed, creator Doom Record, and
  persistent watchlist alerts. Death Watch reads the chain directly and is
  correct; anything the site derives from the indexer is not.

Direct reads, the observer, and Death Watch agree on the factory being resumed
with launch count 1. The indexer does not.

Before launch 2, in order:

1. Clear the blockers in `docs/stage-5-launch-1-review.md`: the stalled indexer,
   the unfunded creator account, unconfirmed Telegram delivery, and the open GM
   streak.
2. Owner grants explicit approval for launch 2, immediately before the action.
   Approval for launch 1 does not carry.
3. Prepare the plan with `tools/canary/prepare.ps1 -Kind launch -Launch 2` and
   rehearse it with `tools/canary/fork-rehearsal.ps1 -Kind launch`.
4. Launch exactly 0.01 ETH of liquidity — 0.0101 ETH of value — from the approved
   creator.
5. Run `tools/canary/observe.mjs` against that launch and review every invariant
   before launch 3 is even considered. Three launches is the hard cap.
6. Compare indexer and public API output against direct contract reads.

Closed on 2026-08-02: `PositionLocker.bindRegistrar` at block 25102641 fell
outside the scan range that started at the factory deployment block 25105648.
Both the indexer and `config/keeper.mainnet.json` now start at 25082132, the
first deployment, so `RegistrarBound` is inside the range.

Two structural facts to carry forward:

- Factory #1 can only ever perform three launches of exactly 0.01 ETH. The canary
  caps are contract constants the constructor enforces, so public launching needs
  a second factory, and that factory is outside the audit waiver.
- The first-party audit in `docs/internal-audit-2026-07-28.md` is not an
  independent review. M-1 (permissionless pool pre-creation can grief a launch)
  is remediated only as a diagnostic revert; the denial of service itself remains
  and must be treated as an architecture requirement for factory v2.

## Remaining staged roadmap

### Stage 4 — deployment preparation

Remaining gates include:

- Close localhost-preview documentation/evidence.
- Complete source-verification rehearsal.
- Freeze the exact review artifact and checksum.
- Obtain independent review.
- Resolve findings and re-review changed security-sensitive code.
- Repeat dual-RPC preflight.
- Repeat exact localhost deployment preview from the final reviewed commit.
- Refresh pending nonce, base fee, priority fee, conservative gas caps,
  predicted CREATE addresses, balance, and funding requirement.
- Put only the fresh final values in the deployment manifest.
- Ask the owner for explicit final funding and deployment approval.

### Production deployment, only after every gate

1. Fund only the dedicated Rabby deployer with the freshly calculated,
   deliberately limited gas amount.
2. Confirm the expected pending nonce through both RPC providers.
3. Recalculate and cross-check every predicted contract address.
4. Deploy one transaction at a time in the six-transaction order.
5. Use Rabby to inspect and approve each exact transaction.
6. After each transaction, wait for and validate the receipt, status, nonce,
   target or created address, bytecode, constructor/config values, and balance.
7. Stop on any discrepancy; never blindly submit the next nonce.
8. Verify source code and constructor arguments on the explorer.
9. Confirm the factory is paused and both one-time bindings are correct.
10. Revoke or remove unnecessary hot-wallet funds after the procedure.

### Stage 5 — capped mainnet canary, in progress

This is separate from deployment:

- Owner explicitly approves resuming the factory. **Done 2026-08-01.**
- Launch no more than three canary tokens. **One done; two remain.**
- Each uses exactly 0.01 ETH of native liquidity.
- Aggregate canary liquidity cannot exceed 0.03 ETH.
- Observe and review each launch before proceeding to the next.
- Validate token allocation, V3 pool/position, permanent locker custody,
  escrow timing, GM check-ins, success/default paths, fee collection,
  DoomRewards accounting, indexer ingestion, public API, Telegram monitoring,
  and emergency controls.
- Pause and investigate on any inconsistency.

### Stage 6 — launcher-first public website

Only after the canary proves the contracts and operations:

- Make the memecoin launchpad the homepage.
- Use a simple, low-friction launch flow inspired by successful launchpads
  without copying their branding.
- Keep DoomStreak's cyan/lime/yellow/pink visual identity.
- Main navigation should lead with launch/discovery.
- Preserve the NFT game as a clearly visible core product and future gating
  mechanism.
- Give every launched token a shareable detail URL.
- Include risk score, liquidity, creator history, launchpad, volume, holders,
  last-indexed timestamp, and confidence/completeness indicator.
- Keep transaction simulation, review, approvals, slippage, and risk notices
  understandable before signing.

### Stage 7 — analytics v2 and gated tools

- Reorganize the analytics dashboard around decisions, not decorative panels.
- Restore and retain wallet investigation as `Creator History` or
  `Wallet Reputation`.
- Improve launchpad comparisons and token discovery.
- Add useful watchlist alerts:
  - creator launched again
  - liquidity fell materially
  - risk score changed
- Show freshness and confidence beside every derived score.
- Add NFT-holder gating for advanced analytics later.
- Consider a broader launcher only after the first system is reliable.

## Security and operating rules

These rules are mandatory:

1. Never request or accept a seed phrase or private key.
2. Never store RPC URLs, Telegram tokens, wallet secrets, or API keys in Git,
   logs, Markdown evidence, generated reports, screenshots, or chat.
3. Never import the SafePal seed/private key into Rabby.
4. Treat Rabby as a deliberate hot-wallet downgrade:
   - use only the dedicated project account
   - keep it isolated
   - fund it only with the currently required gas
   - remove residual funds after the operation
5. Do not sign or broadcast because a script says the configuration is ready.
6. Require explicit owner approval at the final reviewed checkpoint.
7. Keep the factory paused through deployment and verification.
8. Do not bypass irreversible-binding checks.
9. Do not guess external protocol addresses or compatibility.
10. Do not call owner, Claude, Codex, or another non-independent AI review an
    independent smart-contract security review.
11. Any security-sensitive source change invalidates the old reviewed artifact.
12. Avoid force pushes, destructive Git resets, or rewriting the tagged
    baselines.
13. Preserve unrelated owner changes in dirty worktrees.
14. Keep generated preview output ignored unless a sanitized evidence artifact
    is deliberately created and reviewed.

## Files Claude Code needs

The recommended access scope is the entire launchpad repository, including its
`.git` history and tags:

`C:\Users\golis\Desktop\doomstreak-site\doom-launchpad`

Selective access is possible but less safe. At minimum Claude needs:

### Repository and build configuration

- `.git/` history and tags
- `.github/workflows/`
- `.gitignore`
- `README.md`
- `foundry.toml`
- `remappings.txt`
- dependency lock/configuration files present in the repository

### Contracts and tests

- `src/` — all files
- `script/` — all files
- `test/` — all files
- library dependencies checked into or referenced by Foundry

### Canonical configuration

- `config/robinhood-mainnet-canary.decisions.json`
- `config/stage4-deployment-manifest.json`
- `config/keeper.example.json`
- any schema or validation files used by those configurations

### Deployment and operations

- `tools/deployment/` — all files
- `tools/rewards/` — all files
- `tools/keeper/` — all files
- `tools/verify-local.ps1`
- `integration/` — all files

The latest local evidence report is ignored by Git but may be read locally:

`tools/deployment/output/latest-report.json`

It must not be treated as a final deployment manifest.

### Documentation and evidence

Claude should read every Markdown file under `docs/`, especially:

- `docs/roadmap.md`
- launchpad specification / architecture documentation
- threat model
- audit checklist
- economics documentation
- Stage 3.1 security/audit-candidate documents
- Stage 3.2 rewards-operations documents
- Stage 3.3 keeper/Telegram documents
- Stage 3.4 indexer/public-UI documents
- all Stage 4 deployment, signer, RPC, fork, and localhost-preview documents
- this handover file

Also retain and inspect:

- `SHA256SUMS.stage-*`

## Other project access needed later

### Public DoomStreak site

Repository/root:

`C:\Users\golis\Desktop\doomstreak-site`

GitHub:

<https://github.com/Qazza1/doomstreak-site>

Minimum later access:

- `C:\Users\golis\Desktop\doomstreak-site\index.html`
- site assets and JavaScript loaded by it
- Vercel configuration, if present
- site Git history

The current site is deployed through Vercel to <https://www.doomstreak.xyz/>.
Do not redesign the analytics page until the launchpad roadmap and canary are
complete unless the owner explicitly changes priorities.

### OnchainDiligence indexer

Expected local repository:

`C:\Users\golis\Desktop\onchaindiligence-indexer`

It is deployed on Railway and already serves the analytics site. A previous
production responsiveness/background-worker isolation fix was associated with
commit `9230ca1`; verify the actual repository and remote history rather than
assuming the commit is still HEAD.

Claude will later need:

- the full indexer repository
- migrations and schema
- launchpad event ABIs and normalizers
- API routes and tests
- Railway configuration and environment-variable names

Do not give Claude secret environment-variable values in the prompt or commit
them. Use the existing local/host secret management.

## Safe startup commands

```powershell
cd C:\Users\golis\Desktop\doomstreak-site\doom-launchpad
git fetch --all --tags
git checkout stage4-deployment-prep
git pull --ff-only origin stage4-deployment-prep
git status
git log -5 --oneline
powershell -ExecutionPolicy Bypass -File .\tools\verify-local.ps1
```

Existing operator commands, to be read before rerunning:

```powershell
# Secret-safe dual RPC check; supply secrets only through the documented local
# mechanism. Never paste them into source or logs.
.\tools\deployment\rpc-preflight.ps1

# Read-only/non-broadcast fork rehearsal.
.\tools\deployment\fork-rehearsal.ps1

# Exact local Anvil six-transaction preview; no mainnet signing.
.\tools\deployment\localhost-preview.ps1

# Local Rabby ownership verification UI. Already passed; do not store its
# signature or reinterpret it as deployment approval.
node .\tools\deployment\rabby-verify-server.mjs
```

Read each command's documentation and help before use. Do not infer that a
successful local command grants authorization to fund, sign, or broadcast.

## Definition of the next successful handoff checkpoint

Any checkpoint is successful when:

- `tools/verify-local.ps1` exits zero and GitHub Actions is green;
- the canonical manifest is still fail-closed, with approval, broadcast, and
  verification flags false and the nonce, gas, transaction, and deployed-address
  fields empty;
- `config/review-artifact.json` matches `src/` at HEAD, re-frozen deliberately in
  the same commit if contracts changed;
- every downstream consumer of a contract change was checked: `tools/canary`,
  `tools/deathwatch`, `tools/keeper`, `integration/`, and both fork tests;
- the roadmap marks only what actually happened;
- no wallet was funded and no transaction was signed or broadcast.

The remaining sequence is: finish the launcher-first site and the chosen Stage 6.5
mechanics, obtain an independent review of the final artifact, refresh the funding
worksheet from that commit, deploy one transaction at a time, verify through two
providers, then run the capped three-launch canary with the observer between
launches.
