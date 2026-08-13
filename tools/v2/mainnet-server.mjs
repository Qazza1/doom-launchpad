import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chooseFeeCeiling, combineFeeCeilings } from "../deployment/funding-refresh.mjs";
import { runCommand } from "../deployment/localhost-preview.mjs";
import {
  normalizeOnchainTransaction,
  validateReceipt,
  validateStepSubmission,
} from "../deployment/rabby-preview-server.mjs";
import { compareRuntimeBytecode } from "../deployment/verification-bundle.mjs";
import { compareReports, inspectProvider, validateEndpointPair } from "./network-preflight.mjs";
import { CHAIN_ID, DEPLOYER, validateDependencyWiring, validatePlan } from "./transaction-plan.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output");
const planPath = resolve(outputRoot, "transaction-plan.json");
const previewPath = resolve(outputRoot, "localhost-preview-report.json");
const receiptPath = resolve(outputRoot, "mainnet-receipts.json");
const approvalPath = resolve(projectRoot, "config/v2-mainnet-deployment-authorization.json");
const HOST = "127.0.0.1";
const PORT = 4182;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CONTRACT_INPUT_PATHS = ["v2/src", "v2/foundry.toml", "config/v2-mainnet-deployment-manifest.json"];

const sha256 = value => createHash("sha256").update(value).digest("hex");
const lower = value => (typeof value === "string" ? value.toLowerCase() : value);
const quantity = value => Number(BigInt(value));

export function buildWalletFeePolicy(previewTransaction, state) {
  const gasLimit = BigInt(previewTransaction?.localGasLimit || 0);
  const maxFeePerGasWei = BigInt(state?.feeCeilingWei || 0);
  const maxPriorityFeePerGasWei = BigInt(state?.maxPriorityFeeWei || 0);
  if (gasLimit <= 0n) throw new Error("the rehearsed gas limit is missing");
  if (maxFeePerGasWei <= 0n) throw new Error("the live fee ceiling is missing");
  if (maxPriorityFeePerGasWei < 0n || maxPriorityFeePerGasWei > maxFeePerGasWei) {
    throw new Error("the live priority fee is invalid");
  }
  return {
    gasLimit: gasLimit.toString(),
    maxFeePerGasWei: maxFeePerGasWei.toString(),
    maxPriorityFeePerGasWei: maxPriorityFeePerGasWei.toString(),
    maximumNetworkFeeWei: (gasLimit * maxFeePerGasWei).toString(),
  };
}

export function validateV2MainnetApproval(approval, plan, planBody) {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const authorization = approval?.authorization || {};
  const predicted = Object.fromEntries(
    (plan?.transactions || [])
      .filter(transaction => transaction.kind === "CREATE")
      .map(transaction => [transaction.contract, lower(transaction.predictedAddress)]),
  );
  require(
    approval?.status === "owner_authorized_exact_paused_v2_deployment",
    "the exact V2 owner authorization is missing",
  );
  require(approval?.chainId === CHAIN_ID, "the owner authorization targets the wrong chain");
  require(lower(approval?.deployer) === lower(DEPLOYER), "the owner authorization has the wrong deployer");
  require(SHA256.test(approval?.contractDigest || ""), "the approved contract digest is malformed");
  require(approval?.planSha256 === sha256(planBody), "the owner authorization does not match the plan digest");
  require(approval?.startingNonce === plan?.startingNonce, "the owner authorization has the wrong starting nonce");
  require(approval?.endingNonce === plan?.startingNonce + 6, "the owner authorization has the wrong ending nonce");
  require(approval?.transactionCount === 7, "the owner authorization must cover exactly seven transactions");
  require(plan?.safety?.signerLoaded === false, "the locked plan must not load a signer");
  require(plan?.safety?.signed === false, "the locked plan must remain unsigned");
  require(plan?.safety?.broadcast === false, "the locked plan must remain unbroadcast");
  require(plan?.safety?.factoryMustRemainPaused === true, "the locked plan must keep the factory paused");
  require(approval?.validity?.pendingNonceMustRemain === 10, "the authorization is not locked to nonce 10");
  require(approval?.validity?.exactPlanDigestRequired === true, "exact plan digest enforcement is missing");
  require(
    approval?.validity?.reauthorizationRequiredAfterNonceOrPayloadDrift === true,
    "drift must require reauthorization",
  );
  require(authorization.sevenTransactionsOneAtATime === true, "one-at-a-time execution was not authorized");
  require(authorization.useExistingDeployerBalance === true, "existing-balance execution was not authorized");
  require(authorization.fundingTransfer === false, "a funding transfer must remain unauthorized");
  require(authorization.stopAndVerifyEveryReceipt === true, "receipt verification was not authorized");
  require(authorization.factoryMustRemainPaused === true, "factory-paused requirement is missing");
  require(authorization.factoryResume === false, "factory resume must remain unauthorized");
  require(authorization.tokenLaunch === false, "token launch must remain unauthorized");
  require(
    authorization.independentAuditDeferredUntilAfterInitialBetaLaunch === true,
    "the audit-deferral acknowledgement is missing",
  );
  require(
    lower(approval?.predictedAddresses?.curveDeployer) === predicted.DoomLaunchDeployerV2,
    "the approved curve deployer address differs from the plan",
  );
  require(
    lower(approval?.predictedAddresses?.positionLocker) === predicted.PositionLockerV2,
    "the approved position locker address differs from the plan",
  );
  require(
    lower(approval?.predictedAddresses?.graduationManager) === predicted.V3GraduationManagerV2,
    "the approved graduation manager address differs from the plan",
  );
  require(
    lower(approval?.predictedAddresses?.launchFactory) === predicted.DoomLaunchFactoryV2,
    "the approved launch factory address differs from the plan",
  );
  return errors;
}

export function validateReceiptLedger(plan, ledger, requestedStep) {
  const errors = [];
  if (!Number.isInteger(requestedStep) || requestedStep < 0 || requestedStep >= plan.transactions.length) {
    return ["requested step is outside the seven-transaction plan"];
  }
  if (!Array.isArray(ledger?.receipts)) return ["the V2 mainnet receipt ledger is malformed"];
  if (ledger.receipts.length !== requestedStep) {
    errors.push(
      `step ${requestedStep + 1} requires exactly ${requestedStep} previously verified receipts; `
      + `found ${ledger.receipts.length}`,
    );
  }
  for (const [index, receipt] of ledger.receipts.entries()) {
    if (receipt.order !== index) errors.push(`receipt ${index} is out of order`);
    if (receipt.planSha256 !== ledger.planSha256) errors.push(`receipt ${index} has the wrong plan digest`);
    if (!HASH.test(receipt.transactionHash || "")) errors.push(`receipt ${index} has a malformed hash`);
    if (receipt.status !== "verified_success") errors.push(`receipt ${index} is not verified successful`);
  }
  return errors;
}

export function compareMinedProviders(primaryTransaction, fallbackTransaction, primaryReceipt, fallbackReceipt) {
  const errors = [];
  for (const field of ["hash", "from", "to", "input", "nonce", "value"]) {
    if (lower(primaryTransaction?.[field] ?? null) !== lower(fallbackTransaction?.[field] ?? null)) {
      errors.push(`providers disagree on mined transaction ${field}`);
    }
  }
  for (const field of ["status", "from", "to", "contractAddress", "blockHash", "transactionHash"]) {
    if (lower(primaryReceipt?.[field] ?? null) !== lower(fallbackReceipt?.[field] ?? null)) {
      errors.push(`providers disagree on receipt ${field}`);
    }
  }
  return errors;
}

export function validatePreviewStep(planTransaction, previewTransaction) {
  const errors = [];
  if (previewTransaction?.order !== planTransaction?.order) errors.push("the rehearsal step order differs");
  if (previewTransaction?.nonce !== planTransaction?.nonce) errors.push("the rehearsal nonce differs");
  if (lower(previewTransaction?.predictedAddress) !== lower(planTransaction?.predictedAddress)) {
    errors.push("the rehearsal predicted address differs");
  }
  if (previewTransaction?.dataSha256 !== planTransaction?.dataSha256) {
    errors.push("the rehearsal payload digest differs");
  }
  if (BigInt(previewTransaction?.localGasLimit || 0) <= 0n) errors.push("the rehearsal gas limit is missing");
  return errors;
}

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

async function waitForMined(url, txHash) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const [transaction, receipt] = await Promise.all([
      rpc(url, "eth_getTransactionByHash", [txHash]),
      rpc(url, "eth_getTransactionReceipt", [txHash]),
    ]);
    if (transaction && receipt) return { transaction, receipt };
    await new Promise(resolvePromise => setTimeout(resolvePromise, 2_000));
  }
  throw new Error("no mined transaction and receipt were returned within two minutes");
}

async function readArtifact(contractName) {
  return JSON.parse(
    await readFile(resolve(projectRoot, "v2/out", `${contractName}.sol`, `${contractName}.json`), "utf8"),
  );
}

async function verifyArtifactsMatchPlan(plan) {
  const errors = [];
  for (const transaction of plan.transactions) {
    if (sha256(transaction.data) !== transaction.dataSha256) {
      errors.push(`${transaction.label} has a stale payload digest`);
    }
    const artifact = await readArtifact(transaction.contract);
    if (transaction.kind === "CREATE") {
      const expected = `${artifact.bytecode?.object || "0x"}${String(transaction.encodedConstructorArguments).slice(2)}`;
      if (lower(expected) !== lower(transaction.data)) {
        errors.push(`${transaction.contract} creation payload differs from the compiled V2 artifact`);
      }
    } else {
      const functionName = transaction.label.slice(transaction.contract.length + 1);
      const selector = artifact.methodIdentifiers?.[functionName];
      if (!selector || !lower(transaction.data).startsWith(`0x${lower(selector)}`)) {
        errors.push(`${transaction.label} selector differs from the compiled V2 artifact`);
      }
    }
  }
  return errors;
}

async function verifyCreatedRuntime(primary, fallback, transaction) {
  const [primaryCode, fallbackCode, artifact] = await Promise.all([
    rpc(primary, "eth_getCode", [transaction.predictedAddress, "latest"]),
    rpc(fallback, "eth_getCode", [transaction.predictedAddress, "latest"]),
    readArtifact(transaction.contract),
  ]);
  const errors = [];
  if (!primaryCode || primaryCode === "0x") errors.push("created contract has no runtime code");
  if (lower(primaryCode) !== lower(fallbackCode)) errors.push("providers disagree on created runtime code");
  const comparison = compareRuntimeBytecode(
    primaryCode,
    artifact.deployedBytecode?.object || "0x",
    artifact.deployedBytecode?.immutableReferences || {},
  );
  if (!comparison.matches) errors.push(comparison.reason);
  return errors;
}

async function readGetter(primary, fallback, contract, address, getter) {
  const artifact = await readArtifact(contract);
  const selector = artifact.methodIdentifiers?.[getter];
  if (!/^[0-9a-fA-F]{8}$/.test(selector || "")) throw new Error(`compiled artifact has no selector for ${getter}`);
  const call = { to: address, data: `0x${selector}` };
  const [primaryValue, fallbackValue] = await Promise.all([
    rpc(primary, "eth_call", [call, "latest"]),
    rpc(fallback, "eth_call", [call, "latest"]),
  ]);
  if (lower(primaryValue) !== lower(fallbackValue)) throw new Error(`providers disagree on ${getter}`);
  return primaryValue;
}

async function verifyBinding(primary, fallback, transaction) {
  const getter = transaction.contract === "PositionLockerV2" ? "authorizedRegistrar()" : "authorizedFactory()";
  const value = await readGetter(primary, fallback, transaction.contract, transaction.to, getter);
  const observed = `0x${String(value).slice(-40)}`;
  return lower(observed) === lower(transaction.argument)
    ? []
    : [`${getter} returned ${observed}, expected ${transaction.argument}`];
}

export async function verifyPausedZeroLaunchState(primary, fallback, plan, requireFullyBound = true) {
  const factory = plan.transactions.find(transaction => transaction.contract === "DoomLaunchFactoryV2")?.predictedAddress;
  const deployer = plan.transactions.find(transaction => transaction.contract === "DoomLaunchDeployerV2")?.predictedAddress;
  const locker = plan.transactions.find(transaction => transaction.contract === "PositionLockerV2")?.predictedAddress;
  const manager = plan.transactions.find(transaction => transaction.contract === "V3GraduationManagerV2")?.predictedAddress;
  const [paused, count] = await Promise.all([
    readGetter(primary, fallback, "DoomLaunchFactoryV2", factory, "launchesPaused()"),
    readGetter(primary, fallback, "DoomLaunchFactoryV2", factory, "launchCount()"),
  ]);
  const truthy = value => BigInt(value) === 1n;
  const errors = [];
  if (!truthy(paused)) errors.push("the V2 factory is not paused");
  if (BigInt(count) !== 0n) errors.push("the V2 factory already records a token launch");
  if (!requireFullyBound) return errors;
  const [valid, registrar, deployerFactory, managerFactory, managerNetwork] = await Promise.all([
    readGetter(primary, fallback, "DoomLaunchFactoryV2", factory, "isLaunchConfigurationValid()"),
    readGetter(primary, fallback, "PositionLockerV2", locker, "authorizedRegistrar()"),
    readGetter(primary, fallback, "DoomLaunchDeployerV2", deployer, "authorizedFactory()"),
    readGetter(primary, fallback, "V3GraduationManagerV2", manager, "authorizedFactory()"),
    readGetter(primary, fallback, "V3GraduationManagerV2", manager, "isNetworkConfigurationValid()"),
  ]);
  const address = value => `0x${String(value).slice(-40)}`;
  if (!truthy(valid)) errors.push("the V2 factory launch configuration is invalid");
  if (lower(address(registrar)) !== lower(manager)) errors.push("the position locker registrar binding is wrong");
  if (lower(address(deployerFactory)) !== lower(factory)) errors.push("the curve deployer factory binding is wrong");
  if (lower(address(managerFactory)) !== lower(factory)) errors.push("the graduation manager factory binding is wrong");
  if (!truthy(managerNetwork)) errors.push("the graduation manager network configuration is invalid");
  return errors;
}

async function readFeeState(url) {
  const [gasPriceHex, priorityHex, block] = await Promise.all([
    rpc(url, "eth_gasPrice"),
    rpc(url, "eth_maxPriorityFeePerGas").catch(() => "0x0"),
    rpc(url, "eth_getBlockByNumber", ["latest", false]),
  ]);
  const state = {
    gasPriceWei: BigInt(gasPriceHex).toString(),
    baseFeeWei: BigInt(block?.baseFeePerGas || gasPriceHex).toString(),
    maxPriorityFeeWei: BigInt(priorityHex || "0x0").toString(),
  };
  return { ...state, feeCeilingWei: chooseFeeCeiling(state) };
}

async function assertApprovedInputsUnchanged(sourceCommit) {
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit || "")) throw new Error("the authorization source commit is malformed");
  const safe = projectRoot.replaceAll("\\", "/");
  try {
    await runCommand("git", [
      "-c", `safe.directory=${safe}`, "diff", "--quiet", sourceCommit, "HEAD", "--", ...CONTRACT_INPUT_PATHS,
    ]);
  } catch {
    throw new Error("V2 contract-bearing inputs changed after the exact plan was authorized");
  }
  const { stdout } = await runCommand("git", [
    "-c", `safe.directory=${safe}`,
    "status", "--porcelain", "--untracked-files=no", "--", ...CONTRACT_INPUT_PATHS,
  ]);
  if (stdout.trim()) throw new Error("V2 contract-bearing inputs have uncommitted changes");
}

async function readLedger(planSha256) {
  try {
    const ledger = JSON.parse(await readFile(receiptPath, "utf8"));
    if (ledger.planSha256 !== planSha256) throw new Error("the receipt ledger belongs to another plan");
    return ledger;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { schemaVersion: 1, chainId: CHAIN_ID, planSha256, receipts: [] };
  }
}

async function preflight(primary, fallback, plan, step, preview, planSha256) {
  const [primaryReport, fallbackReport, primaryFees, fallbackFees] = await Promise.all([
    inspectProvider("primary", primary),
    inspectProvider("fallback", fallback),
    readFeeState(primary),
    readFeeState(fallback),
  ]);
  const errors = compareReports(primaryReport, fallbackReport);
  if (primaryReport.deployerBalanceWei !== fallbackReport.deployerBalanceWei) {
    errors.push("providers disagree on the deployer balance");
  }
  const expectedNonce = plan.transactions[step].nonce;
  if (primaryReport.pendingNonce !== expectedNonce) {
    errors.push(`pending nonce is ${primaryReport.pendingNonce}, expected ${expectedNonce}`);
  }
  const remainingGas = preview.transactions
    .slice(step)
    .reduce((sum, transaction) => sum + BigInt(transaction.localGasLimit), 0n);
  const feeCeilingWei = BigInt(combineFeeCeilings(primaryFees.feeCeilingWei, fallbackFees.feeCeilingWei));
  const maxPriorityFeeWei = [primaryFees.maxPriorityFeeWei, fallbackFees.maxPriorityFeeWei]
    .map(value => BigInt(value))
    .reduce((highest, value) => value > highest ? value : highest, 0n);
  const requiredBalanceWei = (remainingGas * feeCeilingWei * 12_500n + 9_999n) / 10_000n;
  const balanceWei = BigInt(primaryReport.deployerBalanceWei);
  if (balanceWei < requiredBalanceWei) {
    errors.push(`deployer balance ${balanceWei} wei is below the buffered requirement ${requiredBalanceWei} wei`);
  }
  if (errors.length) throw new Error(errors.join("; "));
  return {
    planSha256,
    expectedNonce,
    balanceWei: balanceWei.toString(),
    remainingRequiredBalanceWei: requiredBalanceWei.toString(),
    feeCeilingWei: feeCeilingWei.toString(),
    maxPriorityFeeWei: maxPriorityFeeWei.toString(),
    primaryBlock: primaryReport.blockNumber,
    fallbackBlock: fallbackReport.blockNumber,
  };
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

async function bodyOf(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 8_192) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export async function main(argv = process.argv.slice(2)) {
  const stepFlag = argv.indexOf("--step");
  if (stepFlag === -1) throw new Error("--step is required and is zero-based");
  const step = Number(argv[stepFlag + 1]);
  const primary = process.env.ROBINHOOD_RPC_URL || "";
  const fallback = process.env.ROBINHOOD_FALLBACK_RPC_URL || "";
  const endpointErrors = validateEndpointPair(primary, fallback);
  if (endpointErrors.length) throw new Error(endpointErrors.join("; "));

  const [planBody, approvalBody, previewBody, manifestBody] = await Promise.all([
    readFile(planPath, "utf8"),
    readFile(approvalPath, "utf8"),
    readFile(previewPath, "utf8"),
    readFile(resolve(projectRoot, "config/v2-mainnet-deployment-manifest.json"), "utf8"),
  ]);
  const plan = JSON.parse(planBody);
  const approval = JSON.parse(approvalBody);
  const preview = JSON.parse(previewBody);
  const manifest = JSON.parse(manifestBody);
  const planSha256 = sha256(planBody);
  const errors = [
    ...validatePlan(plan),
    ...validateDependencyWiring(plan),
    ...validateV2MainnetApproval(approval, plan, planBody),
    ...await verifyArtifactsMatchPlan(plan),
  ];
  if (approval.contractDigest !== manifest?.source?.contractDigest) {
    errors.push("the owner authorization contract digest differs from the frozen V2 manifest");
  }
  if (errors.length) throw new Error(errors.join("; "));
  if (process.env.DOOM_V2_MAINNET_EXECUTION_ACK !== planSha256) {
    throw new Error("the V2 execution acknowledgement does not match the approved plan digest");
  }
  if (preview.status !== "v2_localhost_preview_passed" || preview.deployer?.pendingNonce !== plan.startingNonce) {
    throw new Error("the V2 localhost rehearsal does not match the locked starting nonce");
  }
  await assertApprovedInputsUnchanged(approval.sourceCommit);

  const ledger = await readLedger(planSha256);
  const ledgerErrors = validateReceiptLedger(plan, ledger, step);
  if (ledgerErrors.length) throw new Error(ledgerErrors.join("; "));
  const previewErrors = validatePreviewStep(plan.transactions[step], preview.transactions[step]);
  if (previewErrors.length) throw new Error(previewErrors.join("; "));
  const state = await preflight(primary, fallback, plan, step, preview, planSha256);
  const transaction = plan.transactions[step];
  const previewTransaction = preview.transactions[step];
  const walletFeePolicy = buildWalletFeePolicy(previewTransaction, state);
  let submittedHash = null;

  const server = createServer(async (request, response) => {
    try {
      const origin = request.headers.origin || "";
      const allowedOrigin = `http://${HOST}:${PORT}`;
      if (origin && origin !== allowedOrigin) {
        sendJson(response, 403, { ok: false, error: "invalid request origin" });
        return;
      }
      if (request.method === "GET" && request.url === "/") {
        const html = await readFile(resolve(directory, "mainnet.html"), "utf8");
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(html);
        return;
      }
      if (request.method === "GET" && request.url === "/mainnet.js") {
        const javascript = await readFile(resolve(directory, "mainnet.js"), "utf8");
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        response.end(javascript);
        return;
      }
      if (request.method === "GET" && request.url === "/plan") {
        sendJson(response, 200, {
          chainId: CHAIN_ID,
          deployer: DEPLOYER,
          planSha256,
          step,
          totalSteps: plan.transactions.length,
          transaction,
          state,
          walletFeePolicy,
          completed: ledger.receipts.length,
          factoryMustRemainPaused: true,
          tokenLaunchAuthorized: false,
          warning: "Robinhood Mainnet. This page can submit only this single approved V2 transaction.",
        });
        return;
      }
      if (request.method === "POST" && request.url === "/submitted") {
        const payload = await bodyOf(request);
        if (payload?.step !== step) throw new Error("submitted step does not match the locked server step");
        if (!HASH.test(payload?.txHash || "")) throw new Error("transaction hash is malformed");
        if (submittedHash && lower(submittedHash) !== lower(payload.txHash)) {
          throw new Error("a different transaction hash was already submitted for this step");
        }
        submittedHash = payload.txHash;
        const [primaryMined, fallbackMined] = await Promise.all([
          waitForMined(primary, submittedHash),
          waitForMined(fallback, submittedHash),
        ]);
        const mined = normalizeOnchainTransaction(primaryMined.transaction);
        const minedErrors = [
          ...validateStepSubmission(plan, step, mined),
          ...validateReceipt(transaction, primaryMined.receipt),
          ...validateReceipt(transaction, fallbackMined.receipt),
          ...compareMinedProviders(
            primaryMined.transaction,
            fallbackMined.transaction,
            primaryMined.receipt,
            fallbackMined.receipt,
          ),
        ];
        if (transaction.kind === "CREATE") {
          minedErrors.push(...await verifyCreatedRuntime(primary, fallback, transaction));
        } else {
          minedErrors.push(...await verifyBinding(primary, fallback, transaction));
        }
        if (step >= 4) {
          minedErrors.push(...await verifyPausedZeroLaunchState(primary, fallback, plan, step === 6));
        }
        if (minedErrors.length) throw new Error(minedErrors.join("; "));

        const record = {
          order: step,
          label: transaction.label,
          planSha256,
          transactionHash: submittedHash,
          status: "verified_success",
          nonce: transaction.nonce,
          blockNumber: quantity(primaryMined.receipt.blockNumber),
          blockHash: primaryMined.receipt.blockHash,
          gasUsed: BigInt(primaryMined.receipt.gasUsed).toString(),
          contractAddress: primaryMined.receipt.contractAddress || null,
          verifiedAt: new Date().toISOString(),
          providersAgreed: true,
          factoryPausedAndZeroLaunches: step >= 4 ? true : null,
        };
        ledger.receipts.push(record);
        await writeFile(receiptPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
        sendJson(response, 200, { ok: true, record, remaining: plan.transactions.length - ledger.receipts.length });
        return;
      }
      sendJson(response, 404, { ok: false, error: "not found" });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || "request failed" });
    }
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(PORT, HOST, resolvePromise);
  });
  console.log(`Locked V2 Robinhood mainnet step ${step + 1} ready: http://${HOST}:${PORT}`);
  console.log(`Plan SHA-256: ${planSha256}`);
  console.log(`Transaction: nonce ${transaction.nonce}, ${transaction.label}, value 0`);
  console.log(`Live buffered balance requirement for this and remaining steps: ${state.remainingRequiredBalanceWei} wei`);
  console.log("The server exposes only this step. Factory activation and token launch are not implemented.");
  console.log("Leave this terminal open until the page reports VERIFIED, then press Ctrl+C.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`V2 mainnet step server refused to start: ${error.message}`);
    process.exitCode = 1;
  });
}
