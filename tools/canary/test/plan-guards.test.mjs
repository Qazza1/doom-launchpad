import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CONTRACT_DIGEST, PLAN_KIND, SOURCE_COMMIT, buildLaunchPlan, buildResumePlan } from "../launch-plan.mjs";
import {
  assertNotBundled,
  guardSubmission,
  validateAgainstChain,
  validateApproval,
  validateCalldata,
  validateFreshness,
  validateIntegrity,
  validateValue,
} from "../plan-guards.mjs";

const artifact = JSON.parse(
  await readFile(new URL("../../../out/DoomLaunchFactory.sol/DoomLaunchFactory.json", import.meta.url), "utf8"),
);
const resumeSelector = `0x${artifact.methodIdentifiers["resumeLaunches()"]}`;
const launchSelector = `0x${artifact.methodIdentifiers["launch((string,string,uint256,uint256))"]}`;

const NOW = 1_700_000_000;
const EXPIRES = NOW + 900;
const resumePlan = buildResumePlan({ selector: resumeSelector, nonce: 6, expiresAt: EXPIRES });
const launchPlan = buildLaunchPlan({
  selector: launchSelector,
  nonce: 7,
  expiresAt: EXPIRES,
  name: "DoomStreak Canary Test 1",
  symbol: "DCT1",
  wholeSupply: 1_000_000_000n,
});

const approvalFor = plan => ({ kind: plan.kind, planHash: plan.planHash });
const chainFor = plan => ({
  chainId: 4663,
  pendingNonce: plan.nonce,
  contractDigest: CONTRACT_DIGEST,
  sourceCommit: SOURCE_COMMIT,
  launchCount: "0",
  totalNativeLiquidity: "0",
  paused: plan.kind === PLAN_KIND.resume,
});
const submit = (plan, extra = {}) =>
  guardSubmission({
    plan,
    approval: approvalFor(plan),
    observed: chainFor(plan),
    valueWei: plan.valueWei,
    calldata: plan.data,
    nowSeconds: NOW,
    ...extra,
  });

test("a correct submission passes for both plan kinds", () => {
  assert.deepEqual(submit(resumePlan), []);
  assert.deepEqual(submit(launchPlan), []);
});

test("a resume approval can never authorize a launch", () => {
  // The single most important property here: approving the resume must not carry into the launch.
  const errors = validateApproval(approvalFor(resumePlan), launchPlan);
  assert.ok(errors.some(item => item.includes("approval is for a resume")));
  assert.ok(errors.some(item => item.includes("does not match this plan's hash")));

  assert.deepEqual(validateApproval(null, launchPlan), ["no owner approval was supplied"]);
  // An approval for a different launch plan is equally useless.
  const other = buildLaunchPlan({
    selector: launchSelector, nonce: 7, expiresAt: EXPIRES,
    name: "DoomStreak Canary Test 2", symbol: "DCT2", wholeSupply: 1_000_000_000n,
  });
  assert.ok(validateApproval(approvalFor(other), launchPlan).length > 0);
});

test("resume and launch cannot be bundled", () => {
  assert.deepEqual(assertNotBundled([resumePlan]), []);
  assert.deepEqual(assertNotBundled([launchPlan]), []);
  assert.deepEqual(assertNotBundled([resumePlan, launchPlan]), [
    "resume and launch cannot be approved or submitted together",
  ]);
  assert.ok(submit(launchPlan, { alongside: [resumePlan] }).some(item => item.includes("together")));
});

test("a stale plan is refused", () => {
  assert.deepEqual(validateFreshness(launchPlan, NOW), []);
  assert.deepEqual(validateFreshness(launchPlan, EXPIRES), ["the plan has expired; regenerate it"]);
  assert.deepEqual(validateFreshness(launchPlan, EXPIRES + 1), ["the plan has expired; regenerate it"]);
  assert.ok(validateFreshness(launchPlan, "nonsense").length > 0);
});

test("each chain guard rejects independently", () => {
  const base = chainFor(launchPlan);
  const cases = [
    ["chain", { chainId: 1 }, "chain is 1"],
    ["nonce", { pendingNonce: 9 }, "pending nonce"],
    ["digest", { contractDigest: "0xdead" }, "contract digest has drifted"],
    ["commit", { sourceCommit: "abc123" }, "source commit has drifted"],
    ["launch count", { launchCount: "1" }, "launch count is 1"],
    ["aggregate liquidity", { totalNativeLiquidity: "1" }, "aggregate native liquidity"],
    ["paused", { paused: true }, "the factory is paused; it must be resumed first"],
  ];
  for (const [label, change, expected] of cases) {
    const errors = validateAgainstChain(launchPlan, { ...base, ...change });
    assert.ok(errors.some(item => item.includes(expected)), `${label} must be caught`);
  }
  // A resume against an already-unpaused factory would revert; catch it before spending gas.
  assert.ok(
    validateAgainstChain(resumePlan, { ...chainFor(resumePlan), paused: false })
      .some(item => item.includes("already unpaused")),
  );
});

test("value is bounded by the plan and by the canary ceiling", () => {
  assert.deepEqual(validateValue(launchPlan, launchPlan.valueWei), []);
  assert.deepEqual(validateValue(resumePlan, "0"), []);

  assert.ok(validateValue(resumePlan, "1").some(item => item.includes("resume must carry no value")));
  assert.ok(validateValue(launchPlan, "1").some(item => item.includes("does not match the plan")));
  assert.ok(
    validateValue(launchPlan, "20000000000000000").some(item => item.includes("exceeds the canary ceiling")),
  );
  assert.ok(validateValue(launchPlan, "-1").some(item => item.includes("negative")));
  assert.ok(validateValue(launchPlan, "abc").length > 0);
});

test("calldata must match the plan byte for byte", () => {
  assert.deepEqual(validateCalldata(launchPlan, launchPlan.data), []);
  assert.deepEqual(validateCalldata(launchPlan, launchPlan.data.toUpperCase().replace("0X", "0x")), []);

  assert.ok(validateCalldata(launchPlan, resumePlan.data).some(item => item.includes("does not match")));
  assert.ok(validateCalldata(launchPlan, `${launchPlan.data}00`).some(item => item.includes("does not match")));
  assert.ok(validateCalldata(launchPlan, "0xzz").some(item => item.includes("malformed")));
});

test("a plan edited after approval fails its own integrity check", () => {
  assert.deepEqual(validateIntegrity(launchPlan), []);
  // Changing any field without regenerating the hash is exactly the tamper case.
  assert.deepEqual(validateIntegrity({ ...launchPlan, tokenSymbol: "EVIL" }), [
    "plan contents do not match its hash",
  ]);
  assert.deepEqual(validateIntegrity({ ...launchPlan, valueWei: "1" }), [
    "plan contents do not match its hash",
  ]);
  assert.deepEqual(validateIntegrity({ ...launchPlan, planHash: undefined }), ["plan carries no hash"]);
});

test("a changed token input cannot ride an old approval", () => {
  // Regenerating with a different symbol changes the hash, so the prior approval no longer applies.
  const changed = buildLaunchPlan({
    selector: launchSelector, nonce: 7, expiresAt: EXPIRES,
    name: "DoomStreak Canary Test 1", symbol: "DCT9", wholeSupply: 1_000_000_000n,
  });
  const errors = guardSubmission({
    plan: changed,
    approval: approvalFor(launchPlan),
    observed: chainFor(changed),
    valueWei: changed.valueWei,
    calldata: changed.data,
    nowSeconds: NOW,
  });
  assert.ok(errors.some(item => item.includes("does not match this plan's hash")));
});

test("the guard module never loads a key or reaches the network", async () => {
  const source = await readFile(new URL("../plan-guards.mjs", import.meta.url), "utf8");
  for (const forbidden of ["fetch(", "privateKey", "PRIVATE_KEY", "sendTransaction", "signTransaction", "Wallet("]) {
    assert.equal(source.includes(forbidden), false, `guards must not reference ${forbidden}`);
  }
});
