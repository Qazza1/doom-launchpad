import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareRuntimeBytecode, resolveDeploymentInputs } from "./verification-bundle.mjs";
import { validateEndpointPair } from "./network-preflight.mjs";

export const CHAIN_ID = 4663;
export const CONTRACT_NAMES = [
  "DoomRewards",
  "PositionLocker",
  "V3LiquidityManager",
  "DoomLaunchFactory",
];

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output/verification");
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const RPC_RETRY_ATTEMPTS = 6;
const RPC_PACING_MS = 100;

const sleep = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

export function rpcRetryDelayMs(attempt, retryAfter = null) {
  const retryAfterSeconds = Number.parseFloat(retryAfter || "");
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(Math.ceil(retryAfterSeconds * 1_000), 15_000);
  }
  return Math.min(500 * (2 ** attempt), 8_000);
}

export const decodeAddress = word => `0x${String(word).slice(-40)}`;
export const decodeUint = word => BigInt(word).toString();
export const decodeBool = word => BigInt(word) === 1n;

/// Every value a constructor, binding, or frozen constant put on chain. Reading them back through
/// two providers is the only way to know the deployed system is the one that was planned.
export function expectedState(inputs, decisions, addresses) {
  const wei = value => BigInt(value).toString();
  return {
    DoomRewards: {
      "campaignManager()": ["address", inputs.campaignManager],
      "nftCollection()": ["address", inputs.nftCollection],
      "excludedHolder()": ["address", inputs.treasury],
      "feeRewardToken()": ["address", inputs.wrappedNative],
      "minimumClaimWindow()": ["uint", String(decisions.rewardCampaigns.minimumClaimWindowSeconds)],
      "nextCampaignId()": ["uint", "1"],
    },
    PositionLocker: {
      "positionManager()": ["address", inputs.nonfungiblePositionManager],
      "wrappedNative()": ["address", inputs.wrappedNative],
      "doomRewards()": ["address", addresses.DoomRewards],
      "treasury()": ["address", inputs.treasury],
      "registrarBinder()": ["address", inputs.deployer],
      "authorizedRegistrar()": ["address", addresses.V3LiquidityManager],
      "CREATOR_WETH_FEE_BPS()": ["uint", String(decisions.liquidity.eligibleWethFeeSplitBps.creator)],
      "TREASURY_WETH_FEE_BPS()": ["uint", String(decisions.liquidity.eligibleWethFeeSplitBps.treasury)],
      "REWARDS_WETH_FEE_BPS()": ["uint", String(decisions.liquidity.eligibleWethFeeSplitBps.doomRewards)],
      "POOL_FEE()": ["uint", String(decisions.liquidity.poolFee)],
    },
    V3LiquidityManager: {
      "expectedChainId()": ["uint", String(CHAIN_ID)],
      "factoryBinder()": ["address", inputs.deployer],
      "uniswapV3Factory()": ["address", inputs.uniswapV3Factory],
      "nonfungiblePositionManager()": ["address", inputs.nonfungiblePositionManager],
      "wrappedNative()": ["address", inputs.wrappedNative],
      "positionLocker()": ["address", addresses.PositionLocker],
      "authorizedFactory()": ["address", addresses.DoomLaunchFactory],
      "isNetworkConfigurationValid()": ["bool", true],
      "POOL_FEE()": ["uint", String(decisions.liquidity.poolFee)],
      "TICK_SPACING()": ["uint", String(decisions.liquidity.tickSpacing)],
    },
    DoomLaunchFactory: {
      "operator()": ["address", inputs.operator],
      "approvedCreator()": ["address", inputs.approvedCreator],
      "treasury()": ["address", inputs.treasury],
      "emergencyGuardian()": ["address", inputs.emergencyGuardian],
      "wrappedNative()": ["address", inputs.wrappedNative],
      "doomRewards()": ["address", addresses.DoomRewards],
      "liquidityManager()": ["address", addresses.V3LiquidityManager],
      "positionLocker()": ["address", addresses.PositionLocker],
      // The factory must still be paused. Deployment never authorizes launching.
      "launchesPaused()": ["bool", true],
      "launchCount()": ["uint", "0"],
      "totalNativeLiquidity()": ["uint", "0"],
      "accruedTreasuryFees()": ["uint", "0"],
      "maxLaunches()": ["uint", String(decisions.pilotLimits.maxLaunches)],
      "maxNativeLiquidityPerLaunch()": ["uint", wei(decisions.pilotLimits.maxNativeLiquidityPerLaunchWei)],
      "maxNativeLiquidityGlobal()": ["uint", wei(decisions.pilotLimits.maxNativeLiquidityGlobalWei)],
      "CREATION_FEE_BPS()": ["uint", String(decisions.creationFee.feeBps)],
      "NFT_REWARD_FEE_SHARE_BPS()": ["uint", String(decisions.creationFee.nftRewardsShareBps)],
      "CREATOR_LIQUID_BPS()": ["uint", String(decisions.tokenEconomics.creatorLiquidBps)],
      "LIQUIDITY_BPS()": ["uint", String(decisions.tokenEconomics.liquidityBps)],
      "GM_ESCROW_BPS()": ["uint", String(decisions.tokenEconomics.gmEscrowBps)],
      "REQUIRED_GM_CHECK_INS()": ["uint", String(decisions.gmCommitment.requiredCheckIns)],
      "GM_CADENCE_SECONDS()": ["uint", String(decisions.gmCommitment.cadenceSeconds)],
      "GM_GRACE_PERIOD_SECONDS()": ["uint", String(decisions.gmCommitment.gracePeriodSeconds)],
      "POOL_FEE()": ["uint", String(decisions.liquidity.poolFee)],
      "TICK_SPACING()": ["uint", String(decisions.liquidity.tickSpacing)],
    },
  };
}

export function compareObserved(expected, observed) {
  const errors = [];
  for (const [contract, calls] of Object.entries(expected)) {
    for (const [signature, [kind, want]] of Object.entries(calls)) {
      const got = observed?.[contract]?.[signature];
      if (got === undefined || got === null) {
        errors.push(`${contract}.${signature} returned nothing`);
        continue;
      }
      const same = kind === "address"
        ? String(got).toLowerCase() === String(want).toLowerCase()
        : String(got) === String(want);
      if (!same) errors.push(`${contract}.${signature} is ${got}, expected ${want}`);
    }
  }
  return errors;
}

/// One provider can be stale, wrong, or lying. Agreement between two independent hosts is the
/// cheapest defence available before an irreversible sequence is trusted.
export function compareProviders(primary, fallback) {
  const errors = [];
  for (const contract of Object.keys(primary || {})) {
    if (String(primary[contract]?.code) !== String(fallback[contract]?.code)) {
      errors.push(`providers returned different runtime bytecode for ${contract}`);
    }
    for (const [signature, value] of Object.entries(primary[contract]?.calls || {})) {
      const other = fallback[contract]?.calls?.[signature];
      if (String(value) !== String(other)) {
        errors.push(`providers disagree on ${contract}.${signature}`);
      }
    }
  }
  return errors;
}

export function assertAddressesComplete(addresses) {
  const errors = [];
  for (const name of CONTRACT_NAMES) {
    const value = addresses?.[name];
    if (!ADDRESS.test(value || "")) errors.push(`${name} address is missing or malformed`);
    else if (/^0x0{40}$/i.test(value)) errors.push(`${name} address must not be the zero address`);
  }
  const seen = new Set(CONTRACT_NAMES.map(name => String(addresses?.[name]).toLowerCase()));
  if (seen.size !== CONTRACT_NAMES.length) errors.push("two contracts share the same address");
  return errors;
}

async function rpc(url, method, params = [], label = "provider") {
  for (let attempt = 0; attempt < RPC_RETRY_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429 && attempt + 1 < RPC_RETRY_ATTEMPTS) {
      await sleep(rpcRetryDelayMs(attempt, response.headers.get("retry-after")));
      continue;
    }
    if (!response.ok) throw new Error(`${label} ${method} returned HTTP ${response.status}`);
    const body = await response.json();
    const rateLimited = body.error
      && (body.error.code === 429 || /rate.?limit|too many requests/i.test(body.error.message || ""));
    if (rateLimited && attempt + 1 < RPC_RETRY_ATTEMPTS) {
      await sleep(rpcRetryDelayMs(attempt));
      continue;
    }
    if (body.error) throw new Error(`${label} ${method}: ${body.error.message || "RPC error"}`);
    await sleep(RPC_PACING_MS);
    return body.result;
  }
  throw new Error(`${label} ${method} remained rate-limited after ${RPC_RETRY_ATTEMPTS} attempts`);
}

async function readArtifact(name) {
  return JSON.parse(await readFile(resolve(projectRoot, "out", `${name}.sol`, `${name}.json`), "utf8"));
}

async function observeProvider(label, url, addresses, expected, artifacts) {
  const chainId = Number(await rpc(url, "eth_chainId", [], label));
  if (chainId !== CHAIN_ID) throw new Error(`${label} returned chain ID ${chainId}`);

  const observed = {};
  for (const name of CONTRACT_NAMES) {
    const code = await rpc(url, "eth_getCode", [addresses[name], "latest"], label);
    const calls = {};
    for (const [signature, [kind]] of Object.entries(expected[name])) {
      const identifier = artifacts[name].methodIdentifiers?.[signature];
      if (!identifier) throw new Error(`${name} has no ${signature}`);
      const word = await rpc(url, "eth_call", [
        { to: addresses[name], data: `0x${identifier}` },
        "latest",
      ], label);
      calls[signature] = kind === "address"
        ? decodeAddress(word)
        : kind === "bool"
          ? decodeBool(word)
          : decodeUint(word);
    }
    observed[name] = { code: String(code).toLowerCase(), calls };
  }
  return observed;
}

export async function main(argv = process.argv.slice(2)) {
  const addressFlag = argv.indexOf("--addresses");
  if (addressFlag === -1) {
    throw new Error("--addresses <file> is required and must list the four deployed addresses");
  }
  const primary = process.env.ROBINHOOD_RPC_URL || "";
  const fallback = process.env.ROBINHOOD_FALLBACK_RPC_URL || "";
  const endpointErrors = validateEndpointPair(primary, fallback);
  if (endpointErrors.length) throw new Error(endpointErrors.join("; "));

  const addresses = JSON.parse(
    await readFile(resolve(process.cwd(), argv[addressFlag + 1]), "utf8"),
  );
  const addressErrors = assertAddressesComplete(addresses);
  if (addressErrors.length) throw new Error(addressErrors.join("; "));

  const manifest = JSON.parse(
    await readFile(resolve(projectRoot, "config/stage4-deployment-manifest.json"), "utf8"),
  );
  const decisions = JSON.parse(
    await readFile(resolve(projectRoot, "config/robinhood-mainnet-canary.decisions.json"), "utf8"),
  );
  const { errors: inputErrors, inputs } = resolveDeploymentInputs(manifest, decisions);
  if (inputErrors.length) throw new Error(inputErrors.join("; "));

  const expected = expectedState(inputs, decisions, addresses);
  const artifacts = Object.fromEntries(
    await Promise.all(CONTRACT_NAMES.map(async name => [name, await readArtifact(name)])),
  );

  const [primaryObserved, fallbackObserved] = await Promise.all([
    observeProvider("primary", primary, addresses, expected, artifacts),
    observeProvider("fallback", fallback, addresses, expected, artifacts),
  ]);

  const failures = [];
  failures.push(...compareProviders(primaryObserved, fallbackObserved));
  failures.push(
    ...compareObserved(
      expected,
      Object.fromEntries(
        Object.entries(primaryObserved).map(([name, value]) => [name, value.calls]),
      ),
    ),
  );

  const bytecode = {};
  for (const name of CONTRACT_NAMES) {
    const artifact = artifacts[name];
    const comparison = compareRuntimeBytecode(
      primaryObserved[name].code,
      artifact.deployedBytecode?.object || "0x",
      artifact.deployedBytecode?.immutableReferences || {},
    );
    bytecode[name] = comparison;
    if (!comparison.matches) failures.push(`${name} bytecode: ${comparison.reason}`);
  }

  const report = {
    schemaVersion: 1,
    status: failures.length ? "deployment_verification_failed" : "deployment_verification_passed",
    generatedAt: new Date().toISOString(),
    chainId: CHAIN_ID,
    addresses,
    providersAgree: !failures.some(item => item.startsWith("providers")),
    bytecode,
    observed: Object.fromEntries(
      Object.entries(primaryObserved).map(([name, value]) => [name, value.calls]),
    ),
    failures,
    notes: [
      "Runtime bytecode is compared with the compiler's immutable ranges masked on both sides,"
        + " because immutables are written at construction time and never match the artifact.",
      "Every value was read through two independent providers and must agree.",
    ],
    warning:
      "Verification only. Passing does not authorize resuming the factory or launching anything.",
  };

  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    resolve(outputRoot, "deployment-verification.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  for (const name of CONTRACT_NAMES) {
    console.log(`${name} ${addresses[name]}: ${bytecode[name].reason}`);
  }
  if (failures.length) {
    for (const failure of failures) console.error(`  FAIL ${failure}`);
    throw new Error(`${failures.length} verification failures; do not proceed`);
  }
  console.log("All roles, dependencies, bindings, caps, and constants match through both providers.");
  console.log("The factory is paused.");
  console.log("Resuming the factory is a separate Stage 5 owner decision.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Deployment verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
