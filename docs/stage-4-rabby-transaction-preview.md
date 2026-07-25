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
2. The deployer's balance must sit inside a window at the local-only sentinel
   balance `123456789012345678901 wei`, which only Anvil's `anvil_setBalance`
   produces: at most the sentinel, and at most 1 ETH below it.

Both are re-checked before every step, so switching networks mid-rehearsal stops
the run rather than silently sending somewhere else.

The second guard is a window rather than an equality because each confirmed step
spends gas. The window is still unforgeable in practice: the real deployer holds
a fraction of an ETH and the sentinel is over 123. The server also restores the
sentinel after each verified step, so the balance never drifts far.

## What the first run found

The harness was run against a real Rabby session before the gate was attempted.
It surfaced two defects in the harness itself, both now fixed and covered by
tests.

**An exact sentinel check cannot survive its own first step.** Step 1 confirmed,
which spent gas, and the balance was no longer exactly the sentinel. Every later
step, and any page reload, then failed with "this is not the preview fork" —
the guard reporting a wrong network when the network was correct. A guard that
fails closed is right; a guard that fails closed on the normal path is a bug,
because it teaches the operator to distrust it.

**Asking once for a receipt is a race.** Rabby returns the transaction hash as
soon as it submits, and the receipt can lag by milliseconds. The first attempt
happened to win the race and the second lost it, producing "no receipt was
returned" for a transaction that was perfectly healthy. The server now polls for
up to ten seconds.

A third problem was visible in that failure and fixed at the same time: after a
step failed verification, pressing the button again would have signed a *second*
transaction at an already-spent nonce, which could never confirm. A retry now
re-checks the hash that was already signed.

Observed gas for step 1 was `1,002,237`, matching the impersonated localhost
preview's figure for `DoomRewards` exactly.

## What the second run found

With those fixed, the on-chain check fired: *the wallet signed something other
than the plan: nonce does not match the plan*.

That was the check doing its job, but the cause is an artifact of rehearsing, not
a defect in the plan. Rabby caches a pending nonce per chain ID and address. The
first session consumed nonce 0 on the preview chain; the second session started a
brand-new fork whose on-chain nonce is 0 again, but Rabby still believed the
account was one ahead and signed at its own nonce. The transaction then sat in
the mempool behind a gap that could never be filled.

Two changes came out of it:

- The error now names both numbers. "Nonce does not match the plan" is useless in
  front of an irreversible sequence; "wallet used 2, plan expects 0" is
  actionable.
- Before any step is confirmed, a nonce-only difference realigns the preview:
  the fork's account nonce is set to the one the wallet used, the plan is rebuilt
  from it, and every predicted address is recalculated. The page reloads the new
  plan and says what happened. The report records the realignment and the
  original upstream nonce.

`isNonceOnlyDrift` is deliberately narrow. It realigns only when sender,
recipient, calldata, and zero value all match and the nonce alone moved forward,
and only before the first confirmed step. Any other difference, and any drift
after step 1, remains a hard failure. A wallet that rewrites calldata is a
finding; a wallet that remembers a stale nonce across two local forks is not.

None of this changes production. There the pending nonce is read from both
providers immediately before planning, and a nonce that disagrees with the plan
stops the sequence rather than realigning it.

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
- The **mined** transaction, read back with `eth_getTransactionByHash`, must be
  byte-identical to the plan: sender, recipient, calldata, nonce, and zero value.
  Checking the payload the page sent would only re-check our own object. Reading
  back what the wallet actually signed is what catches a substituted nonce or a
  rewritten field, which is the failure the runbook cares about.
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
