# Stage 1: local validation and frozen decisions

> Historical record for the preserved `stage-3-baseline`. Economics and LP
> policy were superseded by the Stage 3.1 specification and roadmap.

Status: complete for local validation. Mainnet deployment is disabled.

## What was verified

- The NFT collection is a deployed ERC-721 contract on Robinhood Chain mainnet.
- The deployer, treasury, campaign-manager, and emergency-guardian addresses are externally owned accounts at the validation block.
- The NFT contract reports name `DoomStreak Astronauts`, symbol `DOOM`, and total supply `0` at the validation block.
- Robinhood Chain mainnet accepts the Cancun `MCOPY` opcode required by OpenZeppelin Contracts 5.6.1.
- Solidity 0.8.36 with Cancun EVM output compiles the current contracts.
- All 50 local tests pass after updating the stale Foundry test-helper behavior.
- The fuzz tests complete 512 runs each, and the two stateful invariants complete 128 runs with 8,192 calls each.

## Approved product configuration

The machine-readable source of truth is `config/robinhood-mainnet-canary.decisions.json`.

- Supply allocation: 10% creator, 40% liquidity, 50% GM escrow.
- GM commitment: three daily check-ins with a 12-hour grace period.
- Failed GM: the entire 50% escrow goes to DoomRewards.
- Creation fee: 10% on top of creator-provided native liquidity.
- Fee split: 50% native asset to treasury and 50% wrapped native asset to DoomRewards for NFT holders.
- Unclaimed NFT rewards: recycled inside DoomRewards.
- LP position: locked for 365 days, then releasable to the creator.
- Mainnet pilot: approved creator only; at most three launches, 0.01 native asset per launch, and 0.03 globally.

## NFT supply confirmation

The owner confirmed that the NFT contract's zero total supply is expected because minting has not started. The rewards implementation must retain and recycle rewards safely while eligible supply is zero, without dividing by zero, losing funds, or allowing a treasury-held NFT to participate.

## Safety gate

The existing contracts do not yet implement the approved economics. In particular, the current factory uses a fixed fee and user-supplied allocations; the current reward flow is a generic Merkle campaign; and no production Uniswap V3 adapter exists. Do not deploy this revision.

Stage 2 must implement those decisions and add emergency controls without making the token, escrow outcome, or LP beneficiary mutable after launch.
