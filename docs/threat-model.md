# Threat model and trust boundaries

Assessment status: Stage 3.1 audit candidate, not production-ready.

## Assets

- Fixed token supply and 10 / 40 / 50 allocation integrity.
- Creator GM escrow and its terminal outcome.
- Creator-provided native liquidity and permanent V3 position.
- Accrued LP fees and deterministic recipient splits.
- Creation fees and NFT-holder reward inventory.
- Merkle campaign roots, reservations, claims, and recycled inventory.
- Canonical launch state consumed by the indexer and UI.

## Roles

- Approved creator EOA: can submit at most three canary launches and record GMs.
- Operator/deployer: can pause or resume future launches and bind dependencies
  once during deployment.
- Emergency guardian: can pause future launches but cannot resume.
- Treasury: receives its immutable shares and can withdraw accrued creation fees.
- Campaign manager: can reserve rewards behind a root and deadline.
- Permissionless keeper/relayer: can finalize defaults, collect LP fees, submit
  claims, and recycle expired campaign inventory.

None of these roles can mint token supply, change a launched escrow, withdraw
liquidity, change LP-fee percentages, rescue arbitrary assets, or upgrade code.

## Primary threats and controls

| Threat | Impact | Control | Remaining assurance |
|---|---|---|---|
| Hidden mint/tax/admin | Dilution or confiscation | Constructor-only standard ERC-20; no owner | Audit source and deployed bytecode |
| Allocation arithmetic error | Supply loss | Fixed BPS, explicit bounds, reconciliation fuzz | Independent review |
| Early or duplicate escrow resolution | Creator/community theft | Scheduled windows, terminal status, CEI, reentrancy guard | Timestamp behavior and keeper monitoring |
| Missed deadline not finalized | Creator improperly keeps LP share | Locker treats an overdue active escrow as ineligible | Boundary tests and UI wording |
| Fake V3 dependency or position | Asset loss / false lock badge | Constructor wiring, one-time bindings, canonical position metadata and ownership checks | Live code hashes and fork rehearsal |
| LP withdrawal | Rug pull | Permanent locker has no release/decrease/approve/call path | Bytecode review and owner reads |
| Accidental position transfer | Stranded NFT | Only bound registrar can register; no rescue by design | Prominent operations warning |
| Fee theft by collector | Lost revenue | Permissionless call has no caller share or recipient inputs | Fee delta and recipient tests |
| Creator dumps launch-token fees | Sell pressure | 100% of launch-token LP fees go to rewards | Reward campaign policy |
| Stale escrow status/call failure | Wrong creator fee share | Fail-closed eligibility; creator gets zero on errors | Monitoring |
| Merkle proof replay | Cross-campaign claim | Leaf includes chain, vault, campaign, account, amount | Round-trip generator tests |
| Wrong campaign root | Inventory unavailable until expiry | No cancellation or withdrawal; permissionless recycle | Two-person root verification runbook |
| Direct unsupported token donations | Stranded/unaccounted tokens | Deposits use balance deltas; no rescue | Documented permanent-loss behavior |
| Reentrancy or rejecting recipient | Duplicate accounting / denial | Reentrancy guards, CEI, exact approvals, atomic reverts | Static analysis and malicious mocks |
| Compromised UI/RPC | Bad transaction or false badge | Contract-side constants, public reads, confirmation/freshness indicators | Direct-interaction docs and reorg-aware indexer |
| Operator/guardian compromise | Availability loss | Roles affect only new-launch pause state; guardian cannot resume | Hardware keys and monitoring |
| Campaign-manager compromise | Unfair reward root | Cannot withdraw; public manifest and independent verification | Multisig/hardware signing before Stage 5 |

## Invariants

1. Token total supply never changes.
2. Creator, liquidity, and escrow allocations reconcile exactly.
3. The factory and manager retain no launch-token or wrapped-native residue after
   a successful launch.
4. Each escrow resolves once, never both completed and defaulted.
5. Default cannot succeed until strictly after the current deadline.
6. Every registered position remains owned by the permanent locker.
7. Only the bound manager can register positions.
8. LP fee collection cannot decrease liquidity or transfer the position.
9. Eligible WETH fees reconcile to 60 / 20 / 20; ineligible fees reconcile to
   0 / 20 / 80; launch-token fees reconcile 100% to rewards.
10. Claimed plus remaining campaign allocation never exceeds its reservation.
11. A campaign claim cannot be replayed for another chain, vault, campaign, or
    account.
12. Creation-fee liabilities never exceed retained native balance.

## Permanent-stranding assumptions

No rescue path is intentional. Direct token donations to `DoomRewards` bypass
accounting; excess or post-resolution transfers to `GmEscrow` remain there; an
unregistered NFT sent to `PositionLocker` remains there. Operators must never
use these addresses as generic recipients.

## External assumptions

- Robinhood Chain supports Cancun bytecode and usable timestamp semantics.
- The documented WETH, V3 Factory, and NPM implementations are canonical.
- WETH and launched tokens behave as standard balance-preserving ERC-20s.
- Production role addresses and the excluded NFT holder are entered correctly.
- The root generator uses the exact onchain leaf and deterministic tree rules.
- The indexer stores raw logs and handles confirmation/reorg rollback.
