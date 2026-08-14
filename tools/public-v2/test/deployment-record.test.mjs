import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const record = JSON.parse(await readFile(
  new URL("../../../config/public-v2-mainnet-deployment-record.json", import.meta.url),
  "utf8",
));
const planBody = await readFile(new URL("../output/transaction-plan.json", import.meta.url), "utf8");
const plan = JSON.parse(planBody);

test("public deployment record matches the exact seven-transaction plan", () => {
  assert.equal(record.status, "public_v2_mainnet_deployment_verified_paused");
  assert.equal(record.planSha256, createHash("sha256").update(planBody).digest("hex"));
  assert.equal(record.transactions.length, 7);
  assert.deepEqual(record.transactions.map(item => item.nonce), [19, 20, 21, 22, 23, 24, 25]);
  assert.ok(record.transactions.every(item => item.status === "verified_success"));
  assert.equal(record.addresses.launchFactory.toLowerCase(), plan.transactions[4].predictedAddress.toLowerCase());
});

test("public deployment record remains paused, empty, provider-agreed, and unactivated", () => {
  assert.equal(record.verification.receiptCount, 7);
  assert.equal(record.verification.providersAgreed, true);
  assert.equal(record.verification.allRuntimeBytecodesMatch, true);
  assert.equal(record.verification.factoryPaused, true);
  assert.equal(record.verification.factoryLaunchCount, 0);
  assert.equal(record.verification.firstLaunchId, 2);
  assert.equal(record.verification.finalLaunchId, 100);
  assert.equal(record.safety.factoryResumeAuthorized, false);
  assert.equal(record.safety.tokenLaunchAuthorized, false);
});
