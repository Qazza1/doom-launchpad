# Owner decisions, 2026-08-12

These decisions supersede conflicting proposals in earlier planning documents.
They authorize specification and implementation work, not a mainnet broadcast.
Every deployment and resume transaction still requires its own explicit approval.

## Public factory architecture

- Factory #2 uses a bonding curve with buying and selling before graduation.
- Graduation creates a full-range Uniswap V3 position using Robinhood Chain's
  canonical 1% fee tier.
- The V3 position is permanently locked and has no liquidity-decrease or release
  path.
- The net native graduation target is 0.05 ETH.
- Exact virtual reserves and rounding rules are not guessed here. They must be
  derived through economic simulation, specified, and covered by invariants.

## Beta cap and audit stop

- Creator access is allowlisted during the initial beta. Unrestricted public
  creation requires a later explicit decision.
- The public beta has a constructor-enforced maximum of 100 launches.
- New launches stop automatically after launch 100.
- An external smart-contract audit is deferred until after initial launch and is
  required before any replacement factory or resumption beyond the 100-launch
  cap.
- The cap limits exposure; it is not represented as a substitute for an audit.

## Approved beta economics

- Creator liquid allocation at launch: 0%.
- Curve and graduation allocation: 40%.
- Creator GM escrow: 60%.
- Three check-ins at 24-hour cadence with a 12-hour grace period.
- Honoured releases are not clawed back.
- Unreleased escrow after default routes to DoomRewards.
- Curve trading fee: 1%.
- Eligible trading-fee split: creator 70%, treasury 15%, DoomRewards 15%.
- Flat launch anti-spam fee: 0.001 ETH.
- The implementation must show all fees, slippage, graduation state and creator
  downside before signature.

## Roles

Existing role addresses remain unchanged:

- deployer/operator: `0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F`
- treasury: `0x9038C3AB7caE02a8aae730E705fdF7a15945eb7E`
- campaign manager: `0x4F81E3939232815e3C98B124A17BaC75304C82D8`
- emergency guardian: `0x3EeF0a7Ee9420a1035a4541582B384bc4405A439`

## Public policy inputs

- Support contact: `support@doomstreak.xyz`.
- Official social account: `https://x.com/DoomStreak_xyz`.
- Illegal, hateful, impersonating, infringing and otherwise abusive token content
  is prohibited and may be refused, hidden or delisted from DoomStreak.
- IPFS permanence and the limits of interface moderation must be disclosed before
  upload.

## Still unresolved before public launch

- Final constant-product virtual reserves and price path.
- Exact rounding, dust, graduation and failed-graduation behavior.
- Curve inventory accounting that reconciles buyer balances, the remaining V3
  token side and the 40% allocation at every point.
- Upload bot protection and public-wallet rate limits.
- Operator legal identity, governing law, target jurisdictions and professional
  legal review.
- Final tagged review candidate, mainnet fork evidence, deployment funding and
  explicit broadcast approval.
