import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findFoundryBinaries } from "./localhost-preview.mjs";
import { buildPlan } from "./transaction-plan.mjs";

export const PRODUCTION_CHAIN_ID = 4663;
/// The preview fork deliberately runs on a different chain ID. Rabby signs real transactions here,
/// and EIP-155 binds every signature to this chain, so nothing produced during the rehearsal is a
/// valid Robinhood mainnet transaction even if the raw bytes leak.
export const PREVIEW_CHAIN_ID = 46630;
export const DEPLOYER = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F";
export const SENTINEL_BALANCE_WEI = 123_456_789_012_345_678_901n;
export const PREVIEW_RPC_URL = "http://127.0.0.1:18546";

const HOST = "127.0.0.1";
const PORT = 4179;
const directory = dirname(fileURLToPath(import.meta.url));
const outputRoot = resolve(directory, "output");
const strip = hex => (hex.startsWith("0x") ? hex.slice(2) : hex);
const lower = value => String(value ?? "").toLowerCase();

/// Refuses to rehearse on the production chain ID. This is the single guard that makes signing with
/// the real deployer key safe, so it is checked before Anvil starts and again before every step.
export function assertIsolatedChain(chainId) {
  const value = Number(chainId);
  if (value === PRODUCTION_CHAIN_ID) {
    throw new Error(
      "refusing to rehearse on chain 4663: a signature made there would be a valid mainnet transaction",
    );
  }
  if (value !== PREVIEW_CHAIN_ID) {
    throw new Error(`the preview chain must be ${PREVIEW_CHAIN_ID}, not ${value}`);
  }
  return true;
}

export function validateSentinelBalance(balanceHex) {
  if (BigInt(balanceHex || 0) !== SENTINEL_BALANCE_WEI) {
    throw new Error(
      "the connected account does not hold the local sentinel balance; this is not the preview fork",
    );
  }
  return true;
}

/// The browser may only submit a payload that is byte-identical to the planned one.
export function validateStepSubmission(plan, index, submitted) {
  const errors = [];
  const planned = plan?.transactions?.[index];
  if (!planned) return ["unknown step"];

  if (lower(submitted?.from) !== lower(planned.from)) errors.push("sender does not match the plan");
  if (lower(submitted?.to || null) !== lower(planned.to || null)) {
    errors.push("recipient does not match the plan");
  }
  if (lower(submitted?.data) !== lower(planned.data)) errors.push("calldata does not match the plan");
  if (Number(submitted?.nonce) !== planned.nonce) errors.push("nonce does not match the plan");
  if (submitted?.value && BigInt(submitted.value) !== 0n) errors.push("a preview step must carry no value");
  return errors;
}

export function validateReceipt(planned, receipt) {
  const errors = [];
  if (!receipt) return ["no receipt was returned"];
  if (Number(receipt.status) !== 1) errors.push("the transaction did not succeed");
  if (lower(receipt.from) !== lower(planned.from)) errors.push("the receipt has the wrong sender");
  if (planned.kind === "CREATE") {
    if (lower(receipt.contractAddress) !== lower(planned.predictedAddress)) {
      errors.push("the created address differs from the predicted address");
    }
  } else if (lower(receipt.to) !== lower(planned.to)) {
    errors.push("the receipt has the wrong recipient");
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

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 262_144) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function waitForAnvil(child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Anvil exited before becoming ready");
    try {
      const [client, chainId] = await Promise.all([
        rpc(PREVIEW_RPC_URL, "web3_clientVersion"),
        rpc(PREVIEW_RPC_URL, "eth_chainId"),
      ]);
      if (!String(client).toLowerCase().includes("anvil")) throw new Error("endpoint is not Anvil");
      assertIsolatedChain(Number(chainId));
      return;
    } catch (error) {
      if (attempt === 39) throw error;
      await new Promise(done => setTimeout(done, 250));
    }
  }
}

export async function startServer() {
  const upstream = process.env.ROBINHOOD_RPC_URL || "";
  if (!/^https:\/\//.test(upstream)) {
    throw new Error("ROBINHOOD_RPC_URL must be an HTTPS upstream endpoint");
  }
  assertIsolatedChain(PREVIEW_CHAIN_ID);

  const foundry = findFoundryBinaries();
  const pendingNonce = Number(
    await rpc(upstream, "eth_getTransactionCount", [DEPLOYER, "pending"]),
  );
  const plan = await buildPlan(pendingNonce);
  const html = await readFile(resolve(directory, "rabby-preview.html"));
  const clientScript = await readFile(resolve(directory, "rabby-preview.js"));
  const baseUrl = `http://${HOST}:${PORT}`;

  const anvil = spawn(foundry.anvil, [
    "--fork-url", upstream,
    "--host", "127.0.0.1",
    "--port", "18546",
    "--chain-id", String(PREVIEW_CHAIN_ID),
    "--silent",
  ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });

  const completed = [];
  let server;
  try {
    await waitForAnvil(anvil);
    const forkNonce = Number(await rpc(PREVIEW_RPC_URL, "eth_getTransactionCount", [DEPLOYER, "pending"]));
    if (forkNonce !== pendingNonce) {
      throw new Error("the fork nonce does not match the upstream pending nonce");
    }
    await rpc(PREVIEW_RPC_URL, "anvil_setBalance", [
      DEPLOYER,
      `0x${SENTINEL_BALANCE_WEI.toString(16)}`,
    ]);
    validateSentinelBalance(await rpc(PREVIEW_RPC_URL, "eth_getBalance", [DEPLOYER, "latest"]));

    server = createServer(async (request, response) => {
      response.setHeader(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; " +
          "connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'",
      );
      response.setHeader("referrer-policy", "no-referrer");
      response.setHeader("x-frame-options", "DENY");

      try {
        if (request.method === "GET" && request.url === "/") {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          response.end(html);
          return;
        }
        if (request.method === "GET" && request.url === "/rabby-preview.js") {
          response.writeHead(200, {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "no-store",
          });
          response.end(clientScript);
          return;
        }
        if (request.method === "GET" && request.url === "/plan") {
          sendJson(response, 200, {
            deployer: DEPLOYER,
            previewChainId: PREVIEW_CHAIN_ID,
            previewRpcUrl: PREVIEW_RPC_URL,
            sentinelBalanceWei: SENTINEL_BALANCE_WEI.toString(),
            startingNonce: plan.startingNonce,
            completed: completed.map(item => item.order),
            transactions: plan.transactions.map(transaction => ({
              order: transaction.order,
              label: transaction.label,
              kind: transaction.kind,
              irreversible: transaction.irreversible,
              from: transaction.from,
              to: transaction.to,
              value: transaction.value,
              nonce: transaction.nonce,
              data: transaction.data,
              predictedAddress: transaction.predictedAddress,
              dataSha256: transaction.dataSha256,
            })),
          });
          return;
        }
        if (request.method === "POST" && request.url === "/step") {
          if (request.headers.origin !== baseUrl) {
            sendJson(response, 403, { ok: false, error: "invalid request origin" });
            return;
          }
          const payload = await readJsonBody(request);
          const index = Number(payload?.order);
          if (index !== completed.length) {
            sendJson(response, 409, { ok: false, error: "steps must be confirmed in order" });
            return;
          }
          assertIsolatedChain(Number(await rpc(PREVIEW_RPC_URL, "eth_chainId")));
          const submissionErrors = validateStepSubmission(plan, index, payload?.transaction);
          if (submissionErrors.length) {
            sendJson(response, 400, { ok: false, error: submissionErrors.join("; ") });
            return;
          }
          const receipt = await rpc(PREVIEW_RPC_URL, "eth_getTransactionReceipt", [payload?.txHash]);
          const receiptErrors = validateReceipt(plan.transactions[index], receipt);
          if (receiptErrors.length) {
            sendJson(response, 400, { ok: false, error: receiptErrors.join("; ") });
            return;
          }
          completed.push({ order: index, gasUsed: BigInt(receipt.gasUsed).toString() });
          sendJson(response, 200, {
            ok: true,
            order: index,
            gasUsed: BigInt(receipt.gasUsed).toString(),
            remaining: plan.transactions.length - completed.length,
          });
          return;
        }
        if (request.method === "POST" && request.url === "/finish") {
          if (completed.length !== plan.transactions.length) {
            sendJson(response, 409, { ok: false, error: "the sequence is incomplete" });
            return;
          }
          const report = await finalize(plan, completed);
          sendJson(response, 200, { ok: true, ...report });
          return;
        }
        sendJson(response, 404, { ok: false, error: "not found" });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message || "request failed" });
      }
    });

    await new Promise((done, reject) => {
      server.once("error", reject);
      server.listen(PORT, HOST, done);
    });

    console.log(`Rabby transaction preview ready: ${baseUrl}`);
    console.log(`Preview chain: ${PREVIEW_CHAIN_ID} at ${PREVIEW_RPC_URL}`);
    console.log(`Upstream pending nonce copied: ${plan.startingNonce}`);
    console.log("Add the preview network in Rabby before connecting:");
    console.log(`  Name: Doom preview fork    RPC: ${PREVIEW_RPC_URL}    Chain ID: ${PREVIEW_CHAIN_ID}`);
    console.log("Rabby signs real transactions here. EIP-155 binds them to the preview chain,");
    console.log("so none of them is a valid Robinhood mainnet transaction.");
    console.log("Press Ctrl+C when finished; Anvil and all preview state are discarded.");

    const shutdown = () => {
      if (anvil.exitCode === null) anvil.kill();
      server?.close();
    };
    process.on("SIGINT", () => {
      shutdown();
      process.exit(0);
    });
    return { server, anvil, plan };
  } catch (error) {
    if (anvil.exitCode === null) anvil.kill();
    server?.close();
    throw error;
  }
}

async function finalize(plan, completed) {
  const created = Object.fromEntries(
    plan.transactions
      .filter(transaction => transaction.kind === "CREATE")
      .map(transaction => [transaction.contract, transaction.predictedAddress]),
  );
  // Selectors are read from the compiled artifacts rather than written by hand, so a renamed or
  // re-typed getter fails loudly instead of silently reading the wrong slot.
  const selector = async (contract, signature) => {
    const artifact = JSON.parse(
      await readFile(resolve(directory, "../../out", `${contract}.sol`, `${contract}.json`), "utf8"),
    );
    const identifier = artifact.methodIdentifiers?.[signature];
    if (!identifier) throw new Error(`${contract} has no ${signature}`);
    return `0x${identifier}`;
  };
  const call = async (contract, address, signature) =>
    rpc(PREVIEW_RPC_URL, "eth_call", [{ to: address, data: await selector(contract, signature) }, "latest"]);

  const [paused, registrar, boundFactory, networkValid] = await Promise.all([
    call("DoomLaunchFactory", created.DoomLaunchFactory, "launchesPaused()"),
    call("PositionLocker", created.PositionLocker, "authorizedRegistrar()"),
    call("V3LiquidityManager", created.V3LiquidityManager, "authorizedFactory()"),
    call("V3LiquidityManager", created.V3LiquidityManager, "isNetworkConfigurationValid()"),
  ]);

  const asAddress = word => (word ? `0x${word.slice(-40)}` : null);
  const postconditions = {
    factoryPaused: paused ? BigInt(paused) === 1n : null,
    registrarBoundToManager: lower(asAddress(registrar)) === lower(created.V3LiquidityManager),
    managerBoundToFactory: lower(asAddress(boundFactory)) === lower(created.DoomLaunchFactory),
    networkConfigurationValid: networkValid ? BigInt(networkValid) === 1n : null,
  };

  const report = {
    schemaVersion: 1,
    status: "rabby_transaction_preview_passed",
    generatedAt: new Date().toISOString(),
    safety: {
      signerLoaded: false,
      walletSigned: true,
      previewChainId: PREVIEW_CHAIN_ID,
      productionChainId: PRODUCTION_CHAIN_ID,
      signaturesValidOnProductionChain: false,
      mainnetBroadcastAuthorized: false,
      rawSignedTransactionsStored: false,
    },
    startingNonce: plan.startingNonce,
    steps: plan.transactions.map((transaction, index) => ({
      order: transaction.order,
      label: transaction.label,
      nonce: transaction.nonce,
      predictedAddress: transaction.predictedAddress,
      dataSha256: transaction.dataSha256,
      previewGasUsed: completed[index]?.gasUsed ?? null,
    })),
    postconditions,
    notes: [
      "isNetworkConfigurationValid is expected to be false on the preview chain because the manager"
        + " stores the production chain ID. The chain-4663 postconditions are covered by the"
        + " impersonated localhost preview.",
      "Predicted addresses depend on the copied pending nonce and change if it moves.",
    ],
    warning:
      "Rehearsal only. This proves Rabby renders and signs the planned payloads; it authorizes no mainnet action.",
  };
  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    resolve(outputRoot, "rabby-preview-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch(error => {
    console.error(`Rabby transaction preview failed: ${error.message}`);
    process.exitCode = 1;
  });
}
