# Uniswap v4 on Robinhood Chain — the three verification gates

Answered 2026-08-02. These are the gates `docs/launchpad-v2-mechanics.md` requires
before any v4 work is estimated, let alone started.

**Outcome: all three pass, and none of them forces a decision now.** The owner's
call stands — factory #2 on v3, v4 evaluated again afterwards — and these answers
make that a deferral rather than a rejection.

## Gate 1 — does a v4 `PoolManager` exist on chain 4663, and at what address?

**Yes.** From the official Uniswap developer deployments page, and then verified
independently against the chain rather than trusted from a document:

| Contract | Address | Runtime bytecode on 4663 |
|---|---|---:|
| PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` | 24,009 bytes |
| PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` | 23,877 bytes |
| StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` | 3,531 bytes |
| Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` | 6,118 bytes |
| Universal Router | `0x8876789976decbfcbbbe364623c63652db8c0904` | 24,546 bytes |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 9,152 bytes |

Read with `eth_getCode` at `latest` on chain `0x1237`. Every address has code.
Re-verify immediately before any deployment work: this is evidence from one day,
and the project rule against guessing dependency addresses applies to a
six-month-old table just as much as to a guess.

## Gate 2 — is there volume, or is v4 deployed and empty?

**Live and genuinely busy — and still smaller than v3 on the same chain.**

Measured directly from the chain, counting `Swap` events in two non-overlapping
recent windows rather than reading a dashboard. v4 swaps are filtered to the
`PoolManager`; v3 swaps are filtered by event topic across all pool contracts.

| Window | Blocks | Seconds | v4 swaps / pools | v3 swaps / pools |
|---|---:|---:|---:|---:|
| A (head) | 2,000 | 200 | 987 / 108 | 4,960 / 289 |
| B (~1 h earlier) | 2,000 | 202 | 1,013 / 142 | 4,417 / 267 |

Consistent across both: **v4 carries roughly a fifth of v3's swap count and
about half as many active pools.** Extrapolated, that is on the order of 400,000
v4 swaps a day against 2,000,000 for v3, on a chain producing about ten blocks a
second.

New v4 pools in the last 40,000 blocks (about 70 minutes): **296 initialized, 88
of them with a hook attached** — roughly 30% hook adoption, which matches the
public claim that this chain has an unusually high hook share.

**The honest caveat:** swap *count* is not volume. This measures activity, not
notional value or pool depth, and a launchpad cares about depth. A real volume
comparison needs price data per pool and was not done. What the numbers do settle
is the question the gate actually asked: v4 here is not a ghost town, so the
"better venue with no traders" failure mode does not apply.

## Gate 3 — the licence

**v4-core is BUSL-1.1 until 2027-06-15, then MIT.** From the licence file itself:

- Licensor: Universal Navigation Inc.
- Licensed Work: Uniswap V4 Core
- Additional Use Grant: any uses listed at `v4-core-license-grants.uniswap.eth`
- Change Date: the earlier of **2027-06-15** or a date at
  `v4-core-license-date.uniswap.eth`
- Change License: MIT

**v4-periphery is GPL-2.0**, which is a separate consideration and arguably the
more relevant one, because hooks are usually built on periphery.

Two distinctions that decide whether this matters, neither of which is mine to
settle:

1. BUSL restricts production use of *the licensed work*. Deploying your own copy
   or fork of v4-core commercially is restricted; building a hook that talks to
   the **already-deployed** PoolManager is a different act. The common reading is
   that integrating with the deployed protocol is fine, but "common reading" is
   not a legal opinion.
2. GPL-2.0 is copyleft. A hook that inherits from periphery may itself have to be
   GPL-2.0. For a commercial launchpad that is a question to answer deliberately,
   before writing the contract rather than after.

Get a lawyer's view before committing engineering time. The cost of asking is a
fraction of the 4–10 week audit budget the same document already assumes, and the
answer may be "wait until June 2027", at which point the whole question dissolves
into MIT.

## What this changes

Nothing immediately, which is the useful result. v3 remains the venue for factory
#2 by the owner's decision of 2026-08-02, and these answers mean that decision
costs nothing that cannot be recovered later:

- v4 exists here and is used, so the option stays open.
- Its licence becomes MIT in under a year, removing the most awkward constraint
  from a commercial build.
- v3 currently carries most of the chain's swap activity, so choosing it is not
  choosing the quieter venue.

Re-run all three gates before v4 work actually starts. Gate 1 is a chain read,
gate 2 is the script pattern above, and gate 3 has a date on it.

## Sources

- [Uniswap v4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments)
- [v4-core BUSL licence](https://github.com/Uniswap/v4-core/blob/main/licenses/BUSL_LICENSE)
- [v4-periphery](https://github.com/Uniswap/v4-periphery)
- [Uniswap v4 licensing overview](https://support.uniswap.org/hc/en-us/articles/33829751588109-Uniswap-v4-licensing)
- [Uniswap is live on Robinhood Chain](https://blog.uniswap.org/robinhood-chain-is-live)
- Chain reads: `eth_getCode` and `eth_getLogs` against chain 4663, 2026-08-02.
