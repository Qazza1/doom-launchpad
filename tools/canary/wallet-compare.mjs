import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readJson, writeJson } from "../lib/json-file.mjs";
import { CHAIN_ID, MAX_VALUE_WEI, PLAN_KIND } from "./launch-plan.mjs";
import { findFoundry, validatePlanForRehearsal } from "./fork-rehearsal.mjs";
import {
  HISTORICAL_PREVIEW_CHAIN_ID,
  PREVIEW_CHAIN_ID,
  PRODUCTION_CHAIN_ID,
} from "../deployment/rabby-preview-server.mjs";

/// Stage E — wallet comparison harness for a canary plan.
///
/// Stage D proves the plan executes. This proves the *wallet* signs the plan and not something else.
/// The two are different failures: a correct plan can still be mis-rendered, re-nonced, or have its
/// value quietly changed between the page and the signature.
///
/// The rule that makes it safe to let a real wallet sign here is chain isolation. The fork runs on
/// `PREVIEW_CHAIN_ID`, EIP-155 binds every signature to that chain, and nothing signed is a valid
/// Robinhood mainnet transaction even if the raw bytes leak. The harness refuses to start on 4663
/// and re-checks the chain before every prompt.
///
/// No private key is ever loaded and there is no path from this process to mainnet other than
/// read-only calls to fork from.

export { PREVIEW_CHAIN_ID, PRODUCTION_CHAIN_ID };
export const PREVIEW_PORT = 18548;
export const PREVIEW_RPC_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
/// Distinct from the Stage 4 and Stage D sentinels so a balance can only match the fork it belongs
/// to. Unreachable for the real creator account, which holds a fraction of an ETH.
export const SENTINEL_BALANCE_WEI = 555_444_333_222_111_000_999n;
/// One canary transaction costs well under an ETH of gas, so a window this wide still cannot be
/// mistaken for a real balance while surviving the gas the signed transaction spends.
export const MAX_PREVIEW_SPEND_WEI = 10n ** 18n;
/// Wallets cache a pending nonce per chain and address and take the maximum of that cache and the
/// chain. Starting the fork far above any cached value keeps the wallet in agreement with the
/// preview plan. Preview only: a production plan uses the real pending nonce.
export const PREVIEW_NONCE_FLOOR = 1000;

const HOST = "127.0.0.1";
const PORT = 4180;
const directory = dirname(fileURLToPath(import.meta.url));
const outputRoot = resolve(directory, "output");
const lower = value => String(value ?? "").toLowerCase();
const toHex = value => `0x${BigInt(value).toString(16)}`;

/// Refuses to run anywhere a signature would be worth something. Checked before Anvil starts and
/// again before every prompt, because a wallet can switch networks between them.
export function assertIsolatedChain(chainId) {
  const value = Number(chainId);
  if (value === PRODUCTION_CHAIN_ID) {
    throw new Error(
      "refusing to compare on chain 4663: a signature made there would be a valid mainnet transaction",
    );
  }
  if (value === HISTORICAL_PREVIEW_CHAIN_ID) {
    throw new Error(
      "refusing to compare on 46630: it is a real network, so signatures made there are replayable",
    );
  }
  if (value !== PREVIEW_CHAIN_ID) {
    throw new Error(`the preview chain must be ${PREVIEW_CHAIN_ID}, not ${value}`);
  }
  return true;
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

export function choosePreviewNonce(upstreamPendingNonce) {
  return Math.max(Number(upstreamPendingNonce) + PREVIEW_NONCE_FLOOR, PREVIEW_NONCE_FLOOR);
}

/// The payload the wallet is asked to sign. Recipient, value, and calldata are the mainnet plan's,
/// unchanged — those are the fields being compared. Only the nonce differs, and it differs for a
/// stated reason that the report records.
export function buildPreviewTransaction(plan, previewNonce) {
  if (Number(plan?.chainId) !== CHAIN_ID) {
    throw new Error(`the plan targets chain ${plan?.chainId}, not the production chain ${CHAIN_ID}`);
  }
  if (BigInt(plan?.valueWei ?? 0) > MAX_VALUE_WEI) {
    throw new Error("the plan's value exceeds the canary ceiling");
  }
  return {
    from: plan.sender,
    to: plan.to,
    value: toHex(plan.valueWei),
    data: plan.data,
    nonce: Number(previewNonce),
  };
}

/// Two independent guards, both read live from the fork immediately before a prompt. Independent
/// means what it says: the chain check cannot pass because the balance check did, and a page that
/// silently switched networks fails the first while a page pointed at a different fork fails the
/// second.
export function guardsBeforePrompt({ chainId, balanceWei }) {
  const errors = [];
  try {
    assertIsolatedChain(chainId);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    validateSentinelBalance(balanceWei);
  } catch (error) {
    errors.push(error.message);
  }
  return errors;
}

/// Reads back what the wallet actually signed. Comparing against the payload the page sent would
/// only re-check our own object; the question is whether the wallet substituted anything, and only
/// the mined transaction answers it.
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

/// The mined transaction must match the planned one field for field. Value is checked as an exact
/// equality rather than "no value": a canary launch carries 0.0101 ETH, and a wallet that rounds,
/// truncates, or drops it is exactly the failure this stage exists to catch.
export function validateWalletSubmission(previewTransaction, mined) {
  const errors = [];
  if (!mined) return ["the preview chain does not know that transaction"];
  if (lower(mined.from) !== lower(previewTransaction.from)) errors.push("sender does not match the plan");
  if (lower(mined.to) !== lower(previewTransaction.to)) errors.push("recipient does not match the plan");
  if (lower(mined.data) !== lower(previewTransaction.data)) {
    errors.push("calldata does not match the plan");
  }
  if (BigInt(mined.value ?? 0) !== BigInt(previewTransaction.value)) {
    errors.push(
      `value does not match the plan (wallet sent ${BigInt(mined.value ?? 0)}, plan expects ${BigInt(previewTransaction.value)})`,
    );
  }
  if (Number(mined.nonce) !== Number(previewTransaction.nonce)) {
    errors.push(
      `nonce does not match the preview plan (wallet used ${Number(mined.nonce)}, preview expects ${previewTransaction.nonce})`,
    );
  }
  return errors;
}

/// True when the wallet signed the planned payload but chose its own nonce, which is a wallet cache
/// artifact rather than a finding. Everything that matters on mainnet is still identical.
export function isNonceOnlyDrift(previewTransaction, mined) {
  if (!previewTransaction || !mined) return false;
  return (
    lower(mined.from) === lower(previewTransaction.from) &&
    lower(mined.to) === lower(previewTransaction.to) &&
    lower(mined.data) === lower(previewTransaction.data) &&
    BigInt(mined.value ?? 0) === BigInt(previewTransaction.value) &&
    Number(mined.nonce) !== Number(previewTransaction.nonce)
  );
}

export function validateReceipt(previewTransaction, receipt) {
  const errors = [];
  if (!receipt) return ["no receipt was returned"];
  if (Number(receipt.status) !== 1) errors.push("the signed transaction did not succeed");
  if (lower(receipt.from) !== lower(previewTransaction.from)) {
    errors.push("the receipt has the wrong sender");
  }
  if (lower(receipt.to) !== lower(previewTransaction.to)) {
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

async function waitForReceipt(txHash, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const receipt = await rpc(PREVIEW_RPC_URL, "eth_getTransactionReceipt", [txHash]);
    if (receipt) return receipt;
    await new Promise(done => setTimeout(done, 250));
  }
  return null;
}

async function waitForAnvil(child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
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
      if (attempt === 79) throw error;
      await new Promise(done => setTimeout(done, 250));
    }
  }
  throw new Error("Anvil did not become ready");
}

export function parseArguments(argv) {
  const read = flag => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : argv[index + 1];
  };
  const errors = [];
  const kind = read("--kind");
  if (kind !== PLAN_KIND.resume && kind !== PLAN_KIND.launch) {
    errors.push("--kind must be resume or launch");
  }
  if (argv.filter(item => item === "--kind").length > 1) {
    errors.push("compare one kind per run; resume and launch are separate decisions");
  }
  return { errors, kind, planPath: read("--plan") ?? (kind ? `tools/canary/output/${kind}-plan.json` : null) };
}

export async function startServer(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.errors.length) throw new Error(options.errors.join("; "));

  const upstream = process.env.ROBINHOOD_RPC_URL || "";
  if (!/^https:\/\//.test(upstream)) {
    throw new Error("ROBINHOOD_RPC_URL must be an HTTPS upstream endpoint");
  }
  assertIsolatedChain(PREVIEW_CHAIN_ID);

  const planFile = await readJson(resolve(process.cwd(), options.planPath));
  const plan = planFile.plan ?? planFile;
  const planErrors = validatePlanForRehearsal(plan, options.kind);
  if (planErrors.length) throw new Error(`plan is not fit to compare: ${planErrors.join("; ")}`);

  const foundry = findFoundry();
  const upstreamPendingNonce = Number(
    await rpc(upstream, "eth_getTransactionCount", [plan.sender, "pending"]),
  );
  const previewNonce = choosePreviewNonce(upstreamPendingNonce);
  const previewTransaction = buildPreviewTransaction(plan, previewNonce);
  const html = await readFile(resolve(directory, "wallet-compare.html"));
  const clientScript = await readFile(resolve(directory, "wallet-compare.js"));
  const baseUrl = `http://${HOST}:${PORT}`;

  const anvil = spawn(foundry.anvil, [
    "--fork-url", "robinhood_mainnet",
    "--host", HOST,
    "--port", String(PREVIEW_PORT),
    "--chain-id", String(PREVIEW_CHAIN_ID),
    "--silent",
  ], {
    cwd: resolve(directory, "../.."),
    // The endpoint carries an API key, so it goes through the Foundry alias rather than argv.
    env: { ...process.env, ROBINHOOD_RPC_URL: upstream },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let server;
  let result = null;
  try {
    await waitForAnvil(anvil);
    await rpc(PREVIEW_RPC_URL, "anvil_setBalance", [plan.sender, toHex(SENTINEL_BALANCE_WEI)]);
    validateSentinelBalance(await rpc(PREVIEW_RPC_URL, "eth_getBalance", [plan.sender, "latest"]));
    await rpc(PREVIEW_RPC_URL, "anvil_setNonce", [plan.sender, toHex(previewNonce)]);
    const appliedNonce = Number(
      await rpc(PREVIEW_RPC_URL, "eth_getTransactionCount", [plan.sender, "pending"]),
    );
    if (appliedNonce !== previewNonce) throw new Error("the fork did not apply the preview nonce");

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
          response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          });
          response.end(html);
          return;
        }
        if (request.method === "GET" && request.url === "/wallet-compare.js") {
          response.writeHead(200, {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "no-store",
          });
          response.end(clientScript);
          return;
        }
        if (request.method === "GET" && request.url === "/plan") {
          sendJson(response, 200, {
            kind: plan.kind,
            planHash: plan.planHash,
            calldataHash: plan.calldataHash,
            tokenName: plan.tokenName ?? null,
            tokenSymbol: plan.tokenSymbol ?? null,
            sender: plan.sender,
            previewChainId: PREVIEW_CHAIN_ID,
            previewRpcUrl: PREVIEW_RPC_URL,
            sentinelBalanceWei: SENTINEL_BALANCE_WEI.toString(),
            minimumPreviewBalanceWei: (SENTINEL_BALANCE_WEI - MAX_PREVIEW_SPEND_WEI).toString(),
            productionNonce: plan.nonce,
            upstreamPendingNonce,
            transaction: previewTransaction,
            completed: Boolean(result),
          });
          return;
        }
        if (request.method === "POST" && request.url === "/compare") {
          if (request.headers.origin !== baseUrl) {
            sendJson(response, 403, { ok: false, error: "invalid request origin" });
            return;
          }
          if (result) {
            sendJson(response, 409, { ok: false, error: "this plan has already been compared" });
            return;
          }
          const payload = await readJsonBody(request);

          // Both guards again, server side, against the live fork. The page ran its own copy before
          // prompting; neither is trusted to stand in for the other.
          const guardErrors = guardsBeforePrompt({
            chainId: Number(await rpc(PREVIEW_RPC_URL, "eth_chainId")),
            balanceWei: await rpc(PREVIEW_RPC_URL, "eth_getBalance", [plan.sender, "latest"]),
          });
          if (guardErrors.length) {
            sendJson(response, 400, { ok: false, error: guardErrors.join("; ") });
            return;
          }

          const mined = normalizeOnchainTransaction(
            await rpc(PREVIEW_RPC_URL, "eth_getTransactionByHash", [payload?.txHash]),
          );
          const submissionErrors = validateWalletSubmission(previewTransaction, mined);
          if (submissionErrors.length) {
            sendJson(response, 400, {
              ok: false,
              nonceOnly: isNonceOnlyDrift(previewTransaction, mined),
              error: `the wallet signed something other than the plan: ${submissionErrors.join("; ")}`,
            });
            return;
          }
          const receipt = await waitForReceipt(payload?.txHash);
          const receiptErrors = validateReceipt(previewTransaction, receipt);
          if (receiptErrors.length) {
            sendJson(response, 400, { ok: false, error: receiptErrors.join("; ") });
            return;
          }

          result = await finalize({
            plan,
            previewTransaction,
            mined,
            receipt,
            upstreamPendingNonce,
          });
          sendJson(response, 200, { ok: true, ...result });
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

    console.log(`Canary wallet comparison ready: ${baseUrl}`);
    console.log(`Preview chain: ${PREVIEW_CHAIN_ID} at ${PREVIEW_RPC_URL}`);
    console.log(`Comparing the ${plan.kind} plan ${plan.planHash}`);
    console.log(`Production nonce ${plan.nonce}; the preview signs at ${previewNonce} so the`);
    console.log("wallet's cached counter cannot get ahead of the fork.");
    console.log("Add the preview network in your wallet before connecting:");
    console.log(`  Name: Doom canary preview    RPC: ${PREVIEW_RPC_URL}    Chain ID: ${PREVIEW_CHAIN_ID}`);
    console.log("The wallet signs a real transaction here. EIP-155 binds it to the preview chain,");
    console.log("so it is not a valid Robinhood mainnet transaction.");
    console.log("Press Ctrl+C when finished; Anvil and all preview state are discarded.");

    const shutdown = () => {
      if (anvil.exitCode === null) anvil.kill();
      server?.close();
    };
    process.on("SIGINT", () => {
      shutdown();
      process.exit(0);
    });
    return { server, anvil, previewTransaction };
  } catch (error) {
    if (anvil.exitCode === null) anvil.kill();
    server?.close();
    throw error;
  }
}

export async function finalize({ plan, previewTransaction, mined, receipt, upstreamPendingNonce }) {
  const report = {
    schemaVersion: 1,
    status: "canary_wallet_comparison_passed",
    generatedAt: new Date().toISOString(),
    kind: plan.kind,
    planHash: plan.planHash,
    // The stable identity across re-preparation. The plan hash moves with the nonce and expiry;
    // this does not, so it is what to compare against the plan actually submitted.
    calldataHash: plan.calldataHash,
    safety: {
      signerLoaded: false,
      walletSigned: true,
      previewChainId: PREVIEW_CHAIN_ID,
      productionChainId: PRODUCTION_CHAIN_ID,
      signaturesValidOnProductionChain: false,
      mainnetBroadcastAuthorized: false,
      rawSignedTransactionsStored: false,
    },
    compared: {
      sender: previewTransaction.from,
      recipient: previewTransaction.to,
      valueWei: BigInt(previewTransaction.value).toString(),
      calldataBytes: (previewTransaction.data.length - 2) / 2,
      walletValueWei: BigInt(mined.value ?? 0).toString(),
      walletNonce: mined.nonce,
      previewNonce: previewTransaction.nonce,
      productionNonce: plan.nonce,
      upstreamPendingNonce,
      gasUsed: BigInt(receipt.gasUsed).toString(),
    },
    notes: [
      "The mined transaction was read back from the fork and compared field by field. The payload"
        + " the page sent was not trusted as evidence of what the wallet signed.",
      `The preview signs at nonce ${previewTransaction.nonce} while production plans at`
        + ` ${plan.nonce}, so a cached wallet nonce cannot get ahead of the fork. Nonce is the only`
        + " field that differs by design; recipient, value, and calldata are the plan's own.",
    ],
    warning:
      "Comparison only. This proves the wallet renders and signs the planned call; it authorizes no mainnet action.",
  };
  await writeJson(resolve(outputRoot, `wallet-comparison-${plan.kind}.json`), report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch(error => {
    console.error(`Canary wallet comparison failed: ${error.message}`);
    process.exitCode = 1;
  });
}
