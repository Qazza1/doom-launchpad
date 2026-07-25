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

test("localhost preview state is recorded with evidence and claims nothing else", () => {
  assert.equal(canonical.previews.localhostSequencePreviewComplete, true);
  assert.equal(canonical.previews.rabbyTransactionPreviewComplete, false);
  assert.equal(canonical.signing.rehearsalComplete, false);
  assert.ok(Object.values(canonical.gasPlan).every(value => value === null || value === 2500));

  const unevidenced = copy();
  unevidenced.previews.localhostSequencePreviewCommit = null;
  unevidenced.previews.localhostSequencePreviewEvidence = "";
  const errors = validatePredeploymentManifest(unevidenced);
  assert.ok(errors.some(error => error.includes("exact source commit")));
  assert.ok(errors.some(error => error.includes("committed evidence document")));

  const missingFlag = copy();
  delete missingFlag.previews.localhostSequencePreviewComplete;
  assert.ok(
    validatePredeploymentManifest(missingFlag).some(error =>
      error.includes("localhostSequencePreviewComplete must be a boolean")
    ),
  );
});

test("the verification rehearsal is recorded without claiming verified deployed source", () => {
  assert.equal(canonical.previews.blockscoutVerificationRehearsalComplete, true);
  assert.equal(canonical.verification.sourceVerifiedOnBlockscout, false);

  const unevidenced = copy();
  unevidenced.previews.blockscoutVerificationRehearsalEvidence = "";
  assert.ok(
    validatePredeploymentManifest(unevidenced).some(error =>
      error.includes("verification rehearsal must reference its committed evidence")
    ),
  );

  const wrongCompiler = copy();
  wrongCompiler.previews.blockscoutVerificationCompilerVersion = "v0.8.30+commit.aaaaaaaa";
  assert.ok(
    validatePredeploymentManifest(wrongCompiler).some(error =>
      error.includes("exact pinned build")
    ),
  );
});

test("a live-wallet transaction preview cannot be claimed from the localhost preview", () => {
  const claimed = copy();
  claimed.previews.rabbyTransactionPreviewComplete = true;
  assert.ok(
    validatePredeploymentManifest(claimed).some(error =>
      error.includes("Rabby transaction preview must remain incomplete")
    ),
  );
});

test("signing workflow cannot silently change, roll back verification, or claim rehearsal", () => {
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

  const missingVerification = copy();
  missingVerification.signing.addressVerifiedBySignature = false;
  assert.ok(
    validatePredeploymentManifest(missingVerification).some(error =>
      error.includes("address verification must be recorded")
    ),
  );

  const prematureRehearsal = copy();
  prematureRehearsal.signing.rehearsalComplete = true;
  assert.ok(
    validatePredeploymentManifest(prematureRehearsal).some(error =>
      error.includes("transaction rehearsal must remain incomplete")
    ),
  );
});
