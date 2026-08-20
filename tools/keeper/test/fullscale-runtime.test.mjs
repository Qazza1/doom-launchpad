import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildFullScaleKeeperConfig } from "../lib/fullscale-runtime.mjs";

const template = JSON.parse(await readFile(
  new URL("../../../config/keeper-fullscale-v3.template.json", import.meta.url),
  "utf8",
));

const completeEnvironment = {
  DOOM_FULLSCALE_V3_ENABLED: "1",
  DOOM_FULLSCALE_V3_FACTORY: "0x1111111111111111111111111111111111111111",
  DOOM_FULLSCALE_V3_FACTORY_DEPLOYMENT_BLOCK: "123",
  DOOM_FULLSCALE_V3_POSITION_LOCKER: "0x2222222222222222222222222222222222222222",
  DOOM_FULLSCALE_V3_GRADUATION_MANAGER: "0x3333333333333333333333333333333333333333",
  DOOM_FULLSCALE_V3_CURVE_DEPLOYER: "0x4444444444444444444444444444444444444444",
};

test("full-scale keeper remains disabled without explicit opt-in", () => {
  assert.equal(buildFullScaleKeeperConfig(template, {}), null);
});

test("full-scale keeper config is unbounded and generated entirely from final runtime values", () => {
  const config = buildFullScaleKeeperConfig(template, completeEnvironment);
  assert.equal(config.enabled, true);
  assert.equal(config.unboundedLaunches, true);
  assert.equal(config.expectedCanaryLimits.firstLaunchId, "101");
  assert.equal(config.factoryDeploymentBlock, "123");
  assert.equal(config.contracts.factory, completeEnvironment.DOOM_FULLSCALE_V3_FACTORY);
});

test("partial full-scale keeper configuration fails closed", () => {
  assert.throws(
    () => buildFullScaleKeeperConfig(template, { DOOM_FULLSCALE_V3_ENABLED: "1" }),
    /is required/,
  );
});

test("daemon supports three generations without embedding final addresses", async () => {
  const source = await readFile(new URL("../daemon.mjs", import.meta.url), "utf8");
  assert.match(source, /secondaryConfigPath/);
  assert.match(source, /tertiaryConfigPath/);
  assert.match(source, /buildFullScaleKeeperConfig/);
});
