import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function json(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("production keeper is pinned to the paused verified deployment", async () => {
  const [keeper, deployment, manifest] = await Promise.all([
    json("../../../config/keeper.mainnet.json"),
    json("../../../config/robinhood-mainnet-stage4-deployment.json"),
    json("../../../config/stage4-deployment-manifest.json"),
  ]);
  const transactions = Object.fromEntries(
    deployment.deployment.transactions.map((transaction) => [transaction.operation, transaction]),
  );

  assert.equal(keeper.enabled, true);
  assert.equal(keeper.expectedFactoryPaused, true);
  assert.equal(deployment.status, "deployed_paused_verified");
  assert.equal(deployment.verification.factoryPausedVerified, true);
  assert.equal(deployment.verification.launchCount, 0);
  assert.equal(keeper.factoryDeploymentBlock, String(transactions["Deploy DoomLaunchFactory"].blockNumber));
  assert.equal(keeper.contracts.factory.toLowerCase(), transactions["Deploy DoomLaunchFactory"].address.toLowerCase());
  assert.equal(keeper.contracts.positionLocker.toLowerCase(), transactions["Deploy PositionLocker"].address.toLowerCase());
  assert.equal(keeper.contracts.doomRewards.toLowerCase(), transactions["Deploy DoomRewards"].address.toLowerCase());
  assert.equal(keeper.contracts.liquidityManager.toLowerCase(), transactions["Deploy V3LiquidityManager"].address.toLowerCase());
  assert.equal(keeper.expectedRoles.operator.toLowerCase(), manifest.roles.operator.toLowerCase());
  assert.equal(keeper.expectedRoles.emergencyGuardian.toLowerCase(), manifest.roles.emergencyGuardian.toLowerCase());
  assert.equal(keeper.expectedRoles.approvedCreator.toLowerCase(), manifest.roles.approvedCreator.toLowerCase());
  assert.equal(keeper.expectedRoles.treasury.toLowerCase(), manifest.roles.treasury.toLowerCase());
  assert.equal(keeper.expectedRoles.campaignManager.toLowerCase(), manifest.roles.campaignManager.toLowerCase());
  assert.equal(keeper.contracts.nftCollection.toLowerCase(), manifest.dependencies.nftCollection.toLowerCase());
  assert.equal(keeper.contracts.wrappedNative.toLowerCase(), manifest.dependencies.wrappedNative.toLowerCase());
  assert.equal(
    keeper.contracts.nonfungiblePositionManager.toLowerCase(),
    manifest.dependencies.nonfungiblePositionManager.toLowerCase(),
  );
});
