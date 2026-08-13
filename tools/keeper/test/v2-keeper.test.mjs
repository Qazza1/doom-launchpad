import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateKeeperState } from "../lib/rules.mjs";

const config = JSON.parse(await readFile(new URL("../../../config/keeper-v2.mainnet.json", import.meta.url), "utf8"));
const liveConfig = JSON.parse(await readFile(new URL("../../../config/keeper-v2-live.mainnet.json", import.meta.url), "utf8"));

function state(overrides = {}) {
  return {
    protocolVersion: "v2", observedAt: 1_800_000_000, chainId: 4663,
    headNumber: "100", headTimestamp: 1_799_999_990,
    factory: {
      hasCode: true, launchesPaused: true, configurationValid: true, initialCreatorAllowed: true,
      expected: { operator: config.expectedRoles.operator }, actual: { operator: config.expectedRoles.operator },
    },
    components: {
      code: Object.fromEntries(Object.keys(config.contracts).map(name => [name, true])),
      deployerAuthorizedFactory: config.contracts.factory,
      manager: {
        authorizedFactory: config.contracts.factory, positionLocker: config.contracts.positionLocker,
        uniswapV3Factory: config.contracts.uniswapV3Factory,
        positionManager: config.contracts.nonfungiblePositionManager,
        wrappedNative: config.contracts.wrappedNative, expectedChainId: "4663",
      },
    },
    launches: [],
    ...overrides,
  };
}

test("V2 keeper config is pinned to the verified paused deployment", () => {
  assert.equal(config.schema, "doom.keeper-config.v2");
  assert.equal(config.contracts.factory, "0x142760D2C865537c063492933FB71ddefA2372C6");
  assert.equal(config.factoryDeploymentBlock, "35548791");
  assert.equal(config.expectedFactoryPaused, true);
  assert.equal(config.expectedCanaryLimits.maxLaunches, "100");
});

test("live monitoring changes only the expected pause state", () => {
  assert.equal(liveConfig.expectedFactoryPaused, false);
  assert.deepEqual({ ...liveConfig, expectedFactoryPaused: true }, config);
});

test("healthy paused V2 pre-launch state emits no alerts", () => {
  assert.deepEqual(evaluateKeeperState(state(), config), []);
});

test("unexpected V2 activation and broken graduation lock alert critically", () => {
  const alerts = evaluateKeeperState(state({
    factory: { ...state().factory, launchesPaused: false },
    launches: [{ launchId: "1", graduated: true, pool: config.contracts.factory, positionId: "99", currentlyLocked: false, escrowStatus: 1 }],
  }), config);
  assert.ok(alerts.some(item => item.id === "factory:pause-state" && item.severity === "critical"));
  assert.ok(alerts.some(item => item.id === "v2-launch:1:lock" && item.severity === "critical"));
});
