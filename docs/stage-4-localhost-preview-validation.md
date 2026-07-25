# Stage 4 localhost preview validation

Validation date: 2026-07-25. The exact six-transaction deployment sequence was
previewed against a temporary local Anvil fork of Robinhood Chain. No private
key, seed phrase, keystore, or wallet signer was loaded. No transaction was
signed, serialized for mainnet, or broadcast. No address was funded.

This document records the evidence for one specific gate only: the localhost
exact-sequence preview. It is not a funding plan, not an approval, and not a
live-wallet rehearsal.

## Reviewed artifact

- Source commit: `f2dee520ac1d5c16059f47bf80e8791bbe6bc66d`
- Commit subject: `feat: add exact localhost deployment preview`
- Branch: `stage4-deployment-prep`
- Procedure: [stage-4-localhost-preview.md](stage-4-localhost-preview.md)
- Feature CI: <https://github.com/Qazza1/doom-launchpad/actions/runs/30156968557>

Implementing files:

- `script/PreviewRobinhoodDeployment.s.sol`
- `test/PreviewRobinhoodDeploymentSafety.t.sol`
- `tools/deployment/localhost-preview.mjs`
- `tools/deployment/localhost-preview.ps1`
- `tools/deployment/test/localhost-preview.test.mjs`

## Safety boundary that was enforced

- Anvil was started on `127.0.0.1:18545` and forked Robinhood Chain read-only.
- The client identity and chain ID `4663` were confirmed before any state change.
- The real deployer's pending nonce was copied from upstream before local state
  was modified.
- The deployer received the distinctive local-only sentinel balance
  `123456789012345678901 wei` through `anvil_setBalance`.
- The Solidity preview requires that exact sentinel before `vm.startBroadcast`,
  so the script cannot execute against a chain that is not this local fork.
- Only the locally unlocked, impersonated deployer was used. Rabby was never
  connected and no key was loaded.
- Every write went to `http://127.0.0.1:18545`. Nothing was written upstream.
- Anvil was stopped afterwards.
- The generated report is secret-sanitized and Git-ignored at
  `tools/deployment/output/latest-report.json`. It contains no RPC URL and no
  signature.

`ONCHAIN EXECUTION COMPLETE` appears in Foundry output because the six
transactions execute on the temporary localhost chain. They were not sent to
Robinhood Chain.

## Committed-run snapshot

- Report generated: `2026-07-25T11:53:28.960Z`
- Report status: `localhost_preview_passed`
- Fork block: `18988889`
- Deployer: `0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F`
- Observed pending deployer nonce: `0`
- Observed deployer balance: `0.0005 ETH`

### Transaction evidence

| Nonce | Action | Predicted address | Gas used | Planned gas limit | Receipt |
|---:|---|---|---:|---:|:---:|
| 0 | Deploy DoomRewards | `0x615f6E6B0AEA7Ac94F4391424aF601F9290dd9dC` | 1,002,237 | 1,302,908 | success |
| 1 | Deploy PositionLocker | `0xdaE01c32131fF283f403b4C1fD71018Fa31cfAC0` | 1,664,106 | 2,163,337 | success |
| 2 | Deploy V3LiquidityManager | `0xbf36be8861ca4fe9920B10fc526E3fD039F88519` | 1,518,199 | 1,973,658 | success |
| 3 | `PositionLocker.bindRegistrar` | n/a | 49,335 | 68,143 | success |
| 4 | Deploy DoomLaunchFactory | `0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE` | 4,602,092 | 5,982,719 | success |
| 5 | `V3LiquidityManager.bindFactory` | n/a | 49,312 | 68,112 | success |

### Checks that passed

- Exactly six transactions in the dependency-safe order.
- Six sequential nonces starting from the observed pending nonce.
- Every transaction sent from the exact deployer address.
- Every local receipt succeeded.
- Every CREATE result equalled the independently predicted address.
- Deployed runtime code was present at each created address.
- The factory was paused after deployment.
- `PositionLocker` was bound to the manager and `V3LiquidityManager` was bound to
  the factory, each exactly once.

### Snapshot fee and funding figures

- Total gas used: `8,885,281`
- Total planned gas limit: `11,558,877`
- Observed gas price: `0.082332 gwei`
- Observed base fee: `82,184,000 wei`
- Observed priority fee: `0`
- Conservative max-fee ceiling: `0.164368 gwei`
- Maximum cost before buffer: `0.001899909494736 ETH`
- Snapshot requirement with the 25% buffer: `0.00237488686842 ETH`
- Snapshot shortfall at the observed balance: `0.00187488686842 ETH`

**These figures are evidence, not a funding instruction.** The report itself sets
`finalFundingMustBeRecalculated: true`. A change in deployer nonce, block, fee
market, or contract code invalidates both the predicted CREATE addresses and the
funding requirement. The dual-RPC preflight and this preview must be repeated
from the final reviewed commit before the owner is asked to approve funding.

## Supporting local validation at this checkpoint

- 14 Node deployment-tool tests passed.
- 71 Solidity tests passed; 2 opt-in fork tests skipped, 73 total.
- 8 rewards-tool tests passed.
- 13 keeper-tool tests passed.
- Runtime sizes within frozen budgets: `DoomLaunchFactory` 20,574 / 23,500;
  `V3LiquidityManager` 6,520 / 12,000; `PositionLocker` 7,268 / 12,000.
- Two safety tests prove the preview aborts before any broadcast when the chain
  is wrong or the local sentinel balance is absent.

## Manifest state recorded for this gate

`config/stage4-deployment-manifest.json` now distinguishes the two previews:

- `previews.localhostSequencePreviewComplete`: `true`, with the source commit,
  date, and a reference to this document.
- `previews.rabbyTransactionPreviewComplete`: `false`.

`verify-manifest.mjs` rejects a completed localhost preview that lacks a commit,
date, or evidence reference, and rejects any attempt to mark the live-wallet
preview complete. Every other fail-closed flag is unchanged: deployment remains
disabled, broadcast remains false, approvals remain unrecorded, and the nonce,
gas, transaction, deployed-address, and verification fields remain empty.

## Still blocking deployment

- Independent smart-contract review of the exact tagged artifact. Owner, Codex,
  and Claude reviews do not satisfy this gate.
- Remediation and focused re-review of any resulting contract change.
- Blockscout source-verification rehearsal.
- Six-transaction Rabby transaction preview against localhost only.
- Repeated dual-RPC preflight and repeated localhost preview from the final
  reviewed commit.
- Fresh nonce, base fee, priority fee, gas caps, predicted addresses, balance,
  and funding requirement, recorded only after that repeat run.
- Explicit owner funding and deployment approval immediately before any
  broadcast.
