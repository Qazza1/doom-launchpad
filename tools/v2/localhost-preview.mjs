import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  calculateFunding,
  findFoundryBinaries,
  runCommand,
} from "../deployment/localhost-preview.mjs";
import { buildPlan, CHAIN_ID, DEPLOYER, validatePlan } from "./transaction-plan.mjs";

export const LOCAL_URL = "http://127.0.0.1:18547";
export const SENTINEL_BALANCE_WEI = 123_456_789_012_345_678_901n;

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output");
const quantity = value => Number(BigInt(value));
const hex = value => `0x${BigInt(value).toString(16)}`;
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

async function waitForAnvil(child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Anvil exited before becoming ready");
    try {
      const [client, chainId] = await Promise.all([
        rpc(LOCAL_URL, "web3_clientVersion"),
        rpc(LOCAL_URL, "eth_chainId"),
      ]);
      if (!String(client).toLowerCase().includes("anvil")) throw new Error("localhost endpoint is not Anvil");
      if (quantity(chainId) !== CHAIN_ID) throw new Error("localhost fork has the wrong chain ID");
      return;
    } catch (error) {
      if (attempt === 59) throw error;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
    }
  }
}

async function waitForReceipt(hash) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const receipt = await rpc(LOCAL_URL, "eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
  }
  throw new Error(`no receipt for ${hash}`);
}

async function selector(contract, signature) {
  const artifact = JSON.parse(
    await readFile(resolve(projectRoot, "v2/out", `${contract}.sol`, `${contract}.json`), "utf8"),
  );
  const method = artifact.methodIdentifiers?.[signature];
  if (!method) throw new Error(`${contract} artifact has no ${signature}`);
  return `0x${method}`;
}

async function call(contract, address, signature) {
  return rpc(LOCAL_URL, "eth_call", [{ to: address, data: await selector(contract, signature) }, "latest"]);
}

const asAddress = word => `0x${word.slice(-40)}`;
const asBool = word => BigInt(word) === 1n;
const weiToEth = value => {
  const wei = BigInt(value);
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
};

export function validateReceipts(plan, receipts) {
  const errors = [];
  if (receipts.length !== plan.transactions.length) return ["receipt count differs from the plan"];
  for (const [index, transaction] of plan.transactions.entries()) {
    const receipt = receipts[index];
    if (quantity(receipt?.status || 0) !== 1) errors.push(`transaction ${index} failed`);
    if (lower(receipt?.from) !== lower(DEPLOYER)) errors.push(`receipt ${index} has the wrong sender`);
    if (transaction.kind === "CREATE") {
      if (lower(receipt?.contractAddress) !== lower(transaction.predictedAddress)) {
        errors.push(`transaction ${index} created an unexpected address`);
      }
    } else if (lower(receipt?.to) !== lower(transaction.to)) {
      errors.push(`transaction ${index} called an unexpected address`);
    }
  }
  return errors;
}

export async function main() {
  const primary = process.env.ROBINHOOD_RPC_URL || "";
  const primaryUrl = new URL(primary);
  if (primaryUrl.protocol !== "https:") throw new Error("ROBINHOOD_RPC_URL must use HTTPS");
  const foundry = findFoundryBinaries();
  const [chainHex, blockHex, nonceHex, balanceHex, gasPriceHex, priorityHex, latestBlock] = await Promise.all([
    rpc(primary, "eth_chainId"),
    rpc(primary, "eth_blockNumber"),
    rpc(primary, "eth_getTransactionCount", [DEPLOYER, "pending"]),
    rpc(primary, "eth_getBalance", [DEPLOYER, "latest"]),
    rpc(primary, "eth_gasPrice"),
    rpc(primary, "eth_maxPriorityFeePerGas"),
    rpc(primary, "eth_getBlockByNumber", ["latest", false]),
  ]);
  if (quantity(chainHex) !== CHAIN_ID) throw new Error(`primary RPC is not chain ${CHAIN_ID}`);
  const startingNonce = quantity(nonceHex);
  const plan = await buildPlan(startingNonce);
  const planErrors = validatePlan(plan);
  if (planErrors.length) throw new Error(planErrors.join("; "));

  const childEnvironment = { ...process.env, ROBINHOOD_RPC_URL: primary };
  const anvil = spawn(foundry.anvil, [
    "--fork-url", "robinhood_mainnet",
    "--host", "127.0.0.1",
    "--port", "18547",
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
    if (Math.abs(quantity(localBlockHex) - quantity(blockHex)) > 500) throw new Error("fork head is stale");
    if (quantity(localNonceHex) !== startingNonce) throw new Error("fork nonce differs from the plan");
    await rpc(LOCAL_URL, "anvil_setBalance", [DEPLOYER, hex(SENTINEL_BALANCE_WEI)]);

    const receipts = [];
    const transactionReports = [];
    for (const transaction of plan.transactions) {
      const request = {
        from: DEPLOYER,
        data: transaction.data,
        value: transaction.value,
        nonce: hex(transaction.nonce),
      };
      if (transaction.to) request.to = transaction.to;
      const estimate = BigInt(await rpc(LOCAL_URL, "eth_estimateGas", [request]));
      const gasLimit = (estimate * 125n + 99n) / 100n;
      const hash = await rpc(LOCAL_URL, "eth_sendTransaction", [{ ...request, gas: hex(gasLimit) }]);
      const receipt = await waitForReceipt(hash);
      receipts.push(receipt);
      transactionReports.push({
        order: transaction.order,
        label: transaction.label,
        nonce: transaction.nonce,
        predictedAddress: transaction.predictedAddress,
        dataSha256: transaction.dataSha256,
        estimatedGas: estimate.toString(),
        localGasLimit: gasLimit.toString(),
        localGasUsed: BigInt(receipt.gasUsed).toString(),
      });
    }
    const receiptErrors = validateReceipts(plan, receipts);
    if (receiptErrors.length) throw new Error(receiptErrors.join("; "));

    const created = Object.fromEntries(
      plan.transactions.filter(tx => tx.kind === "CREATE").map(tx => [tx.contract, tx.predictedAddress]),
    );
    const [paused, configuration, registrar, deployerFactory, managerFactory, managerNetwork] = await Promise.all([
      call("DoomLaunchFactoryV2", created.DoomLaunchFactoryV2, "launchesPaused()"),
      call("DoomLaunchFactoryV2", created.DoomLaunchFactoryV2, "isLaunchConfigurationValid()"),
      call("PositionLockerV2", created.PositionLockerV2, "authorizedRegistrar()"),
      call("DoomLaunchDeployerV2", created.DoomLaunchDeployerV2, "authorizedFactory()"),
      call("V3GraduationManagerV2", created.V3GraduationManagerV2, "authorizedFactory()"),
      call("V3GraduationManagerV2", created.V3GraduationManagerV2, "isNetworkConfigurationValid()"),
    ]);
    const postconditions = {
      factoryPaused: asBool(paused),
      launchConfigurationValid: asBool(configuration),
      registrarBound: lower(asAddress(registrar)) === lower(created.V3GraduationManagerV2),
      deployerBound: lower(asAddress(deployerFactory)) === lower(created.DoomLaunchFactoryV2),
      managerBound: lower(asAddress(managerFactory)) === lower(created.DoomLaunchFactoryV2),
      managerNetworkValid: asBool(managerNetwork),
    };
    if (!Object.values(postconditions).every(Boolean)) throw new Error("V2 fork postconditions failed");

    const baseFee = BigInt(latestBlock?.baseFeePerGas || gasPriceHex);
    const priority = BigInt(priorityHex || 0);
    const gasPrice = BigInt(gasPriceHex);
    const eip1559Ceiling = baseFee * 2n + priority;
    const feeCeiling = eip1559Ceiling > gasPrice ? eip1559Ceiling : gasPrice;
    const totalGasLimit = transactionReports.reduce((sum, tx) => sum + BigInt(tx.localGasLimit), 0n);
    const funding = calculateFunding(totalGasLimit, feeCeiling);
    const balance = BigInt(balanceHex);
    const shortfall = funding.requiredBalanceWei > balance ? funding.requiredBalanceWei - balance : 0n;
    const commit = (await runCommand("git", ["rev-parse", "HEAD"], { cwd: projectRoot })).stdout.trim();
    const report = {
      schemaVersion: 1,
      status: "v2_localhost_preview_passed",
      generatedAt: new Date().toISOString(),
      sourceCommit: commit,
      safety: {
        upstreamWrites: false,
        signerLoaded: false,
        localImpersonationOnly: true,
        mainnetBroadcastAuthorized: false,
      },
      network: { chainId: CHAIN_ID, forkBlock: quantity(blockHex), rpcSecretPrinted: false },
      deployer: { address: DEPLOYER, pendingNonce: startingNonce, balanceWei: balance.toString() },
      transactions: transactionReports,
      gasPlan: {
        feeCeilingWei: feeCeiling.toString(),
        totalGasLimit: totalGasLimit.toString(),
        fundingBufferBps: 2500,
        requiredBalanceWei: funding.requiredBalanceWei.toString(),
        requiredBalanceEth: weiToEth(funding.requiredBalanceWei),
        shortfallWei: shortfall.toString(),
        shortfallEth: weiToEth(shortfall),
        sufficientAtSnapshot: shortfall === 0n,
        finalRefreshRequired: true,
      },
      postconditions,
    };
    await mkdir(outputRoot, { recursive: true });
    const reportPath = resolve(outputRoot, "localhost-preview-report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log("Seven-transaction V2 localhost preview passed.");
    console.log(`Fork block: ${report.network.forkBlock}; starting nonce: ${startingNonce}`);
    for (const tx of transactionReports) console.log(`  nonce ${tx.nonce}: ${tx.label}; gas ${tx.localGasUsed}`);
    console.log(`Snapshot required with 25% buffer: ${report.gasPlan.requiredBalanceEth} ETH`);
    console.log(`Current shortfall: ${report.gasPlan.shortfallEth} ETH`);
    console.log("No signer or private key was loaded; every write occurred only on 127.0.0.1.");
    return report;
  } finally {
    if (anvil.exitCode === null) anvil.kill();
    process.env.ROBINHOOD_RPC_URL = "";
    if (anvil.exitCode && anvil.exitCode !== 0 && anvilError.trim()) console.error(`Anvil: ${anvilError.trim()}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`V2 localhost preview failed: ${error.message}`);
    process.exitCode = 1;
  });
}
