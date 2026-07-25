import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validatePredeploymentManifest } from "../verify-manifest.mjs";

const canonical = JSON.parse(
  await readFile(new URL("../../../config/stage4-deployment-manifest.json", import.meta.url), "utf8"),
);
const copy = () => structuredClone(canonical);

test("canonical Stage 4 manifest is fail-closed", () => {
  assert.deepEqual(validatePredeploymentManifest(copy()), []);
});

test("broadcast approval is rejected", () => {
  const manifest = copy();
  manifest.safety.broadcast = true;
  manifest.safety.mainnetDeploymentApproved = true;
  const errors = validatePredeploymentManifest(manifest);
  assert.ok(errors.some(error => error.includes("broadcast must remain false")));
  assert.ok(errors.some(error => error.includes("mainnetDeploymentApproved")));
});

test("dependency-unsafe deployment order is rejected", () => {
  const manifest = copy();
  [manifest.deploymentOrder[0], manifest.deploymentOrder[1]] =
    [manifest.deploymentOrder[1], manifest.deploymentOrder[0]];
  assert.ok(
    validatePredeploymentManifest(manifest)
      .some(error => error.includes("dependency-safe sequence")),
  );
});

test("populated transaction or verification claims are rejected", () => {
  const manifest = copy();
  manifest.transactions.doomRewards.address = "0x1111111111111111111111111111111111111111";
  manifest.verification.runtimeBytecodeVerified = true;
  const errors = validatePredeploymentManifest(manifest);
  assert.ok(errors.some(error => error.includes("transactions.doomRewards")));
  assert.ok(errors.some(error => error.includes("verification flags")));
});

test("signing workflow cannot silently change or claim completion", () => {
  const wrongWallet = copy();
  wrongWallet.signing.method = "hardware_wallet";
  assert.ok(
    validatePredeploymentManifest(wrongWallet).some(error =>
      error.includes("signing method must be rabby_browser_wallet")
    ),
  );

  const sharedWallet = copy();
  sharedWallet.signing.dedicatedCanaryAccount = false;
  assert.ok(
    validatePredeploymentManifest(sharedWallet).some(error =>
      error.includes("dedicated canary account")
    ),
  );

  const prematureVerification = copy();
  prematureVerification.signing.addressVerifiedBySignature = true;
  assert.ok(
    validatePredeploymentManifest(prematureVerification).some(error =>
      error.includes("address verification must remain false")
    ),
  );
});
