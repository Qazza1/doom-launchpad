import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const record = JSON.parse(await readFile(
  new URL("../../../config/public-v2-mainnet-activation-record.json", import.meta.url),
  "utf8",
));

test("public activation record contains one exact resume and no launch", () => {
  assert.equal(record.status, "public_v2_factory_activation_verified_success");
  assert.equal(record.transactionHash, "0x58c274165e5026c102a5ae13636515a68085d2807c0603980ab2c4227a87994e");
  assert.equal(record.transaction.nonce, 28);
  assert.equal(record.transaction.value, "0x0");
  assert.equal(record.transaction.data, "0xd255d203");
  assert.equal(record.receipt.status, 1);
  assert.equal(record.verification.providersAgreed, true);
  assert.equal(record.verification.publicFactoryPaused, false);
  assert.equal(record.verification.publicFactoryLaunchCount, 0);
  assert.equal(record.verification.legacyFactoryPaused, true);
  assert.equal(record.verification.legacyFactoryLaunchCount, 1);
  assert.equal(record.safety.tokenLaunchAuthorized, false);
  assert.equal(record.safety.tokenLaunched, false);
  assert.equal(record.safety.localhostSigningGateStopped, true);
});
