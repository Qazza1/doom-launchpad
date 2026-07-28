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

test("owner review waiver is narrow and never authorizes a transaction", () => {
  assert.equal(canonical.ownerRiskAcceptance.independentThirdPartyReviewWaived, true);
  assert.equal(canonical.ownerRiskAcceptance.scope, "capped_three_launch_mainnet_canary");
  assert.equal(canonical.ownerRiskAcceptance.nonBroadcastFinalizationAuthorized, true);
  assert.equal(canonical.ownerRiskAcceptance.mainnetDeploymentAuthorized, false);
  assert.equal(canonical.ownerRiskAcceptance.factoryResumeAuthorized, false);
  assert.equal(canonical.ownerRiskAcceptance.firstCanaryLaunchAuthorized, false);
  assert.equal(canonical.independentReview.reviewer, null);

  const broadened = copy();
  broadened.ownerRiskAcceptance.scope = "public_factory";
  broadened.ownerRiskAcceptance.mainnetDeploymentAuthorized = true;
  const errors = validatePredeploymentManifest(broadened);
  assert.ok(errors.some(error => error.includes("limited to the capped canary")));
  assert.ok(errors.some(error => error.includes("must not authorize mainnet deployment")));
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

test("the completed Rabby preview is recorded with evidence and claims nothing more", () => {
  assert.equal(canonical.previews.rabbyTransactionPreviewComplete, true);
  assert.equal(canonical.signing.rehearsalComplete, true);
  assert.notEqual(canonical.previews.rabbyTransactionPreviewChainId, 4663);
  assert.equal(canonical.safety.mainnetDeploymentApproved, false);

  const unevidenced = copy();
  unevidenced.previews.rabbyTransactionPreviewEvidence = "";
  unevidenced.previews.rabbyTransactionPreviewRecordedAt = "soon";
  const errors = validatePredeploymentManifest(unevidenced);
  assert.ok(errors.some(error => error.includes("Rabby preview must record its date")));
  assert.ok(errors.some(error => error.includes("committed evidence document")));
});

test("the rehearsal cannot claim the production chain or seed the production nonce plan", () => {
  const onProduction = copy();
  onProduction.previews.rabbyTransactionPreviewChainId = 4663;
  assert.ok(
    validatePredeploymentManifest(onProduction).some(error =>
      error.includes("must not claim to have run on the production chain")
    ),
  );

  // The rehearsal runs at an offset nonce on an isolated chain, so it can never be the source of a
  // production nonce.
  const seeded = copy();
  seeded.noncePlan.startingNonce = 1000;
  assert.ok(
    validatePredeploymentManifest(seeded).some(error =>
      error.includes("must not populate the production nonce plan")
    ),
  );
});

test("the signing rehearsal and the Rabby preview cannot disagree", () => {
  const halfClaimed = copy();
  halfClaimed.signing.rehearsalComplete = false;
  assert.ok(
    validatePredeploymentManifest(halfClaimed).some(error =>
      error.includes("signing rehearsal and the Rabby preview must agree")
    ),
  );

  const otherHalf = copy();
  otherHalf.previews.rabbyTransactionPreviewComplete = false;
  assert.ok(
    validatePredeploymentManifest(otherHalf).some(error =>
      error.includes("signing rehearsal and the Rabby preview must agree")
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

});
