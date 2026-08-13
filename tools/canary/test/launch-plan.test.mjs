import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CHAIN_ID,
  FACTORY,
  MAX_VALUE_WEI,
  NATIVE_LIQUIDITY_WEI,
  PLAN_KIND,
  SENDER,
  buildLaunchPlan,
  buildResumePlan,
  encodeLaunchCalldata,
  planHash,
  validateTokenInputs,
} from "../launch-plan.mjs";

const artifact = JSON.parse(
  await readFile(new URL("../../../out/DoomLaunchFactory.sol/DoomLaunchFactory.json", import.meta.url), "utf8"),
);
const resumeSelector = `0x${artifact.methodIdentifiers["resumeLaunches()"]}`;
const launchSelector = `0x${artifact.methodIdentifiers["launch((string,string,uint256,uint256))"]}`;

const inputs = { name: "Doom Cat", symbol: "DOOMCAT", wholeSupply: 1_000_000_000n };
const launch = (extra = {}) =>
  buildLaunchPlan({ selector: launchSelector, nonce: 6, expiresAt: 1_800_000_000, ...inputs, ...extra });
const resume = (extra = {}) =>
  buildResumePlan({ selector: resumeSelector, nonce: 6, expiresAt: 1_800_000_000, ...extra });

test("selectors come from the compiled artifact, not from this test's imagination", () => {
  assert.match(resumeSelector, /^0x[0-9a-f]{8}$/);
  assert.match(launchSelector, /^0x[0-9a-f]{8}$/);
  assert.notEqual(resumeSelector, launchSelector);
});

test("a resume plan carries no value, no token inputs, and cannot become a launch", () => {
  const plan = resume();
  assert.equal(plan.kind, PLAN_KIND.resume);
  assert.equal(plan.valueWei, "0");
  assert.equal(plan.maxValueWei, "0");
  assert.equal(plan.data, resumeSelector, "resume calldata is the bare selector");
  assert.equal(plan.tokenName, undefined);
  assert.equal(plan.supplyWei, undefined);
  // The two decisions must be distinguishable at a glance and by hash.
  assert.notEqual(plan.planHash, launch().planHash);
  assert.notEqual(plan.calldataHash, launch().calldataHash);
});

test("a launch plan binds every field the requirements list", () => {
  const plan = launch();
  assert.equal(plan.kind, PLAN_KIND.launch);
  assert.equal(plan.chainId, CHAIN_ID);
  assert.equal(plan.factory, FACTORY);
  assert.equal(plan.to, FACTORY);
  assert.equal(plan.sender, SENDER);
  assert.equal(plan.nonce, 6);
  assert.equal(plan.expiresAt, 1_800_000_000);
  assert.equal(plan.tokenName, "Doom Cat");
  assert.equal(plan.tokenSymbol, "DOOMCAT");
  assert.equal(plan.wholeSupply, "1000000000");
  assert.equal(plan.supplyWei, (1_000_000_000n * 10n ** 18n).toString());
  assert.equal(plan.nativeLiquidityWei, NATIVE_LIQUIDITY_WEI.toString());
  // Value must cover liquidity plus the max creation fee, or the factory reverts with
  // InsufficientNativeValue. The excess is refunded.
  assert.equal(plan.valueWei, MAX_VALUE_WEI.toString());
  assert.equal(BigInt(plan.valueWei) - BigInt(plan.nativeLiquidityWei), 100000000000000n);
  assert.equal(plan.maxValueWei, MAX_VALUE_WEI.toString());
  assert.equal(plan.expectedLaunchCount, "0");
  assert.equal(plan.expectedTotalNativeLiquidity, "0");
  assert.match(plan.contractDigest, /^7aab9e3b/);
  assert.match(plan.sourceCommit, /^740a473/);
  assert.match(plan.planHash, /^0x[0-9a-f]{64}$/);
});

test("the plan hash is stable across runs and moves when any bound field moves", () => {
  assert.equal(launch().planHash, launch().planHash, "same inputs must hash identically");

  const variants = [
    ["name", { name: "Doom Dog" }],
    ["symbol", { symbol: "DOOMDOG" }],
    ["supply", { wholeSupply: 999_999_999n }],
    ["nonce", { nonce: 7 }],
    ["expiry", { expiresAt: 1_800_000_001 }],
    ["launch count", { observedLaunchCount: 1 }],
    ["aggregate liquidity", { observedTotalNativeLiquidity: 1 }],
  ];
  const base = launch().planHash;
  for (const [label, change] of variants) {
    assert.notEqual(launch(change).planHash, base, `${label} must change the plan hash`);
  }
});

test("calldata encodes the exact token inputs and the frozen liquidity", () => {
  const plan = launch();
  const body = plan.data.slice(10);
  assert.ok(plan.data.startsWith(launchSelector));
  // Supply and native liquidity appear as whole words in the struct head.
  assert.ok(body.includes((1_000_000_000n * 10n ** 18n).toString(16).padStart(64, "0")));
  assert.ok(body.includes(NATIVE_LIQUIDITY_WEI.toString(16).padStart(64, "0")));
  // Both strings are present as UTF-8 payloads.
  assert.ok(body.includes(Buffer.from("Doom Cat", "utf8").toString("hex")));
  assert.ok(body.includes(Buffer.from("DOOMCAT", "utf8").toString("hex")));
  // A different name produces different calldata, so the hash cannot be reused.
  assert.notEqual(launch({ name: "Doom Dog" }).data, plan.data);
});

test("token inputs are validated against the deployed factory's bounds", () => {
  assert.deepEqual(validateTokenInputs(inputs).errors, []);
  assert.equal(validateTokenInputs(inputs).supplyWei, 1_000_000_000n * 10n ** 18n);

  const tooSmall = validateTokenInputs({ ...inputs, wholeSupply: 999_999n });
  assert.ok(tooSmall.errors.some(item => item.includes("between")));
  const tooBig = validateTokenInputs({ ...inputs, wholeSupply: 1_000_000_000_000_001n });
  assert.ok(tooBig.errors.some(item => item.includes("between")));

  assert.ok(validateTokenInputs({ ...inputs, name: "" }).errors.some(item => item.includes("name")));
  assert.ok(
    validateTokenInputs({ ...inputs, symbol: "TOOLONGSYMBOL" }).errors.some(item => item.includes("symbol")),
  );
  assert.ok(validateTokenInputs({ ...inputs, wholeSupply: "abc" }).errors.length > 0);
});

test("an invalid plan is refused rather than built", () => {
  assert.throws(() => launch({ wholeSupply: 1n }), /between/);
  assert.throws(() => launch({ symbol: "" }), /symbol/);
  assert.throws(() => buildResumePlan({ selector: "0xzz", nonce: 1, expiresAt: 1 }), /malformed/);
  assert.throws(() => launch({ nonce: -1 }), /non-negative/);
  assert.throws(() => launch({ expiresAt: 0 }), /unix time/);
  assert.throws(
    () => encodeLaunchCalldata("0x1234", { name: "a", symbol: "b", supplyWei: 1n, nativeLiquidityWei: 1n }),
    /malformed/,
  );
});

test("plan hashing is order-independent over fields", () => {
  const plan = { b: "2", a: "1" };
  assert.equal(planHash(plan), planHash({ a: "1", b: "2" }));
});
