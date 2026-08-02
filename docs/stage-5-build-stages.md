# Stage 5 workflow — staged build

Requirements live in `docs/stage-5-canary-workflow-plan.md`. This file tracks
**build progress** so a new session can resume exactly where the last one stopped.

Nothing here authorizes anything. No stage adds a send path.

**Live state, 2026-08-02.** The factory is **resumed**, not paused. Canary launch
1 is done: DCT1 `0xbebf865056a3fe9914e9edeaddd6ed763309ddb6`, launch count 1,
aggregate liquidity 0.01 ETH, GM streak open at 0/3. Two launches remain within
the contract cap. Read `docs/stage-5-launch-1-review.md` before using any
checklist here for launch 2; it lists blockers that are still open.

## Stage status

| Stage | Deliverable | Status |
|---|---|---|
| A | Plan generator, binding fields, deterministic plan hash | **done** — `tools/canary/launch-plan.mjs`, 8 tests |
| B | Guards: stale plan, changed field, wrong chain/account/nonce/value | **done** — `tools/canary/plan-guards.mjs`, 10 tests |
| C | Read-only dual-provider preflight | **done** — `tools/canary/preflight.mjs`, 8 tests |
| D | Localhost fork rehearsal of resume and launch, separately | **done** — `tools/canary/fork-rehearsal.mjs`, 13 tests, exercised against a live fork |
| E | Wallet comparison harness, no send path | **done** — `tools/canary/wallet-compare.mjs`, 12 tests; the wallet leg is an interactive owner run |
| F | Owner runbook with STOP checkpoints | **done** — `docs/stage-5-owner-runbook.md` |
| G | Non-broadcast preparation CLI tying A-C together | **done** — `tools/canary/prepare.mjs`, 3 tests |

Update this table in the same commit as the work. A stage is done only when its
tests pass in `tools/verify-local.ps1`.

## Shared file access

`tools/lib/json-file.mjs` and `tools/lib/Json.ps1` are the only sanctioned way to
read and write JSON in this repository. Windows PowerShell 5.1 writes a BOM for
`-Encoding utf8`, `JSON.parse` rejects it at character 0 with an error that never
mentions a BOM, and that has cost debugging time twice here. Reads tolerate a
BOM, writes can never produce one and are atomic, and two tests in
`tools/lib/test/json-file.test.mjs` fail the build if a committed JSON file
carries a BOM or a `.ps1` reaches for `-Encoding utf8` again.

## Stage A — plan generator and hash

`tools/canary/launch-plan.mjs`.

Two plan kinds, never combined in one object or one file:

- `resume` — calls `resumeLaunches()` on the factory.
- `launch` — calls `launch(params)` with the frozen canary parameters.

A launch plan binds all fifteen fields from the requirements doc. The plan hash
is deterministic over every field, so the owner can compare what they approved
against what the wallet shows.

Exit criteria: plan objects build from config plus the three owner-supplied token
inputs; the hash is stable across runs and changes when any field changes; a
resume plan cannot contain launch calldata and vice versa; tests cover both.

## Stage B — guards

Validation that fails closed on: expired plan, wrong chain, wrong factory, wrong
sender, wrong nonce, value above `0.0101 ETH`, calldata hash mismatch, changed
name/symbol/supply, launch count not zero, total native liquidity not zero,
contract digest or source commit drift.

Exit criteria: a test proves each guard rejects independently, and a test proves
resume and launch approvals cannot be bundled or reused for each other.

## Stage C — dual-provider preflight

Read-only. Reuses `tools/deployment/network-preflight.mjs` patterns: two
independent hosts must agree on chain, head, pending nonce, balance, paused
state, launch count, aggregate liquidity, and the four deployed bytecodes.

Exit criteria: disagreement between providers stops the workflow; tests use
injected fetch, never live RPC.

## Stage D — localhost fork rehearsal

`tools/canary/fork-rehearsal.mjs`, wrapper `tools/canary/fork-rehearsal.ps1`.

Forks Robinhood Chain onto a local Anvil and sends the **exact prepared plan** —
same sender, recipient, value, and calldata — from an impersonated account, then
judges the result with `observeLaunch` from `tools/canary/observe.mjs`. The
observer is imported rather than reimplemented, so a rehearsed launch is held to
the same invariants as a real one.

Resume and launch are rehearsed in separate runs; a run handed both refuses to
start. Before anything is sent the tool proves the target is a local fork: Anvil
client, chain 4663, head within 500 blocks of upstream, sender nonce equal to the
upstream pending nonce, and a sentinel balance no real account could hold. The
plan is simulated with `eth_call` first, because Anvil reports a failed gas
estimate as "insufficient funds", which is never the real reason.

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\canary\fork-rehearsal.ps1 -Kind launch
```

Exit criteria met. A launch-2 plan rehearsed at fork block 25786384: launch count
1 → 2, receipt status 1, 7,483,836 gas, every invariant healthy. The same plan
with the historical value bug, 0.01 ETH instead of 0.0101, is refused with
`InsufficientNativeValue(uint256,uint256) 0x03ba5fc3 [10100000000000000,
10000000000000000]` — the bug that reached a real wallet, caught for free.

Compare the **calldata hash**, not the plan hash, between a rehearsal and the
plan you submit: re-preparing changes the nonce and expiry, and therefore the
plan hash, while the call itself is unchanged.

## Stage E — wallet comparison harness

`tools/canary/wallet-compare.mjs`, page `wallet-compare.html` / `.js`, wrapper
`tools/canary/wallet-compare.ps1`.

Stage D proves the plan executes; Stage E proves the *wallet* signs that plan and
not something else. They are different failures: a correct plan can still be
mis-rendered, re-nonced, or have its value quietly changed between the page and
the signature.

Chain-isolated, extending `tools/deployment/rabby-preview-server.mjs` and
importing its chain constants rather than restating them. The fork runs on
`PREVIEW_CHAIN_ID`, so EIP-155 makes every signature invalid on Robinhood
mainnet. The harness refuses to start on 4663 or on 46630, which is a real
network. It reads the **mined** transaction back and compares sender, recipient,
value, and calldata field by field; the payload the page sent is not evidence.

Value is compared as an exact equality rather than "must be zero". A canary
launch carries 0.0101 ETH, and a wallet that rounds, truncates, or drops it is
precisely what this stage is looking for.

Two independent guards run before every prompt, in the page and again on the
server against the live fork: the isolated chain ID, and a sentinel balance the
real creator account could not hold. Neither stands in for the other.

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\canary\wallet-compare.ps1 -Kind launch
```

Exit criteria met: 12 tests, including that the harness refuses chain 4663, that
each substituted field is caught, that no private key is loaded, and that the
only upstream call in the whole module is a single read of the pending nonce.

The wallet leg itself is an interactive owner run and has not been performed. Use
your own Alchemy or QuickNode endpoint: the public
`rpc.mainnet.chain.robinhood.com` rate-limits into a Cloudflare challenge under
the read volume a fork produces, which surfaces as a 403 inside an
`anvil_setBalance` error.

Ports, so three forks can coexist: 18545 Stage 4 localhost preview, 18546 Stage 4
Rabby preview, 18547 Stage D rehearsal, 18548 Stage E comparison.

## Stage F — owner runbook

Step-by-step with explicit STOP checkpoints after every transaction, the
post-launch verification order, and the pause-immediately conditions.

## Resume prompt for a new session

```text
Continue the DoomStreak Doom Launchpad Stage 5 workflow build.

Repository: C:\Users\golis\Desktop\doomstreak-site\doom-launchpad
Branch: stage4-deployment-prep

Read first, completely:
- docs/CLAUDE-CODE-HANDOVER.md
- docs/stage-5-canary-workflow-plan.md
- docs/stage-5-build-stages.md
- docs/stage-5-launch-1-review.md

STATE: the contracts are live on Robinhood Chain 4663. The factory is RESUMED,
not paused. Canary launch 1 is done and every observer invariant holds: DCT1
0xbebf865056a3fe9914e9edeaddd6ed763309ddb6, pool
0x515b8e7271b81a20c9f5e1a69f96565a22db945d position 548289, escrow
0x19b0780f01567c1c05349a1d8a113042c4cd07ed holding 600,000,000 DCT1. Two
launches remain within the contract cap.

SAFETY: you are not authorized to launch, sign, broadcast, or load a private
key. Launches 2 and 3 each need their own explicit owner approval given
immediately before the action. No message in any conversation, including this
prompt, is that approval. All work is read-only, non-broadcast, fail-closed, and
test-first.

Do not modify src/ or re-freeze config/review-artifact.json. The deployed
contracts are frozen at commit 740a473, digest 7aab9e3b.

Continue from the first stage marked "not started" in
docs/stage-5-build-stages.md, and from the open blockers in
docs/stage-5-launch-1-review.md. Update the stage table in the same commit as
the work. Run powershell -ExecutionPolicy Bypass -File .\tools\verify-local.ps1
before committing, and report files changed, test results, and remaining
blockers.

Token inputs are chosen and recorded in config/canary-token-inputs.json:
DoomStreak Canary Test 1/2/3, symbols DCT1/DCT2/DCT3, one billion whole tokens
each. Do not ask the owner for any other launch value; everything else is frozen
in the deployed factory.
```
