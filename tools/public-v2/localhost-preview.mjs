import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { calculateFunding, findFoundryBinaries } from "../deployment/localhost-preview.mjs";
import {
  buildPlan as buildPublicPlan,
  CHAIN_ID,
  DEPLOYER,
  PUBLIC_FACTORY,
  validatePlan as validatePublicPlan,
} from "./transaction-plan.mjs";
import {
  buildPlan as buildFullScalePlan,
  FULLSCALE_FACTORY,
  validatePlan as validateFullScalePlan,
} from "../fullscale-v3/transaction-plan.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const fullScaleProfile = process.env.DOOM_FULLSCALE_V3_MAINNET === "1";
const factoryContract = fullScaleProfile ? FULLSCALE_FACTORY : PUBLIC_FACTORY;
const buildPlan = fullScaleProfile ? buildFullScalePlan : buildPublicPlan;
const validatePlan = fullScaleProfile ? validateFullScalePlan : validatePublicPlan;
const outputRoot = fullScaleProfile ? resolve(directory, "../fullscale-v3/output") : resolve(directory, "output");
const LOCAL_URL = "http://127.0.0.1:18548";
const SENTINEL_BALANCE_WEI = 123_456_789_012_345_678_901n;
const quantity = value => Number(BigInt(value));
const hex = value => `0x${BigInt(value).toString(16)}`;
const lower = value => String(value ?? "").toLowerCase();
const asAddress = value => `0x${value.slice(-40)}`;
const asBool = value => BigInt(value) === 1n;

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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Anvil exited before becoming ready");
    try {
      const [client, chainId] = await Promise.all([
        rpc(LOCAL_URL, "web3_clientVersion"),
        rpc(LOCAL_URL, "eth_chainId"),
      ]);
      if (!String(client).toLowerCase().includes("anvil")) throw new Error("localhost is not Anvil");
      if (quantity(chainId) !== CHAIN_ID) throw new Error("fork has the wrong chain ID");
      return;
    } catch (error) {
      if (attempt === 79) throw error;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
    }
  }
}

async function receipt(hash) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await rpc(LOCAL_URL, "eth_getTransactionReceipt", [hash]);
    if (result) return result;
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

async function stopAnvil(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise(resolvePromise => child.once("exit", resolvePromise)),
    new Promise(resolvePromise => setTimeout(resolvePromise, 2_000)),
  ]);
}

async function previewProvider(label, upstream, plan, foundry) {
  const [blockHex, nonceHex, balanceHex, gasPriceHex, priorityHex, latestBlock] = await Promise.all([
    rpc(upstream, "eth_blockNumber"),
    rpc(upstream, "eth_getTransactionCount", [DEPLOYER, "pending"]),
    rpc(upstream, "eth_getBalance", [DEPLOYER, "latest"]),
    rpc(upstream, "eth_gasPrice"),
    rpc(upstream, "eth_maxPriorityFeePerGas"),
    rpc(upstream, "eth_getBlockByNumber", ["latest", false]),
  ]);
  if (quantity(nonceHex) !== plan.startingNonce) throw new Error(`${label} nonce changed; rebuild the plan`);

  const anvil = spawn(foundry.anvil, [
    "--fork-url", upstream,
    "--host", "127.0.0.1",
    "--port", "18548",
    "--auto-impersonate",
    "--chain-id", String(CHAIN_ID),
    "--silent",
  ], { cwd: projectRoot, windowsHide: true, stdio: "ignore" });

  try {
    await waitForAnvil(anvil);
    await rpc(LOCAL_URL, "anvil_setBalance", [DEPLOYER, hex(SENTINEL_BALANCE_WEI)]);
    const transactions = [];
    for (const transaction of plan.transactions) {
      const request = {
        from: DEPLOYER,
        data: transaction.data,
        value: transaction.value,
        nonce: hex(transaction.nonce),
        ...(transaction.to ? { to: transaction.to } : {}),
      };
      const estimatedGas = BigInt(await rpc(LOCAL_URL, "eth_estimateGas", [request]));
      const gasLimit = (estimatedGas * 125n + 99n) / 100n;
      const hash = await rpc(LOCAL_URL, "eth_sendTransaction", [{ ...request, gas: hex(gasLimit) }]);
      const mined = await receipt(hash);
      if (quantity(mined.status) !== 1) throw new Error(`${label} transaction ${transaction.order} reverted`);
      if (transaction.kind === "CREATE" && lower(mined.contractAddress) !== lower(transaction.predictedAddress)) {
        throw new Error(`${label} transaction ${transaction.order} created the wrong address`);
      }
      transactions.push({
        order: transaction.order,
        nonce: transaction.nonce,
        label: transaction.label,
        predictedAddress: transaction.predictedAddress,
        dataSha256: transaction.dataSha256,
        estimatedGas: estimatedGas.toString(),
        gasLimit: gasLimit.toString(),
        gasUsed: BigInt(mined.gasUsed).toString(),
      });
    }

    const created = Object.fromEntries(
      plan.transactions.filter(transaction => transaction.kind === "CREATE")
        .map(transaction => [transaction.contract, transaction.predictedAddress]),
    );
    const [paused, valid, firstId, bound, count, registrar, deployerFactory, managerFactory, networkValid] = await Promise.all([
      call(factoryContract, created[factoryContract], "launchesPaused()"),
      call(factoryContract, created[factoryContract], "isLaunchConfigurationValid()"),
      call(factoryContract, created[factoryContract], "FIRST_LAUNCH_ID()"),
      call(factoryContract, created[factoryContract], fullScaleProfile ? "UNBOUNDED_LAUNCHES()" : "FINAL_LAUNCH_ID()"),
      call(factoryContract, created[factoryContract], "launchCount()"),
      call("PositionLockerV2", created.PositionLockerV2, "authorizedRegistrar()"),
      call("DoomLaunchDeployerV2", created.DoomLaunchDeployerV2, "authorizedFactory()"),
      call("V3GraduationManagerV2", created.V3GraduationManagerV2, "authorizedFactory()"),
      call("V3GraduationManagerV2", created.V3GraduationManagerV2, "isNetworkConfigurationValid()"),
    ]);
    const postconditions = {
      factoryPaused: asBool(paused),
      launchConfigurationValid: asBool(valid),
      firstLaunchId: quantity(firstId),
      finalLaunchId: fullScaleProfile ? null : quantity(bound),
      unboundedLaunches: fullScaleProfile ? asBool(bound) : false,
      launchCount: quantity(count),
      registrarBound: lower(asAddress(registrar)) === lower(created.V3GraduationManagerV2),
      deployerBound: lower(asAddress(deployerFactory)) === lower(created[factoryContract]),
      managerBound: lower(asAddress(managerFactory)) === lower(created[factoryContract]),
      managerNetworkValid: asBool(networkValid),
    };
    if (
      !postconditions.factoryPaused || !postconditions.launchConfigurationValid
      || postconditions.firstLaunchId !== (fullScaleProfile ? 101 : 2)
      || (fullScaleProfile ? !postconditions.unboundedLaunches : postconditions.finalLaunchId !== 100)
      || postconditions.launchCount !== 0
      || !postconditions.registrarBound || !postconditions.deployerBound
      || !postconditions.managerBound || !postconditions.managerNetworkValid
    ) throw new Error(`${label} postconditions failed`);

    const baseFee = BigInt(latestBlock?.baseFeePerGas || gasPriceHex);
    const feeCeiling = [baseFee * 2n + BigInt(priorityHex || 0), BigInt(gasPriceHex)].reduce((a, b) => a > b ? a : b);
    const totalGasLimit = transactions.reduce((sum, transaction) => sum + BigInt(transaction.gasLimit), 0n);
    const funding = calculateFunding(totalGasLimit, feeCeiling);
    return {
      label,
      forkBlock: quantity(blockHex),
      pendingNonce: quantity(nonceHex),
      balanceWei: BigInt(balanceHex).toString(),
      transactions,
      postconditions,
      feeCeilingWei: feeCeiling.toString(),
      requiredBalanceWei: funding.requiredBalanceWei.toString(),
      sufficientAtSnapshot: BigInt(balanceHex) >= funding.requiredBalanceWei,
    };
  } finally {
    await stopAnvil(anvil);
  }
}

export async function main() {
  const primary = process.env.ROBINHOOD_RPC_URL || "";
  const fallback = process.env.ROBINHOOD_FALLBACK_RPC_URL || "";
  if (!primary || !fallback || primary === fallback) throw new Error("two independent RPC URLs are required");
  const plan = await buildPlan(Number(BigInt(await rpc(primary, "eth_getTransactionCount", [DEPLOYER, "pending"]))));
  const errors = validatePlan(plan);
  if (errors.length) throw new Error(errors.join("; "));
  const foundry = findFoundryBinaries();
  const reports = [];
  reports.push(await previewProvider("primary", primary, plan, foundry));
  reports.push(await previewProvider("fallback", fallback, plan, foundry));
  if (reports.some(report => !report.sufficientAtSnapshot)) throw new Error("deployer balance is below the buffered gas requirement");
  const result = {
    schemaVersion: 1,
    status: fullScaleProfile
      ? "fullscale_v3_dual_rpc_localhost_preview_passed"
      : "public_v2_dual_rpc_localhost_preview_passed",
    generatedAt: new Date().toISOString(),
    chainId: CHAIN_ID,
    deployer: DEPLOYER,
    planStartingNonce: plan.startingNonce,
    planSafety: plan.safety,
    safety: { signerLoaded: false, privateKeyLoaded: false, upstreamWrites: false, localImpersonationOnly: true },
    reports,
  };
  await mkdir(outputRoot, { recursive: true });
  await writeFile(resolve(outputRoot, "localhost-preview-report.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`${fullScaleProfile ? "Full-scale V3" : "Public V2"} exact plan passed on both RPC forks at nonce ${plan.startingNonce}.`);
  for (const report of reports) {
    console.log(`${report.label}: block ${report.forkBlock}; buffered requirement ${report.requiredBalanceWei} wei; balance sufficient.`);
    for (const transaction of report.transactions) console.log(`  nonce ${transaction.nonce}: ${transaction.label}; gas ${transaction.gasUsed}`);
  }
  console.log("No signer or private key was loaded; all writes occurred on 127.0.0.1 forks.");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`${fullScaleProfile ? "Full-scale V3" : "Public V2"} localhost preview failed: ${error.message}`);
    process.exitCode = 1;
  });
}
