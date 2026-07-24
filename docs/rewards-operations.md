# Rewards operations

Stage 3.2 provides a reproducible path from a canonical NFT ownership snapshot to
the exact Merkle root accepted by `DoomRewards`. These tools are read-only except
for writing local JSON artifacts. They never sign or broadcast transactions.

## Pinned implementation

- Node.js 22 or newer; CI uses Node.js 24.
- `@openzeppelin/merkle-tree` exactly `1.0.8`.
- Transitive `uuid` overridden to patched `11.1.1`.
- Standard Merkle leaf:
  `["uint256","address","uint256","address","uint256"]`.
- Leaf values:
  `[chainId, doomRewards, campaignId, account, amount]`.
- Leaves and pairs use OpenZeppelin's sorted standard-tree convention.
- Generator version `0.1.0`.

All uints are canonical decimal strings. Addresses and hashes are lowercased
before hashing. JSON source digests use recursively key-sorted canonical JSON,
so whitespace and source key order cannot alter them.

## Snapshot format

`doom.nft-ownership-snapshot.v1` records:

- chain ID;
- canonical snapshot block number/hash, observed head, and confirmation count;
- NFT collection and the immutable excluded holder;
- onchain `totalSupply`; and
- one sorted token-ID array per current owner.

The collector reconstructs ownership from ERC-721 `Transfer` logs between the
collection deployment block and the explicit snapshot block. It then requires
the reconstructed token count to equal `totalSupply` at that block and, by
default, checks `balanceOf` for every reconstructed holder. A mismatch aborts.

The input contract must expose ERC-721 `Transfer` logs, `totalSupply()`, and
`balanceOf(address)`. Do not use the collector for an ERC-1155 collection or a
non-enumerable ERC-721 without adapting and independently reviewing it.

## Allocation rule

The immutable excluded holder is retained in the ownership snapshot for supply
reconciliation but omitted from eligibility. The reward is divided using:

`perNftAmount = floor(totalReward / eligibleNftCount)`

Each wallet receives `perNftAmount * nftCount`. Integer remainder is not
reserved by the campaign; it remains available inside `DoomRewards`.

If the NFT supply is zero, or every NFT belongs to the excluded holder, the
manifest contains:

- `canCreateCampaign: false`;
- `merkle.root: null`;
- no claims; and
- the whole reward as `retainedRemainder`.

The operator must not call `createCampaign` for such a manifest.

## Reproduction

From the repository root:

```bash
npm ci --prefix tools/rewards
npm test --prefix tools/rewards
npm run generate --prefix tools/rewards -- \
  --snapshot tools/rewards/fixtures/ownership.snapshot.json \
  --campaign tools/rewards/fixtures/campaign.config.json \
  --output tools/rewards/output/campaign.manifest.json
npm run verify --prefix tools/rewards -- \
  --manifest tools/rewards/output/campaign.manifest.json \
  --snapshot tools/rewards/fixtures/ownership.snapshot.json \
  --campaign tools/rewards/fixtures/campaign.config.json
```

The committed fixture is synthetic and is never valid deployment input.
