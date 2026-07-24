# Campaign-manager runbook

The campaign manager can reserve `DoomRewards` inventory behind a Merkle root. It
cannot withdraw rewards, edit a campaign, or cancel an incorrect root.

## Before signing

1. Confirm chain ID 4663, the deployed `DoomRewards` address, and its immutable
   NFT collection, excluded holder, and fee reward token.
2. Select an explicit canonical snapshot block after sufficient confirmations.
3. Export NFT ownership at that block. Exclude the immutable treasury holder and
   zero address.
4. Allocate per NFT held. Define how multiple NFTs aggregate to one account and
   how integer remainder stays in the vault.
5. Generate leaves using exactly:
   `keccak256(bytes.concat(keccak256(abi.encode(chainId, vault, campaignId, account, amount))))`.
6. Sort leaves/pairs using the generator's published deterministic convention.
7. Independently reproduce the root and total allocation on a separate machine.
8. Verify `availableRewards(token) >= allocation` and use a deadline at least the
   immutable minimum claim window away.
9. Publish the signed manifest before creating the campaign.
10. Simulate `createCampaign`, then verify calldata on the signing device.

## Required manifest

- chain ID, snapshot block/hash, confirmation count;
- NFT collection, excluded holder, vault, campaign ID, reward token;
- allocation rule, holder count, leaf count, total allocation and remainder;
- root, claim deadline, generator version/commit, input/output SHA-256 hashes;
- independent verifier name/address and reproduction result.

## Error handling

There is no cancellation. A wrong root reserves inventory until its deadline,
after which anyone can call `recycleUnclaimed`. Do not create a replacement
campaign from the same inventory until the first reservation is recycled.

Direct transfers to the vault do not update `availableRewards`; always use a
deposit function. Zero eligible NFT supply means no campaign is created and the
inventory remains available inside `DoomRewards`.
