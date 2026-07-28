# Stage 3.2 validation

> Historical Stage 3.2 delivery evidence. Contract counts and sizes below refer
> to the superseded Stage 3.1 contract candidate; current contract evidence is
> tracked in `docs/independent-review-package.md`.

Validation date: 2026-07-24. No transaction was signed or broadcast.

## Local gates

- Foundry 1.7.1 and Solidity 0.8.36.
- 69 contract tests passed; 2 opt-in tests were skipped in the normal suite.
- 2 Robinhood read-only fork tests passed when explicitly enabled.
- 8 Node.js rewards-operations tests passed.
- OpenZeppelin Standard Merkle Tree fixed root:
  `0xd64f965899b8c4be141f803c1d1cddfaa112051290d0f63f460af5f33ebefa67`.
- `npm audit --audit-level=low`: zero known vulnerabilities.
- GitHub Actions rewards operations, Foundry, Slither, and Aderyn jobs passed:
  `https://github.com/Qazza1/doom-launchpad/actions/runs/30081737788`.
- Runtime sizes remain within the audit-candidate budgets:
  - `DoomLaunchFactory`: 20,574 bytes;
  - `V3LiquidityManager`: 6,520 bytes;
  - `PositionLocker`: 7,268 bytes.

## Supplied NFT read-only check

At Robinhood block 18,030,571:

- RPC chain ID: 4663;
- NFT: `0xB1b37dca046d0e70D9F5de673202D69c7DEF9be6`;
- bytecode hash:
  `0xa94465e9c7d45b1d8886eae4123fb9544e5ba797426427712e64e4796befbec5`;
- `totalSupply()`: 0.

This confirms the currently expected zero-mint state and that the collection
exposes the `totalSupply()` surface required by the snapshot collector. It is
not a campaign snapshot; a future campaign must use its own finalized block,
block hash, reconstructed ownership, and confirmation count.

## Open assurance gates

Independent contract review, signer preparation, source verification, exact gas
funding, production RPC/fallback inputs, and explicit deployment approval remain
required under Stage 4. Mainnet deployment remains disabled.
