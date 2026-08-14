import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateKeeperState } from "../lib/rules.mjs";

const config = JSON.parse(await readFile(new URL("../../../config/keeper-v2.mainnet.json", import.meta.url), "utf8"));
const liveConfig = JSON.parse(await readFile(new URL("../../../config/keeper-v2-live.mainnet.json", import.meta.url), "utf8"));
const publicConfig = JSON.parse(await readFile(new URL("../../../config/keeper-public-v2.mainnet.json", import.meta.url), "utf8"));

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

test("legacy live monitoring expects the completed public-cutover pause", () => {
  assert.equal(liveConfig.expectedFactoryPaused, true);
  assert.deepEqual(liveConfig, config);
});

test("public successor keeper is pinned to the verified paused deployment", () => {
  assert.equal(publicConfig.enabled, true);
  assert.equal(publicConfig.creatorPolicy, "permissionless_eoa");
  assert.equal(publicConfig.expectedCanaryLimits.firstLaunchId, "2");
  assert.equal(publicConfig.expectedCanaryLimits.finalLaunchId, "100");
  assert.equal(publicConfig.factoryDeploymentBlock, "36216119");
  assert.equal(publicConfig.contracts.factory, "0x8f8c948A6558C79531317b4AD7CfdBa4e9728f24");
  assert.equal(publicConfig.expectedFactoryPaused, true);
});

test("permissionless successor does not expect an allowlisted creator", () => {
  const permissionless = {
    ...config,
    creatorPolicy: "permissionless_eoa",
    expectedRoles: {
      operator: config.expectedRoles.operator,
      emergencyGuardian: config.expectedRoles.emergencyGuardian,
      treasury: config.expectedRoles.treasury,
    },
  };
  const publicState = state({
    factory: { ...state().factory, initialCreatorAllowed: null },
  });
  assert.equal(evaluateKeeperState(publicState, permissionless).some(alert => alert.id === "factory:creator-disabled"), false);
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
