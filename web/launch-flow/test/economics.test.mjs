import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readJson } from "../../../tools/lib/json-file.mjs";
import {
  checkInSchedule,
  describeLaunch,
  loadEconomics,
  splitFee,
  splitSupply,
  validateTokenInputs,
} from "../economics.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../../..");
const decisions = await readJson(
  resolve(projectRoot, "config/robinhood-mainnet-canary.decisions.json"),
);
const economics = loadEconomics(decisions);
const LIMITS = { minWholeSupply: 1_000_000n, maxWholeSupply: 1_000_000_000_000_000n };

/// The interface must show what the contracts do, not what a document once said. The static-site UI
/// plan claimed a 10% creator allocation for months after it became 0%.
test("the displayed economics come from the frozen configuration", () => {
  assert.equal(economics.creatorLiquidBps, 0);
  assert.equal(economics.liquidityBps, 4000);
  assert.equal(economics.gmEscrowBps, 6000);
  assert.equal(economics.creationFeeBps, 100);
  assert.equal(economics.requiredCheckIns, 3);
  assert.equal(economics.liquidityIsPermanent, true);
});

test("the split matches the launch that actually happened", () => {
  // DCT1: one billion tokens, 0 to the creator, 400 million to liquidity, 600 million escrowed.
  const split = splitSupply(1_000_000_000n, economics);
  assert.equal(split.creator, 0n);
  assert.equal(split.liquidity, 400_000_000n);
  assert.equal(split.escrow, 600_000_000n);
  assert.equal(split.perCheckIn, 200_000_000n);
  assert.equal(split.finalCheckIn, 200_000_000n);
  assert.equal(split.reconciles, true);
});

test("division dust goes to the escrow and the last check-in, so nothing is stranded", () => {
  const split = splitSupply(1_000_001n, economics);
  assert.equal(split.creator + split.liquidity + split.escrow, 1_000_001n);
  assert.equal(split.reconciles, true);
  assert.equal(split.perCheckIn * 2n + split.finalCheckIn, split.escrow);
});

test("the creation fee is added on top of the liquidity, not taken out of it", () => {
  const { fee, treasury, rewards, total } = splitFee(10_000_000_000_000_000n, economics);
  assert.equal(fee, 100_000_000_000_000n);
  assert.equal(treasury, 50_000_000_000_000n);
  assert.equal(rewards, 50_000_000_000_000n);
  // 0.0101 ETH: the number the creator's wallet will actually show.
  assert.equal(total, 10_100_000_000_000_000n);
});

test("the three deadlines match the ones the contract set for DCT1", () => {
  const schedule = checkInSchedule(1785618759, economics);
  assert.equal(schedule.length, 3);
  assert.equal(schedule[0].opensAt, 1785705159);
  assert.equal(schedule[0].closesAt, 1785748359);
  assert.equal(schedule[1].opensAt, 1785791559);
  assert.equal(schedule[2].closesAt, 1785921159);
});

test("token inputs are checked before anything else happens", () => {
  const good = validateTokenInputs(
    { name: "DoomStreak Canary Test 2", symbol: "DCT2", wholeSupply: "1,000,000,000" },
    LIMITS,
  );
  assert.equal(good.valid, true);
  assert.equal(good.supply, 1_000_000_000n);

  assert.match(validateTokenInputs({ name: "", symbol: "A", wholeSupply: "1000000" }, LIMITS).errors.name, /name/i);
  assert.match(
    validateTokenInputs({ name: "x", symbol: "TOO-LONG-TICKER", wholeSupply: "1000000" }, LIMITS).errors.symbol,
    /12 bytes/,
  );
  assert.match(
    validateTokenInputs({ name: "x", symbol: "A B", wholeSupply: "1000000" }, LIMITS).errors.symbol,
    /letters and numbers/,
  );
  assert.match(
    validateTokenInputs({ name: "x", symbol: "AB", wholeSupply: "999999" }, LIMITS).errors.wholeSupply,
    /at least/,
  );
  assert.match(
    validateTokenInputs({ name: "x", symbol: "AB", wholeSupply: "1.5" }, LIMITS).errors.wholeSupply,
    /whole number/,
  );
});

test("a multi-byte name is measured in bytes, as the contract measures it", () => {
  const name = "é".repeat(33); // 66 bytes, 33 characters
  assert.match(validateTokenInputs({ name, symbol: "AB", wholeSupply: "1000000" }, LIMITS).errors.name, /64 bytes/);
});

/// The rule the roadmap states plainly: never imply that a submitted transaction is a completed
/// launch.
test("a submitted transaction is never described as a finished launch", () => {
  const pending = describeLaunch({ receiptStatus: null });
  assert.equal(pending.state, "pending");
  assert.equal(pending.done, false);
  assert.doesNotMatch(pending.label.toLowerCase(), /live|listed|complete/);
});

test("a reverted launch says plainly that no token exists", () => {
  const reverted = describeLaunch({ receiptStatus: 0 });
  assert.equal(reverted.state, "reverted");
  assert.equal(reverted.tone, "error");
  assert.match(reverted.detail, /no token, pool, or escrow was created/);
});

/// The exact situation on 2026-08-02: the launch was real and correct, and the indexer had not seen
/// it. The interface has to say that, not show an empty page or claim the launch failed.
test("a mined but unindexed launch is reported honestly, not hidden", () => {
  const stalled = describeLaunch({ receiptStatus: 1, confirmations: 40, indexed: false, indexerHealthy: false });
  assert.equal(stalled.state, "indexing");
  assert.equal(stalled.done, true);
  assert.match(stalled.detail, /exists on chain and is safe/);
  assert.match(stalled.detail, /read directly from the chain/);

  const catchingUp = describeLaunch({ receiptStatus: 1, confirmations: 2, indexed: false });
  assert.equal(catchingUp.state, "indexing");
  assert.match(catchingUp.detail, /once the indexer catches up/);

  const listed = describeLaunch({ receiptStatus: 1, confirmations: 12, indexed: true });
  assert.equal(listed.state, "listed");
  assert.equal(listed.tone, "success");
});
