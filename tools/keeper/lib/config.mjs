import { readFile } from "node:fs/promises";
import { parseJson } from "../../lib/json-file.mjs";
import { getAddress } from "viem";

const POSITIVE_INTEGER_FIELDS = [
  "rpcStaleSeconds",
  "rpcFutureToleranceSeconds",
  "gmReminderLeadSeconds",
  "gmCriticalLeadSeconds",
  "feeCollectionReminderSeconds",
  "feeLogLookbackBlocks",
  "warningRepeatSeconds",
  "criticalRepeatSeconds",
  "infoRepeatSeconds",
];

export async function readKeeperConfig(path) {
  const input = parseJson(await readFile(path, "utf8"), path);
  if (!["doom.keeper-config.v1", "doom.keeper-config.v2"].includes(input?.schema)) {
    throw new Error("Unsupported keeper config schema");
  }
  if (typeof input.enabled !== "boolean") throw new Error("enabled must be boolean");
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error("chainId must be a positive integer");
  if (typeof input.expectedFactoryPaused !== "boolean") throw new Error("expectedFactoryPaused must be boolean");
  if (input.schema === "doom.keeper-config.v2" && !["allowlisted_eoa", "permissionless_eoa"].includes(input.creatorPolicy || "allowlisted_eoa")) {
    throw new Error("creatorPolicy must be allowlisted_eoa or permissionless_eoa");
  }
  if (typeof input.rpcUrlEnvironmentVariable !== "string") throw new Error("Missing primary RPC environment name");
  if (typeof input.fallbackRpcUrlEnvironmentVariable !== "string") throw new Error("Missing fallback RPC environment name");
  for (const field of POSITIVE_INTEGER_FIELDS) {
    if (!Number.isSafeInteger(input.thresholds?.[field]) || input.thresholds[field] <= 0) {
      throw new Error(`thresholds.${field} must be a positive integer`);
    }
  }
  if (input.thresholds.gmCriticalLeadSeconds >= input.thresholds.gmReminderLeadSeconds) {
    throw new Error("GM critical lead must be shorter than reminder lead");
  }

  if (!input.enabled) return input;
  if (!/^(0|[1-9][0-9]*)$/.test(input.factoryDeploymentBlock)) {
    throw new Error("factoryDeploymentBlock must be a decimal string");
  }
  for (const [name, address] of Object.entries(input.contracts ?? {})) {
    input.contracts[name] = getAddress(address);
  }
  for (const [name, address] of Object.entries(input.expectedRoles ?? {})) {
    input.expectedRoles[name] = getAddress(address);
  }
  for (const [name, value] of Object.entries(input.expectedCanaryLimits ?? {})) {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`expectedCanaryLimits.${name} must be a decimal string`);
  }
  return input;
}
