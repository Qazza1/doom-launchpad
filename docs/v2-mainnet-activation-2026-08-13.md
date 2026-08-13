# V2 mainnet factory activation — 2026-08-13

The owner authorized exactly one zero-value `resumeLaunches()` call on
Robinhood Chain mainnet. The transaction was submitted through a localhost-only
Rabby gate and verified through both configured RPC providers.

- Factory: `0x142760D2C865537c063492933FB71ddefA2372C6`
- Transaction: `0xa8866c1345cd4650bd789f185a446d3e1b2257b41e28e3d140c1cadb77af7907`
- Nonce: `17`
- Authorized gas limit: `50000`
- Gas used: `23446`
- Block: `35712838`
- Receipt status: success
- Post-state: factory active, launch count zero, operator pending nonce `18`

The authorization did not cover a token launch, ETH transfer, deployment,
approval or any other contract call. The one-use localhost signing gate was
stopped after receipt verification.

Operational activation is not complete until the Railway keeper uses
`config/keeper-v2-live.mainnet.json`, the V2 indexer is fresh with high
confidence, and the website transaction flag is separately approved and
enabled. A first token launch remains separately gated.
