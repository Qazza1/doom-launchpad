import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareRuntimeBytecode } from "../deployment/verification-bundle.mjs";
import { validateEndpointPair } from "../v2/network-preflight.mjs";

export const CHAIN_ID = 4663;
export const PUBLIC_FACTORY = "0x8f8c948A6558C79531317b4AD7CfdBa4e9728f24";
export const EXPECTED = Object.freeze({
  firstLaunchId: 2,
  finalLaunchId: 100,
  maximumLaunches: 99,
  launchFeeWei: "1000000000000000",
  launchCount: 0,
  nextLaunchId: 2,
});

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const quantity = value => Number(BigInt(value));
const bool = value => BigInt(value) === 1n;
const lower = value => String(value ?? "").toLowerCase();

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message || "RPC error"}`);
  return body.result;
}

async function json(url, label) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return response.json();
}

async function inspectProvider(label, url, artifact) {
  const call = signature => rpc(url, "eth_call", [{
    to: PUBLIC_FACTORY,
    data: `0x${artifact.methodIdentifiers[signature]}`,
  }, "latest"]);
  const [chainId, blockNumber, code, paused, valid, count, nextId, firstId, finalId, max, fee] = await Promise.all([
    rpc(url, "eth_chainId"),
    rpc(url, "eth_blockNumber"),
    rpc(url, "eth_getCode", [PUBLIC_FACTORY, "latest"]),
    call("launchesPaused()"),
    call("isLaunchConfigurationValid()"),
    call("launchCount()"),
    call("nextLaunchId()"),
    call("FIRST_LAUNCH_ID()"),
    call("FINAL_LAUNCH_ID()"),
    call("MAX_LAUNCHES()"),
    call("LAUNCH_FEE()"),
  ]);
  const runtime = compareRuntimeBytecode(
    code,
    artifact.deployedBytecode.object,
    artifact.deployedBytecode.immutableReferences,
  );
  return {
    label,
    chainId: quantity(chainId),
    blockNumber: quantity(blockNumber),
    runtimeMatches: runtime.matches,
    runtimeReason: runtime.reason,
    paused: bool(paused),
    configurationValid: bool(valid),
    launchCount: quantity(count),
    nextLaunchId: quantity(nextId),
    firstLaunchId: quantity(firstId),
    finalLaunchId: quantity(finalId),
    maximumLaunches: quantity(max),
    launchFeeWei: BigInt(fee).toString(),
  };
}

export function validateCanaryReadiness({ primary, fallback, website, indexer, keeper }) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  for (const provider of [primary, fallback]) {
    require(provider.chainId === CHAIN_ID, `${provider.label} chain ID differs`);
    require(provider.runtimeMatches === true, `${provider.label} factory runtime differs`);
    require(provider.paused === false, `${provider.label} factory is paused`);
    require(provider.configurationValid === true, `${provider.label} factory configuration is invalid`);
    for (const [key, value] of Object.entries(EXPECTED)) {
      require(String(provider[key]) === String(value), `${provider.label} ${key} differs`);
    }
  }
  require(Math.abs(primary.blockNumber - fallback.blockNumber) <= 500, "provider heads differ by more than 500 blocks");

  require(website.chainId === CHAIN_ID, "website chain ID differs");
  require(lower(website.factory) === lower(PUBLIC_FACTORY), "website factory differs");
  require(website.transactionsEnabled === true, "website launch transactions are disabled");
  require(website.creatorPolicy === "permissionless_eoa", "website creator policy is not permissionless EOA");
  require(website.activationPolicy === "public_launches_live", "website activation policy is not public live");
  require(website.firstLaunchId === EXPECTED.firstLaunchId, "website first launch ID differs");
  require(website.factoryMaximumLaunches === EXPECTED.maximumLaunches, "website factory launch cap differs");

  const publicFactory = indexer.factories?.find(factory => factory.role === "public");
  require(indexer.status === "ok", "V2 indexer status is not ok");
  require(indexer.confidence === "high", "V2 indexer confidence is not high");
  require(indexer.blocks_behind === 0, "V2 indexer is behind");
  require(indexer.last_error === null, "V2 indexer reports an error");
  require(lower(indexer.public_factory) === lower(PUBLIC_FACTORY), "V2 indexer public factory differs");
  require(publicFactory?.paused === false, "V2 indexer reports the public factory paused");
  require(publicFactory?.configuration_valid === true, "V2 indexer reports invalid public configuration");
  require(publicFactory?.launch_count === EXPECTED.launchCount, "V2 indexer public launch count differs");

  const publicMonitor = keeper.monitored_factories?.find(factory => lower(factory.factory) === lower(PUBLIC_FACTORY));
  require(keeper.status === "ok", "keeper status is not ok");
  require(keeper.read_only === true, "keeper is not read-only");
  require(keeper.consecutive_failures === 0, "keeper has consecutive failures");
  require(Array.isArray(keeper.last_monitor_exit_codes) && keeper.last_monitor_exit_codes.every(code => code === 0), "keeper monitor exit code is non-zero");
  require(publicMonitor?.enabled === true, "public factory keeper monitor is disabled");
  require(publicMonitor?.expected_factory_paused === false, "keeper expects the public factory paused");
  return errors;
}

export async function main() {
  const primaryUrl = process.env.ROBINHOOD_RPC_URL || "";
  const fallbackUrl = process.env.ROBINHOOD_FALLBACK_RPC_URL || "";
  const endpointErrors = validateEndpointPair(primaryUrl, fallbackUrl);
  if (endpointErrors.length) throw new Error(endpointErrors.join("; "));
  const artifact = JSON.parse(await readFile(
    resolve(projectRoot, "v2/out/DoomPublicLaunchFactoryV2.sol/DoomPublicLaunchFactoryV2.json"),
    "utf8",
  ));
  const [primary, fallback, website, indexer, keeper] = await Promise.all([
    inspectProvider("primary", primaryUrl, artifact),
    inspectProvider("fallback", fallbackUrl, artifact),
    json(process.env.DOOMSTREAK_LAUNCH_CONFIG_URL || "https://www.doomstreak.xyz/api/launch/config", "website launch config"),
    json(process.env.DOOMSTREAK_V2_HEALTH_URL || "https://onchaindiligence-indexer-production.up.railway.app/launchpad/v2/health", "V2 indexer health"),
    json(process.env.DOOMSTREAK_KEEPER_HEALTH_URL || "https://doom-launchpad-keeper-production.up.railway.app/health", "keeper health"),
  ]);
  const errors = validateCanaryReadiness({ primary, fallback, website, indexer, keeper });
  if (errors.length) throw new Error(errors.join("; "));
  const report = {
    schemaVersion: 1,
    status: "ready_for_user_signed_launch_id_2_canary",
    generatedAt: new Date().toISOString(),
    factory: PUBLIC_FACTORY,
    expected: EXPECTED,
    primary,
    fallback,
    services: {
      website: { transactionsEnabled: website.transactionsEnabled, creatorPolicy: website.creatorPolicy },
      indexer: { status: indexer.status, confidence: indexer.confidence, blocksBehind: indexer.blocks_behind },
      keeper: { status: keeper.status, checksCompleted: keeper.checks_completed, consecutiveFailures: keeper.consecutive_failures },
    },
    safety: {
      readOnly: true,
      walletConnected: false,
      transactionPrepared: false,
      signed: false,
      broadcast: false,
      fundsSpent: false,
    },
    nextStep: "A user must connect a normal EOA, review metadata and fees, and explicitly sign the launch transaction in the website.",
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Public V2 canary readiness failed: ${error.message}`);
    process.exitCode = 1;
  });
}
