import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_ALERT_STATE, readAlertState, reconcileAlerts, writeAlertState } from "../lib/alerts.mjs";
import { collectKeeperState } from "../lib/collect.mjs";
import { evaluateKeeperState } from "../lib/rules.mjs";
import { formatTelegramAlert, sendTelegramAlert, telegramRequest, validateBotToken } from "../lib/telegram.mjs";

const thresholds = {
  rpcStaleSeconds: 180,
  rpcFutureToleranceSeconds: 60,
  gmReminderLeadSeconds: 3600,
  gmCriticalLeadSeconds: 900,
  feeCollectionReminderSeconds: 86400,
  feeLogLookbackBlocks: 100000,
  warningRepeatSeconds: 1800,
  criticalRepeatSeconds: 300,
  infoRepeatSeconds: 21600,
};

const config = {
  chainId: 4663,
  expectedFactoryPaused: true,
  thresholds,
};

function healthyState(overrides = {}) {
  return {
    observedAt: 1_800_000_000,
    chainId: 4663,
    headNumber: "123",
    headTimestamp: 1_799_999_990,
    factory: {
      address: "0x1111111111111111111111111111111111111111",
      hasCode: true,
      launchesPaused: true,
      expected: { operator: "0x2222222222222222222222222222222222222222" },
      actual: { operator: "0x2222222222222222222222222222222222222222" },
    },
    positionLocker: {
      hasCode: true,
      expected: { treasury: "0x3333333333333333333333333333333333333333" },
      actual: { treasury: "0x3333333333333333333333333333333333333333" },
    },
    doomRewards: {
      hasCode: true,
      expected: { campaignManager: "0x4444444444444444444444444444444444444444" },
      actual: { campaignManager: "0x4444444444444444444444444444444444444444" },
      balances: [],
    },
    launches: [],
    ...overrides,
  };
}

function activeLaunch(overrides = {}) {
  return {
    launchId: "1",
    positionId: "42",
    token: "0x5555555555555555555555555555555555555555",
    creator: "0x6666666666666666666666666666666666666666",
    creatorEscrow: "0x7777777777777777777777777777777777777777",
    liquidityPermanent: true,
    currentlyLocked: true,
    escrowStatus: 0,
    completedCheckIns: 0,
    requiredCheckIns: 3,
    nextCheckInAt: 1_800_001_000,
    nextDeadline: 1_800_002_000,
    createdAt: 1_799_999_000,
    lastFeeCollectionAt: null,
    ...overrides,
  };
}

test("healthy pre-launch state emits no alerts", () => {
  assert.deepEqual(evaluateKeeperState(healthyState(), config), []);
});

test("wrong chain fails closed before interpreting contracts", () => {
  const alerts = evaluateKeeperState(healthyState({ chainId: 1 }), config);
  assert.deepEqual(alerts.map((item) => item.id), ["rpc:wrong-chain"]);
  assert.equal(alerts[0].severity, "critical");
});

test("detects stale RPC and immutable mismatches", () => {
  const state = healthyState({ headTimestamp: 1_799_999_000 });
  state.factory.actual.operator = "0x9999999999999999999999999999999999999999";
  state.positionLocker.actual.treasury = "0x9999999999999999999999999999999999999999";
  const ids = evaluateKeeperState(state, config).map((item) => item.id);
  assert.deepEqual(ids, ["factory:mismatch:operator", "locker:mismatch:treasury", "rpc:stale-head"]);
});

test("detects a future block timestamp or host clock skew", () => {
  const alerts = evaluateKeeperState(healthyState({ headTimestamp: 1_800_000_061 }), config);
  assert.equal(alerts[0].id, "rpc:future-head");
  assert.equal(alerts[0].severity, "critical");
});

test("GM reminder escalates through open, critical, and finalizable states", () => {
  const reminder = evaluateKeeperState(
    healthyState({ launches: [activeLaunch({ nextCheckInAt: 1_800_000_600 })] }),
    config,
  );
  assert.equal(reminder.find((item) => item.id.endsWith("gm-reminder"))?.severity, "info");

  const open = evaluateKeeperState(
    healthyState({ launches: [activeLaunch({ nextCheckInAt: 1_799_999_000, nextDeadline: 1_800_002_000 })] }),
    config,
  );
  assert.equal(open.find((item) => item.id.endsWith("gm-window"))?.severity, "warning");

  const critical = evaluateKeeperState(
    healthyState({ launches: [activeLaunch({ nextCheckInAt: 1_799_999_000, nextDeadline: 1_800_000_600 })] }),
    config,
  );
  assert.equal(critical.find((item) => item.id.endsWith("gm-window"))?.severity, "critical");

  const missed = evaluateKeeperState(
    healthyState({ launches: [activeLaunch({ nextCheckInAt: 1_799_998_000, nextDeadline: 1_799_999_999 })] }),
    config,
  );
  assert.equal(missed.find((item) => item.id.endsWith("default-finalizable"))?.severity, "critical");
});

test("detects permanent-lock failure and fee-collection reminder", () => {
  const launch = activeLaunch({
    currentlyLocked: false,
    createdAt: 1_799_800_000,
    escrowStatus: 1,
    nextCheckInAt: 0,
    nextDeadline: 0,
  });
  const ids = evaluateKeeperState(healthyState({ launches: [launch] }), config).map((item) => item.id);
  assert.deepEqual(ids, ["launch:1:fee-collection", "launch:1:lock"]);
});

test("detects DoomRewards balance-accounting drift", () => {
  const state = healthyState();
  state.doomRewards.balances = [
    {
      token: "0x5555555555555555555555555555555555555555",
      actualBalance: "100",
      availableRewards: "70",
      reservedRewards: "20",
    },
  ];
  const alerts = evaluateKeeperState(state, config);
  assert.equal(alerts[0].id, "rewards:balance:0x5555555555555555555555555555555555555555");
  assert.equal(alerts[0].severity, "critical");
});

test("deduplicates, repeats by severity, changes, and resolves alerts", () => {
  const current = [
    {
      id: "rpc:stale-head",
      severity: "critical",
      title: "Stale",
      summary: "Head is stale",
      details: [],
      action: "Check RPC",
    },
  ];
  const opened = reconcileAlerts(current, structuredClone(EMPTY_ALERT_STATE), 1000, thresholds);
  assert.equal(opened.notifications[0].notificationKind, "opened");

  const suppressed = reconcileAlerts(current, opened.nextState, 1100, thresholds);
  assert.deepEqual(suppressed.notifications, []);

  const repeated = reconcileAlerts(current, opened.nextState, 1300, thresholds);
  assert.equal(repeated.notifications[0].notificationKind, "repeat");

  const changedAlert = structuredClone(current);
  changedAlert[0].summary = "Different head";
  const changed = reconcileAlerts(changedAlert, opened.nextState, 1100, thresholds);
  assert.equal(changed.notifications[0].notificationKind, "changed");

  const resolved = reconcileAlerts([], opened.nextState, 1200, thresholds);
  assert.equal(resolved.notifications[0].notificationKind, "resolved");
  assert.equal(Object.keys(resolved.nextState.active).length, 0);
});

test("alert state persists and atomically replaces an earlier version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "doom-keeper-state-"));
  const path = join(directory, "alerts.json");
  try {
    await writeAlertState(path, structuredClone(EMPTY_ALERT_STATE));
    const updated = {
      schema: EMPTY_ALERT_STATE.schema,
      active: { example: { lastSentAt: 123 } },
    };
    await writeAlertState(path, updated);
    assert.deepEqual(await readAlertState(path), updated);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Telegram formatting escapes untrusted on-chain text", () => {
  const message = formatTelegramAlert(
    {
      id: "test:<id>",
      severity: "critical",
      title: "Bad <title>",
      summary: "A & B",
      details: ["<script>"],
    },
    1_800_000_000,
  );
  assert.match(message, /&lt;title&gt;/);
  assert.match(message, /A &amp; B/);
  assert.doesNotMatch(message, /<script>/);
});

test("Telegram placeholder receives an actionable setup error", () => {
  assert.throws(
    () => validateBotToken("replace_with_botfather_token"),
    /still the placeholder; replace it with the token from @BotFather/,
  );
});

test("Telegram requests use POST and validate API success", async () => {
  const token = `123456:${"A".repeat(30)}`;
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    };
  };
  await sendTelegramAlert({
    token,
    chatId: "1234",
    observedAt: 1_800_000_000,
    alert: { id: "test", severity: "info", title: "Test", summary: "Works" },
    fetchImpl,
  });
  assert.equal(request.options.method, "POST");
  assert.equal(JSON.parse(request.options.body).chat_id, "1234");

  await assert.rejects(
    telegramRequest(token, "sendMessage", {}, async () => ({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, description: "Unauthorized" }),
    })),
    /Unauthorized/,
  );
});

test("collector reconstructs one launch through read-only contract calls", async () => {
  const addresses = {
    factory: "0x1111111111111111111111111111111111111111",
    positionLocker: "0x2222222222222222222222222222222222222222",
    doomRewards: "0x3333333333333333333333333333333333333333",
    liquidityManager: "0x4444444444444444444444444444444444444444",
    nftCollection: "0x5555555555555555555555555555555555555555",
    wrappedNative: "0x6666666666666666666666666666666666666666",
    operator: "0x7777777777777777777777777777777777777777",
    guardian: "0x8888888888888888888888888888888888888888",
    creator: "0x9999999999999999999999999999999999999999",
    treasury: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    manager: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    token: "0xcccccccccccccccccccccccccccccccccccccccc",
    pool: "0xdddddddddddddddddddddddddddddddddddddddd",
    escrow: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  };
  const values = {
    operator: addresses.operator,
    emergencyGuardian: addresses.guardian,
    approvedCreator: addresses.creator,
    treasury: addresses.treasury,
    doomRewards: addresses.doomRewards,
    wrappedNative: addresses.wrappedNative,
    liquidityManager: addresses.liquidityManager,
    positionLocker: addresses.positionLocker,
    launchesPaused: true,
    launchCount: 1n,
    maxLaunches: 3,
    maxNativeLiquidityPerLaunch: 10_000_000_000_000_000n,
    maxNativeLiquidityGlobal: 30_000_000_000_000_000n,
    campaignManager: addresses.manager,
    nftCollection: addresses.nftCollection,
    excludedHolder: addresses.treasury,
    feeRewardToken: addresses.wrappedNative,
    authorizedRegistrar: addresses.liquidityManager,
    positionManager: "0xffffffffffffffffffffffffffffffffffffffff",
    status: 0,
    completedCheckIns: 1,
    requiredCheckIns: 3,
    nextCheckInAt: 1_800_001_000n,
    nextDeadline: 1_800_002_000n,
  };
  const client = {
    getChainId: async () => 4663,
    getBlock: async ({ blockNumber } = {}) => ({
      number: blockNumber ?? 123n,
      timestamp: blockNumber ? 1_799_999_000n : 1_799_999_990n,
    }),
    getBytecode: async () => "0x01",
    getLogs: async () => [],
    readContract: async ({ functionName }) => {
      if (functionName === "getLaunch") {
        return {
          token: addresses.token,
          creator: addresses.creator,
          pool: addresses.pool,
          creatorEscrow: addresses.escrow,
          positionId: 42n,
          totalSupply: 1_000_000n,
          creatorLiquidAmount: 100_000n,
          liquidityTokenAmountAllocated: 400_000n,
          liquidityTokenAmountUsed: 400_000n,
          liquidityTokenRemainder: 0n,
          escrowTokenAmount: 500_000n,
          nativeLiquidityAmountRequested: 1n,
          nativeLiquidityAmountUsed: 1n,
          creationFee: 1n,
          treasuryFee: 0n,
          nftRewardFee: 1n,
          createdAt: 1_799_999_000,
          liquidityPermanent: true,
          sqrtPriceX96: 1n,
          configurationHash: `0x${"11".repeat(32)}`,
        };
      }
      if (functionName === "lockState") {
        return [addresses.pool, addresses.token, addresses.creator, addresses.escrow, 1n, 1_799_999_000, true, true];
      }
      if (functionName === "doomRewards") return addresses.doomRewards;
      if (functionName === "treasury") return addresses.treasury;
      if (["balanceOf", "availableRewards", "reservedRewards"].includes(functionName)) return 0n;
      return values[functionName];
    },
  };
  const keeperConfig = {
    chainId: 4663,
    factoryDeploymentBlock: "100",
    thresholds,
    contracts: {
      factory: addresses.factory,
      positionLocker: addresses.positionLocker,
      doomRewards: addresses.doomRewards,
      liquidityManager: addresses.liquidityManager,
      nonfungiblePositionManager: "0xffffffffffffffffffffffffffffffffffffffff",
      nftCollection: addresses.nftCollection,
      wrappedNative: addresses.wrappedNative,
    },
    expectedRoles: {
      operator: addresses.operator,
      emergencyGuardian: addresses.guardian,
      approvedCreator: addresses.creator,
      treasury: addresses.treasury,
      campaignManager: addresses.manager,
    },
    expectedCanaryLimits: {
      maxLaunches: "3",
      maxNativeLiquidityPerLaunch: "10000000000000000",
      maxNativeLiquidityGlobal: "30000000000000000",
    },
  };
  const state = await collectKeeperState(client, keeperConfig, 1_800_000_000);
  assert.equal(state.factory.launchCount, "1");
  assert.equal(state.launches[0].positionId, "42");
  assert.equal(state.launches[0].currentlyLocked, true);
  assert.equal(state.launches[0].completedCheckIns, 1);
  assert.equal(state.doomRewards.balances.length, 2);
});
