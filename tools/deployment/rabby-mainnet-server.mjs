import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chooseFeeCeiling, combineFeeCeilings } from "./funding-refresh.mjs";
import { runCommand } from "./localhost-preview.mjs";
import {
  compareReports,
  inspectProvider,
  validateEndpointPair,
} from "./network-preflight.mjs";
import {
  normalizeOnchainTransaction,
  validateReceipt,
  validateStepSubmission,
} from "./rabby-preview-server.mjs";
import {
  CHAIN_ID,
  DEPLOYER,
  validateDependencyWiring,
  validatePlan,
} from "./transaction-plan.mjs";
import { compareRuntimeBytecode } from "./verification-bundle.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output");
const fundingRoot = resolve(outputRoot, "funding");
const planPath = resolve(fundingRoot, "transaction-plan.json");
const approvalPath = resolve(fundingRoot, "owner-approval.json");
const previewPath = resolve(outputRoot, "latest-report.json");
const receiptPath = resolve(outputRoot, "mainnet-receipts.json");
const HOST = "127.0.0.1";
const PORT = 4181;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const CONTRACT_BEARING_PATHS = ["src", "script", "config", "foundry.toml", "remappings.txt"];

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

export function validateMainnetApproval(approval, plan, planBody) {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const authorization = approval?.authorization || {};

  require(
    approval?.status === "owner_approved_funding_and_paused_deployment",
    "owner approval status is missing",
  );
  require(approval?.chainId === CHAIN_ID, "owner approval targets the wrong chain");
  require(lower(approval?.deployer) === lower(DEPLOYER), "owner approval has the wrong deployer");
  require(approval?.planSha256 === sha256(planBody), "owner approval does not match the plan digest");
  require(approval?.startingNonce === plan?.startingNonce, "owner approval has the wrong starting nonce");
  require(authorization.funding === true, "funding was not approved");
  require(authorization.sixTransactionsOneAtATime === true, "one-at-a-time deployment was not approved");
  require(authorization.stopAndVerifyEveryReceipt === true, "receipt verification was not approved");
  require(authorization.factoryMustRemainPaused === true, "factory-paused requirement is missing");
  require(authorization.factoryResume === false, "factory resume must remain unauthorized");
  require(authorization.firstCanaryLaunch === false, "the first launch must remain unauthorized");
  require(approval?.fundingReceipt?.status === "success", "the funding receipt is not recorded as successful");
  require(
    lower(approval?.fundingReceipt?.to) === lower(DEPLOYER),
    "the funding receipt has the wrong recipient",
  );
  require(
    approval?.fundingReceipt?.valueWei === approval?.maximumFundingWei,
    "the funding receipt does not equal the approved amount",
  );
  require(HASH.test(approval?.fundingReceipt?.transactionHash || ""), "the funding transaction hash is malformed");
  return errors;
}

export function validateReceiptLedger(plan, ledger, requestedStep) {
  const errors = [];
  if (!Number.isInteger(requestedStep) || requestedStep < 0 || requestedStep >= plan.transactions.length) {
    return ["requested step is outside the six-transaction plan"];
  }
  if (!Array.isArray(ledger?.receipts)) return ["the mainnet receipt ledger is malformed"];
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
  const fields = ["hash", "from", "to", "input", "nonce", "value"];
  for (const field of fields) {
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
    await readFile(resolve(projectRoot, "out", `${contractName}.sol`, `${contractName}.json`), "utf8"),
  );
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

async function verifyBinding(primary, fallback, transaction) {
  const getter = transaction.contract === "PositionLocker"
    ? "authorizedRegistrar()"
    : "authorizedFactory()";
  const artifact = await readArtifact(transaction.contract);
  const selector = artifact.methodIdentifiers?.[getter];
  if (!/^[0-9a-fA-F]{8}$/.test(selector || "")) {
    return [`compiled artifact has no selector for ${getter}`];
  }
  const call = { to: transaction.to, data: `0x${selector}` };
  const [primaryValue, fallbackValue] = await Promise.all([
    rpc(primary, "eth_call", [call, "latest"]),
    rpc(fallback, "eth_call", [call, "latest"]),
  ]);
  const errors = [];
  if (lower(primaryValue) !== lower(fallbackValue)) errors.push(`providers disagree on ${getter}`);
  const observed = `0x${String(primaryValue).slice(-40)}`;
  if (lower(observed) !== lower(transaction.argument)) {
    errors.push(`${getter} returned ${observed}, expected ${transaction.argument}`);
  }
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

async function assertContractInputsUnchanged(approvedCommit) {
  if (!/^[0-9a-f]{40}$/i.test(approvedCommit || "")) {
    throw new Error("the approval source commit is malformed");
  }
  const safe = projectRoot.replaceAll("\\", "/");
  const args = ["-c", `safe.directory=${safe}`, "diff", "--quiet", approvedCommit, "HEAD", "--", ...CONTRACT_BEARING_PATHS];
  try {
    await runCommand("git", args);
  } catch {
    throw new Error("contract-bearing files changed after the approved plan was produced");
  }
  const { stdout } = await runCommand("git", [
    "-c", `safe.directory=${safe}`,
    "status", "--porcelain", "--untracked-files=no", "--", ...CONTRACT_BEARING_PATHS,
  ]);
  if (stdout.trim()) throw new Error("contract-bearing files have uncommitted changes");
}

async function readLedger(planSha256) {
  try {
    const ledger = JSON.parse(await readFile(receiptPath, "utf8"));
    if (ledger.planSha256 !== planSha256) throw new Error("receipt ledger belongs to another plan");
    return ledger;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { schemaVersion: 1, chainId: CHAIN_ID, planSha256, receipts: [] };
  }
}

async function preflight(primary, fallback, plan, step, preview, approval, planSha256) {
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
    errors.push(
      `deployer balance ${balanceWei} wei is below the live buffered remaining requirement `
      + `${requiredBalanceWei} wei`,
    );
  }
  if (step === 0 && balanceWei < BigInt(approval.proposedDeploymentBalanceWei)) {
    errors.push("deployer balance is below the owner-approved proposed deployment balance");
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
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.reduce((sum, chunk) => sum + chunk.length, 0) > 8_192) {
    throw new Error("request body is too large");
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

  const [planBody, approvalBody, previewBody] = await Promise.all([
    readFile(planPath, "utf8"),
    readFile(approvalPath, "utf8"),
    readFile(previewPath, "utf8"),
  ]);
  const plan = JSON.parse(planBody);
  const approval = JSON.parse(approvalBody);
  const preview = JSON.parse(previewBody);
  const planSha256 = sha256(planBody);
  const errors = [
    ...validatePlan(plan),
    ...validateDependencyWiring(plan),
    ...validateMainnetApproval(approval, plan, planBody),
  ];
  if (errors.length) throw new Error(errors.join("; "));
  if (process.env.DOOM_MAINNET_EXECUTION_ACK !== planSha256) {
    throw new Error("the execution acknowledgement does not match the approved plan digest");
  }
  if (preview.sourceCommit !== approval.sourceCommit) {
    throw new Error("localhost preview and owner approval reference different commits");
  }
  await assertContractInputsUnchanged(approval.sourceCommit);

  const ledger = await readLedger(planSha256);
  const ledgerErrors = validateReceiptLedger(plan, ledger, step);
  if (ledgerErrors.length) throw new Error(ledgerErrors.join("; "));
  const state = await preflight(primary, fallback, plan, step, preview, approval, planSha256);
  const transaction = plan.transactions[step];
  const previewTransaction = preview.transactions[step];
  if (
    previewTransaction?.order !== transaction.order
    || previewTransaction?.nonce !== transaction.nonce
    || previewTransaction?.type !== transaction.kind
    || previewTransaction?.contract !== transaction.contract
  ) {
    throw new Error("the rehearsed transaction does not match the locked plan step");
  }
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
        const html = await readFile(resolve(directory, "rabby-mainnet.html"), "utf8");
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(html);
        return;
      }
      if (request.method === "GET" && request.url === "/rabby-mainnet.js") {
        const javascript = await readFile(resolve(directory, "rabby-mainnet.js"), "utf8");
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
          transaction,
          state,
          walletFeePolicy,
          completed: ledger.receipts.length,
          warning: "Robinhood Mainnet. This page can submit only this single approved transaction.",
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

        // Read the wallet-chosen transaction and its receipt independently through both providers.
        // The next invocation performs a fresh full preflight before exposing the next nonce.
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
  console.log(`Locked Robinhood mainnet step ${step + 1} ready: http://${HOST}:${PORT}`);
  console.log(`Plan SHA-256: ${planSha256}`);
  console.log(`Transaction: nonce ${transaction.nonce}, ${transaction.label}, value 0`);
  console.log(`Live buffered balance requirement for this and remaining steps: ${state.remainingRequiredBalanceWei} wei`);
  console.log("The server exposes only this step. It cannot resume the factory or launch a token.");
  console.log("Leave this terminal open until the page reports VERIFIED, then press Ctrl+C.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Mainnet step server refused to start: ${error.message}`);
    process.exitCode = 1;
  });
}
