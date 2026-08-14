import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const record = JSON.parse(await readFile(
  new URL("../../../config/public-v2-legacy-pause-record.json", import.meta.url),
  "utf8",
));

test("legacy pause record preserves Genesis and leaves public activation unauthorized", () => {
  assert.equal(record.status, "legacy_factory_pause_verified_success");
  assert.equal(record.successfulTransaction.nonce, 26);
  assert.equal(record.successfulTransaction.value, "0");
  assert.equal(record.successfulTransaction.calldata, "0xe79b502e");
  assert.equal(record.successfulTransaction.receiptStatus, 1);
  assert.equal(record.duplicateRevertedTransaction.nonce, 27);
  assert.equal(record.duplicateRevertedTransaction.receiptStatus, 0);
  assert.equal(record.verification.legacyFactoryPaused, true);
  assert.equal(record.verification.legacyFactoryLaunchCount, 1);
  assert.equal(record.verification.genesisLaunchPreserved, true);
  assert.equal(record.verification.publicFactoryRemainsPaused, true);
  assert.equal(record.safety.publicFactoryResumeAuthorized, false);
  assert.equal(record.safety.tokenLaunchAuthorized, false);
});
