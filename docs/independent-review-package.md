# Independent review package

This document is the brief for an independent smart-contract security review of
Doom Launchpad. It is written for an external reviewer who has no prior context.

Nothing in this repository has been deployed. No transaction has been signed or
broadcast. Independent review is a hard gate before deployment, and neither the
owner's review, nor Codex's, nor Claude's counts as independent.

## What is being reviewed

Eleven Solidity sources under `src/`:

| Contract | Responsibility |
|---|---|
| `DoomToken.sol` | Fixed-supply launched token, no owner controls |
| `DoomLaunchFactory.sol` | Launch coordination, allocation, fees, caps, pausing |
| `GmEscrow.sol` | Three-check-in commitment, staggered release, default routing |
| `DoomRewards.sol` | Isolated NFT-holder reward vault and Merkle claims |
| `PositionLocker.sol` | Permanent LP NFT custody and fee accounting |
| `V3LiquidityManager.sol` | Pool creation, full-range mint, locker registration |
| `src/interfaces/*.sol` | Five external and internal interfaces |

Supporting material in scope: `test/`, `script/`, `config/`, `foundry.toml`,
`remappings.txt`, and the documents listed below.

Out of scope: the public website, the OnchainDiligence indexer, the keeper, and
the rewards tooling, except where they define data the contracts depend on.

## Reviewed artifact and checksums

The contract sources are frozen at the annotated tag `stage-3.1-audit-candidate`
(commit `3d1d28b274347b3e39c35ad33ea6a569644caed7`).

`src/` is byte-identical between that tag and the current branch head. Everything
added since is tests, deployment tooling, configuration, and documentation. The
`review-artifact` CI job asserts this on every push, so the reviewed contract set
cannot drift unnoticed.

- Contract digest (`src/` only): `ac9e7192d2af94a189806378dfe0f9bdbca3827b1776e783ec451970af8ce6c9`
- Audit-candidate artifact digest (60 files): `af7f9db104a37b1d2d0bc8a470d49e7435d59307d178e7c48eb5f8ccf31687b7`

Reproduce and verify:

```bash
node tools/review/package.mjs --ref stage-3.1-audit-candidate --out audit-candidate.sums
node tools/review/package.mjs --ref stage-3.1-audit-candidate --verify audit-candidate.sums
```

The manifest hashes **canonical Git blob bytes**, not working-tree bytes, and is
sorted by byte order, so it reproduces identically on Linux, macOS, and Windows.

Note for anyone comparing against the older committed `SHA256SUMS.stage-*` files:
those were generated from a Windows working tree. Eight of their 61 entries cover
files that Git checks out with CRLF endings, so those hashes only reproduce on
Windows. They are kept as historical records. Use `tools/review/package.mjs` for
any hash a reviewer is expected to reproduce.

## Build and test reproduction

- Foundry `1.7.1`, solc `0.8.36+commit.8a079791`, EVM `cancun`
- Optimizer enabled, 200 runs, `via_ir = true`
- Dependencies: OpenZeppelin `v5.6.1`, forge-std `v1.16.1`, Uniswap v3-core
  `v1.0.0`, v3-periphery `v1.0.0`

```bash
forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.6.1
forge install --no-git foundry-rs/forge-std@v1.16.1
forge install --no-git uniswap-v3-core=Uniswap/v3-core@v1.0.0
forge install --no-git uniswap-v3-periphery=Uniswap/v3-periphery@v1.0.0
forge fmt --check
forge test -vv
bash tools/check-sizes.sh
```

Expect 75 passing tests and 2 skipped fork tests. The fork tests need a Robinhood
Chain RPC URL and `RUN_ROBINHOOD_FORK_TESTS=true`; ask the owner for an endpoint
rather than using one committed anywhere, because none is.

## Target network and dependencies

- Robinhood Chain, chain ID `4663`
- WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
- V3 Factory `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`
- NonfungiblePositionManager `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3`
- Pool fee `10000` (1%), tick spacing `200`, full range

## Economics the contracts must enforce

- Supply split: 0% creator at launch, 40% permanent liquidity, 60% GM escrow
- Three check-ins, one per day, 12-hour grace period, each releasing an equal
  share of the escrow
- On failure, 100% of remaining escrow goes to `DoomRewards`
- Creation fee 1% of native liquidity actually used, split 50/50 treasury and
  `DoomRewards`
- WETH LP fees while the creator is eligible: 70/15/15 creator/treasury/rewards
- WETH LP fees after default or a missed finalizable deadline: 0/15/85
- Launch-token LP fees: 100% to `DoomRewards`
- Canary caps: 3 launches, exactly 0.01 ETH each, 0.03 ETH aggregate
- The factory is deployed paused; resuming it is a separate owner decision

## Trust model and known accepted risks

State these back if you disagree with any of them.

1. The LP position is permanently locked. There is no release, decrease, or
   approve path, deliberately. Liquidity cannot be recovered, including by the
   owner, and including if a launch was a mistake.
2. `PositionLocker.bindRegistrar` and `V3LiquidityManager.bindFactory` are
   one-time and irreversible. A wrong binding is unrecoverable and requires
   redeploying the affected contracts.
3. LP fee collection is permissionless with immutable routing. Anyone may trigger
   collection; only the routing decides where value goes.
4. The campaign manager can commit any Merkle root and allocation to
   `DoomRewards`. Claimants are expected to verify roots independently; the
   excluded treasury holder can never claim regardless of the root.
5. The operator can pause and resume launches. The emergency guardian can pause
   but never resume.
6. GM deadlines are onchain-timestamp products and inherit normal miner/sequencer
   timestamp tolerance.
7. NFT total supply is currently zero, so early fee rewards accumulate in the
   vault awaiting a future holder snapshot.
8. The deployer is a dedicated Rabby hot wallet, a deliberate downgrade from a
   hardware wallet, funded only with the gas needed for one deployment.

## Prior work, and what it does not cover

- Unit, boundary, fuzz, invariant, reentrancy, permission, accounting, deadline,
  Merkle-claim, and locker postcondition tests: `docs/test-matrix.md`
- Slither `0.11.5` high-severity gate and Aderyn `0.6.8`, both green in CI, with
  triage rationale in `docs/static-analysis.md`
- Threat model: `docs/threat-model.md`
- Self-audit checklist and deployment blockers: `docs/audit-checklist.md`
- Architecture and specification: `docs/architecture.md`,
  `docs/doom-launchpad-spec.md`
- Deployment plan and stop conditions: `docs/stage-4-deployment-runbook.md`,
  `docs/stage-4-constructor-worksheet.md`
- Localhost six-transaction preview evidence:
  `docs/stage-4-localhost-preview-validation.md`
- Blockscout verification rehearsal: `docs/stage-4-blockscout-verification.md`

All of the above is first-party work. None of it is an independent review, and it
should be treated as claims to check rather than assurances.

## Questions we specifically want answered

1. Can any path move the locked LP position, reduce its liquidity, or approve a
   spender?
2. Can either one-time binding be front-run, griefed, or set to a contract that
   does not point back correctly?
3. Does allocation, fee, refund, and remainder accounting reconcile exactly at
   supply and liquidity boundaries, including rounding?
4. Can escrowed allocation be released early, double-released, or routed to both
   the creator and `DoomRewards`?
5. Can a creator who has defaulted, or whose deadline passed but was not
   finalized, still capture the creator fee share?
6. Can a malicious or non-standard token, pool, position manager, or reward
   recipient break launch atomicity or strand funds?
7. Are the Merkle leaf domain separation, exclusion, reservation, and recycling
   logic sound against replay across chains, vaults, and campaigns?
8. Does anything in the deployment sequence or constructor validation permit a
   partially wired system to look correctly configured?

## Deliverables

- Findings with severity, affected file and line, a concrete exploit path, and a
  suggested remediation.
- An explicit statement of what you did not review.
- A report we can publish, plus its SHA-256.

We will record reviewer identity, report URI, report SHA-256, and the reviewed
commit in `config/stage4-deployment-manifest.json`. Every critical and high
finding must be fixed and re-reviewed before deployment. Accepted lower-severity
findings will be published.

## What invalidates a completed review

Any change to a byte under `src/`, or to compiler settings, changes the contract
digest above and invalidates the review. The change must be re-frozen, and the
affected code re-reviewed by the same reviewer, before deployment continues.
Changes to tests, tooling, or documentation do not invalidate the review, but are
disclosed in the re-freeze.
