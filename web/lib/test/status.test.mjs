import assert from "node:assert/strict";
import test from "node:test";
import {
  ESCROW_STATUS,
  describeCommitment,
  describeFreshness,
  describeGap,
  describePermanence,
  reconcileAllocation,
} from "../status.mjs";

const LOCKER = "0xdaE01c32131fF283f403b4C1fD71018Fa31cfAC0";
// The real DCT1 commitment.
const DCT1 = {
  status: ESCROW_STATUS.active,
  completedCheckIns: 0,
  requiredCheckIns: 3,
  nextCheckInAt: 1785705159,
  nextDeadline: 1785748359,
};

test("before the window opens, the page says when it opens and closes", () => {
  const state = describeCommitment({ ...DCT1, chainTime: 1785661382 });
  assert.equal(state.state, "waiting");
  assert.equal(state.progress.label, "0/3");
  assert.match(state.detail, /opens in 12h/);
  assert.equal(state.deadline, 1785748359);
});

test("inside the window, the page counts down to the deadline", () => {
  const state = describeCommitment({ ...DCT1, chainTime: 1785705159 + 3600 });
  assert.equal(state.state, "window_open");
  assert.equal(state.tone, "pending");
  assert.match(state.detail, /11h 0m left/);
});

/// The distinction that matters most on this page. A missed deadline is not a default until
/// somebody finalises it, and the tokens have not moved in between.
test("a missed deadline is reported as missed, not as defaulted", () => {
  const state = describeCommitment({ ...DCT1, chainTime: 1785748359 + 7200 });
  assert.equal(state.state, "default_eligible");
  assert.notEqual(state.state, "defaulted");
  assert.match(state.label, /not yet finalised/);
  assert.match(state.detail, /Anyone can now finalise/);
  assert.match(state.detail, /nothing has moved/);
});

test("a finalised default says what happened to the tokens, and what was kept", () => {
  const state = describeCommitment({
    ...DCT1,
    status: ESCROW_STATUS.defaulted,
    completedCheckIns: 1,
    // The contract returns zero for both once the commitment is resolved.
    nextCheckInAt: 0,
    nextDeadline: 0,
    chainTime: 1785800000,
  });
  assert.equal(state.state, "defaulted");
  assert.equal(state.deadline, null, "a resolved commitment must not show a 1970 deadline");
  assert.match(state.detail, /1 of 3/);
  assert.match(state.detail, /not taken back/);
});

test("a survived streak is reported as survived", () => {
  const state = describeCommitment({
    ...DCT1,
    status: ESCROW_STATUS.completed,
    completedCheckIns: 3,
    nextCheckInAt: 0,
    nextDeadline: 0,
    chainTime: 1785900000,
  });
  assert.equal(state.state, "survived");
  assert.equal(state.tone, "success");
  assert.equal(state.deadline, null);
});

/// Two independent proofs, because the record is the factory's claim about the past and `ownerOf`
/// is the chain's answer now.
test("permanent liquidity is claimed only when both proofs agree", () => {
  const proven = describePermanence({
    recordSaysPermanent: true,
    positionId: 548289n,
    positionOwner: LOCKER.toLowerCase(),
    expectedLocker: LOCKER,
    verifiedAtBlock: 25794258,
  });
  assert.equal(proven.proven, true);
  // The block it was verified at stays in the sentence; the position ID lives in the table beside
  // it, so repeating it here was noise.
  assert.match(proven.detail, /25794258/);
  assert.match(proven.detail, /No release function exists/);
});

test("a record claiming permanence is not believed when the owner disagrees", () => {
  const state = describePermanence({
    recordSaysPermanent: true,
    positionId: 548289n,
    positionOwner: "0x000000000000000000000000000000000000dEaD",
    expectedLocker: LOCKER,
    verifiedAtBlock: 25794258,
  });
  assert.equal(state.proven, false);
  assert.equal(state.tone, "error");
  assert.match(state.detail, /Do not treat this liquidity as locked/);
});

test("a launch with no position is never described as locked", () => {
  const state = describePermanence({
    recordSaysPermanent: false,
    positionId: 0n,
    positionOwner: LOCKER,
    expectedLocker: LOCKER,
    verifiedAtBlock: 1,
  });
  assert.equal(state.proven, false);
});

test("freshness names the block and admits when the indexer is behind", () => {
  const fresh = describeFreshness({ blockNumber: 25794258, blockTime: 1000, wallClock: 1060, indexerBehind: 0 });
  assert.equal(fresh.confidence, "high");
  assert.match(fresh.detail, /block 25794258/);
  assert.match(fresh.detail, /indexer agrees/);

  // The real situation on 2026-08-02.
  const behind = describeFreshness({ blockNumber: 25794258, blockTime: 1000, wallClock: 1060, indexerBehind: 441547 });
  assert.match(behind.detail, /441,547 blocks behind/);
  assert.match(behind.detail, /do not depend on it/);

  const stale = describeFreshness({ blockNumber: 1, blockTime: 0, wallClock: 4000, indexerBehind: null });
  assert.equal(stale.confidence, "low");
  assert.match(stale.detail, /indexer was not consulted/);
});

test("gaps read as human durations", () => {
  assert.equal(describeGap(45), "45s");
  assert.equal(describeGap(600), "10m");
  assert.equal(describeGap(3600 * 5 + 120), "5h 2m");
  assert.equal(describeGap(3600 * 50), "2d 2h");
  assert.equal(describeGap(-10), "0s");
});

test("the allocation is reconciled, using the real launch 1 numbers", () => {
  const record = {
    totalSupply: 1_000_000_000_000_000_000_000_000_000n,
    creatorLiquidAmount: 0n,
    liquidityTokenAmountAllocated: 400_000_000_000_000_000_000_000_000n,
    liquidityTokenAmountUsed: 399_999_999_999_999_999_999_999_892n,
    liquidityTokenRemainder: 108n,
    escrowTokenAmount: 600_000_000_000_000_000_000_000_000n,
    creationFee: 99_999_999_999_998n,
    treasuryFee: 49_999_999_999_999n,
    nftRewardFee: 49_999_999_999_999n,
  };
  assert.deepEqual(reconcileAllocation(record), {
    supplyReconciles: true,
    liquidityReconciles: true,
    feeReconciles: true,
  });

  const broken = reconcileAllocation({ ...record, escrowTokenAmount: 1n });
  assert.equal(broken.supplyReconciles, false);
});
