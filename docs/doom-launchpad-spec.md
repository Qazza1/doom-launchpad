# Doom Launchpad Specification

**Status:** test-first engineering specification; not deployed; not production-ready.  
**Scope:** new `doom-launchpad/` module only. Existing DoomStreak static website and OnchainDiligence services remain unchanged unless a later, reviewed integration patch is approved.  
**Chain target:** Robinhood Chain testnet only after verified dependency data is supplied.

## 1. Product intent

Doom Launchpad creates fixed-supply memecoins whose creators commit an explicit token allocation to a scheduled GM cadence. Successful completion releases that allocation to the creator. A missed commitment can be finalized permissionlessly after the grace period, transferring the allocation into `DoomRewards` for later Merkle campaigns benefiting eligible DoomStreak NFT holders.

Failed creator allocations are a **community incentive**. They are not buyer protection, insurance, compensation, a safety guarantee, or a promise of token value.

The launchpad complements the existing DoomStreak NFT game and OnchainDiligence analytics. Basic risk facts, commitment status, creator history, and LP lock facts must remain public. Future NFT gating may cover advanced analytics, alerts, saved workflows, or automation, but never safety-critical facts.

## 2. Non-goals

- No mainnet deployment or production-readiness claim.
- No use of real funds.
- No post-launch minting, token taxes, blacklists, pausability, arbitrary seizure, or hidden owner controls.
- No automatic holder iteration or airdrop loop.
- No buyer-protection language.
- No upgradeable proxy architecture.
- No unverified V3 deployment assumptions.
- No Next.js or React migration of the existing static site.
- No replacement of the existing indexer or scorer.

## 3. Launch lifecycle

1. Creator submits token metadata, fixed supply, allocation basis points, GM configuration, V3 price/range inputs, native liquidity amount, LP lock duration, and predetermined LP beneficiary.
2. Factory validates all inputs and the configured liquidity manager's network-validation status.
3. Factory deploys an ownerless `DoomToken` and mints the entire fixed supply once to itself.
4. Factory deploys one isolated `GmEscrow` for the launch.
5. Factory transfers the liquid creator allocation directly to the creator and the committed allocation to the escrow.
6. Factory approves exactly the liquidity token allocation to the configured liquidity manager.
7. Liquidity manager creates/initializes the verified V3-compatible pool, mints the position NFT, transfers it directly to `PositionLocker`, registers its immutable lock terms, and returns the pool and position ID.
8. Factory verifies that all liquidity tokens were consumed, that the returned pool contains code, then reads `PositionLocker` directly to match the pool, beneficiary, registration time, unlock time, release flag, current NFT ownership, and lock state.
9. Factory stores one launch record, accrues the launch fee, refunds any overpayment with a safe native call, and emits the canonical launch event set.
10. Creator records each GM only during its scheduled window. Scheduled times do not drift based on late check-ins.
11. Final successful GM releases the committed allocation to the creator.
12. If a deadline passes, anyone may finalize default. The escrow deposits the allocation into `DoomRewards`.
13. An immutable campaign-manager role may reserve deposited inventory into a Merkle campaign with a public deadline.
14. Anyone may relay a valid claim to the eligible account. Each account may claim once per campaign.
15. After the deadline, anyone may sweep unclaimed campaign inventory to the immutable community recipient configured at deployment.

## 4. Allocation/accounting rules

- Allocations are expressed in basis points and must sum exactly to 10,000:
  - `creatorLiquidBps`
  - `liquidityBps`
  - `gmEscrowBps`
- Each allocation must be non-zero in the current test implementation.
- Integer rounding remainder is assigned to GM escrow:
  - `creatorAmount = totalSupply * creatorLiquidBps / 10_000`
  - `liquidityAmount = totalSupply * liquidityBps / 10_000`
  - `escrowAmount = totalSupply - creatorAmount - liquidityAmount`
- `DoomToken.totalSupply()` must always equal `INITIAL_SUPPLY`.
- Factory token balance must be zero after a successful launch.
- A resolved escrow must have transferred exactly `committedAmount` either to the creator or to `DoomRewards`, never both.
- `DoomRewards.availableRewards[token] + reservedRewards[token]` must never exceed unclaimed inventory held for that token. Equality is expected for supported deposits unless tokens were sent directly without calling the deposit function.

## 5. GM schedule semantics

For check-in number `n`, where the first check-in is `n = 1`:

- `scheduledAt(n) = startTime + n * cadenceSeconds`
- The creator may record at `scheduledAt(n) <= now <= scheduledAt(n) + gracePeriodSeconds`.
- Recording before `scheduledAt(n)` fails.
- Recording after the deadline fails; default becomes finalizable only when `now > deadline`.
- The next schedule is based on `startTime`, not the prior transaction time.
- Completion and default are mutually exclusive terminal states.

The implementation currently requires `0 < gracePeriodSeconds < cadenceSeconds`; product approval is still required for the final bounds.

## 6. LP lock semantics

- The concrete V3 manager must mint the position NFT and transfer it directly to `PositionLocker` in the same transaction.
- The locker stores `pool`, `beneficiary`, `registeredAt`, and `unlockTime` per position.
- No owner, admin, treasury, rescue, collect-fees, or discretionary early-withdrawal function exists in the locker.
- Release is permissionless after `unlockTime` and always transfers to the predetermined beneficiary.
- The locker itself cannot be selected as beneficiary; a permanent-lock policy requires an explicit design rather than a misleading self-transfer.
- An accidental unrelated NFT sent to the locker cannot be extracted unless it was registered with valid future terms; this behavior must be called out in operations documentation.
- Whether positions should be permanently locked, time-locked to the creator, time-locked to a community vault, or managed by another predetermined beneficiary remains unresolved.

## 7. Reward campaign semantics

- Failed allocations are isolated from operating treasury funds.
- Anyone may deposit tokens into `DoomRewards`, but indexers must classify a deposit as a launch default only when its source equals the factory-emitted escrow for that launch.
- Only the immutable `campaignManager` may create campaigns.
- Campaign creation requires already-deposited inventory, a non-zero Merkle root, non-zero allocation, and a deadline at least `minimumClaimWindow` in the future.
- Leaf encoding is double-hashed OpenZeppelin-compatible encoding:
  - `keccak256(bytes.concat(keccak256(abi.encode(account, amount))))`
- Claims may be relayed, but rewards are always transferred to the leaf account.
- Each account can claim at most once per campaign.
- Unclaimed campaign funds go only to the immutable `unclaimedRecipient` after the deadline.

## 8. Fees and native-value handling

- Required launch payment is `launchFee + nativeLiquidityAmount`.
- Native liquidity is forwarded only to the configured liquidity manager.
- Launch fees accrue in the factory and are withdrawable only by the immutable treasury address.
- Treasury withdrawal uses low-level `call`, reverts on failure, and updates accounting before interaction.
- Overpayments are refunded to the creator with low-level `call`; failure reverts the entire launch.
- No Solidity `transfer()` is used.

## 9. Administrative powers and trust assumptions

| Component | Power | Intended holder | Constraints |
|---|---|---|---|
| DoomToken | None | None | Ownerless fixed supply |
| GmEscrow | None | None | Immutable launch configuration |
| PositionLocker | None | None | Permissionless release only after fixed unlock |
| DoomRewards | Create campaigns | Multisig campaign manager | Cannot withdraw arbitrary inventory; can only reserve available inventory into campaigns |
| DoomRewards | Receive unclaimed funds | Immutable community recipient | Selected at deployment; not mutable |
| DoomLaunchFactory | Withdraw accrued fees | Immutable treasury multisig | Recipient fixed to treasury; cannot change fee or dependencies |
| V3LiquidityManager | Concrete behavior unresolved | No deployment until verified | Must be non-upgradeable or separately justified and audited |

## 10. Exact unresolved product and network parameters

Every item below must be explicitly approved. Values shown in test fixtures are test-only and are not recommendations.

### Network/dependency decisions

1. Robinhood Chain testnet chain ID.
2. Robinhood Chain mainnet chain ID, for future planning only.
3. Verified wrapped native token/WETH address.
4. Verified V3 Factory address.
5. Verified NonfungiblePositionManager address.
6. Verified SwapRouter address.
7. Verified Quoter address and interface version.
8. Exact V3-compatible deployment/vendor/fork name and source repository/commit.
9. Factory init-code hash, if independently verifying pool derivation.
10. Supported fee tiers.
11. Tick spacing for every supported fee tier.
12. Whether the deployment supports the same pool initializer and position-manager ABI as canonical Uniswap V3.
13. Whether native wrapping is performed by the position manager, router, a separate WETH call, or the launchpad manager.
14. Whether the chain's native token is named ETH or another asset in user-facing copy.
15. Testnet RPC URL, explorer base URL, and finality/reorg assumptions.
16. Exact EVM hardfork target supported by Robinhood Chain testnet and mainnet.

### Token and launch economics

17. Minimum and maximum fixed total supply.
18. Allowed decimals; implementation currently fixes 18.
19. Minimum/maximum token name and symbol lengths; tests use 64/12 technical bounds.
20. Default and allowed range for creator liquid allocation.
21. Default and allowed range for liquidity allocation.
22. Default and allowed range for GM escrow allocation.
23. Whether any allocation may be zero.
24. Rounding policy approval; current remainder goes to escrow.
25. Testnet launch fee.
26. Future mainnet launch fee.
27. Whether the launch fee is fixed forever per factory deployment or a new factory is deployed for changes.
28. Minimum/maximum native liquidity amount.
29. Whether creator-provided ERC-20 quote assets other than wrapped native are ever supported.
30. Whether refunds must support an alternate recipient for smart-contract creators.

### GM commitment

31. Default required check-in count.
32. Minimum/maximum required check-in count.
33. Default cadence.
34. Minimum/maximum cadence.
35. Default grace period.
36. Minimum/maximum grace period.
37. Whether the first GM is due one cadence after launch or immediately.
38. Whether early check-ins before the scheduled time should ever be allowed.
39. Timestamp source tolerance and sequencer considerations for Robinhood Chain.
40. Whether creator identity can be a smart contract/multisig.
41. Whether delegated or signature-based GM submission is needed in a later phase.
42. Whether commitment completion should be callable separately after the final GM or remain automatic.

### Liquidity and LP lock

43. Initial price source and UX convention.
44. Allowed `sqrtPriceX96` bounds beyond non-zero.
45. Allowed tick-range presets and whether full-range liquidity is permitted.
46. Slippage protections for mint amounts.
47. Minimum token/native amounts passed to the position manager.
48. Mint deadline duration.
49. Minimum LP lock duration.
50. Maximum LP lock duration.
51. Whether locks are time-limited or permanent.
52. Predetermined LP beneficiary policy: creator, community vault, burn-style address, or another immutable recipient.
53. Treatment of LP trading fees while the NFT is locked.
54. Whether fee collection should be impossible until unlock or permissionlessly collectible to a fixed recipient.
55. Treatment of tokens/native returned as unused mint amounts.
56. Whether excess liquidity assets are refunded to creator or retained for a second mint attempt.
57. Whether pool existence before launch is allowed or must cause failure.
58. Whether launch price can be manipulated by a pre-existing pool.
59. Exact verification method for pool address and token ordering.

### Rewards

60. DoomStreak NFT contract address on the target chain or cross-chain eligibility method.
61. Snapshot block policy.
62. Eligibility rules: one reward per NFT, holder-weighted, streak-weighted, trait-weighted, or another formula.
63. Handling NFTs in escrow, lending wrappers, marketplaces, bridges, and smart wallets at snapshot.
64. Campaign manager multisig address and signer policy.
65. Minimum claim window.
66. Default claim deadline.
67. Immutable unclaimed-recipient address and governance policy.
68. Whether one failed launch maps to one campaign or may fund multiple campaigns.
69. Whether multiple failed launches may be aggregated.
70. Whether campaigns require an off-chain signed manifest in addition to the Merkle root.
71. Merkle tree sorting convention and generator implementation.
72. Claim front-end gas sponsorship/relayer policy.
73. Dust and rounding treatment in reward generation.

### Operations, analytics, and legal copy

74. Factory treasury multisig address and signer policy.
75. Emergency response policy given intentionally non-upgradeable contracts.
76. Whether new factory versions are registered in an on-chain registry.
77. Indexer confirmation depth and reorg rollback behavior for launchpad events.
78. Badge names, colors, and exact default/late-state wording.
79. Whether a missed-but-not-finalized commitment displays “late,” “default eligible,” or another state.
80. Explorer and token-detail URL formats.
81. Public API rate limits for launchpad endpoints.
82. Legal review of launch fee, creator commitment, reward eligibility, and user-facing risk statements.
83. Jurisdiction/geofencing requirements, if any.
84. Terms for token creators and prohibited token metadata/content.
85. Whether launchpad UI requires wallet screening or sanctions controls.

## 11. Safe placeholders

Configuration templates use explicit strings such as `<VERIFY_BEFORE_USE>` and zero/empty values that cause deployment or launch validation to fail. No Robinhood Chain address, fee tier, tokenomic percentage, treasury, campaign manager, or reward recipient is guessed.

## 12. Phased delivery

- **Phase 0 — specification and threat model:** complete in this module.
- **Phase 1 — isolated primitives:** token, escrow, rewards, locker, interfaces, mocks, unit/fuzz/invariant tests.
- **Phase 2 — verified V3 adapter:** blocked pending the required verified dependency package.
- **Phase 3 — testnet deployment rehearsal:** template only; no deployment performed.
- **Phase 4 — additive indexer and static-site integration:** plan and schemas only in this package.
- **Phase 5 — external audit/remediation:** mandatory before any mainnet decision.
