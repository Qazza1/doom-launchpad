# Audit Checklist and Mainnet Launch Blockers

## Contract review checklist

### General

- [ ] Independent line-by-line review of every contract and interface.
- [ ] Confirm exact compiler, optimizer, EVM version, OpenZeppelin tag, forge-std tag, and dependency commits.
- [ ] Reproducible build and bytecode verification.
- [ ] Slither, Semgrep, and at least one additional static analyzer run with reviewed findings.
- [ ] Unit, fuzz, invariant, gas, and fork tests passing in CI.
- [ ] No ignored compiler warnings.
- [ ] Custom-error and event coverage reviewed.
- [ ] NatSpec matches behavior.
- [ ] No upgrade/proxy/admin backdoor.
- [ ] All external calls analyzed for reentrancy, return behavior, and denial of service.

### DoomToken

- [ ] One constructor mint only.
- [ ] No inherited ownership/roles/pause/blacklist/tax hooks.
- [ ] Fixed 18 decimals approved.
- [ ] Metadata length and rendering risks reviewed.

### DoomLaunchFactory

- [ ] Allocation rounding and extreme supplies fuzzed.
- [ ] Fee/native-liquidity/refund accounting reconciles in all revert/success paths.
- [ ] Exact approval lifecycle verified.
- [ ] Malicious manager, malicious creator, rejecting refund receiver, and rejecting treasury tests.
- [ ] Lock post-condition cannot be spoofed by concrete manager.
- [ ] Supported fee/tick map matches verified deployment.
- [ ] Event size/indexing/gas cost acceptable.
- [ ] Factory runtime/initcode size remains below target-chain limits despite embedded child-contract creation code.
- [ ] Deployment constructor values independently checked by two reviewers.

### GmEscrow

- [ ] Boundary tests at `due - 1`, `due`, `deadline`, and `deadline + 1`.
- [ ] Multiple check-ins cannot be compressed.
- [ ] Schedule does not drift.
- [ ] Completion/default mutually exclusive.
- [ ] Permissionless default cannot redirect funds.
- [ ] Chain timestamp/sequencer behavior accepted.
- [ ] Smart-contract creator compatibility reviewed.

### PositionLocker

- [ ] Concrete NPM ownership reads and safe transfers verified on fork/testnet.
- [ ] No early release, rescue, admin, fee collect, approve, or arbitrary call path.
- [ ] Beneficiary/unlock cannot change after registration.
- [ ] Registration cannot be front-run or spoofed in concrete V3 flow.
- [ ] Permanent-lock behavior, if selected, is represented safely.
- [ ] Accidental NFT treatment documented.

### DoomRewards

- [ ] Available/reserved/claimed/swept accounting invariant.
- [ ] Merkle generator test vectors match Solidity leaf encoding.
- [ ] Duplicate, malformed, oversized, zero, and expired claims tested.
- [ ] Fee-on-transfer/rebasing token assumptions documented; launch tokens are standard.
- [ ] Campaign-manager scope cannot move arbitrary inventory.
- [ ] Immutable unclaimed recipient approved.
- [ ] Snapshot methodology and manifest publishing process reviewed.

### V3LiquidityManager

- [ ] **Not yet implemented.**
- [ ] All external addresses verified from official and explorer sources.
- [ ] Code hashes/versions pinned.
- [ ] Pool address and token ordering independently verified.
- [ ] Existing-pool behavior specified.
- [ ] Price initialization and tick math independently tested.
- [ ] Mint minimums, deadline, refund, native wrapping, and dust behavior specified.
- [ ] NFT recipient is locker in the mint/transfer flow.
- [ ] Position is registered and verifiably locked before returning.
- [ ] Router/Quoter usage minimized; unused dependency removed.
- [ ] Fork tests cover all supported fee tiers.

## Operational checklist

- [ ] Treasury and campaign manager are separate reviewed multisigs unless explicitly approved otherwise.
- [ ] Signer hardware/security and quorum documented.
- [ ] Testnet addresses published with checksums and configuration hash.
- [ ] Monitoring for defaults, failed deposits, LP owner changes, campaign roots, and fee withdrawals.
- [ ] Reorg-aware indexer rollback tested.
- [ ] Incident response and factory-version deprecation process documented.
- [ ] Frontend transaction simulation and chain/address guards reviewed.
- [ ] CSP, dependency pinning, XSS escaping, and supply-chain review completed.
- [ ] Legal/product copy review; no buyer-protection representation.

## Explicit mainnet launch blockers

Mainnet must not proceed until every item is closed:

1. Verified Robinhood Chain mainnet WETH, V3 Factory, NPM, SwapRouter, Quoter, supported fee tiers, tick spacing, deployment identity, and source commit.
2. Concrete `V3LiquidityManager` implemented, fork-tested, and audited.
3. All unresolved parameters in the specification approved and recorded in a signed deployment manifest.
4. At least two independent smart-contract security reviews, with one external audit and all critical/high findings remediated.
5. Extended public testnet period with real-world smart wallets, reorg handling, keeper behavior, claims, and lock verification.
6. Reproducible deployment rehearsal from clean hardware with bytecode/source verification.
7. Multisig addresses, signer policy, and community unclaimed-recipient policy approved.
8. Merkle snapshot/generation tooling audited and deterministic test vectors published.
9. Indexer additive consumer, API badges, and static UI pass security and failure-mode review.
10. Monitoring, alerting, incident response, version registry, and deprecation plan operational.
11. Economic/legal review of launch fees, creator commitments, reward campaigns, and jurisdictions completed.
12. Formal decision on LP lock duration, beneficiary, fee collection, unused mint assets, existing pools, and initial price controls.
13. Gas limits and event ingestion tested under expected Robinhood Chain block constraints.
14. No placeholder address, tokenomic value, role, URL, or chain ID remains anywhere in deployment inputs.
15. Final launch sign-off explicitly states that rewards are community incentives, not buyer protection.
