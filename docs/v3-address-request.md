# Required Verified Robinhood Chain V3 Dependency Package

> Archived request. The canonical Robinhood mainnet dependencies were supplied
> and validated during the preserved Stage 3 work. Fresh verification is still
> required before the Stage 3.1 audit tag and any deployment.

Before any concrete V3 integration is written, provide all items below for the exact **testnet** deployment intended for Doom Launchpad:

1. Wrapped native token / WETH address.
2. Uniswap V3-compatible Factory address.
3. NonfungiblePositionManager address.
4. SwapRouter address.
5. Quoter address and whether it is Quoter or QuoterV2 compatible.
6. Supported fee tiers and tick spacing for each tier.
7. Exact deployment name/vendor/fork.
8. Official documentation URL.
9. Verified explorer links for every contract.
10. Source repository and exact commit/tag used to deploy.
11. Chain ID and RPC/explorer details.
12. Factory pool init-code hash, when available.
13. Confirmation of native wrapping/refund behavior in the position manager/router.
14. Any ABI differences from canonical Uniswap V3.
15. A known testnet pool and position ID that can be used as read-only compatibility fixtures.

The same package will later be required separately for mainnet. Testnet addresses must never be silently reused for mainnet.
