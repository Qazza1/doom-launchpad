import assert from "node:assert/strict";
import test from "node:test";
import { EXPECTED, PUBLIC_FACTORY, validateCanaryReadiness } from "../canary-readiness.mjs";

const provider = label => ({
  label,
  chainId: 4663,
  blockNumber: 41_000_000,
  runtimeMatches: true,
  paused: false,
  configurationValid: true,
  ...EXPECTED,
});

const healthy = () => ({
  primary: provider("primary"),
  fallback: provider("fallback"),
  website: {
    chainId: 4663,
    factory: PUBLIC_FACTORY,
    transactionsEnabled: true,
    creatorPolicy: "permissionless_eoa",
    activationPolicy: "public_launches_live",
    firstLaunchId: 2,
    factoryMaximumLaunches: 99,
  },
  indexer: {
    status: "ok",
    confidence: "high",
    blocks_behind: 0,
    last_error: null,
    public_factory: PUBLIC_FACTORY,
    factories: [{ role: "public", paused: false, configuration_valid: true, launch_count: 0 }],
  },
  keeper: {
    status: "ok",
    read_only: true,
    consecutive_failures: 0,
    last_monitor_exit_codes: [0, 0],
    monitored_factories: [{ factory: PUBLIC_FACTORY, enabled: true, expected_factory_paused: false }],
  },
});

test("accepts a healthy read-only canary snapshot", () => {
  assert.deepEqual(validateCanaryReadiness(healthy()), []);
});

test("fails closed on a paused factory or stale indexer", () => {
  const snapshot = healthy();
  snapshot.fallback.paused = true;
  snapshot.indexer.blocks_behind = 9;
  const errors = validateCanaryReadiness(snapshot);
  assert.ok(errors.some(error => error.includes("factory is paused")));
  assert.ok(errors.some(error => error.includes("indexer is behind")));
});

test("fails closed after the first public launch already exists", () => {
  const snapshot = healthy();
  snapshot.primary.launchCount = 1;
  snapshot.primary.nextLaunchId = 3;
  assert.ok(validateCanaryReadiness(snapshot).some(error => error.includes("launchCount differs")));
});
