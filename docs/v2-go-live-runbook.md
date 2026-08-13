# V2 production go-live runbook

## Current posture

The four V2 contracts are deployed on Robinhood Chain mainnet and their runtime
bytecode and irreversible bindings were verified through two providers. The
factory at `0x142760D2C865537c063492933FB71ddefA2372C6` is intentionally paused,
has zero launches and allows only
`0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F` as the initial creator.

No step below inherits the authorization for any other step. A code push,
hosting deployment, explorer verification, factory resume and first token
launch are separate actions.

## Phase 1 — publish while inert

1. Push the reviewed website, contract/keeper and indexer commits.
2. Deploy the website with `V2_LAUNCH_TRANSACTIONS_ENABLED=false` (or absent).
   Keep the existing server-only `FILEBASE_RPC_TOKEN`,
   `TURNSTILE_SECRET_KEY` and `IPFS_UPLOAD_WALLETS` values installed.
3. Deploy the indexer with `DOOM_V2_ENABLED=1`. Set a dedicated
   `DOOM_V2_RPC_URL` when available; otherwise it deliberately falls back to
   the existing launchpad or fallback RPC. Keep `INDEX_SWAPS=0` and
   `CHECK_SELLABLE=0` during the free-tier beta unless the extra RPC usage is
   explicitly wanted.
4. Deploy the keeper with its persistent volume mounted at `/data` and
   `KEEPER_CONFIG_PATH=config/keeper-v2.mainnet.json`. This policy expects the
   factory to remain paused.
5. Confirm the public endpoints:
   - website `/api/launch/config` reports `transactionsEnabled: false`;
   - indexer `/launchpad/v2/health` reports chain 4663, the exact V2 factory,
     valid configuration, paused factory, zero launches and a current cursor;
   - keeper `/health` reports successful checks with no active critical alert;
   - artwork and metadata uploads work only for the approved creator wallet.

## Phase 2 — source verification

Run `node tools/v2/verification-bundle.mjs`. It regenerates four exact
standard-input files and proves that each compiled creation payload matches the
frozen deployed transaction plan. It never contacts Blockscout.

The deployed compiler metadata contains unused absolute local remappings. Exact
public verification can therefore expose a local build-path username in the
submitted compiler settings. The bundle contains no RPC URL, API key, private
key or Telegram credential, but owner approval is still required before public
submission. After approval, submit the four contracts separately and confirm
that Blockscout marks each one verified before activation.

Completed 2026-08-13 with privacy-sanitized relative remappings. Blockscout
marks all four contracts verified and partially verified; none is claimed as a
full metadata match. Evidence: `docs/v2-blockscout-verification-2026-08-13.md`.

## Phase 3 — activation (separate authorization)

Before asking for authorization, confirm through two independent RPC providers:

- chain ID 4663 and matching current heads;
- exact factory runtime bytecode and valid configuration;
- factory paused, launch count zero and approved creator still allowed;
- V2 indexer healthy and caught up;
- keeper healthy under the paused policy;
- operator pending nonce and sufficient gas balance.

The only activation call is the zero-value factory call in
`config/v2-mainnet-activation-intent.json`: `resumeLaunches()` with calldata
`0xd255d203`. Nonce and gas remain blank until the dual-provider preflight.
Broadcast requires a new owner authorization bound to the final nonce and
payload. It does not authorize a token launch.

After the receipt is independently verified:

1. Change the keeper to
   `KEEPER_CONFIG_PATH=config/keeper-v2-live.mainnet.json` and confirm that the
   live policy reports no alert.
2. Set the website `V2_LAUNCH_TRANSACTIONS_ENABLED=true` and confirm the page
   shows V2 live only for the approved creator.
3. Recheck that launch count is still zero.

## Phase 4 — first beta launch (another separate authorization)

Prepare the exact name, ticker, description, image CID, metadata CID and total
supply. The browser must simulate the launch, require exactly 0.001 ETH plus
gas, and show the final transaction for wallet approval. Record the receipt,
token, bonding curve and GM escrow addresses. Confirm the V2 indexer displays
the curve and the keeper remains healthy.

Buyer trades, not the creator's launch fee, fund the 0.05 ETH graduation
target. At graduation, verify the canonical V3 pool, NFT position ID, permanent
locker registration and unrestricted token transfers. Then test the three GM
check-ins and fee routing. Stop new launches immediately on any invariant,
indexing, monitoring, metadata or support failure.

## Deferred but mandatory follow-up

The owner accepted an unaudited initial beta launch. Arrange the independent
contract audit immediately after that initial launch and pause further launches
while material findings are unresolved. Professional legal review, including a
governing-law decision and current sanctions coverage, also remains outside the
technical readiness claim.
