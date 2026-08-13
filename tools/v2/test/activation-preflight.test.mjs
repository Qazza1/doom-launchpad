import assert from "node:assert/strict";
import test from "node:test";
import {
  CALLDATA,
  CHAIN_ID,
  OPERATOR,
  chooseActivationGasLimit,
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
  assert.ok(validateActivationReports(report("primary"), active).some(error => error.includes("not paused")));
});

test("activation payload stays zero-value and function-only", () => {
  assert.equal(CALLDATA, "0xd255d203");
});
