# Stage 4 fail-closed deployment runbook

No step in this document currently authorizes a broadcast.

## Gate A — freeze and review

1. Give the independent reviewer the exact `stage-3.1-audit-candidate` tag and
   its checksum manifest.
2. Record reviewer identity, report URI, report SHA-256, and reviewed commit.
3. Remediate every accepted finding on a new branch.
4. Obtain focused re-review of every contract change.
5. Create a new reviewed tag if any contract byte changes.

## Gate B — operator preparation

1. Use a hardware wallet for the deployer unless a separately reviewed,
   encrypted-keystore procedure is approved.
2. Store primary and fallback RPC URLs only in local environment variables.
3. Confirm control of operator, campaign-manager, treasury, and guardian
   addresses with read-only wallet checks or zero-value signing rehearsals.
4. Read the deployer pending nonce and balance without signing.
5. Populate a copy of the manifest; never overwrite the fail-closed template.

## Gate C — fork and signing rehearsal

1. Run the complete local test, fuzz, invariant, size, rewards, and keeper gates.
2. Run both opt-in Robinhood fork tests against the primary RPC.
3. Repeat dependency reads against the fallback RPC.
4. Run the non-broadcast deployment rehearsal from the exact reviewed commit.
5. Record per-transaction gas, current gas price, a 25% funding buffer, fork
   block, RPC chain ID, expected nonce sequence, and predicted addresses.
6. Rehearse the six hardware-wallet prompts without broadcasting.

Do not fund the deployer from an estimate written before this gate.

## Gate D — final approval

The owner must review and explicitly approve the final manifest immediately
before broadcast. At that moment all of these must be true:

- independent review and focused re-review are complete;
- source commit, archive checksum, constructor arguments, and dependency
  addresses match;
- deployer nonce and balance match the worksheet;
- primary and fallback RPC agree on chain ID and dependency bytecode;
- deployment remains capped to the approved canary;
- factory-paused postcondition is mandatory.

## Gate E — one transaction at a time

If Gate D is eventually satisfied, submit only the next transaction from
`docs/stage-4-constructor-worksheet.md`. After every receipt:

1. require successful status and the expected sender/nonce;
2. record transaction hash, block number, gas used, and deployed address;
3. compare runtime bytecode and every constructor/immutable getter;
4. compare the result through the fallback RPC;
5. stop on any discrepancy before signing the next transaction.

The two binding transactions receive the same review despite deploying no
bytecode because they are irreversible.

## Gate F — paused post-deployment state

After all six transactions:

1. run `VerifyRobinhoodCanary` through both RPCs;
2. verify source and constructor arguments on Blockscout;
3. verify the factory is paused;
4. configure the read-only indexer and keeper with verified addresses;
5. wait for confirmation depth and compare public API state with direct reads;
6. publish the completed manifest.

Resuming the factory and executing the first 0.01 ETH launch are separate Stage
5 approvals. They are not part of deployment.
