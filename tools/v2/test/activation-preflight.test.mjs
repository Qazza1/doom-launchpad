import assert from "node:assert/strict";
import test from "node:test";
import {
  CALLDATA,
  CHAIN_ID,
  CUTOVER_OPERATIONS,
  OPERATOR,
  chooseActivationGasLimit,
  operationForArguments,
  validateActivationReports,
} from "../activation-preflight.mjs";

test("activation gas limit uses the larger provider estimate with buffer and floor", () => {
  assert.equal(chooseActivationGasLimit(["21000", "22000"]), "50000");
  assert.equal(chooseActivationGasLimit(["50000", "60000"]), "75000");
  assert.throws(() => chooseActivationGasLimit(["0"]), /missing/);
});

function report(label) {
  return {
    label,
    chainId: CHAIN_ID,
    blockNumber: 100,
    pendingNonce: 17,
    factoryRuntimeMatches: true,
    factoryPaused: true,
    factoryLaunchCount: 0,
    factoryConfigurationValid: true,
    approvedCreatorAllowed: true,
    operator: OPERATOR.toLowerCase(),
    simulationResult: "0x",
  };
}

test("activation reports require the exact paused, zero-launch state", () => {
  assert.deepEqual(validateActivationReports(report("primary"), report("fallback")), []);
  const active = report("fallback");
  active.factoryPaused = false;
  assert.ok(validateActivationReports(report("primary"), active).some(error => error.includes("pause state differs")));
});

test("activation payload stays zero-value and function-only", () => {
  assert.equal(CALLDATA, "0xd255d203");
});

test("cutover modes pin legacy pause before public resume", () => {
  assert.equal(operationForArguments(["node", "script", "--legacy-pause"]), CUTOVER_OPERATIONS.legacyPause);
  assert.equal(CUTOVER_OPERATIONS.legacyPause.calldata, "0xe79b502e");
  assert.equal(CUTOVER_OPERATIONS.legacyPause.expectedPaused, false);
  assert.equal(CUTOVER_OPERATIONS.legacyPause.expectedLaunchCount, 1);
  assert.equal(operationForArguments(["node", "script", "--public-v2"]), CUTOVER_OPERATIONS.publicResume);
  assert.equal(CUTOVER_OPERATIONS.publicResume.calldata, "0xd255d203");
  assert.equal(CUTOVER_OPERATIONS.publicResume.expectedPaused, true);
  assert.equal(CUTOVER_OPERATIONS.publicResume.expectedLaunchCount, 0);
});
