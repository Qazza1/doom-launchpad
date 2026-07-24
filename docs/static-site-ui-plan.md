# Static-site launchpad UI plan

Status: Stage 3.4. No write transaction is enabled during Stage 3.1.

## Product hierarchy

The analytics dashboard remains the main product. The NFT game stays visibly
promoted because it funds the project and later provides access eligibility.
Launchpad pages should read like a serious terminal, with DoomStreak personality
limited to labels, empty states, and commitment moments.

## Launch page

The eventual creator form exposes only:

- token name;
- symbol;
- supply within 1 million–1 quadrillion;
- the fixed 0.01 ETH liquidity amount as read-only.

Before signing, show an exact simulation summary:

- 10% liquid creator allocation;
- 40% supplied to permanent liquidity;
- 50% held behind three daily GM check-ins;
- 3% creation fee and 50 / 50 fee routing;
- permanent 1% full-range V3 position;
- conditional LP-fee split;
- no token tax, admin, upgrade, liquidity withdrawal, or rescue.

The form must query the deployed factory constants and compare them to the UI's
expected configuration hash. Any mismatch disables the launch button.

## Public launch detail

Every launch has one shareable route, for example `/launch/:token`, showing:

- token/pool/position/escrow addresses with explorer links;
- creator address and creator-history link;
- total supply and exact allocation reconciliation;
- GM status, progress, next window, deadline, and default eligibility;
- permanent-position proof: known locker, exact position ID, NPM owner, fee tier,
  ticks, and last verification time;
- fee-routing status and cumulative creator/treasury/reward amounts;
- launch fee and liquidity actually used;
- indexed block, last indexed time, confirmations, and confidence.

“Liquidity permanent” requires both the registration event and a recent
`ownerOf` verification. “Default eligible” is distinct from “Defaulted.”

## Actions

- `Record GM` is visible only to the creator during a valid window.
- `Finalize default`, `Collect LP fees`, `Claim reward`, and `Recycle campaign`
  are permissionless and explain who receives value.
- Transaction actions always show chain, target contract, function, value, and
  expected post-state before requesting a wallet signature.
- Public read-only pages and direct-contract instructions remain available if
  wallet connection or the DoomStreak frontend fails.

## NFT-holder rewards

The claim page shows snapshot block, NFT collection, excluded holder, campaign
ID, root, token, total allocation, claim deadline, manifest link, and proof
verification result. Zero NFT supply leaves funds available in `DoomRewards`; it
never redirects them to the treasury.

Future NFT gating may cover advanced analytics and automation, but never safety
facts, contract addresses, commitment state, permanent-lock proof, freshness, or
claimability.

## Delivery order

1. Read-only launch details using mocked Stage 3.1 events.
2. Indexer-backed freshness, confirmation, reorg, and confidence states.
3. Direct-contract interaction guide.
4. GM/default/fee-collection actions on a fork or local chain.
5. Reward manifest and proof flow.
6. Write actions behind a deployment-manifest feature flag only after Stage 5.
