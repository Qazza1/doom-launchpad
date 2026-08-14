import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareRuntimeBytecode } from "../deployment/verification-bundle.mjs";
import { compareReports, validateEndpointPair } from "./network-preflight.mjs";

export const CHAIN_ID = 4663;
export const OPERATOR = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F";
export const FACTORY = "0x142760D2C865537c063492933FB71ddefA2372C6";
export const CALLDATA = "0xd255d203";
const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");

export const CUTOVER_OPERATIONS = Object.freeze({
  legacyResume: Object.freeze({
    key: "legacy-resume",
    factory: FACTORY,
    calldata: CALLDATA,
    function: "resumeLaunches()",
    artifact: "v2/out/DoomLaunchFactoryV2.sol/DoomLaunchFactoryV2.json",
    expectedPaused: true,
    expectedLaunchCount: 0,
    checkCreator: true,
  }),
  legacyPause: Object.freeze({
    key: "legacy-pause",
    factory: FACTORY,
    calldata: "0xe79b502e",
    function: "pauseLaunches()",
    artifact: "v2/out/DoomLaunchFactoryV2.sol/DoomLaunchFactoryV2.json",
    expectedPaused: false,
    expectedLaunchCount: 1,
    checkCreator: false,
  }),
  publicResume: Object.freeze({
    key: "public-resume",
    factory: "0x8f8c948A6558C79531317b4AD7CfdBa4e9728f24",
    calldata: CALLDATA,
    function: "resumeLaunches()",
    artifact: "v2/out/DoomPublicLaunchFactoryV2.sol/DoomPublicLaunchFactoryV2.json",
    expectedPaused: true,
    expectedLaunchCount: 0,
    checkCreator: false,
  }),
});

export function operationForArguments(args = process.argv) {
  if (args.includes("--legacy-pause")) return CUTOVER_OPERATIONS.legacyPause;
  if (args.includes("--public-v2")) return CUTOVER_OPERATIONS.publicResume;
  return CUTOVER_OPERATIONS.legacyResume;
}

const quantity = value => Number(BigInt(value));
const bool = value => BigInt(value) === 1n;
const address = value => `0x${value.slice(-40)}`.toLowerCase();
const calldataForAddress = (selector, value) => `${selector}${value.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

export function chooseActivationGasLimit(estimates) {
  const maximum = estimates.reduce((highest, value) => BigInt(value) > highest ? BigInt(value) : highest, 0n);
  if (maximum <= 0n) throw new Error("activation gas estimate is missing");
  const buffered = (maximum * 125n + 99n) / 100n;
  const rounded = ((buffered + 999n) / 1000n) * 1000n;
  return (rounded < 50_000n ? 50_000n : rounded).toString();
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message || "RPC error"}`);
  return body.result;
}

async function inspect(label, url, artifact, operation) {
  const selectors = artifact.methodIdentifiers;
  const transaction = { from: OPERATOR, to: operation.factory, value: "0x0", data: operation.calldata };
  const creatorAllowed = operation.checkCreator
    ? rpc(url, "eth_call", [{
        to: operation.factory,
        data: calldataForAddress(`0x${selectors["creatorAllowed(address)"]}`, OPERATOR),
      }, "latest"])
    : Promise.resolve(null);
  const [
    chainIdHex, blockHex, nonceHex, balanceHex, code, pausedHex, countHex,
    validHex, creatorHex, operatorHex, simulation, estimateHex, gasPriceHex,
  ] = await Promise.all([
    rpc(url, "eth_chainId"),
    rpc(url, "eth_blockNumber"),
    rpc(url, "eth_getTransactionCount", [OPERATOR, "pending"]),
    rpc(url, "eth_getBalance", [OPERATOR, "latest"]),
    rpc(url, "eth_getCode", [operation.factory, "latest"]),
    rpc(url, "eth_call", [{ to: operation.factory, data: `0x${selectors["launchesPaused()"]}` }, "latest"]),
    rpc(url, "eth_call", [{ to: operation.factory, data: `0x${selectors["launchCount()"]}` }, "latest"]),
    rpc(url, "eth_call", [{ to: operation.factory, data: `0x${selectors["isLaunchConfigurationValid()"]}` }, "latest"]),
    creatorAllowed,
    rpc(url, "eth_call", [{ to: operation.factory, data: `0x${selectors["operator()"]}` }, "latest"]),
    rpc(url, "eth_call", [transaction, "latest"]),
    rpc(url, "eth_estimateGas", [transaction]),
    rpc(url, "eth_gasPrice"),
  ]);
  const runtime = compareRuntimeBytecode(
    code,
    artifact.deployedBytecode.object,
    artifact.deployedBytecode.immutableReferences,
  );
  return {
    label,
    chainId: quantity(chainIdHex),
    blockNumber: quantity(blockHex),
    pendingNonce: quantity(nonceHex),
    operatorBalanceWei: BigInt(balanceHex).toString(),
    factoryRuntimeMatches: runtime.matches,
    factoryRuntimeReason: runtime.reason,
    factoryPaused: bool(pausedHex),
    factoryLaunchCount: quantity(countHex),
    factoryConfigurationValid: bool(validHex),
    approvedCreatorAllowed: creatorHex === null ? null : bool(creatorHex),
    operator: address(operatorHex),
    simulationResult: simulation,
    gasEstimate: BigInt(estimateHex).toString(),
    gasPriceWei: BigInt(gasPriceHex).toString(),
  };
}

export function validateActivationReports(primary, fallback, operation = CUTOVER_OPERATIONS.legacyResume) {
  const errors = compareReports(
    { ...primary, code: {} },
    { ...fallback, code: {} },
  );
  const require = (condition, message) => { if (!condition) errors.push(message); };
  for (const report of [primary, fallback]) {
    require(report.chainId === CHAIN_ID, `${report.label} chain ID is not 4663`);
    require(report.factoryRuntimeMatches === true, `${report.label} factory runtime differs`);
    require(report.factoryPaused === operation.expectedPaused, `${report.label} factory pause state differs`);
    require(report.factoryLaunchCount === operation.expectedLaunchCount, `${report.label} launch count differs`);
    require(report.factoryConfigurationValid === true, `${report.label} factory configuration is invalid`);
    if (operation.checkCreator) require(report.approvedCreatorAllowed === true, `${report.label} approved creator is not allowed`);
    require(report.operator === OPERATOR.toLowerCase(), `${report.label} operator differs`);
    require(report.simulationResult === "0x", `${report.label} activation simulation returned unexpected data`);
  }
  require(primary.pendingNonce === fallback.pendingNonce, "provider pending nonces disagree");
  return errors;
}

export async function main() {
  const operation = operationForArguments();
  const outputPath = resolve(directory, `output/${operation.key}-preflight.json`);
  const primaryUrl = process.env.ROBINHOOD_RPC_URL || "";
  const fallbackUrl = process.env.ROBINHOOD_FALLBACK_RPC_URL || "";
  const endpointErrors = validateEndpointPair(primaryUrl, fallbackUrl);
  if (endpointErrors.length) throw new Error(endpointErrors.join("; "));
  const artifact = JSON.parse(await readFile(
    resolve(projectRoot, operation.artifact),
    "utf8",
  ));
  if (`0x${artifact.methodIdentifiers[operation.function]}` !== operation.calldata) {
    throw new Error(`${operation.function} selector differs from the frozen calldata`);
  }
  const [primary, fallback] = await Promise.all([
    inspect("primary", primaryUrl, artifact, operation),
    inspect("fallback", fallbackUrl, artifact, operation),
  ]);
  const errors = validateActivationReports(primary, fallback, operation);
  if (errors.length) throw new Error(errors.join("; "));
  const gasLimit = chooseActivationGasLimit([primary.gasEstimate, fallback.gasEstimate]);
  const maximumGasPrice = [primary.gasPriceWei, fallback.gasPriceWei]
    .reduce((highest, value) => BigInt(value) > highest ? BigInt(value) : highest, 0n);
  const report = {
    status: "ready_for_exact_owner_authorization",
    generatedAt: new Date().toISOString(),
    chainId: CHAIN_ID,
    transaction: {
      from: OPERATOR,
      to: operation.factory,
      value: "0x0",
      data: operation.calldata,
      function: operation.function,
      nonce: primary.pendingNonce,
      gasLimit,
    },
    maximumEstimatedFeeWeiAtObservedGasPrice: (BigInt(gasLimit) * maximumGasPrice).toString(),
    primary,
    fallback,
    safety: {
      signed: false,
      broadcast: false,
      tokenLaunchAuthorized: false,
      fundingTransferAuthorized: false,
    },
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`V2 cutover preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}
