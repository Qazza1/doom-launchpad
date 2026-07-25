# Stage 4 Rabby transaction preview

This rehearsal answers one question the impersonated localhost preview cannot:
**does Rabby, driven by the owner, render and sign the exact planned payloads
correctly?** The earlier preview proved the sequence executes; it used Anvil
impersonation and never touched the wallet.

Status: the harness is built and tested. It has not been run yet, so
`previews.rabbyTransactionPreviewComplete` remains `false` in the deployment
manifest and the roadmap gate stays open.

## The replay hazard, and how it is removed

Rabby holds the real deployer key. A rehearsal where Rabby signs is therefore a
rehearsal that produces real signatures.

Forking Robinhood Chain the obvious way keeps chain ID `4663`. A transaction
signed there is a **valid Robinhood mainnet transaction**. Worse, because the
fork copies the upstream pending nonce, those signatures would be valid at
exactly the nonce the deployer will really use. Anything that later recovered
those bytes — a log, a crash dump, a screenshot of a raw payload — could be
broadcast to mainnet without the owner ever approving it. The deployment runbook
already says not to retain a raw signed mainnet transaction; the safest way to
honour that is to never create one.

So the preview fork runs on chain ID **`46630`**, not `4663`. EIP-155 binds every
signature to the chain ID it was made on, so nothing produced during this
rehearsal is a valid mainnet transaction. That is a cryptographic guarantee, not
a procedural one, and it holds even if the raw bytes leak.

`assertIsolatedChain` refuses to start, and refuses each step, if the chain is
`4663`. The refusal is tested.

### What isolation costs

`V3LiquidityManager.isNetworkConfigurationValid()` compares `block.chainid` with
the production chain ID it stores, so on the preview chain it returns `false`.
That is expected and is recorded in the report rather than hidden.

Nothing else is lost. The constructor does not read `block.chainid`, so all six
transactions execute normally, and CREATE addresses depend only on sender and
nonce, so the predicted addresses are identical. The chain-4663 postconditions
are already covered by the impersonated localhost preview.

## Two independent guards before any prompt

1. The wallet must report chain `46630`.
2. The deployer must hold the local-only sentinel balance
   `123456789012345678901 wei`, which only Anvil's `anvil_setBalance` produces.

Both are re-checked before every step, so switching networks mid-rehearsal stops
the run rather than silently sending somewhere else.

## Run

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\deployment\rabby-preview.ps1
```

Paste the Alchemy Robinhood mainnet URL into the hidden prompt. The server forks
upstream state read-only, copies the deployer's pending nonce, builds the plan
from that nonce, and serves the page on `http://127.0.0.1:4179`.

In Rabby, add a network before connecting:

- Name: `Doom preview fork`
- RPC: `http://127.0.0.1:18546`
- Chain ID: `46630`

Then connect and send one step at a time. For each step, read the Rabby prompt
and confirm it matches the page: recipient, calldata size, and for steps 4 and 6
the single address argument. Those two are the irreversible bindings.

## What the server enforces

- Steps must be confirmed in order; the next button unlocks only after the
  previous receipt verifies.
- The submitted payload must be byte-identical to the plan: sender, recipient,
  calldata, nonce, and zero value.
- Each receipt must succeed, come from the deployer, and for a creation land at
  the predicted address.
- Getter selectors used for the final postcondition checks are read from the
  compiled artifacts, never hand-written, so a renamed getter fails loudly
  instead of reading the wrong slot.

The sanitized report is written to the Git-ignored
`tools/deployment/output/rabby-preview-report.json`. It records gas per step,
postconditions, and that the signatures are not valid on the production chain.
No raw signed transaction is stored.

## Which failures matter

The point of this rehearsal is what the owner sees, so treat these as findings:

- Rabby shows a recipient, value, or argument that differs from the page.
- A binding step does not clearly show the address being bound.
- Gas estimation fails or looks implausible for a step.
- Rabby silently substitutes its own nonce.
- Any prompt appears while the wallet is on the production network.

Record what happened, fix it, and re-run before the gate is marked complete.
Passing this rehearsal authorizes nothing: funding, approval, and broadcast
remain separate later decisions.
