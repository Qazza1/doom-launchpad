import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { LAUNCH_FIELDS, decodeLaunchRecord, evaluateLaunch, splitWords } from "../observe.mjs";

const decisions = JSON.parse(
  await readFile(
    new URL("../../../config/robinhood-mainnet-canary.decisions.json", import.meta.url),
    "utf8",
  ),
);

const addresses = {
  DoomRewards: "0x615f6E6B0AEA7Ac94F4391424aF601F9290dd9dC",
  PositionLocker: "0xdaE01c32131fF283f403b4C1fD71018Fa31cfAC0",
  V3LiquidityManager: "0xbf36be8861ca4fe9920B10fc526E3fD039F88519",
  DoomLaunchFactory: "0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE",
};
const creator = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F";
const token = "0x1111111111111111111111111111111111111111";
const pool = "0x2222222222222222222222222222222222222222";
const escrowAddress = "0x3333333333333333333333333333333333333333";

const supply = 1_000_000_000n * 10n ** 18n;
const nativeUsed = 10_000_000_000_000_000n;
const creationFee = (nativeUsed * 100n) / 10_000n;

const economics = {
  creatorLiquidBps: decisions.tokenEconomics.creatorLiquidBps,
  liquidityBps: decisions.tokenEconomics.liquidityBps,
  gmEscrowBps: decisions.tokenEconomics.gmEscrowBps,
  creationFeeBps: decisions.creationFee.feeBps,
  nftRewardsShareBps: decisions.creationFee.nftRewardsShareBps,
  requiredCheckIns: decisions.gmCommitment.requiredCheckIns,
  cadenceSeconds: decisions.gmCommitment.cadenceSeconds,
  gracePeriodSeconds: decisions.gmCommitment.gracePeriodSeconds,
};

const healthy = () => ({
  record: {
    token,
    creator,
    pool,
    creatorEscrow: escrowAddress,
    positionId: 42n,
    totalSupply: supply,
    creatorLiquidAmount: 0n,
    liquidityTokenAmountAllocated: (supply * 4000n) / 10_000n,
    liquidityTokenAmountUsed: (supply * 4000n) / 10_000n - 5n,
    liquidityTokenRemainder: 5n,
    escrowTokenAmount: (supply * 6000n) / 10_000n,
    nativeLiquidityAmountRequested: nativeUsed,
    nativeLiquidityAmountUsed: nativeUsed,
    creationFee,
    treasuryFee: creationFee / 2n,
    nftRewardFee: creationFee / 2n,
    createdAt: 1_700_000_000n,
    liquidityPermanent: true,
    sqrtPriceX96: 1n,
    configurationHash: `0x${"ab".repeat(32)}`,
  },
  economics,
  limits: {
    maxLaunches: 3n,
    launchCount: 1n,
    totalNativeLiquidity: nativeUsed,
    maxNativeLiquidityPerLaunchWei: decisions.pilotLimits.maxNativeLiquidityPerLaunchWei,
    maxNativeLiquidityGlobalWei: decisions.pilotLimits.maxNativeLiquidityGlobalWei,
  },
  escrow: {
    creator,
    token,
    doomRewards: addresses.DoomRewards,
    committedAmount: (supply * 6000n) / 10_000n,
    releasedAmount: 0n,
    requiredCheckIns: 3n,
    completedCheckIns: 0n,
    remainingCheckIns: 3n,
    cadenceSeconds: 86_400n,
    gracePeriodSeconds: 43_200n,
    startTime: 1_700_000_000n,
    nextCheckInAt: 1_700_000_000n,
    nextDeadline: 1_700_129_600n,
    status: 0n,
  },
  balances: {
    tokenTotalSupply: supply,
    creator: 0n,
    escrow: (supply * 6000n) / 10_000n,
    pool: (supply * 4000n) / 10_000n - 5n,
  },
  positionOwner: addresses.PositionLocker,
  addresses,
});

test("a healthy canary launch passes every invariant", () => {
  assert.deepEqual(evaluateLaunch(healthy()), []);
});

test("allocation rounding dust belongs to escrow", () => {
  const observed = healthy();
  const oddSupply = supply + 1n;
  const creatorAllocation = (oddSupply * 0n) / 10_000n;
  const liquidityAllocation = (oddSupply * 4000n) / 10_000n;
  const escrowAllocation = oddSupply - creatorAllocation - liquidityAllocation;

  observed.record.totalSupply = oddSupply;
  observed.record.creatorLiquidAmount = creatorAllocation;
  observed.record.liquidityTokenAmountAllocated = liquidityAllocation;
  observed.record.liquidityTokenAmountUsed = liquidityAllocation;
  observed.record.liquidityTokenRemainder = 0n;
  observed.record.escrowTokenAmount = escrowAllocation;
  observed.escrow.committedAmount = escrowAllocation;
  observed.balances.tokenTotalSupply = oddSupply;
  observed.balances.escrow = escrowAllocation;
  observed.balances.pool = liquidityAllocation;

  assert.deepEqual(evaluateLaunch(observed), []);
});

test("the launch record decodes in the contract's field order", () => {
  const words = [
    token.slice(2).padStart(64, "0"),
    creator.slice(2).padStart(64, "0"),
    pool.slice(2).padStart(64, "0"),
    escrowAddress.slice(2).padStart(64, "0"),
    (42n).toString(16).padStart(64, "0"),
    ...Array.from({ length: 12 }, (_, index) => BigInt(index + 1).toString(16).padStart(64, "0")),
    (1n).toString(16).padStart(64, "0"),
    (7n).toString(16).padStart(64, "0"),
    "ab".repeat(32),
  ];
  const record = decodeLaunchRecord(`0x${words.join("")}`);
  assert.equal(record.token.toLowerCase(), token.toLowerCase());
  assert.equal(record.positionId, 42n);
  assert.equal(record.liquidityPermanent, true);
  assert.equal(record.configurationHash, `0x${"ab".repeat(32)}`);
  assert.equal(LAUNCH_FIELDS.length, 20);
  assert.equal(splitWords(`0x${words.join("")}`).length, 20);
  assert.throws(() => splitWords("0x1234"), /whole number of words/);
  assert.throws(() => decodeLaunchRecord("0x"), /truncated/);
});

test("a broken allocation split is caught", () => {
  const skewed = healthy();
  skewed.record.creatorLiquidAmount = (supply * 2000n) / 10_000n;
  const failures = evaluateLaunch(skewed);
  assert.ok(failures.some(item => item.includes("creator allocation is not 0%")));
  assert.ok(failures.some(item => item.includes("do not sum to total supply")));
});

test("liquidity that does not reconcile with its remainder is caught", () => {
  const leaking = healthy();
  leaking.record.liquidityTokenRemainder = 0n;
  assert.ok(
    evaluateLaunch(leaking).some(item => item.includes("remainder does not equal the allocation")),
  );
});

test("an LP position that is not permanently locked is caught", () => {
  const escaped = healthy();
  escaped.positionOwner = creator;
  assert.ok(
    evaluateLaunch(escaped).some(item => item.includes("not the permanent locker")),
  );

  const impermanent = healthy();
  impermanent.record.liquidityPermanent = false;
  assert.ok(
    evaluateLaunch(impermanent).some(item => item.includes("not recorded as permanent liquidity")),
  );
});

test("a wrong creation fee or split is caught", () => {
  const overcharged = healthy();
  overcharged.record.creationFee = creationFee * 2n;
  assert.ok(evaluateLaunch(overcharged).some(item => item.includes("not 1% of the native liquidity")));

  const misrouted = healthy();
  misrouted.record.treasuryFee = creationFee;
  misrouted.record.nftRewardFee = 0n;
  assert.ok(evaluateLaunch(misrouted).some(item => item.includes("fee share is not 50%")));
});

test("a canary cap breach is caught", () => {
  const oversized = healthy();
  oversized.record.nativeLiquidityAmountRequested = 100_000_000_000_000_000n;
  assert.ok(evaluateLaunch(oversized).some(item => item.includes("not exactly the canary amount")));

  const tooMany = healthy();
  tooMany.limits.launchCount = 4n;
  assert.ok(evaluateLaunch(tooMany).some(item => item.includes("launch count exceeds the canary cap")));

  const overLiquidity = healthy();
  overLiquidity.limits.totalNativeLiquidity = 40_000_000_000_000_000n;
  assert.ok(evaluateLaunch(overLiquidity).some(item => item.includes("aggregate native liquidity exceeds")));
});

test("a mis-parameterised or mis-wired commitment is caught", () => {
  const shortened = healthy();
  shortened.escrow.requiredCheckIns = 1n;
  shortened.escrow.gracePeriodSeconds = 0n;
  const failures = evaluateLaunch(shortened);
  assert.ok(failures.some(item => item.includes("required check-in count")));
  assert.ok(failures.some(item => item.includes("grace period")));

  const misrouted = healthy();
  misrouted.escrow.doomRewards = creator;
  assert.ok(evaluateLaunch(misrouted).some(item => item.includes("route defaults to DoomRewards")));

  const foreign = healthy();
  foreign.escrow.token = pool;
  assert.ok(evaluateLaunch(foreign).some(item => item.includes("escrow token does not match")));
});

test("escrowed tokens must actually sit in the escrow while the commitment is open", () => {
  const drained = healthy();
  drained.balances.escrow = 0n;
  assert.ok(
    evaluateLaunch(drained).some(item => item.includes("does not hold the unreleased part")),
  );

  // After a completed commitment the escrow is expected to be empty, so the check does not apply.
  const completed = healthy();
  completed.escrow.completedCheckIns = 3n;
  completed.balances.escrow = 0n;
  assert.deepEqual(evaluateLaunch(completed), []);
});

test("a partially released escrow is judged against what it should still hold", () => {
  const escrowed = (supply * 6000n) / 10_000n;
  const share = escrowed / 3n;

  // One check-in honoured: the escrow should hold two thirds, and the creator holds the rest.
  const partial = healthy();
  partial.escrow.completedCheckIns = 1n;
  partial.escrow.remainingCheckIns = 2n;
  partial.escrow.releasedAmount = share;
  partial.balances.escrow = escrowed - share;
  partial.balances.creator = share;
  assert.deepEqual(evaluateLaunch(partial), []);

  // Still holding everything after a release is an accounting failure, not a pass.
  const unreleased = structuredClone(partial);
  unreleased.balances.escrow = escrowed;
  assert.ok(
    evaluateLaunch(unreleased).some(item => item.includes("does not hold the unreleased part")),
  );

  // Releasing more than was ever committed must be caught.
  const overReleased = healthy();
  overReleased.escrow.releasedAmount = escrowed + 1n;
  assert.ok(
    evaluateLaunch(overReleased).some(item => item.includes("released more than it ever held")),
  );
});

test("a supply mismatch between the token and the record is caught", () => {
  const inflated = healthy();
  inflated.balances.tokenTotalSupply = supply * 2n;
  assert.ok(
    evaluateLaunch(inflated).some(item => item.includes("total supply does not match")),
  );
});
