# Doom Launchpad canary specification

**Status:** Stage 3.1 audit-candidate rebuild; not deployed; not production-ready.
**Chain:** Robinhood Chain mainnet, chain ID 4663.
**Scope:** contracts and additive integration artifacts under `doom-launchpad/`.

## 1. Product and safety claims

Doom Launchpad creates ownerless fixed-supply ERC-20 tokens with creator-funded
Uniswap V3 liquidity. The liquidity position is held permanently by an ownerless
locker. The creator commits 50% of supply to three scheduled GM check-ins. A
missed commitment sends the escrowed allocation into an isolated NFT-holder
reward vault.

The commitment and lock are risk signals, not buyer protection, insurance, a
promise of liquidity value, or a guarantee against creator selling. Permanent
LP custody prevents direct position withdrawal; it does not prevent a holder
from selling tokens into the pool.

The system has no upgrade key, token owner, mint key, LP-withdrawal key, or
discretionary asset-rescue key. It does have narrowly scoped operational roles:

- operator: pause or resume new launches;
- emergency guardian: pause new launches only;
- treasury: withdraw accrued treasury creation fees;
- campaign manager: commit NFT reward campaign roots.

These roles cannot modify launched token supply, GM terms, permanent positions,
or existing reward claims.

## 2. Frozen canary configuration

| Parameter | Value |
| --- | --- |
| Creator liquid allocation | 10% |
| Permanent-liquidity allocation | 40% |
| GM escrow allocation | 50% |
| GM check-ins | 3 |
| GM cadence | 24 hours |
| GM grace period | 12 hours |
| Uniswap V3 fee tier | 1% (`10000`) |
| Tick spacing | `200` |
| Full-range ticks | `-887200` to `887200` |
| Creation fee | 1% of native liquidity actually used |
| Creation-fee treasury share | 50% |
| Creation-fee NFT-reward share | 50% |
| Eligible creator WETH LP-fee share | 60% |
| Treasury WETH LP-fee share | 20% |
| NFT-reward WETH LP-fee share | 20% normally; 80% after creator default eligibility |
| Launch-token LP fees | 100% DoomRewards |
| Supply bounds | 1 million to 1 quadrillion whole tokens |
| Native liquidity | exactly 0.01 ETH |
| Approved creators | one immutable canary creator |
| Launch cap | 3 |
| Global native-liquidity cap | 0.03 ETH |

The creation fee is paid on top of liquidity. The token has no transfer tax,
blacklist, post-launch minting, owner, or pause function.

## 3. Launch lifecycle

1. The immutable approved EOA submits name, symbol, total supply, and exactly
   0.01 ETH of requested liquidity plus the maximum 1% creation fee.
2. The paused factory, creator gate, launch caps, supply bounds, payment, and
   canonical dependency configuration are checked.
3. The factory deploys one fixed-supply `DoomToken` and one `GmEscrow`.
4. It transfers 10% to the creator and 50% into the escrow.
5. It approves 40% to the one-time-bound V3 liquidity manager.
6. The manager derives the canonical token order, creates/initializes the 1%
   pool, and mints a full-range position using at least 99.9999% of both assets.
7. The manager transfers the position NFT to the permanent locker and registers
   the launch metadata. Only the bound manager may register.
8. The factory verifies the permanent lock directly.
9. Bounded token dust goes to DoomRewards; bounded native dust returns to the
   factory and then the creator.
10. The 1% creation fee is calculated from native liquidity actually used and
    split equally between accrued treasury ETH and DoomRewards WETH.
11. The factory stores the exact initial price used by the manager and emits the
    canonical event set.

## 4. Permanent LP custody and fee routing

The permanent locker has no position release, decrease-liquidity, approval,
arbitrary call, rescue, or administrative withdrawal function. The verified
position manager remains the only external position dependency.

Anyone may call `collectFees(positionId)`. The call always requests the maximum
owed token0 and token1 amounts and initially receives both assets into the
locker. Routing uses measured balance deltas and leaves no newly collected
balance behind.

For WETH fees:

- while creator-eligible: 70% creator, 15% treasury, 15% DoomRewards;
- after creator default eligibility: 0% creator, 15% treasury, 85% DoomRewards.

The creator becomes ineligible when either:

- escrow status is `Defaulted`; or
- escrow status is still `Active` but `block.timestamp > nextDeadline()`.

The second rule prevents collection in the interval after an irrevocably missed
deadline but before `finalizeDefault()` is called. A completed commitment remains
creator-eligible. This is a three-day commitment, not an indefinite heartbeat.

All collected launch-token fees go to DoomRewards. WETH is not unwrapped; creator
and treasury payouts are ERC-20 WETH transfers. The permissionless caller receives
no bounty and cannot choose recipients, amounts, or splits.

## 5. GM commitment

For check-in ordinal `n`:

```text
due(n)      = startTime + n * cadence
deadline(n) = due(n) + grace
```

The creator may record only when `due <= now <= deadline`. Schedule time never
drifts. Each successful check-in releases an equal share of the escrow, and the
final one releases whatever remains, so nothing is stranded by integer division
and there is no single cliff. Once `now > deadline`, recording is impossible and
anyone may finalize default, depositing only the *unreleased* remainder into
DoomRewards. Check-ins already honoured are never clawed back.

Resolved escrows return zero for next-check-in views. `scheduleFor(n)` exposes
historical/future configured times, and `remainingCheckIns()` exposes progress.

## 6. DoomRewards campaigns

DoomRewards isolates:

- failed GM allocations;
- bounded V3 token remainder;
- the NFT-holder share of creation fees;
- WETH and launch-token LP-fee rewards.

The configured treasury NFT holder is excluded onchain. Zero NFT supply does not
move or discard rewards.

Campaign leaves are double-hashed and domain-separated:

```text
keccak256(
  bytes.concat(
    keccak256(
      abi.encode(
        chainId,
        doomRewardsAddress,
        campaignId,
        account,
        amount
      )
    )
  )
)
```

Claims may be relayed but always pay the leaf account. A campaign cannot be
cancelled. Incorrectly reserved inventory remains unavailable until the deadline,
after which anyone may recycle unclaimed inventory inside DoomRewards.

## 7. Deliberately stranded assets

There is no rescue authority. These assets may remain permanently stranded:

- unrelated NFTs sent directly to the permanent locker;
- ERC-20 donations to a GM escrow above its committed amount;
- ERC-20 transfers sent directly to DoomRewards without a deposit function;
- assets sent to contracts through unsupported mechanisms.

Operations and UI documentation must warn users not to transfer assets directly.

## 8. Direct interaction and liveness

Asset safety cannot depend on the DoomStreak website, indexer, or keeper.
Permissionless actions include:

- GM default finalization after a missed deadline;
- LP-fee collection;
- reward claims with valid proofs;
- expired reward recycling.

Delayed keepers affect freshness and fee collection timing, not ownership or the
permanent lock. Direct interaction instructions and verified ABIs must be public.

## 9. Mainnet gate

Deployment remains prohibited until:

1. all local, fuzz, invariant, and Robinhood fork tests pass;
2. static-analysis output is triaged;
3. a tagged audit-candidate commit and checksum bundle exist;
4. an independent reviewer audits that exact commit;
5. findings are remediated and re-reviewed;
6. production scripts and source verification rehearse successfully;
7. the owner gives explicit approval immediately before broadcast.

The detailed sequence is maintained in `docs/roadmap.md`.
