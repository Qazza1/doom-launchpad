import assert from "node:assert/strict";
import test from "node:test";
import { initialDaemonHealth, parseIntervalSeconds, recordCheckResult } from "../lib/daemon.mjs";

test("keeper interval is bounded for deadline monitoring", () => {
  assert.equal(parseIntervalSeconds(undefined), 60);
  assert.equal(parseIntervalSeconds("30"), 30);
  assert.equal(parseIntervalSeconds("3600"), 3600);
  assert.throws(() => parseIntervalSeconds("29"), /30 to 3600/);
  assert.throws(() => parseIntervalSeconds("60.5"), /30 to 3600/);
});

test("daemon health records recovery without hiding prior checks", () => {
  let health = initialDaemonHealth(100, 60);
  health = recordCheckResult(health, {
    startedAt: 101,
    completedAt: 102,
    exitCode: 1,
    nextRunAt: 162,
  });
  assert.equal(health.status, "error");
  assert.equal(health.consecutive_failures, 1);
  health = recordCheckResult(health, {
    startedAt: 162,
    completedAt: 163,
    exitCode: 0,
    nextRunAt: 223,
  });
  assert.equal(health.status, "ok");
  assert.equal(health.checks_completed, 2);
  assert.equal(health.consecutive_failures, 0);
  assert.equal(health.next_run_at, 223);
});
