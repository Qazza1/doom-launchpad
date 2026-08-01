# Stage 4 fail-closed deployment runbook

No step in this document currently authorizes a broadcast.

## Gate A — freeze and review

1. The canary contract source is commit
   `740a473bd0f2830a17650be7a3b4008be1f82441`, contract digest
   `7aab9e3b0c0c7066ee31e89807900e63112b0c4815338825e02f5d85fa4684c8`.
2. Independent review was not completed. On 2026-07-29 the owner explicitly
   accepted that risk for this capped three-launch canary only:
   `docs/stage-4-owner-risk-acceptance.md`.
3. Keep the manifest's `independentReview` fields empty; never describe the
   owner exception as an independent audit.
4. Any later contract-source change invalidates this acceptance target and
   requires a new digest, a new explicit decision, and repeated technical gates.
5. The exception does not apply to a public or replacement factory.

## Gate B — operator preparation

1. Use the dedicated Rabby canary account selected by the owner. Never import
   the SafePal recovery phrase. Keep the Rabby account isolated from unrelated
   assets and fund only the freshly calculated deployment-gas requirement.
2. Store primary and fallback RPC URLs only in local environment variables.
   The owner completed the dual-provider preflight on 2026-07-25; repeat it
   immediately before final manifest approval.
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
6. Rehearse the six Rabby transaction previews against a localhost fork without
   retaining a raw signed mainnet transaction or broadcasting.

Do not fund the deployer from an estimate written before this gate.

## Gate D — final approval

The owner must review and explicitly approve the final manifest immediately
before broadcast. At that moment all of these must be true:

- either independent review is complete, or the exact capped-canary owner risk
  exception remains valid for the unchanged contract digest;
- source commit, archive checksum, constructor arguments, and dependency
  addresses match;
- deployer nonce and balance match the worksheet;
- primary and fallback RPC agree on chain ID and dependency bytecode;
- deployment remains capped to the approved canary;
- factory-paused postcondition is mandatory.

## Gate E — one transaction at a time

If Gate D is eventually satisfied, submit only the next transaction from
`docs/stage-4-constructor-worksheet.md` through the locked one-step Rabby flow in
`docs/stage-4-rabby-mainnet-executor.md`. After every receipt:

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
