import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readJson } from "../../lib/json-file.mjs";
import { describeGap, evaluateWindow } from "../checkin.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../../..");

// The real DCT1 commitment.
const OPENS = 1785705159;
const CLOSES = 1785748359;
const base = {
  status: 0,
  completedCheckIns: 0,
  requiredCheckIns: 3,
  nextCheckInAt: OPENS,
  nextDeadline: CLOSES,
};

test("before the window, it refuses and says how long to wait", () => {
  const state = evaluateWindow({ ...base, chainTime: OPENS - 900 });
  assert.equal(state.ready, false);
  assert.equal(state.state, "early");
  assert.match(state.message, /opens in 15m/);
});

test("inside the window, it is ready and reports the margin", () => {
  const state = evaluateWindow({ ...base, chainTime: OPENS + 60 });
  assert.equal(state.ready, true);
  assert.equal(state.state, "open");
  assert.match(state.message, /11h 59m left/);
  assert.equal(state.remainingSeconds, CLOSES - OPENS - 60);
});

test("the first second of the window counts as open, and the last", () => {
  assert.equal(evaluateWindow({ ...base, chainTime: OPENS }).ready, true);
  assert.equal(evaluateWindow({ ...base, chainTime: CLOSES }).ready, true);
  assert.equal(evaluateWindow({ ...base, chainTime: CLOSES + 1 }).ready, false);
});

/// Printing a transaction that will revert wastes gas and, worse, makes somebody believe they
/// checked in.
test("after the deadline it refuses rather than printing a reverting call", () => {
  const state = evaluateWindow({ ...base, chainTime: CLOSES + 7200 });
  assert.equal(state.ready, false);
  assert.equal(state.state, "missed");
  assert.match(state.message, /closed 2h 0m ago/);
  assert.match(state.message, /finalise the default/);
});

test("a resolved commitment is never ready", () => {
  const completed = evaluateWindow({ ...base, status: 1, completedCheckIns: 3, chainTime: OPENS + 60 });
  assert.equal(completed.ready, false);
  assert.match(completed.message, /complete at 3\/3/);

  const defaulted = evaluateWindow({ ...base, status: 2, chainTime: OPENS + 60 });
  assert.equal(defaulted.ready, false);
  assert.match(defaulted.message, /already defaulted/);
});

test("gaps read as durations", () => {
  assert.equal(describeGap(30), "30s");
  assert.equal(describeGap(150), "2m 30s");
  assert.equal(describeGap(7260), "2h 1m");
  assert.equal(describeGap(-5), "0s");
});

test("the selector it prints is the compiled one", async () => {
  const artifact = await readJson(resolve(projectRoot, "out/GmEscrow.sol/GmEscrow.json"));
  assert.equal(artifact.methodIdentifiers["recordGm()"], "595100fc");
});

test("the tool has no send path", async () => {
  const source = await readFile(resolve(directory, "../checkin.mjs"), "utf8");
  for (const forbidden of ["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "privateKey", "mnemonic"]) {
    assert.ok(!source.includes(forbidden), `checkin.mjs must not reference ${forbidden}`);
  }
  const methods = [...source.matchAll(/rpc\(url, "([a-zA-Z_]+)"/g)].map(match => match[1]);
  assert.deepEqual([...new Set(methods)].sort(), ["eth_call", "eth_chainId", "eth_getBlockByNumber"]);
});
