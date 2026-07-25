import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EMPTY_TRANSACTION = value =>
  value && Object.values(value).every(item => item === null);

export function validatePredeploymentManifest(manifest) {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };

  require(manifest?.schemaVersion === 1, "schemaVersion must be 1");
  require(manifest?.status === "draft_fail_closed", "status must be draft_fail_closed");
  require(manifest?.network?.chainId === 4663, "chainId must be 4663");
  require(manifest?.safety?.enabled === false, "deployment must remain disabled");
  require(manifest?.safety?.broadcast === false, "broadcast must remain false");
  require(
    manifest?.safety?.mainnetDeploymentApproved === false,
    "mainnetDeploymentApproved must remain false",
  );
  require(
    manifest?.safety?.finalOwnerApprovalRecorded === false,
    "finalOwnerApprovalRecorded must remain false",
  );
  require(
    manifest?.safety?.factoryMustRemainPaused === true,
    "factoryMustRemainPaused must be true",
  );

  for (const [name, value] of Object.entries(manifest?.roles || {})) {
    require(ADDRESS.test(value), `roles.${name} must be an address`);
  }
  for (const [name, value] of Object.entries(manifest?.dependencies || {})) {
    require(ADDRESS.test(value), `dependencies.${name} must be an address`);
  }

  const expectedOrder = [
    "DoomRewards",
    "PositionLocker",
    "V3LiquidityManager",
    "PositionLocker.bindRegistrar",
    "DoomLaunchFactory",
    "V3LiquidityManager.bindFactory",
  ];
  require(
    JSON.stringify(manifest?.deploymentOrder) === JSON.stringify(expectedOrder),
    "deploymentOrder does not match the dependency-safe sequence",
  );

  require(
    Object.values(manifest?.noncePlan || {}).every(value => value === null),
    "nonce plan must be empty before the signed rehearsal",
  );
  for (const [name, value] of Object.entries(manifest?.transactions || {})) {
    require(EMPTY_TRANSACTION(value), `transactions.${name} must be empty`);
  }
  require(
    Object.values(manifest?.verification || {}).every(value => value === false),
    "verification flags must be false before deployment",
  );
  require(
    Object.entries(manifest?.independentReview || {}).every(([key, value]) =>
      key === "allFindingsRemediated" || key === "focusedReReviewComplete"
        ? value === false
        : value === null
    ),
    "independent review fields must be empty and false",
  );
  require(
    manifest?.signing?.method === "rabby_browser_wallet",
    "signing method must be rabby_browser_wallet",
  );
  require(manifest?.signing?.wallet === "Rabby", "wallet must be Rabby");
  require(
    manifest?.signing?.dedicatedCanaryAccount === true,
    "Rabby signer must remain a dedicated canary account",
  );
  require(
    manifest?.signing?.addressVerifiedBySignature === true,
    "Rabby address verification must be recorded",
  );
  require(
    manifest?.signing?.addressVerificationEvidence ===
      "owner_confirmed_local_signature_recovery",
    "Rabby address-verification evidence is missing",
  );
  require(
    /^\d{4}-\d{2}-\d{2}$/.test(manifest?.signing?.addressVerificationRecordedAt || ""),
    "Rabby address-verification date is missing",
  );
  require(
    manifest?.signing?.rehearsalComplete === false,
    "Rabby transaction rehearsal must remain incomplete",
  );

  return errors;
}

async function main(path) {
  if (!path) throw new Error("usage: node verify-manifest.mjs <manifest.json>");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const errors = validatePredeploymentManifest(manifest);
  if (errors.length) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("Stage 4 manifest is valid and remains fail-closed.");
  console.log("No transaction address, hash, nonce, approval, or verification claim is populated.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv[2]);
}
