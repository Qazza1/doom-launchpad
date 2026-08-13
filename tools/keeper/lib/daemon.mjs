export function parseIntervalSeconds(input, fallback = 60) {
  const value = input == null || input === "" ? fallback : Number(input);
  if (!Number.isSafeInteger(value) || value < 30 || value > 3600) {
    throw new Error("KEEPER_INTERVAL_SECONDS must be an integer from 30 to 3600");
  }
  return value;
}

export function initialDaemonHealth(startedAt, intervalSeconds) {
  return {
    status: "starting",
    read_only: true,
    started_at: startedAt,
    interval_seconds: intervalSeconds,
    checks_completed: 0,
    consecutive_failures: 0,
    last_started_at: null,
    last_completed_at: null,
    last_exit_code: null,
    next_run_at: null,
  };
}

export function addPolicyHealth(health, { configFile, chainId, factory, expectedFactoryPaused }) {
  if (typeof configFile !== "string" || configFile.length === 0) {
    throw new Error("configFile must be a non-empty filename");
  }
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("chainId must be a positive integer");
  }
  if (typeof factory !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(factory)) {
    throw new Error("factory must be an address");
  }
  if (typeof expectedFactoryPaused !== "boolean") {
    throw new Error("expectedFactoryPaused must be boolean");
  }
  return {
    ...health,
    config_file: configFile,
    chain_id: chainId,
    factory,
    expected_factory_paused: expectedFactoryPaused,
  };
}

export function recordCheckResult(health, { startedAt, completedAt, exitCode, nextRunAt }) {
  const passed = exitCode === 0;
  return {
    ...health,
    status: passed ? "ok" : "error",
    checks_completed: health.checks_completed + 1,
    consecutive_failures: passed ? 0 : health.consecutive_failures + 1,
    last_started_at: startedAt,
    last_completed_at: completedAt,
    last_exit_code: exitCode,
    next_run_at: nextRunAt,
  };
}
