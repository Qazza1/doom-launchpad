# Stage 4 funding refresh

The last piece of Stage 4 machinery. It answers one question with live data:
**exactly how much gas money does the deployer need, right now, for this exact
commit?**

It funds nothing. It writes a proposal for the owner to approve or reject.

## Why this cannot be done in advance

Every input moves. The pending nonce changes if the deployer sends anything. The
base fee changes every block. The balance changes when anything arrives. And the
predicted contract addresses are derived from the nonce, so a nonce that moved
invalidates the addresses as well as the funding number.

The committed evidence from the `f2dee52` localhost preview is a snapshot, not a
funding instruction, and says so. This tool exists so that the number used for
the real transfer is minutes old rather than days old.

## Run

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\deployment\funding-refresh.ps1
```

Both provider URLs are read through hidden prompts, held in the environment for
the duration, and never printed or written to disk.

Run the localhost preview from the current commit first. The refresh refuses to
proceed without a matching one.

## What it refuses to do

The tool stops, rather than producing a number, when:

- either RPC URL is missing, not HTTPS, or shares a host with the other;
- the providers disagree on chain ID, head, pending nonce, deployer balance, or
  dependency bytecode;
- the working tree is dirty, so the funded code would not be a committed tree;
- there is no passing localhost preview report;
- the preview was produced from a different commit than `HEAD`;
- the preview ran at a different nonce than the deployer's current pending nonce;
- the transaction planner and the preview disagree on any predicted address;
- the arithmetic in the resulting proposal does not reconcile.

The commit and nonce checks are the important ones. Gas figures belong to the
code that produced them, and predicted addresses belong to the nonce that
produced them. Funding from a preview of different code, or a different nonce, is
how a deployment strands halfway or lands at addresses nobody predicted.

## How the number is built

- **Gas**: the sum of the conservative per-transaction gas limits from the
  localhost preview of this commit, not the gas actually used.
- **Fee ceiling**: `max(gasPrice, 2 x baseFee + maxPriorityFee)`, computed for
  each provider separately, then the **higher** of the two is taken. Funding from
  the cheaper provider's view is exactly what strands a half-deployed system.
- **Buffer**: the frozen 25%.

The required balance is `gas x ceiling x 1.25`, rounded up.

## What it writes

All three files go to the Git-ignored `tools/deployment/output/funding/`:

- `funding-worksheet.json` — the observed state, both providers' fee readings,
  the chosen ceiling, predicted addresses, required balance, and the shortfall.
- `stage4-deployment-manifest.proposal.json` — a copy of the canonical manifest
  with `noncePlan` and `gasPlan` filled in.
- `transaction-plan.json` — the exact six value-free, unsigned transactions for
  Rabby review, including nonces, predicted addresses, constructor arguments,
  calldata, and calldata digests.

**The canonical `config/stage4-deployment-manifest.json` is never modified.** The
runbook requires populating a copy and leaving the fail-closed template alone, so
the repository's committed manifest stays empty and CI keeps checking that it is.

## What a proposal may never contain

`validateFundingProposal` rejects a proposal that carries deployment approval,
owner approval, a broadcast flag, any verification claim, any independent-review
field, or any deployed transaction. It also rejects any broadening of the
recorded owner exception beyond non-broadcast preparation for the capped
three-launch canary. The validator requires the six nonces to be sequential from
the observed pending nonce and re-derives the funding arithmetic rather than
trusting what is written.

A funding worksheet is allowed to know two new things: the current nonce and the
current gas cost. Nothing else.

## Freshness

The worksheet records `observedAt` and is valid for 900 seconds. It is not a
document to keep. If the nonce, block, fees, balance, or commit move, regenerate
it. Re-confirm the pending nonce through both providers immediately before the
transfer regardless of how recent the worksheet looks.

## What happens after

Nothing automatic. The owner reads the worksheet and separately decides whether
to fund the deployer after every applicable review requirement has passed or a
narrow exception has been explicitly recorded. Funding is a transfer the owner
makes; no tool in this repository moves value.
