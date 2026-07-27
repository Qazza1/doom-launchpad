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
