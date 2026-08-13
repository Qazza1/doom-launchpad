import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findFoundryBinaries } from "./localhost-preview.mjs";
import { buildPlan as buildV1Plan } from "./transaction-plan.mjs";
import { buildPlan as buildV2Plan } from "../v2/transaction-plan.mjs";

export const PRODUCTION_CHAIN_ID = 4663;
/// The preview fork deliberately runs on a different chain ID. Rabby signs real transactions here,
/// and EIP-155 binds every signature to this chain, so nothing produced during the rehearsal is a
/// valid Robinhood mainnet transaction even if the raw bytes leak.
///
/// This was 46630 until the site's own launchpad page was found labelling `Robinhood Testnet ·
/// 46630`. Isolating onto a chain that actually exists makes the signatures replayable there, which
/// defeats the point. The value below is derived from the production chain so its origin is obvious,
/// and is not a network anything is expected to run on. It must never equal 4663.
export const PREVIEW_CHAIN_ID = 4_663_666;
/// The chain the already-passed rehearsal ran on, kept so its recorded evidence still reads true.
export const HISTORICAL_PREVIEW_CHAIN_ID = 46630;
export const DEPLOYER = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F";
export const SENTINEL_BALANCE_WEI = 123_456_789_012_345_678_901n;
export const PREVIEW_RPC_URL = "http://127.0.0.1:18546";
/// Wallets keep their own pending-nonce counter per chain and address, and it survives the fork
/// being thrown away. Chasing that counter cannot converge: every signature advances it by one, so
/// realigning to it and asking for another signature just moves the target. Instead the fork starts
/// the deployer far above any plausible cached value, because a wallet takes the maximum of its
/// cache and the chain's pending nonce. Preview only: production plans from the real pending nonce.
export const PREVIEW_NONCE_FLOOR = 1000;

const HOST = "127.0.0.1";
const PORT = 4179;
const directory = dirname(fileURLToPath(import.meta.url));
const outputRoot = resolve(directory, "output");
const strip = hex => (hex.startsWith("0x") ? hex.slice(2) : hex);
const lower = value => String(value ?? "").toLowerCase();

export function selectPreviewMode(value = "v1") {
  if (value === "v1") return { mode: "v1", buildPlan: buildV1Plan };
  if (value === "v2") return { mode: "v2", buildPlan: buildV2Plan };
  throw new Error("DOOM_PREVIEW_PLAN must be v1 or v2");
}

/// Refuses to rehearse on the production chain ID. This is the single guard that makes signing with
/// the real deployer key safe, so it is checked before Anvil starts and again before every step.
export function assertIsolatedChain(chainId) {
  const value = Number(chainId);
  if (value === PRODUCTION_CHAIN_ID) {
    throw new Error(
      "refusing to rehearse on chain 4663: a signature made there would be a valid mainnet transaction",
    );
  }
  if (value === HISTORICAL_PREVIEW_CHAIN_ID) {
    throw new Error(
      "refusing to rehearse on 46630: it is a real network, so signatures made there are replayable",
    );
  }
  if (value !== PREVIEW_CHAIN_ID) {
    throw new Error(`the preview chain must be ${PREVIEW_CHAIN_ID}, not ${value}`);
  }
  return true;
}

/// Sending a step spends gas, so the balance stops being exactly the sentinel the moment the first
/// transaction lands. The guard therefore accepts a window below the sentinel rather than equality:
/// an exact check made every later step fail, and made a page reload look like the wrong network.
/// The window is still unforgeable in practice, because the real deployer holds a fraction of an ETH
/// and the sentinel is over 123.
export const MAX_PREVIEW_SPEND_WEI = 10n ** 18n;

export function choosePreviewNonce(upstreamPendingNonce) {
  return Math.max(Number(upstreamPendingNonce) + PREVIEW_NONCE_FLOOR, PREVIEW_NONCE_FLOOR);
}

export function validateSentinelBalance(balanceHex) {
  const balance = BigInt(balanceHex || 0);
  if (balance > SENTINEL_BALANCE_WEI || balance < SENTINEL_BALANCE_WEI - MAX_PREVIEW_SPEND_WEI) {
    throw new Error(
      "the connected account does not hold the local sentinel balance; this is not the preview fork",
    );
  }
  return true;
}

/// Reads back what the wallet actually signed. Comparing the plan with the payload the page sent
/// would only re-check our own object; the runbook cares whether Rabby substituted a nonce or
/// rewrote a field, and only the mined transaction can answer that.
export function normalizeOnchainTransaction(transaction) {
  if (!transaction) return null;
  return {
    from: transaction.from,
    to: transaction.to ?? null,
    data: transaction.input ?? transaction.data,
    nonce: Number(transaction.nonce),
    value: transaction.value ?? "0x0",
  };
}

/// The mined transaction must be byte-identical to the planned one.
export function validateStepSubmission(plan, index, submitted) {
  const errors = [];
  const planned = plan?.transactions?.[index];
  if (!planned) return ["unknown step"];

  if (lower(submitted?.from) !== lower(planned.from)) errors.push("sender does not match the plan");
  if (lower(submitted?.to || null) !== lower(planned.to || null)) {
    errors.push("recipient does not match the plan");
  }
  if (lower(submitted?.data) !== lower(planned.data)) errors.push("calldata does not match the plan");
  if (Number(submitted?.nonce) !== planned.nonce) {
    errors.push(
      `nonce does not match the plan (wallet used ${Number(submitted?.nonce)}, plan expects ${planned.nonce})`,
    );
  }
  if (submitted?.value && BigInt(submitted.value) !== 0n) errors.push("a preview step must carry no value");
  return errors;
}

/// True when the wallet signed the planned payload but chose its own nonce. Rabby caches a pending
/// nonce per chain and address, so a second preview session against a fresh fork can start ahead of
/// the chain even though the fork's nonce is correct.
export function isNonceOnlyDrift(planned, mined) {
  if (!planned || !mined) return false;
  return (
    lower(mined.from) === lower(planned.from) &&
    lower(mined.to || null) === lower(planned.to || null) &&
    lower(mined.data) === lower(planned.data) &&
    (!mined.value || BigInt(mined.value) === 0n) &&
    Number(mined.nonce) !== planned.nonce
  );
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

/// Rabby returns the hash as soon as it submits, so the receipt can lag the response by a few
/// milliseconds. Asking once turned a healthy step into "no receipt was returned".
async function waitForReceipt(txHash, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const receipt = await rpc(PREVIEW_RPC_URL, "eth_getTransactionReceipt", [txHash]);
    if (receipt) return receipt;
    await new Promise(done => setTimeout(done, 250));
  }
  return null;
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

  const { mode, buildPlan } = selectPreviewMode(process.env.DOOM_PREVIEW_PLAN || "v1");

  const foundry = findFoundryBinaries();
  const pendingNonce = Number(
    await rpc(upstream, "eth_getTransactionCount", [DEPLOYER, "pending"]),
  );
  const previewNonce = choosePreviewNonce(pendingNonce);
  let plan = { ...(await buildPlan(previewNonce)), upstreamPendingNonce: pendingNonce };
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
  // Realigning more than once cannot converge: signing advances the wallet's counter, so each
  // realignment moves the target by one. One attempt, then stop and say what to fix.
  let realignments = 0;
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

    // Raise the fork's nonce above any cached wallet counter before the wallet is ever asked to
    // sign. A wallet takes the maximum of its cache and the chain, so it now agrees with the plan.
    await rpc(PREVIEW_RPC_URL, "anvil_setNonce", [DEPLOYER, `0x${previewNonce.toString(16)}`]);
    const appliedNonce = Number(
      await rpc(PREVIEW_RPC_URL, "eth_getTransactionCount", [DEPLOYER, "pending"]),
    );
    if (appliedNonce !== previewNonce) {
      throw new Error("the fork did not apply the preview nonce offset");
    }

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
            mode,
            deployer: DEPLOYER,
            previewChainId: PREVIEW_CHAIN_ID,
            previewRpcUrl: PREVIEW_RPC_URL,
            sentinelBalanceWei: SENTINEL_BALANCE_WEI.toString(),
            minimumPreviewBalanceWei: (SENTINEL_BALANCE_WEI - MAX_PREVIEW_SPEND_WEI).toString(),
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

          const mined = normalizeOnchainTransaction(
            await rpc(PREVIEW_RPC_URL, "eth_getTransactionByHash", [payload?.txHash]),
          );
          if (!mined) {
            sendJson(response, 400, {
              ok: false,
              error: "the preview chain does not know that transaction hash",
            });
            return;
          }
          // Before any step is confirmed, a wallet-chosen nonce is an artifact of Rabby's cache, not
          // a finding. Realign the fork and the plan to what the wallet actually signed, and say so
          // loudly. After the first confirmed step the same drift is a hard failure.
          if (
            index === 0 &&
            completed.length === 0 &&
            realignments === 0 &&
            isNonceOnlyDrift(plan.transactions[0], mined) &&
            mined.nonce > plan.startingNonce
          ) {
            realignments += 1;
            const realignedFrom = plan.startingNonce;
            await rpc(PREVIEW_RPC_URL, "anvil_setNonce", [DEPLOYER, `0x${mined.nonce.toString(16)}`]);
            // The signed transaction is parked in the queued pool behind a nonce gap. Raising the
            // account nonce does not promote it, so it is dropped and re-signed against the
            // realigned plan rather than left to wait for a receipt that can never arrive.
            await rpc(PREVIEW_RPC_URL, "anvil_dropTransaction", [payload?.txHash]).catch(() => null);
            plan = {
              ...(await buildPlan(mined.nonce)),
              upstreamPendingNonce: plan.upstreamPendingNonce,
            };
            console.log(
              `Realigned the preview to the wallet's nonce ${mined.nonce} (was ${realignedFrom}).`,
            );
            console.log("Sign step 1 again; the predicted addresses were recalculated.");
            sendJson(response, 409, {
              ok: false,
              realigned: true,
              realignedFrom,
              startingNonce: plan.startingNonce,
              error:
                `Rabby signed at nonce ${mined.nonce} instead of ${realignedFrom}, which is its own ` +
                "cached nonce. The preview realigned to it and recalculated every predicted " +
                "address. Sign step 1 once more against the new plan.",
            });
            return;
          }

          const submissionErrors = validateStepSubmission(plan, index, mined);
          if (submissionErrors.length) {
            const stuckAhead = realignments > 0 && isNonceOnlyDrift(plan.transactions[index], mined);
            sendJson(response, 400, {
              ok: false,
              error: stuckAhead
                ? `the wallet is still one ahead of the fork (signed ${mined.nonce}, plan expects ` +
                  `${plan.transactions[index].nonce}). Its cached nonce advances with every ` +
                  "signature, so realigning again cannot catch up. Clear pending transactions for " +
                  "this network in the wallet, then restart the preview."
                : `the wallet signed something other than the plan: ${submissionErrors.join("; ")}`,
            });
            return;
          }
          const receipt = await waitForReceipt(payload?.txHash);
          if (!receipt) {
            const chainNonce = Number(
              await rpc(PREVIEW_RPC_URL, "eth_getTransactionCount", [DEPLOYER, "latest"]),
            );
            sendJson(response, 400, {
              ok: false,
              error:
                `no receipt after 10 seconds. The transaction is signed at nonce ${mined.nonce} ` +
                `while the account is at ${chainNonce}, so it is parked behind a nonce gap and ` +
                "cannot be mined. Restart the preview to get a fresh fork.",
            });
            return;
          }
          const receiptErrors = validateReceipt(plan.transactions[index], receipt);
          if (receiptErrors.length) {
            sendJson(response, 400, { ok: false, error: receiptErrors.join("; ") });
            return;
          }
          // Restore the sentinel so the next step's guard sees the fork it expects.
          await rpc(PREVIEW_RPC_URL, "anvil_setBalance", [
            DEPLOYER,
            `0x${SENTINEL_BALANCE_WEI.toString(16)}`,
          ]);
          completed.push({ order: index, gasUsed: BigInt(receipt.gasUsed).toString() });
          sendJson(response, 200, {
            ok: true,
            order: index,
            gasUsed: BigInt(receipt.gasUsed).toString(),
            remaining: plan.transactions.length - completed.length,
            startingNonce: plan.startingNonce,
          });
          return;
        }
        if (request.method === "POST" && request.url === "/finish") {
          if (completed.length !== plan.transactions.length) {
            sendJson(response, 409, { ok: false, error: "the sequence is incomplete" });
            return;
          }
          const report = await finalize(plan, completed, mode);
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
    console.log(`Deployment plan: ${mode.toUpperCase()} (${plan.transactions.length} steps)`);
    console.log(`Preview chain: ${PREVIEW_CHAIN_ID} at ${PREVIEW_RPC_URL}`);
    console.log(`Upstream pending nonce: ${pendingNonce}`);
    console.log(
      `Preview nonce: ${plan.startingNonce} (offset by ${PREVIEW_NONCE_FLOOR} to clear any cached`
        + " wallet nonce). Predicted addresses below are preview-only for that reason.",
    );
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

async function finalize(plan, completed, mode) {
  const created = Object.fromEntries(
    plan.transactions
      .filter(transaction => transaction.kind === "CREATE")
      .map(transaction => [transaction.contract, transaction.predictedAddress]),
  );
  // Selectors are read from the compiled artifacts rather than written by hand, so a renamed or
  // re-typed getter fails loudly instead of silently reading the wrong slot.
  const selector = async (contract, signature) => {
    const artifactRoot = mode === "v2" ? "../../v2/out" : "../../out";
    const artifact = JSON.parse(
      await readFile(resolve(directory, artifactRoot, `${contract}.sol`, `${contract}.json`), "utf8"),
    );
    const identifier = artifact.methodIdentifiers?.[signature];
    if (!identifier) throw new Error(`${contract} has no ${signature}`);
    return `0x${identifier}`;
  };
  const call = async (contract, address, signature) =>
    rpc(PREVIEW_RPC_URL, "eth_call", [{ to: address, data: await selector(contract, signature) }, "latest"]);

  const asAddress = word => (word ? `0x${word.slice(-40)}` : null);
  let postconditions;
  if (mode === "v2") {
    const [paused, registrar, deployerFactory, managerFactory, networkValid] = await Promise.all([
      call("DoomLaunchFactoryV2", created.DoomLaunchFactoryV2, "launchesPaused()"),
      call("PositionLockerV2", created.PositionLockerV2, "authorizedRegistrar()"),
      call("DoomLaunchDeployerV2", created.DoomLaunchDeployerV2, "authorizedFactory()"),
      call("V3GraduationManagerV2", created.V3GraduationManagerV2, "authorizedFactory()"),
      call("V3GraduationManagerV2", created.V3GraduationManagerV2, "isNetworkConfigurationValid()"),
    ]);
    postconditions = {
      factoryPaused: paused ? BigInt(paused) === 1n : null,
      registrarBoundToManager: lower(asAddress(registrar)) === lower(created.V3GraduationManagerV2),
      deployerBoundToFactory: lower(asAddress(deployerFactory)) === lower(created.DoomLaunchFactoryV2),
      managerBoundToFactory: lower(asAddress(managerFactory)) === lower(created.DoomLaunchFactoryV2),
      networkConfigurationValid: networkValid ? BigInt(networkValid) === 1n : null,
    };
  } else {
    const [paused, registrar, boundFactory, networkValid] = await Promise.all([
      call("DoomLaunchFactory", created.DoomLaunchFactory, "launchesPaused()"),
      call("PositionLocker", created.PositionLocker, "authorizedRegistrar()"),
      call("V3LiquidityManager", created.V3LiquidityManager, "authorizedFactory()"),
      call("V3LiquidityManager", created.V3LiquidityManager, "isNetworkConfigurationValid()"),
    ]);
    postconditions = {
      factoryPaused: paused ? BigInt(paused) === 1n : null,
      registrarBoundToManager: lower(asAddress(registrar)) === lower(created.V3LiquidityManager),
      managerBoundToFactory: lower(asAddress(boundFactory)) === lower(created.DoomLaunchFactory),
      networkConfigurationValid: networkValid ? BigInt(networkValid) === 1n : null,
    };
  }

  const report = {
    schemaVersion: 1,
    status: mode === "v2" ? "v2_rabby_transaction_preview_passed" : "rabby_transaction_preview_passed",
    deploymentPlan: mode,
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
      `The preview deliberately runs at nonce ${plan.startingNonce} while the upstream pending nonce`
        + ` is ${plan.upstreamPendingNonce}, so the wallet's cached counter cannot get ahead of the`
        + " fork. The addresses above are preview-only. Production predicts from the real pending"
        + " nonce, confirmed through both providers immediately before planning.",
      "This rehearsal covers wallet rendering, signing, and gas estimation. Address prediction at"
        + " the real nonce is covered by the impersonated localhost preview.",
    ],
    warning:
      "Rehearsal only. This proves Rabby renders and signs the planned payloads; it authorizes no mainnet action.",
  };
  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    resolve(outputRoot, mode === "v2" ? "v2-rabby-preview-report.json" : "rabby-preview-report.json"),
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
