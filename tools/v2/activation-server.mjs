import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { main as runPreflight, operationForArguments } from "./activation-preflight.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const host = "127.0.0.1";
const port = 4183;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const lower = value => String(value || "").toLowerCase();
const number = value => Number(BigInt(value));
const sleep = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

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

function serverProfile(operation) {
  if (operation.key === "legacy-pause") {
    return {
      authorizationPath: resolve(projectRoot, "config/public-v2-legacy-pause-authorization.json"),
      receiptPath: resolve(directory, "output/legacy-pause-receipt.json"),
      authorizationStatus: "owner_authorized_exact_legacy_pause",
      scopeField: "legacyFactoryPause",
      expectedPausedAfter: true,
      completedStatus: "legacy_factory_pause_verified_success",
      title: "Pause Legacy Launches",
      warning: "One zero-value transaction only. This blocks new legacy launches; Genesis trading and GM stay available.",
      button: "CONNECT RABBY & SEND EXACT LEGACY PAUSE",
    };
  }
  if (operation.key === "public-resume") {
    return {
      authorizationPath: resolve(projectRoot, "config/public-v2-mainnet-activation-authorization.json"),
      receiptPath: resolve(directory, "output/public-v2-activation-receipt.json"),
      authorizationStatus: "owner_authorized_exact_public_v2_activation",
      scopeField: "factoryResume",
      expectedPausedAfter: false,
      completedStatus: "public_v2_factory_activation_verified_success",
      title: "Activate Public Doom Launcher",
      warning: "One zero-value transaction only. This resumes public launches; it does not launch a token.",
      button: "CONNECT RABBY & SEND EXACT PUBLIC ACTIVATION",
    };
  }
  return {
    authorizationPath: resolve(projectRoot, "config/v2-mainnet-activation-authorization.json"),
    receiptPath: resolve(directory, "output/activation-receipt.json"),
    authorizationStatus: "owner_authorized_exact_v2_activation",
    scopeField: "factoryResume",
    expectedPausedAfter: false,
    completedStatus: "v2_factory_activation_verified_success",
    title: "Activate Doom Launcher V2",
    warning: "One zero-value transaction only. This resumes the factory; it does not launch a token.",
    button: "CONNECT RABBY & SEND EXACT ACTIVATION",
  };
}

export function validateAuthorization(authorization, preflight, operation = operationForArguments([])) {
  const profile = serverProfile(operation);
  const errors = [];
  const expected = preflight?.transaction || {};
  const actual = authorization?.transaction || {};
  const require = (condition, message) => { if (!condition) errors.push(message); };
  require(authorization?.status === profile.authorizationStatus, "exact cutover authorization is missing");
  require(authorization?.chainId === 4663, "authorization chain ID differs");
  for (const field of ["from", "to", "value", "data"]) {
    require(lower(actual[field]) === lower(expected[field]), `authorization ${field} differs`);
  }
  require(actual.nonce === expected.nonce, "authorization nonce differs");
  require(String(actual.gasLimit) === String(expected.gasLimit), "authorization gas limit differs");
  const maximumGasLimit = BigInt(actual.maximumGasLimit || actual.gasLimit || 0);
  require(maximumGasLimit >= BigInt(expected.gasLimit), "maximum gas limit is below the requested gas limit");
  require(maximumGasLimit <= BigInt(expected.gasLimit) * 2n, "maximum gas limit exceeds the safety bound");
  require(actual.function === operation.function, "authorization function differs");
  require(authorization?.scope?.transactionCount === 1, "authorization must cover one transaction");
  require(authorization?.scope?.[profile.scopeField] === true, `${profile.scopeField} was not authorized`);
  require(authorization?.scope?.factoryResume === (profile.scopeField === "factoryResume"), "factory resume scope differs");
  require(authorization?.scope?.legacyFactoryResume !== true, "legacy factory resume must remain unauthorized");
  for (const field of ["tokenLaunch", "ethTransfer", "contractDeployment", "tokenApproval", "otherContractCall"]) {
    require(authorization?.scope?.[field] === false, `${field} must remain unauthorized`);
  }
  require(preflight?.safety?.signed === false && preflight?.safety?.broadcast === false, "preflight is not unsigned");
  return errors;
}

function transactionForWallet(transaction) {
  return {
    from: transaction.from,
    to: transaction.to,
    value: transaction.value,
    data: transaction.data,
    nonce: `0x${transaction.nonce.toString(16)}`,
    gas: `0x${BigInt(transaction.gasLimit).toString(16)}`,
    chainId: "0x1237"
  };
}

async function waitForReceipt(url, transactionHash) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const [transaction, receipt] = await Promise.all([
      rpc(url, "eth_getTransactionByHash", [transactionHash]),
      rpc(url, "eth_getTransactionReceipt", [transactionHash]),
    ]);
    if (transaction && receipt) return { transaction, receipt };
    await sleep(2_000);
  }
  throw new Error("activation transaction was not mined within the verification window");
}

function validateMined(observed, expected, maximumGasLimit = expected.gasLimit) {
  const errors = [];
  const transaction = observed.transaction;
  const receipt = observed.receipt;
  const require = (condition, message) => { if (!condition) errors.push(message); };
  require(lower(transaction.from) === lower(expected.from), "mined sender differs");
  require(lower(transaction.to) === lower(expected.to), "mined target differs");
  require(lower(transaction.input) === lower(expected.data), "mined calldata differs");
  require(BigInt(transaction.value) === 0n, "mined value is not zero");
  require(number(transaction.nonce) === expected.nonce, "mined nonce differs");
  require(BigInt(transaction.gas) >= BigInt(expected.gasLimit), "mined gas limit is below the authorized request");
  require(BigInt(transaction.gas) <= BigInt(maximumGasLimit), "mined gas limit exceeds the authorized maximum");
  require(number(receipt.status) === 1, "activation receipt failed");
  require(lower(receipt.from) === lower(expected.from), "receipt sender differs");
  require(lower(receipt.to) === lower(expected.to), "receipt target differs");
  return errors;
}

async function verifyPostconditions(url, expected) {
  const [pausedHex, countHex, nonceHex] = await Promise.all([
    rpc(url, "eth_call", [{ to: expected.to, data: "0x3bc340c2" }, "latest"]),
    rpc(url, "eth_call", [{ to: expected.to, data: "0x27cca59f" }, "latest"]),
    rpc(url, "eth_getTransactionCount", [expected.from, "pending"]),
  ]);
  return {
    factoryPaused: BigInt(pausedHex) === 1n,
    factoryLaunchCount: number(countHex),
    pendingNonce: number(nonceHex),
  };
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 2048) throw new Error("request body is too large");
  }
  return JSON.parse(body || "{}");
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(body)}\n`);
}

export async function main() {
  const operation = operationForArguments();
  const profile = serverProfile(operation);
  const [authorization, preflight] = await Promise.all([
    readFile(profile.authorizationPath, "utf8").then(JSON.parse),
    runPreflight(),
  ]);
  const authorizationErrors = validateAuthorization(authorization, preflight, operation);
  if (authorizationErrors.length) throw new Error(authorizationErrors.join("; "));
  const walletTransaction = transactionForWallet(preflight.transaction);
  const primaryUrl = process.env.ROBINHOOD_RPC_URL;
  const fallbackUrl = process.env.ROBINHOOD_FALLBACK_RPC_URL;
  let submittedHash = null;
  let completed = false;

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/") {
        const html = await readFile(resolve(directory, "activation.html"));
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(html);
        return;
      }
      if (request.method === "GET" && request.url === "/activation.js") {
        const javascript = await readFile(resolve(directory, "activation.js"));
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        response.end(javascript);
        return;
      }
      if (request.method === "GET" && request.url === "/api/intent") {
        json(response, 200, {
          status: completed ? "completed" : "authorized",
          transaction: walletTransaction,
          presentation: { title: profile.title, warning: profile.warning, button: profile.button },
        });
        return;
      }
      if (request.method === "POST" && request.url === "/api/verify") {
        const body = await readJson(request);
        const transactionHash = String(body.transactionHash || "");
        if (!hashPattern.test(transactionHash)) throw new Error("transaction hash is malformed");
        if (submittedHash && lower(submittedHash) !== lower(transactionHash)) throw new Error("a different transaction was already submitted");
        submittedHash = transactionHash;
        const [primary, fallback] = await Promise.all([
          waitForReceipt(primaryUrl, transactionHash),
          waitForReceipt(fallbackUrl, transactionHash),
        ]);
        const maximumGasLimit = authorization.transaction.maximumGasLimit || preflight.transaction.gasLimit;
        const errors = [
          ...validateMined(primary, preflight.transaction, maximumGasLimit),
          ...validateMined(fallback, preflight.transaction, maximumGasLimit),
        ];
        if (lower(primary.receipt.blockHash) !== lower(fallback.receipt.blockHash)) errors.push("providers disagree on receipt block");
        const [primaryPost, fallbackPost] = await Promise.all([
          verifyPostconditions(primaryUrl, preflight.transaction),
          verifyPostconditions(fallbackUrl, preflight.transaction),
        ]);
        for (const post of [primaryPost, fallbackPost]) {
          if (post.factoryPaused !== profile.expectedPausedAfter) errors.push("factory pause state differs after cutover");
          if (post.factoryLaunchCount !== operation.expectedLaunchCount) errors.push("launch count changed during cutover");
          if (post.pendingNonce !== preflight.transaction.nonce + 1) errors.push("operator nonce did not advance exactly once");
        }
        if (errors.length) throw new Error(errors.join("; "));
        completed = true;
        const report = {
          status: profile.completedStatus,
          verifiedAt: new Date().toISOString(),
          chainId: 4663,
          transactionHash,
          transaction: preflight.transaction,
          receipt: {
            blockNumber: number(primary.receipt.blockNumber),
            blockHash: primary.receipt.blockHash,
            gasUsed: BigInt(primary.receipt.gasUsed).toString(),
            submittedGasLimit: BigInt(primary.transaction.gas).toString(),
            status: number(primary.receipt.status),
          },
          postconditions: primaryPost,
          providersAgreed: true,
          tokenLaunchAuthorized: false,
        };
        await mkdir(dirname(profile.receiptPath), { recursive: true });
        await writeFile(profile.receiptPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
        json(response, 200, report);
        return;
      }
      json(response, 404, { error: "not found" });
    } catch (error) {
      json(response, 400, { error: error.message });
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolvePromise);
  });
  console.log(`${profile.title} gate ready at http://${host}:${port}`);
  console.log("Exact authorized transaction only. No token launch path exists.");
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`V2 cutover gate failed: ${error.message}`);
    process.exitCode = 1;
  });
}
