# DoomRewards operations

This directory contains deterministic, fail-closed tools for:

- reconstructing ERC-721 ownership at a canonical block;
- allocating deposited rewards per eligible NFT;
- generating OpenZeppelin-compatible Merkle proofs; and
- independently verifying a public campaign manifest.

The tools never sign or broadcast transactions. All integer values in JSON are
decimal strings, addresses are normalized to lowercase, and generated manifests
contain no wall-clock timestamp.

Install the pinned dependency:

```bash
npm ci --prefix tools/rewards
```

Generate and independently verify the included non-production fixture:

```bash
npm run generate --prefix tools/rewards -- \
  --snapshot tools/rewards/fixtures/ownership.snapshot.json \
  --campaign tools/rewards/fixtures/campaign.config.json \
  --output tools/rewards/output/campaign.manifest.json

npm run verify --prefix tools/rewards -- \
  --manifest tools/rewards/output/campaign.manifest.json \
  --snapshot tools/rewards/fixtures/ownership.snapshot.json \
  --campaign tools/rewards/fixtures/campaign.config.json
```

The snapshot collector is read-only. Copy `snapshot.config.example.json`, set
the snapshot block and RPC environment-variable name, then run:

```bash
npm run snapshot --prefix tools/rewards -- \
  --config path/to/snapshot.config.json \
  --output path/to/ownership.snapshot.json
```

Never commit RPC credentials. A zero eligible NFT supply intentionally produces
a manifest with `canCreateCampaign: false`, no root, and no allocations.
