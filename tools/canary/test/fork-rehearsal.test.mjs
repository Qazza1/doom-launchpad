import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_VALUE_WEI, NATIVE_LIQUIDITY_WEI, buildLaunchPlan, buildResumePlan } from "../launch-plan.mjs";
import {
  SENTINEL_BALANCE_WEI,
  assertLocalFork,
  decodeRevert,
  evaluateLaunchOutcome,
  evaluateResumeOutcome,
  parseArguments,
  validatePlanForRehearsal,
} from "../fork-rehearsal.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(directory, "../fork-rehearsal.mjs"), "utf8");

const RESUME_SELECTOR = "0x1a2b3c4d";
const LAUNCH_SELECTOR = "0x0a1b2c3d";
const later = () => Math.floor(Date.now() / 1000) + 900;

const resumePlan = () => buildResumePlan({ selector: RESUME_SELECTOR, nonce: 7, expiresAt: later() });
const launchPlan = () => buildLaunchPlan({
  selector: LAUNCH_SELECTOR,
  nonce: 7,
  expiresAt: later(),
  name: "DoomStreak Canary Test 2",
  symbol: "DCT2",
  wholeSupply: 1_000_000_000n,
  observedLaunchCount: 1,
  observedTotalNativeLiquidity: NATIVE_LIQUIDITY_WEI.toString(),
});

const healthyFork = {
  clientVersion: "anvil/v1.7.1",
  chainId: 4663,
  localHead: 25_776_700,
  upstreamHead: 25_776_655,
  localNonce: 7,
  upstreamNonce: 7,
  sentinelBalanceWei: SENTINEL_BALANCE_WEI,
};

test("one kind per run; resume and launch cannot be rehearsed together", () => {
  assert.deepEqual(parseArguments(["--kind", "launch"]).errors, []);
  const both = parseArguments(["--kind", "resume", "--kind", "launch"]);
  assert.ok(both.errors.some(error => /separate decisions/.test(error)));
  assert.ok(parseArguments([]).errors.some(error => /--kind must be/.test(error)));
});

test("the plan file defaults to the plan the preparation tool wrote", () => {
  assert.equal(parseArguments(["--kind", "resume"]).planPath, "tools/canary/output/resume-plan.json");
  assert.equal(parseArguments(["--kind", "launch", "--plan", "x.json"]).planPath, "x.json");
});

test("a well-formed plan of the requested kind is accepted", () => {
  assert.deepEqual(validatePlanForRehearsal(resumePlan(), "resume"), []);
  assert.deepEqual(validatePlanForRehearsal(launchPlan(), "launch"), []);
});

test("a launch plan cannot be rehearsed as a resume, or the reverse", () => {
  assert.ok(validatePlanForRehearsal(launchPlan(), "resume").some(e => /but the run asked for/.test(e)));
  assert.ok(validatePlanForRehearsal(resumePlan(), "launch").some(e => /but the run asked for/.test(e)));
});

test("a plan edited after it was hashed is refused", () => {
  const tampered = { ...launchPlan(), valueWei: (MAX_VALUE_WEI + 1n).toString() };
  const errors = validatePlanForRehearsal(tampered, "launch");
  assert.ok(errors.some(error => /do not match its hash/.test(error)));
});

test("a plan aimed at another chain, factory, or sender never reaches the fork", () => {
  for (const [field, value] of [
    ["chainId", 1],
    ["to", "0x000000000000000000000000000000000000dEaD"],
    ["sender", "0x000000000000000000000000000000000000dEaD"],
  ]) {
    const errors = validatePlanForRehearsal({ ...launchPlan(), [field]: value }, "launch");
    assert.ok(errors.length > 0, `${field} must be rejected`);
  }
});

test("the target must be provably a local fork before anything is sent", () => {
  assert.deepEqual(assertLocalFork(healthyFork), []);

  const cases = [
    [{ clientVersion: "Geth/v1.14" }, /not Anvil/],
    [{ chainId: 1 }, /reports chain/],
    [{ localHead: 25_000_000 }, /500 blocks/],
    [{ localNonce: 9 }, /nonce differs/],
    [{ sentinelBalanceWei: 10n ** 18n }, /sentinel balance/],
  ];
  for (const [override, pattern] of cases) {
    const errors = assertLocalFork({ ...healthyFork, ...override });
    assert.ok(errors.some(error => pattern.test(error)), `${Object.keys(override)[0]} must fail`);
  }
});

test("a resume rehearsal must unpause and change nothing else", () => {
  const before = { paused: true, launchCount: "1", totalNativeLiquidity: "10000000000000000" };
  assert.deepEqual(evaluateResumeOutcome({ before, after: { ...before, paused: false } }), []);
  assert.ok(
    evaluateResumeOutcome({ before, after: { ...before, paused: false, launchCount: "2" } })
      .some(error => /changed the launch count/.test(error)),
  );
  assert.ok(
    evaluateResumeOutcome({ before, after: before }).some(error => /still paused/.test(error)),
  );
});

test("a launch rehearsal must add exactly one launch and exactly the planned liquidity", () => {
  const before = { paused: false, launchCount: "1", totalNativeLiquidity: "10000000000000000" };
  const after = { paused: false, launchCount: "2", totalNativeLiquidity: "20000000000000000" };
  const observation = { failures: [] };
  assert.deepEqual(
    evaluateLaunchOutcome({
      before,
      after,
      requestedLiquidityWei: NATIVE_LIQUIDITY_WEI.toString(),
      observation,
    }),
    [],
  );

  assert.ok(
    evaluateLaunchOutcome({
      before,
      after: { ...after, totalNativeLiquidity: "10000000000000000" },
      requestedLiquidityWei: NATIVE_LIQUIDITY_WEI.toString(),
      observation,
    }).some(error => /aggregate native liquidity moved/.test(error)),
  );
  assert.ok(
    evaluateLaunchOutcome({
      before,
      after: { ...after, launchCount: "3" },
      requestedLiquidityWei: NATIVE_LIQUIDITY_WEI.toString(),
      observation,
    }).some(error => /exactly one/.test(error)),
  );
  assert.ok(
    evaluateLaunchOutcome({ before: { ...before, paused: true }, after, requestedLiquidityWei: NATIVE_LIQUIDITY_WEI.toString(), observation })
      .some(error => /was paused before/.test(error)),
  );
});

/// The bug this stage exists for: a plan whose value does not cover liquidity plus the creation fee
/// reverts. A rejected or reverted transaction must surface as a failure, never as a quiet pass.
test("every observer invariant failure becomes a rehearsal failure", () => {
  const before = { paused: false, launchCount: "1", totalNativeLiquidity: "10000000000000000" };
  const after = { paused: false, launchCount: "2", totalNativeLiquidity: "20000000000000000" };
  const errors = evaluateLaunchOutcome({
    before,
    after,
    requestedLiquidityWei: NATIVE_LIQUIDITY_WEI.toString(),
    observation: { failures: ["the LP position is owned by 0xdead, not the permanent locker"] },
  });
  assert.deepEqual(errors, ["observer: the LP position is owned by 0xdead, not the permanent locker"]);
});

/// The exact revert the historical plan-value bug produces, as the deployed factory emits it:
/// InsufficientNativeValue(required, provided).
test("a revert is reported by name and arguments, not as four opaque bytes", () => {
  const data = "0x03ba5fc3"
    + BigInt(10_100_000_000_000_000n).toString(16).padStart(64, "0")
    + BigInt(10_000_000_000_000_000n).toString(16).padStart(64, "0");
  const named = decodeRevert(data, { "0x03ba5fc3": "InsufficientNativeValue(uint256,uint256)" });
  assert.match(named, /InsufficientNativeValue\(uint256,uint256\)/);
  assert.match(named, /10100000000000000, 10000000000000000/);

  assert.match(decodeRevert(data), /unknown custom error 0x03ba5fc3/);
  assert.equal(decodeRevert(""), "no revert data");
});

test("a plain Error(string) revert is decoded to its message", () => {
  const reason = "paused";
  const body = "08c379a0"
    + (32).toString(16).padStart(64, "0")
    + reason.length.toString(16).padStart(64, "0")
    + Buffer.from(reason, "utf8").toString("hex").padEnd(64, "0");
  assert.equal(decodeRevert(`0x${body}`), reason);
});

test("the rehearsal has no signing path and cannot write upstream", () => {
  assert.ok(!/privateKey|PRIVATE_KEY|mnemonic|eth_sendRawTransaction|eth_sign/i.test(source));
  // The only account it can send from is one Anvil impersonates locally.
  assert.ok(source.includes("--auto-impersonate"));
  assert.ok(source.includes("127.0.0.1"));
  // Every send goes to the local endpoint constant, never to the upstream URL.
  const sends = source.match(/rpc\(\s*([A-Za-z_]+)\s*,\s*"eth_sendTransaction"/g) ?? [];
  assert.equal(sends.length, 1);
  assert.ok(sends[0].includes("LOCAL_URL"));
  assert.ok(/must be the upstream endpoint, not localhost/.test(source));
});
