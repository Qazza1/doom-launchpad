# Stage 4 locked Rabby mainnet executor

This tool submits the six owner-approved deployment transactions through Rabby
one at a time. It is not an automatic deployment script. Each invocation exposes
exactly one numbered transaction and refuses to expose the next one until the
previous receipt is independently verified.

It never loads a private key, never stores a raw signed transaction, and has no
factory-resume or token-launch path.

## Preconditions

- `tools/deployment/output/funding/transaction-plan.json` is the exact plan the
  owner approved.
- `tools/deployment/output/funding/owner-approval.json` records the matching
  plan digest, funding limit, successful funding receipt, paused-factory rule,
  and explicit absence of resume/launch authorization.
- The frozen contract-bearing paths have not changed since the approved plan.
- Both independent RPC providers agree on chain ID, head, pending nonce,
  deployer balance, and dependency bytecode.
- The deployer balance covers the live, 25%-buffered gas requirement for the
  selected transaction and every remaining transaction.

## Run one step

The operator uses one-based step numbers:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\deployment\rabby-mainnet.ps1 -Step 1
```

The wrapper requires an exact typed confirmation, then reads both RPC URLs
through hidden prompts. It starts a localhost-only page at
`http://127.0.0.1:4181`.

On the page:

1. Read the full plan digest, sender, recipient, nonce, zero value, predicted
   address, and calldata digest.
2. Type the exact step-specific confirmation displayed by the page.
3. Connect only Rabby account
   `0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F` on Robinhood Mainnet chain
   `4663`.
4. Read the Rabby prompt and confirm zero value and the planned nonce.
5. Submit once. If a transaction hash exists, never click or sign again.
6. Wait for `VERIFIED SUCCESS`, then stop the server with `Ctrl+C` and return
   to the runbook before starting the next step.

## Verification performed after each receipt

- The mined transaction is read independently through both RPC providers.
- Sender, recipient, calldata, nonce, and zero value must be byte-identical to
  the approved plan.
- Both receipts must succeed and agree on transaction hash, block hash,
  recipient, and created address.
- Contract creations must land at the predicted address.
- Runtime bytecode must match the frozen compiled artifact after masking only
  compiler-declared immutable ranges, and both providers must return identical
  code.
- `bindRegistrar` and `bindFactory` must return the exact newly bound address
  through their on-chain getters on both providers.
- A sanitized receipt is appended to the Git-ignored
  `tools/deployment/output/mainnet-receipts.json`.

## Hard stop rules

- Never run two step servers at once.
- Never start step `N+1` until step `N` is in the verified receipt ledger.
- Never retry after Rabby returns a transaction hash. Investigate that hash.
- Stop on any provider disagreement, nonce drift, insufficient live gas
  coverage, bytecode mismatch, failed receipt, wrong address, or binding
  mismatch.
- Completing step 6 still does not authorize factory resume or a launch.
