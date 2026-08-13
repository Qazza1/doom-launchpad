import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const record = JSON.parse(await readFile(
  new URL("../../../config/v2-mainnet-activation-record.json", import.meta.url),
  "utf8",
));

test("activation record captures exactly one successful resume and no launch", () => {
  assert.equal(record.status, "v2_factory_activation_verified_success");
  assert.equal(record.chainId, 4663);
  assert.equal(record.transaction.data, "0xd255d203");
  assert.equal(record.transaction.value, "0x0");
  assert.equal(record.transaction.nonce, 17);
  assert.equal(record.transaction.gasLimit, "50000");
  assert.equal(record.receipt.status, 1);
  assert.equal(record.verification.providersAgreed, true);
  assert.equal(record.verification.factoryPaused, false);
  assert.equal(record.verification.factoryLaunchCount, 0);
  assert.equal(record.verification.operatorPendingNonce, 18);
  assert.equal(record.safety.tokenLaunchAuthorized, false);
  assert.equal(record.safety.tokenLaunched, false);
  assert.equal(record.safety.localhostSigningGateStopped, true);
  assert.equal(record.nextGates.firstTokenLaunchRequiresSeparateAuthorization, true);
});
