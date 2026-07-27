import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CONTRACT_NAMES,
  assertAddressesComplete,
  compareObserved,
  compareProviders,
  decodeAddress,
  decodeBool,
  decodeUint,
  expectedState,
} from "../verify-deployment.mjs";
import { resolveDeploymentInputs } from "../verification-bundle.mjs";

const manifest = JSON.parse(
  await readFile(new URL("../../../config/stage4-deployment-manifest.json", import.meta.url), "utf8"),
);
const decisions = JSON.parse(
  await readFile(
    new URL("../../../config/robinhood-mainnet-canary.decisions.json", import.meta.url),
    "utf8",
  ),
);
const { inputs } = resolveDeploymentInputs(manifest, decisions);
const addresses = {
  DoomRewards: "0x615f6E6B0AEA7Ac94F4391424aF601F9290dd9dC",
  PositionLocker: "0xdaE01c32131fF283f403b4C1fD71018Fa31cfAC0",
  V3LiquidityManager: "0xbf36be8861ca4fe9920B10fc526E3fD039F88519",
  DoomLaunchFactory: "0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE",
};
const expected = () => expectedState(inputs, decisions, addresses);
const healthy = () => Object.fromEntries(
  Object.entries(expected()).map(([contract, calls]) => [
    contract,
    Object.fromEntries(Object.entries(calls).map(([signature, [, want]]) => [signature, want])),
  ]),
);

test("word decoding handles addresses, integers, and booleans", () => {
  assert.equal(
    decodeAddress("0x000000000000000000000000cab166ed15e63b846ec8d1a2d6762a33392c796f"),
    "0xcab166ed15e63b846ec8d1a2d6762a33392c796f",
  );
  assert.equal(decodeUint("0x0000000000000000000000000000000000000000000000000000000000002710"), "10000");
  assert.equal(decodeBool("0x0000000000000000000000000000000000000000000000000000000000000001"), true);
  assert.equal(decodeBool("0x0000000000000000000000000000000000000000000000000000000000000000"), false);
});

test("the expected state covers the frozen economics and the paused factory", () => {
  const state = expected();
  assert.deepEqual(Object.keys(state).sort(), [...CONTRACT_NAMES].sort());
  assert.deepEqual(state.DoomLaunchFactory["launchesPaused()"], ["bool", true]);
  assert.deepEqual(state.DoomLaunchFactory["CREATION_FEE_BPS()"], ["uint", "100"]);
  assert.deepEqual(state.DoomLaunchFactory["CREATOR_LIQUID_BPS()"], ["uint", "0"]);
  assert.deepEqual(state.DoomLaunchFactory["LIQUIDITY_BPS()"], ["uint", "4000"]);
  assert.deepEqual(state.DoomLaunchFactory["GM_ESCROW_BPS()"], ["uint", "6000"]);
  assert.deepEqual(state.DoomLaunchFactory["REQUIRED_GM_CHECK_INS()"], ["uint", "3"]);
  assert.deepEqual(
    state.DoomLaunchFactory["maxNativeLiquidityGlobal()"],
    ["uint", "30000000000000000"],
  );
  assert.deepEqual(state.PositionLocker["CREATOR_WETH_FEE_BPS()"], ["uint", "7000"]);
  assert.deepEqual(state.V3LiquidityManager["expectedChainId()"], ["uint", "4663"]);
  // The bindings must point at each other, not at anything else.
  assert.deepEqual(
    state.PositionLocker["authorizedRegistrar()"],
    ["address", addresses.V3LiquidityManager],
  );
  assert.deepEqual(
    state.V3LiquidityManager["authorizedFactory()"],
    ["address", addresses.DoomLaunchFactory],
  );
});

test("a fully matching deployment passes", () => {
  assert.deepEqual(compareObserved(expected(), healthy()), []);
});

test("an unpaused factory is a failure", () => {
  const observed = healthy();
  observed.DoomLaunchFactory["launchesPaused()"] = false;
  const errors = compareObserved(expected(), observed);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("launchesPaused"));
});

test("a wrong role, dependency, binding, or cap is a failure", () => {
  const observed = healthy();
  observed.DoomLaunchFactory["treasury()"] = "0x1111111111111111111111111111111111111111";
  observed.V3LiquidityManager["authorizedFactory()"] = "0x2222222222222222222222222222222222222222";
  observed.PositionLocker["doomRewards()"] = "0x3333333333333333333333333333333333333333";
  observed.DoomLaunchFactory["maxNativeLiquidityPerLaunch()"] = "1000000000000000000";
  const errors = compareObserved(expected(), observed);
  assert.equal(errors.length, 4);
  assert.ok(errors.some(error => error.includes("treasury")));
  assert.ok(errors.some(error => error.includes("authorizedFactory")));
  assert.ok(errors.some(error => error.includes("doomRewards")));
  assert.ok(errors.some(error => error.includes("maxNativeLiquidityPerLaunch")));
});

test("address comparison ignores checksum case but nothing else", () => {
  const observed = healthy();
  observed.DoomLaunchFactory["doomRewards()"] = addresses.DoomRewards.toLowerCase();
  assert.deepEqual(compareObserved(expected(), observed), []);
});

test("a missing return value is a failure rather than a pass", () => {
  const observed = healthy();
  delete observed.DoomRewards["campaignManager()"];
  observed.PositionLocker["treasury()"] = null;
  const errors = compareObserved(expected(), observed);
  assert.ok(errors.some(error => error.includes("campaignManager() returned nothing")));
  assert.ok(errors.some(error => error.includes("treasury() returned nothing")));
});

test("providers must agree on bytecode and on every read", () => {
  const primary = {
    DoomRewards: { code: "0x6080", calls: { "campaignManager()": "0xabc", "nextCampaignId()": "1" } },
  };
  assert.deepEqual(compareProviders(primary, structuredClone(primary)), []);

  const differentCode = structuredClone(primary);
  differentCode.DoomRewards.code = "0x6081";
  assert.deepEqual(compareProviders(primary, differentCode), [
    "providers returned different runtime bytecode for DoomRewards",
  ]);

  const differentCall = structuredClone(primary);
  differentCall.DoomRewards.calls["nextCampaignId()"] = "2";
  assert.deepEqual(compareProviders(primary, differentCall), [
    "providers disagree on DoomRewards.nextCampaignId()",
  ]);

  // A provider that returns nothing at all must not read as agreement.
  assert.ok(compareProviders(primary, {}).length > 0);
});

test("the deployed address set must be complete, non-zero, and distinct", () => {
  assert.deepEqual(assertAddressesComplete(addresses), []);

  const missing = { ...addresses, PositionLocker: undefined };
  assert.ok(assertAddressesComplete(missing).some(error => error.includes("PositionLocker address is missing")));

  const zeroed = { ...addresses, DoomRewards: "0x0000000000000000000000000000000000000000" };
  assert.ok(assertAddressesComplete(zeroed).some(error => error.includes("must not be the zero address")));

  const duplicated = { ...addresses, V3LiquidityManager: addresses.PositionLocker };
  assert.ok(assertAddressesComplete(duplicated).some(error => error.includes("share the same address")));
});
