import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CHAIN_ID = 4663;
export const DEPLOYER = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F";
export const LOCAL_URL = "http://127.0.0.1:18545";
export const SENTINEL_BALANCE_WEI = 123_456_789_012_345_678_901n;
export const FUNDING_BUFFER_BPS = 2_500n;

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output");
const expectedSequence = [
  { type: "CREATE", name: "DoomRewards", nonceOffset: 0 },
  { type: "CREATE", name: "PositionLocker", nonceOffset: 1 },
  { type: "CREATE", name: "V3LiquidityManager", nonceOffset: 2 },
  { type: "CALL", name: "PositionLocker", fn: "bindRegistrar(address)", nonceOffset: 3 },
  { type: "CREATE", name: "DoomLaunchFactory", nonceOffset: 4 },
  { type: "CALL", name: "V3LiquidityManager", fn: "bindFactory(address)", nonceOffset: 5 },
];

const quantity = value => Number(BigInt(value));
const lower = value => value?.toLowerCase();
const toHex = value => `0x${BigInt(value).toString(16)}`;
const isoForPath = value => value.replaceAll(":", "-").replaceAll(".", "-");
const weiToEth = value => {
  const wei = BigInt(value);
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
};
const weiToGwei = value => {
  const wei = BigInt(value);
  const whole = wei / 10n ** 9n;
  const fraction = (wei % 10n ** 9n).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
};

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

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot,
      env: options.env || process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => {
      if (stdout.length < 2_000_000) stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      if (stderr.length < 2_000_000) stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${(stderr || stdout).trim()}`));
    });
  });
}

export function findFoundryBinaries() {
  const executable = process.platform === "win32" ? ".exe" : "";
  const workspaceRoot = resolve(directory, "../../../.tools/foundry-v1.7.1");
  const userRoot = resolve(process.env.USERPROFILE || process.env.HOME || "", ".foundry/bin");
  for (const root of [workspaceRoot, userRoot]) {
    const values = {
      anvil: resolve(root, `anvil${executable}`),
      forge: resolve(root, `forge${executable}`),
      cast: resolve(root, `cast${executable}`),
    };
    if (Object.values(values).every(existsSync)) return values;
  }
  throw new Error("Pinned Foundry binaries were not found");
}

export { run as runCommand };

async function waitForAnvil(child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Anvil exited before becoming ready");
    try {
      const [client, chainId] = await Promise.all([
        rpc(LOCAL_URL, "web3_clientVersion"),
        rpc(LOCAL_URL, "eth_chainId"),
      ]);
      if (!String(client).toLowerCase().includes("anvil")) {
        throw new Error("localhost endpoint is not Anvil");
      }
      if (quantity(chainId) !== CHAIN_ID) {
        throw new Error(`localhost chain ID is ${quantity(chainId)}, expected ${CHAIN_ID}`);
      }
      return;
    } catch (error) {
      if (attempt === 39) throw error;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
    }
  }
}

async function computeAddress(cast, nonce) {
  const result = await run(cast, ["compute-address", DEPLOYER, "--nonce", String(nonce)]);
  const match = result.stdout.match(/0x[0-9a-fA-F]{40}/);
  if (!match) throw new Error(`could not compute address for nonce ${nonce}`);
  return match[0];
}

export function validateBroadcastRun(runData, startingNonce, predictedAddresses) {
  const errors = [];
  if (runData?.chain !== CHAIN_ID.toString() && runData?.chain !== CHAIN_ID) {
    errors.push("broadcast artifact has the wrong chain ID");
  }
  if (runData?.transactions?.length !== expectedSequence.length) {
    errors.push("broadcast artifact must contain exactly six transactions");
    return errors;
  }
  if (runData?.receipts?.length !== expectedSequence.length) {
    errors.push("broadcast artifact must contain exactly six receipts");
    return errors;
  }

  for (const [index, expected] of expectedSequence.entries()) {
    const transaction = runData.transactions[index];
    const receipt = runData.receipts[index];
    if (transaction.transactionType !== expected.type) {
      errors.push(`transaction ${index} has the wrong type`);
    }
    if (transaction.contractName !== expected.name) {
      errors.push(`transaction ${index} has the wrong contract`);
    }
    if ((transaction.function || undefined) !== expected.fn) {
      errors.push(`transaction ${index} has the wrong function`);
    }
    if (quantity(transaction.transaction?.nonce) !== startingNonce + expected.nonceOffset) {
      errors.push(`transaction ${index} has the wrong nonce`);
    }
    if (lower(transaction.transaction?.from) !== lower(DEPLOYER)) {
      errors.push(`transaction ${index} has the wrong sender`);
    }
    if (receipt?.status !== "0x1") errors.push(`transaction ${index} did not succeed`);
    if (lower(receipt?.from) !== lower(DEPLOYER)) {
      errors.push(`receipt ${index} has the wrong sender`);
    }
    if (expected.type === "CREATE") {
      const predicted = predictedAddresses[String(startingNonce + expected.nonceOffset)];
      if (lower(transaction.contractAddress) !== lower(predicted)) {
        errors.push(`transaction ${index} contract address differs from CREATE prediction`);
      }
      if (lower(receipt.contractAddress) !== lower(predicted)) {
        errors.push(`receipt ${index} contract address differs from CREATE prediction`);
      }
    }
  }
  return errors;
}

export function calculateFunding(totalPlannedGas, feeCeilingWei) {
  const gas = BigInt(totalPlannedGas);
  const price = BigInt(feeCeilingWei);
  const baseCostWei = gas * price;
  const requiredBalanceWei =
    (baseCostWei * (10_000n + FUNDING_BUFFER_BPS) + 9_999n) / 10_000n;
  return { baseCostWei, requiredBalanceWei };
}

async function createReport({
  runData,
  generatedAt,
  commit,
  remote,
  startingNonce,
  predictedAddresses,
  postconditions,
}) {
  const transactions = runData.transactions.map((transaction, index) => {
    const receipt = runData.receipts[index];
    return {
      order: index,
      label: expectedSequence[index].fn || `Deploy ${expectedSequence[index].name}`,
      nonce: quantity(transaction.transaction.nonce),
      type: transaction.transactionType,
      contract: transaction.contractName,
      predictedAddress: transaction.transactionType === "CREATE"
        ? predictedAddresses[String(quantity(transaction.transaction.nonce))]
        : null,
      localGasUsed: BigInt(receipt.gasUsed).toString(),
      localGasLimit: BigInt(transaction.transaction.gas).toString(),
      localReceiptStatus: quantity(receipt.status),
    };
  });
  const totalGasUsed = transactions.reduce((sum, item) => sum + BigInt(item.localGasUsed), 0n);
  const totalPlannedGas = transactions.reduce((sum, item) => sum + BigInt(item.localGasLimit), 0n);
  const funding = calculateFunding(totalPlannedGas, remote.feeCeilingWei);
  const currentBalance = BigInt(remote.deployerBalanceWei);
  const shortfall = funding.requiredBalanceWei > currentBalance
    ? funding.requiredBalanceWei - currentBalance
    : 0n;

  return {
    schemaVersion: 1,
    status: "localhost_preview_passed",
    generatedAt,
    sourceCommit: commit,
    safety: {
      upstreamWrites: false,
      signerLoaded: false,
      rawSignedTransactionsStored: false,
      localImpersonationOnly: true,
      mainnetBroadcastAuthorized: false,
    },
    network: {
      name: "Robinhood Chain Mainnet fork",
      chainId: CHAIN_ID,
      forkBlock: remote.blockNumber,
      rpcSecretPrinted: false,
    },
    deployer: {
      address: DEPLOYER,
      observedPendingNonce: startingNonce,
      observedBalanceWei: remote.deployerBalanceWei,
      observedBalanceEth: weiToEth(currentBalance),
    },
    transactions,
    gasPlan: {
      observedGasPriceWei: remote.gasPriceWei,
      observedGasPriceGwei: weiToGwei(remote.gasPriceWei),
      observedBaseFeeWei: remote.baseFeeWei,
      observedMaxPriorityFeeWei: remote.maxPriorityFeeWei,
      maxFeePerGasCeilingWei: remote.feeCeilingWei,
      maxFeePerGasCeilingGwei: weiToGwei(remote.feeCeilingWei),
      totalLocalGasUsed: totalGasUsed.toString(),
      totalPlannedGasLimit: totalPlannedGas.toString(),
      maxCostBeforeBufferWei: funding.baseCostWei.toString(),
      maxCostBeforeBufferEth: weiToEth(funding.baseCostWei),
      fundingBufferBps: Number(FUNDING_BUFFER_BPS),
      snapshotRequiredBalanceWei: funding.requiredBalanceWei.toString(),
      snapshotRequiredBalanceEth: weiToEth(funding.requiredBalanceWei),
      currentShortfallWei: shortfall.toString(),
      currentShortfallEth: weiToEth(shortfall),
      finalFundingMustBeRecalculated: true,
    },
    postconditions,
    warning:
      "Snapshot only. Repeat nonce, gas price, balance, and address derivation immediately before funding or approval.",
  };
}

export async function main() {
  const primary = process.env.ROBINHOOD_RPC_URL || "";
  let primaryUrl;
  try {
    primaryUrl = new URL(primary);
  } catch {
    throw new Error("ROBINHOOD_RPC_URL is missing or invalid");
  }
  if (primaryUrl.protocol !== "https:") {
    throw new Error("The preview requires an HTTPS Robinhood RPC endpoint");
  }
  if (primaryUrl.hostname === "127.0.0.1" || primaryUrl.hostname === "localhost") {
    throw new Error("ROBINHOOD_RPC_URL must be the upstream endpoint, not localhost");
  }

  const foundry = findFoundryBinaries();
  const generatedAt = new Date().toISOString();
  const sessionDirectory = resolve(outputRoot, isoForPath(generatedAt));
  await mkdir(sessionDirectory, { recursive: true });

  const [
    chainIdHex,
    blockNumberHex,
    pendingNonceHex,
    balanceHex,
    gasPriceHex,
    maxPriorityFeeHex,
    latestBlock,
  ] =
    await Promise.all([
      rpc(primary, "eth_chainId"),
      rpc(primary, "eth_blockNumber"),
      rpc(primary, "eth_getTransactionCount", [DEPLOYER, "pending"]),
      rpc(primary, "eth_getBalance", [DEPLOYER, "latest"]),
      rpc(primary, "eth_gasPrice"),
      rpc(primary, "eth_maxPriorityFeePerGas"),
      rpc(primary, "eth_getBlockByNumber", ["latest", false]),
    ]);
  if (quantity(chainIdHex) !== CHAIN_ID) {
    throw new Error(`primary RPC returned chain ID ${quantity(chainIdHex)}, expected ${CHAIN_ID}`);
  }
  const gasPriceWei = BigInt(gasPriceHex);
  const baseFeeWei = BigInt(latestBlock?.baseFeePerGas || gasPriceHex);
  const maxPriorityFeeWei = BigInt(maxPriorityFeeHex || "0x0");
  const eip1559Ceiling = baseFeeWei * 2n + maxPriorityFeeWei;
  const feeCeilingWei = eip1559Ceiling > gasPriceWei ? eip1559Ceiling : gasPriceWei;
  const remote = {
    blockNumber: quantity(blockNumberHex),
    pendingNonce: quantity(pendingNonceHex),
    deployerBalanceWei: BigInt(balanceHex).toString(),
    gasPriceWei: gasPriceWei.toString(),
    baseFeeWei: baseFeeWei.toString(),
    maxPriorityFeeWei: maxPriorityFeeWei.toString(),
    feeCeilingWei: feeCeilingWei.toString(),
  };

  const childEnvironment = {
    ...process.env,
    ROBINHOOD_RPC_URL: primary,
    DOOM_LOCAL_PREVIEW_ACK: "true",
    FOUNDRY_BROADCAST: sessionDirectory,
  };
  const anvil = spawn(foundry.anvil, [
    "--fork-url", "robinhood_mainnet",
    "--host", "127.0.0.1",
    "--port", "18545",
    "--auto-impersonate",
    "--chain-id", String(CHAIN_ID),
    "--silent",
  ], {
    cwd: projectRoot,
    env: childEnvironment,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let anvilError = "";
  anvil.stderr.on("data", chunk => {
    if (anvilError.length < 16_384) anvilError += chunk.toString();
  });

  try {
    await waitForAnvil(anvil);
    const [localBlockHex, localNonceHex] = await Promise.all([
      rpc(LOCAL_URL, "eth_blockNumber"),
      rpc(LOCAL_URL, "eth_getTransactionCount", [DEPLOYER, "pending"]),
    ]);
    const localBlock = quantity(localBlockHex);
    const startingNonce = quantity(localNonceHex);
    if (Math.abs(localBlock - remote.blockNumber) > 500) {
      throw new Error("localhost fork head differs from the primary RPC by more than 500 blocks");
    }
    if (startingNonce !== remote.pendingNonce) {
      throw new Error("localhost fork nonce differs from the primary pending nonce");
    }

    await rpc(LOCAL_URL, "anvil_setBalance", [DEPLOYER, toHex(SENTINEL_BALANCE_WEI)]);
    const sentinel = await rpc(LOCAL_URL, "eth_getBalance", [DEPLOYER, "latest"]);
    if (BigInt(sentinel) !== SENTINEL_BALANCE_WEI) {
      throw new Error("Anvil did not apply the localhost-only sentinel balance");
    }

    const predictedAddresses = {};
    for (const offset of [0, 1, 2, 4]) {
      const nonce = startingNonce + offset;
      predictedAddresses[String(nonce)] = await computeAddress(foundry.cast, nonce);
    }

    const forgeResult = await run(foundry.forge, [
      "script",
      "script/PreviewRobinhoodDeployment.s.sol:PreviewRobinhoodDeployment",
      "--rpc-url", LOCAL_URL,
      "--broadcast",
      "--unlocked",
      "--sender", DEPLOYER,
      "--slow",
      "-vv",
    ], { env: childEnvironment });
    if (!forgeResult.stdout.includes("ONCHAIN EXECUTION COMPLETE & SUCCESSFUL")) {
      throw new Error("Foundry did not report successful localhost execution");
    }

    const runPath = resolve(
      sessionDirectory,
      "PreviewRobinhoodDeployment.s.sol",
      String(CHAIN_ID),
      "run-latest.json",
    );
    const runData = JSON.parse(await readFile(runPath, "utf8"));
    const runErrors = validateBroadcastRun(runData, startingNonce, predictedAddresses);
    if (runErrors.length) throw new Error(runErrors.join("; "));

    const endingNonce = quantity(await rpc(
      LOCAL_URL,
      "eth_getTransactionCount",
      [DEPLOYER, "pending"],
    ));
    if (endingNonce !== startingNonce + 6) {
      throw new Error(`localhost ending nonce is ${endingNonce}, expected ${startingNonce + 6}`);
    }

    const addresses = Object.fromEntries(
      runData.transactions
        .filter(transaction => transaction.transactionType === "CREATE")
        .map(transaction => [transaction.contractName, transaction.contractAddress]),
    );
    const [factoryPaused, registrar, authorizedFactory] = await Promise.all([
      run(foundry.cast, [
        "call", addresses.DoomLaunchFactory, "launchesPaused()(bool)",
        "--rpc-url", LOCAL_URL,
      ]),
      run(foundry.cast, [
        "call", addresses.PositionLocker, "authorizedRegistrar()(address)",
        "--rpc-url", LOCAL_URL,
      ]),
      run(foundry.cast, [
        "call", addresses.V3LiquidityManager, "authorizedFactory()(address)",
        "--rpc-url", LOCAL_URL,
      ]),
    ]);
    const postconditions = {
      factoryPaused: factoryPaused.stdout.trim() === "true",
      registrarBoundToManager:
        lower(registrar.stdout.match(/0x[0-9a-fA-F]{40}/)?.[0]) ===
        lower(addresses.V3LiquidityManager),
      managerBoundToFactory:
        lower(authorizedFactory.stdout.match(/0x[0-9a-fA-F]{40}/)?.[0]) ===
        lower(addresses.DoomLaunchFactory),
    };
    if (!Object.values(postconditions).every(Boolean)) {
      throw new Error("localhost post-deployment assertions failed");
    }

    const gitResult = await run("git", [
      "-c", `safe.directory=${projectRoot.replaceAll("\\", "/")}`,
      "rev-parse", "HEAD",
    ]);
    const report = await createReport({
      runData,
      generatedAt,
      commit: gitResult.stdout.trim(),
      remote,
      startingNonce,
      predictedAddresses,
      postconditions,
    });
    const reportPath = resolve(outputRoot, "latest-report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log("Six-transaction localhost preview passed.");
    console.log(`Fork block: ${report.network.forkBlock}`);
    console.log(`Starting nonce: ${report.deployer.observedPendingNonce}`);
    for (const transaction of report.transactions) {
      const address = transaction.predictedAddress ? ` -> ${transaction.predictedAddress}` : "";
      console.log(`  nonce ${transaction.nonce}: ${transaction.label}${address}; gas ${transaction.localGasUsed}`);
    }
    console.log(
      `Snapshot funding with 25% buffer: ${report.gasPlan.snapshotRequiredBalanceEth} ETH`,
    );
    console.log(`Current shortfall: ${report.gasPlan.currentShortfallEth} ETH`);
    console.log(`Sanitized report: ${reportPath}`);
    console.log("No signer or private key was loaded.");
    console.log("All six transactions were sent only to 127.0.0.1 and cannot affect mainnet.");
    console.log("Do not fund the deployer from this snapshot; final values must be refreshed.");
  } finally {
    if (anvil.exitCode === null) anvil.kill();
    process.env.ROBINHOOD_RPC_URL = "";
    if (anvil.exitCode && anvil.exitCode !== 0 && anvilError.trim()) {
      console.error(`Anvil: ${anvilError.trim()}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Localhost preview failed: ${error.message}`);
    process.exitCode = 1;
  });
}
