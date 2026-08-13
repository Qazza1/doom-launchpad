import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EXPECTED_ORDER = [
  "DoomLaunchDeployerV2",
  "PositionLockerV2",
  "V3GraduationManagerV2",
  "PositionLockerV2.bindRegistrar",
  "DoomLaunchFactoryV2",
  "DoomLaunchDeployerV2.bindFactory",
  "V3GraduationManagerV2.bindFactory",
];

const requireValue = (errors, condition, message) => {
  if (!condition) errors.push(message);
};

export function validateV2Manifest(manifest) {
  const errors = [];
  requireValue(errors, manifest?.schemaVersion === 1, "schemaVersion must be 1");
  requireValue(errors, manifest?.status === "draft_fail_closed", "status must remain draft_fail_closed");
  requireValue(errors, manifest?.network?.chainId === 4663, "chainId must be 4663");
  requireValue(errors, manifest?.source?.compiler === "0.8.36", "compiler must be 0.8.36");
  requireValue(errors, manifest?.source?.foundry === "1.7.1", "Foundry must be 1.7.1");
  requireValue(errors, manifest?.source?.evmVersion === "cancun", "EVM version must be cancun");
  requireValue(errors, manifest?.source?.viaIr === true, "viaIR must remain enabled");

  requireValue(errors, manifest?.safety?.broadcast === false, "broadcast must remain false");
  requireValue(errors, manifest?.safety?.deploymentAuthorized === false, "deployment must remain unauthorized");
  requireValue(errors, manifest?.safety?.factoryResumeAuthorized === false, "factory resume must remain unauthorized");
  requireValue(errors, manifest?.safety?.factoryMustRemainPaused === true, "factory must remain paused");
  requireValue(errors, manifest?.safety?.privateKeysAllowedInManifest === false, "private keys must be prohibited");

  for (const [name, value] of Object.entries(manifest?.roles || {})) {
    requireValue(errors, ADDRESS.test(value), `roles.${name} must be an address`);
  }
  for (const [name, value] of Object.entries(manifest?.dependencies || {})) {
    requireValue(errors, ADDRESS.test(value), `dependencies.${name} must be an address`);
  }
  requireValue(
    errors,
    JSON.stringify(manifest?.deploymentOrder) === JSON.stringify(EXPECTED_ORDER),
    "deploymentOrder must match the dependency-safe seven-step sequence",
  );
  requireValue(errors, manifest?.economics?.launchFeeWei === "1000000000000000", "launch fee must be 0.001 ETH");
  requireValue(errors, manifest?.economics?.graduationTargetWei === "50000000000000000", "target must be 0.05 ETH");
  requireValue(errors, manifest?.economics?.poolFee === 10000, "pool fee must be 1%");
  requireValue(errors, manifest?.economics?.tickSpacing === 200, "tick spacing must be 200");
  requireValue(errors, manifest?.economics?.maximumLaunches === 100, "launch cap must be 100");
  requireValue(errors, Object.values(manifest?.outputs || {}).every(value => value === null), "deployment outputs must be empty");
  requireValue(errors, manifest?.gates?.internalTestsPassed === true, "internal tests must have passed");
  requireValue(errors, manifest?.gates?.postPrimaryRotationDualRpcForkPassed === true, "dual-RPC fork gate must have passed");
  requireValue(errors, manifest?.gates?.bytecodeSizesWithinLimits === true, "bytecode size gate must have passed");
  requireValue(
    errors,
    manifest?.gates?.dualRpcNoBroadcastDeploymentRehearsalPassed === true,
    "dual-RPC no-broadcast deployment rehearsal must have passed",
  );
  requireValue(
    errors,
    /^\d{4}-\d{2}-\d{2}$/.test(manifest?.gates?.dualRpcNoBroadcastDeploymentRehearsalRecordedAt || ""),
    "dual-RPC rehearsal date must be recorded",
  );
  requireValue(
    errors,
    manifest?.gates?.dualRpcNoBroadcastDeploymentRehearsalEvidence ===
      "docs/v2-no-broadcast-rehearsal-2026-08-13.md",
    "dual-RPC rehearsal evidence path must be recorded",
  );
  requireValue(errors, manifest?.gates?.explicitBroadcastApproval === false, "broadcast approval must remain false");
  return errors;
}

async function main(path) {
  if (!path) throw new Error("usage: node tools/v2/verify-manifest.mjs <manifest.json>");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  const errors = validateV2Manifest(manifest);
  if (errors.length) throw new Error(errors.join("; "));
  console.log("V2 manifest is valid and remains fail-closed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch(error => {
    console.error(`V2 manifest validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
