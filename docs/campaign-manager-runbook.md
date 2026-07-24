# Campaign-manager runbook

The campaign manager can reserve `DoomRewards` inventory behind a Merkle root. It
cannot withdraw rewards, edit a campaign, or cancel an incorrect root.

## Before signing

1. Confirm chain ID 4663, the deployed `DoomRewards` address, and its immutable
   NFT collection, excluded holder, and fee reward token.
2. Select an explicit canonical snapshot block after sufficient confirmations.
   Record its number and hash. Never use an unconfirmed `latest` block.
3. Copy `tools/rewards/snapshot.config.example.json`, replace the collection
   deployment block and finalized snapshot block, and set `ROBINHOOD_RPC_URL`
   locally. Never commit the RPC URL.
4. Run the read-only snapshot collector:
   `npm run snapshot --prefix tools/rewards -- --config path/to/snapshot.config.json --output path/to/ownership.snapshot.json`.
5. Independently compare the snapshot block hash, `totalSupply`, and a sample of
   `ownerOf` results with a second RPC or explorer.
6. Create a `doom.reward-campaign-config.v1` file. Read `nextCampaignId`,
   `availableRewards(rewardToken)`, and `minimumClaimWindow` from the deployed
   vault immediately before filling it.
7. Generate leaves using exactly:
   `keccak256(bytes.concat(keccak256(abi.encode(chainId, vault, campaignId, account, amount))))`.
8. Generate the manifest:
   `npm run generate --prefix tools/rewards -- --snapshot path/to/ownership.snapshot.json --campaign path/to/campaign.config.json --output path/to/campaign.manifest.json`.
9. Stop if `canCreateCampaign` is false. This is the expected result while no
   eligible DoomStreak NFTs have been minted.
10. Independently reproduce the root and total allocation on a separate machine
    or clean clone using `npm ci` and:
    `npm run verify --prefix tools/rewards -- --manifest path/to/campaign.manifest.json --snapshot path/to/ownership.snapshot.json --campaign path/to/campaign.config.json`.
11. Verify `availableRewards(token) >= allocatedAmount` and use a deadline at least the
   immutable minimum claim window away.
12. Re-read `nextCampaignId`; abort if it differs from the manifest.
13. Publish the snapshot, campaign config, and verified manifest before creating
    the campaign.
14. Simulate `createCampaign(rewardToken, root, allocatedAmount, claimDeadline)`,
    then verify all four values on the signing device.

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

An output file is created with fail-if-present semantics. Use a new path for a
new run; do not silently overwrite a previously reviewed manifest.
