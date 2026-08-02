import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function json(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("production keeper is pinned to the verified deployment and the live pause state", async () => {
  const [keeper, deployment, manifest] = await Promise.all([
    json("../../../config/keeper.mainnet.json"),
    json("../../../config/robinhood-mainnet-stage4-deployment.json"),
    json("../../../config/stage4-deployment-manifest.json"),
  ]);
  const transactions = Object.fromEntries(
    deployment.deployment.transactions.map((transaction) => [transaction.operation, transaction]),
  );

  assert.equal(keeper.enabled, true);
  // The canary is running: the factory was resumed on 2026-08-01 and stays open until the owner
  // pauses it again. The keeper compares against the state that is meant to be true right now, so
  // this must be flipped back to true the moment the factory is paused — otherwise the one alert
  // that matters is the one it stops sending.
  assert.equal(keeper.expectedFactoryPaused, false);
  // The deployment record is historical evidence of how the contracts were deployed, and does not
  // move when the factory is resumed.
  assert.equal(deployment.status, "deployed_paused_verified");
  assert.equal(deployment.verification.factoryPausedVerified, true);
  assert.equal(deployment.verification.launchCount, 0);
  // Scanning starts at the first deployment, not the factory's, so PositionLocker.bindRegistrar at
  // block 25102641 falls inside the range instead of permanently outside it.
  assert.equal(keeper.factoryDeploymentBlock, String(transactions["Deploy DoomRewards"].blockNumber));
  assert.ok(
    BigInt(keeper.factoryDeploymentBlock) <= 25102641n,
    "the scan must start at or before the RegistrarBound event",
  );
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
