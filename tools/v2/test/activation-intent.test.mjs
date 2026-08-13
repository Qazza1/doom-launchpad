import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const intent = JSON.parse(await readFile(new URL("../../../config/v2-mainnet-activation-intent.json", import.meta.url), "utf8"));
const deployment = JSON.parse(await readFile(new URL("../../../config/v2-mainnet-deployment-record.json", import.meta.url), "utf8"));

test("activation intent is exact, unfunded, unauthorized, and launch-free", () => {
  assert.equal(intent.status, "draft_unauthorized");
  assert.equal(intent.chainId, 4663);
  assert.equal(intent.from.toLowerCase(), deployment.deployer.toLowerCase());
  assert.equal(intent.to.toLowerCase(), deployment.addresses.launchFactory.toLowerCase());
  assert.equal(intent.value, "0x0");
  assert.equal(intent.function, "resumeLaunches()");
  assert.equal(intent.data, "0xd255d203");
  assert.equal(intent.nonce, null);
  assert.equal(intent.gasLimit, null);
  assert.equal(intent.safety.authorizationGranted, false);
  assert.equal(intent.safety.signed, false);
  assert.equal(intent.safety.broadcast, false);
  assert.equal(intent.safety.tokenLaunchAuthorized, false);
  assert.equal(intent.postconditions.noTokenLaunch, true);
});

test("activation cannot be confused with deployment or launch authorization", () => {
  assert.equal(deployment.safety.factoryResumeAuthorized, false);
  assert.equal(deployment.safety.tokenLaunchAuthorized, false);
  assert.match(intent.warning, /separate owner authorization/);
  assert.match(intent.warning, /does not authorize a token launch/);
});
