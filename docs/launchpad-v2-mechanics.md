# Launchpad v2 — differentiation mechanics

Captured 2026-07-28. Nothing here is committed to a release. This is the design
backlog for the second factory and the product layer around it.

## The strategic frame

Launchpads do not compete for creators. They compete for **buyers**. Creators go
where the buyers already are, which is why cheaper pump.fun clones did not
displace pump.fun. Every mechanic below is judged on whether it gives a buyer a
reason to prefer a token launched on these rails.

Two assets no competitor on Robinhood Chain can copy quickly:

1. A risk/analytics dataset covering every creator and launch on the chain.
2. A death-game brand that makes commitment mechanics feel native rather than
   bolted on.

The corollary, stated plainly: **factory #1 can only ever do three launches of
exactly 0.01 ETH.** The canary caps are contract constants and the constructor
enforces them. Public launching requires a second factory regardless, so v2 is
not optional work — it is the product.

## Where the first factory cannot compete

A creator's true cost here is `liquidity + fee + gas`, where the liquidity term
is **permanently unrecoverable**. Competitors using bonding curves cost roughly
gas. You cannot beat free while requiring creator capital, so v2 either removes
the capital requirement or accepts a narrower, higher-quality creator set.

## Ranked backlog

### 1. Holder insurance on default — flagship

Redirect a share of forfeited escrow to **holders of the dead token at the moment
of default**, pro rata, with the remainder continuing to the NFT reward vault.

Why it matters: it converts the existing escrow into the first memecoin launchpad
where abandonment compensates the people who got hurt. That is a buyer-side
sentence no competitor can say — *"if the dev walks, you get paid from his bag."*
Precedent: exchange SAFU funds and deposit insurance sell trust far better than
any timelock.

Open question, and it must be resolved before this ships: **self-dealing.** A
creator can buy their own token through the pool and then deliberately default to
collect a holder's share. The economics partly self-limit — they pay slippage on
the way in and are paid in a token that just crashed — but "partly" is not a
security argument. Needs a game-theory pass and explicit reviewer attention.

Layer: factory #2 contracts.

### 2. Creator reputation tiers — the uncopyable one

An on-chain **Doom Record** derived from the analytics dataset: streaks survived,
tokens still trading, fees generated, prior defaults.

- Higher tier earns better fee splits, featured placement, lower creation fee.
- First-time and previously-defaulted creators get visibly harsher terms.
- **Tiers decay.** A creator who abandons their last two coins drops. The badge
  must stay a live signal, not a medal.

The refinement that matters: the streak only proves three days. The tier should
track what happens *after* — still trading at day 30, fees still accruing, wallet
still active. That is the signal buyers actually want and the one competitors
cannot compute.

Retention effect: leaving for another launchpad means starting from zero.

Layer: indexer and frontend can ship first; contract-enforced tiered splits come
with factory #2.

The read-only indexer and frontend layer is implemented as Doom Record v1. Its
formula, evidence gates, decay, limitations, and enforcement boundary are frozen
in `docs/creator-reputation.md`. Contract-enforced fee tiers remain unbuilt.

### 3. Death Watch — ship first, needs no contract

Every live streak, its countdown, and its outcome, as a public feed plus Telegram
alerts. *"Creator has 2h 14m to check in or 600M tokens go to the vault."*

pump.fun's growth engine was the feed, not the curve. Polymarket turned
uncertainty into content. The GM mechanic already generates cliffhangers; nothing
currently broadcasts them.

This requires zero contract changes and can run alongside the canary, which makes
it both the cheapest and the earliest item here.

Optional escalation: a **Doom Pool** where people stake on survive/default, losing
side pays winners minus a rake. That is a prediction market with the regulatory
surface to match. The spectator layer alone captures most of the value at none of
the risk.

Layer: indexer, frontend, existing Telegram bot.

### 4. Holder streaks

Holders who check in daily on a token they hold split a bonus stream. Duolingo
streak psychology and Blur-style loyalty points, applied to holding rather than
trading. Gives the quiet hours between creator check-ins a pulse, and is a natural
bridge to the NFT game via streak multipliers for holders.

Layer: off-chain and indexer-signed first; on-chain only if it proves out.

### 5. Graduation starts the clock

When the bonding-curve phase exists, do not treat graduation as the finish line.
Everywhere else, graduation is where attention ends — the token lands on a DEX and
dies quietly. Here it should be where the **death clock starts**: curve fills, LP
locks permanently, GM pact begins, Death Watch picks it up.

*"Every launchpad graduates tokens into silence. We graduate them into a survival
arena."* No competitor with a single-act structure can say that.

Layer: factory #2 contracts plus product.

### 6. Hard mode

Let creators choose a longer commitment for better terms: 3 days standard, 7 days
for a better fee split, 30-day "Iron Doom" for the best split and a permanent
badge. Curve's veCRV proved people voluntarily lock longer for multipliers, and a
self-selected difficulty is a costly signal buyers can price.

Layer: factory #2 contracts.

## Also decided, and unresolved

**Free-to-launch requires a bonding curve.** Lowering the minimum does not fix the
cost problem; buyers funding the pool does. A curve phase that graduates into the
permanently-locked V3 position is the only route to being cheaper than the
competition while keeping the differentiators.

**Minimum viable pool depth.** Below roughly 0.05 ETH a pool is untradeable — a
0.005 ETH buy moves price ~9% at 0.05 ETH and ~33% at 0.01 ETH. Whatever the v2
minimum becomes, it has to clear that bar or the launch is theatre.

**Creators must be told their own downside.** With no allocation at launch and a
thin pool, a creator who dumps their released escrow into their own pool recovers
less than they put in. That is a feature — it means nobody profits without real
buyers — but it has to be shown before launch, or creators discover it afterwards
and conclude they were scammed.

**The creator's business is fees, not their bag.** With 0% at launch and 70% of
trading fees, a creator who dumps destroys the stream that was their actual
income. Saying that plainly reframes "my liquidity is locked forever" into "and it
pays me on every trade forever."

## Uniswap v4 as the factory #2 venue — evaluated 2026-08-01

Prompted by a competitor (Pons) announcing a v4 deployment. **No decision made.**
Factory #1 is deployed, immutable, and bound to v3 through constructor
immutables, so none of this affects the canary.

### What v4 changes

- **Singleton `PoolManager`.** Every pool is state inside one contract rather
  than its own deployment. Pool creation becomes a state write.
- **Hooks.** Contracts attached at pool creation that run at defined lifecycle
  points (`before/afterInitialize`, `…AddLiquidity`, `…RemoveLiquidity`,
  `…Swap`, `…Donate`). Enabled callbacks are encoded in the hook's *address*, so
  hook addresses must be mined with CREATE2 salts.
- **Flash accounting.** Balances net within a transaction via transient storage
  and settle once, instead of transferring at every step.
- **Native ETH.** No WETH wrapping.

### Why it is a genuine upgrade for this product

Today the two differentiators are enforced *around* the pool: permanence comes
from an ownerless locker with no release path, and the fee split comes from a
collector contract. Hooks make both properties **of the pool itself**:

- A `beforeRemoveLiquidity` that always reverts means liquidity provably cannot
  be removed by anyone. The claim shortens from *"we locked it"* to **"the pool
  does not implement removal"** — architectural rather than custodial, and not
  something a competitor can match by upgrading.
- `afterSwap` can route the fee split at pool level, removing the collector.
- Dynamic fees can enforce creator reputation tiers on-chain instead of in the
  backend.
- The bonding curve, graduation, and permanent lock could collapse into a single
  hook, rather than a curve contract plus a migration plus custody.

### Effort, at this project's standard of testing and evidence

Minimal port — same economics, v4 instead of v3:

| Work | Estimate |
|---|---|
| Learning spike: flash accounting, unlock/settle/take, hook callbacks | 3–5 days |
| Replace `V3LiquidityManager` with a `PoolManager` integration | 1–2 weeks |
| No-remove hook plus CREATE2 address mining | 1 week |
| Unit, fuzz, invariant and fork tests | 1–2 weeks |
| Adapt deployment tooling, observer, indexer, Death Watch | ~1 week |

**Total 4–8 weeks.** The full v2 vision — curve-as-hook with custom `beforeSwap`
accounting, holder insurance, reputation tiers — is **3–6 months**, because
custom swap accounting is the deep end of v4 rather than the shallow end.

### The audit is a hard cost, not an optional one

Hooks are new, subtly stateful, and a mistake can brick or drain a pool. Firms
with real v4 hook experience are few and book out. Budget **4–10 weeks of
calendar time** for booking, audit, remediation, and re-review, at a price
materially above a standard ERC-20 launchpad audit.

The independent-review waiver does **not** extend here. It was defensible for a
capped 0.03 ETH canary with bounded exposure. It is not defensible for a public
factory holding other people's liquidity permanently.

### Three verification gates before any work starts

**Answered 2026-08-02 — all three pass. Full evidence in
`docs/v4-venue-gates-2026-08-02.md`.** In short: the PoolManager is at
`0x8366a39cc670b4001a1121b8f6a443a643e40951` and every v4 address on chain 4663
was confirmed to hold code; v4 carries roughly a fifth of v3's swap count on the
same chain, so it is active rather than empty; and v4-core is BUSL-1.1 until
2027-06-15, after which it becomes MIT, with v4-periphery under copyleft GPL-2.0.

The owner nonetheless chose v3 for factory #2 on the same day
(`docs/owner-decisions-2026-08-02.md`), which these answers support: the option
stays open, and the licence question largely dissolves by mid-2027. Re-run all
three before v4 work actually begins — gate 1 is a chain read, gate 2 is a log
count, and gate 3 has a date on it.

The original gates, kept because they are the right questions to ask again:

1. **Does a v4 `PoolManager` exist on chain 4663, and at what address?** From
   Uniswap's official deployment list or the chain's own documentation — the same
   standard applied to the v3 addresses. Never guess. If v4 is not on the chain,
   the estimate is moot.
2. **Is there volume on v4 pools there, or is it deployed and empty?** A
   technically better venue with no traders is worse than v3 with traders.
3. **The licence.** v4 core shipped under BUSL-1.1 with a delayed transition to
   open licensing. Confirm the position for a commercial launchpad before
   building on it.

### Sequencing recommendation

Run the canary on what is already built and verified. Three launches cost 0.03
ETH and a few days, and they are the only way to learn whether creators will pay
to commit, whether buyers care, and whether three days is the right shape.

Then build factory #2 on v4 with those lessons. The build costs months whenever
it happens; it will be a better build afterwards.

"Newest" and "best" are not the same thing. No buyer has ever chosen a launchpad
because of its AMM version — they choose it for tokens they want and a venue they
trust. A competitor's v4 announcement is a technology signal, not a liquidity or
trust signal. The thing worth watching is whether their v4 pools attract volume,
because that is a market answer rather than a technical one.
