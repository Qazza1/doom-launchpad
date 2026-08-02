import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readJson, writeJson } from "../lib/json-file.mjs";
import { CHAIN_ID, FACTORY, PLAN_KIND, SENDER } from "./launch-plan.mjs";
import { assertNotBundled, validateCalldata, validateIntegrity, validateValue } from "./plan-guards.mjs";
import { loadDecisions, observeLaunch } from "./observe.mjs";

/// Stage D — localhost fork rehearsal.
///
/// Runs the *exact prepared plan* — same sender, same recipient, same value, same calldata — against
/// a local fork of Robinhood Chain, and then judges the result with the same observer that judges a
/// mainnet launch. It exists because a plan-value bug reached a real wallet: a plan that looks
/// correct in a printed summary can still revert, and the cheapest place to discover that is on a
/// chain nobody can spend from.
///
/// Resume and launch are rehearsed **separately**, one run each, exactly as they are approved. A run
/// that is handed both refuses to start.
///
/// No key is loaded and no request ever reaches mainnet with a `from` this tool controls: the
/// transaction is sent by an impersonated account on a local Anvil that holds a sentinel balance no
/// real account could have.

export const LOCAL_PORT = 18546;
export const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;
/// Distinct from the Stage 4 deployment preview's sentinel so a report can never be confused for the
/// other tool's, and impossible on mainnet.
export const SENTINEL_BALANCE_WEI = 987_654_321_098_765_432_109n;
export const MAX_HEAD_DRIFT_BLOCKS = 500;

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output");

const quantity = value => Number(BigInt(value));
const toHex = value => `0x${BigInt(value).toString(16)}`;

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
  // One kind per run. Rehearsing both in one command would model the two decisions as one, which is
  // the property this whole workflow exists to prevent.
  if (argv.filter(item => item === "--kind").length > 1) {
    errors.push("rehearse one kind per run; resume and launch are separate decisions");
  }
  const plan = read("--plan") ?? (kind ? `tools/canary/output/${kind}-plan.json` : null);
  return { errors, kind, planPath: plan };
}

/// The plan must be internally consistent before it is worth spending a fork on, and it must be the
/// kind this run was asked to rehearse.
export function validatePlanForRehearsal(plan, kind) {
  const errors = [
    ...validateIntegrity(plan),
    ...assertNotBundled([plan]),
    ...validateValue(plan, plan?.valueWei),
    ...validateCalldata(plan, plan?.data),
  ];
  if (plan?.kind !== kind) errors.push(`plan is a ${plan?.kind} but the run asked for a ${kind}`);
  if (Number(plan?.chainId) !== CHAIN_ID) errors.push(`plan targets chain ${plan?.chainId}`);
  if (String(plan?.to).toLowerCase() !== FACTORY.toLowerCase()) {
    errors.push("plan recipient is not the deployed factory");
  }
  if (String(plan?.sender).toLowerCase() !== SENDER.toLowerCase()) {
    errors.push("plan sender is not the approved creator");
  }
  return errors;
}

/// Proves the endpoint about to receive a transaction is a local fork and not the real chain. Every
/// one of these has to hold; a single passing check is not evidence.
export function assertLocalFork({
  clientVersion,
  chainId,
  localHead,
  upstreamHead,
  localNonce,
  upstreamNonce,
  sentinelBalanceWei,
}) {
  const errors = [];
  if (!String(clientVersion).toLowerCase().includes("anvil")) {
    errors.push("the local endpoint is not Anvil");
  }
  if (Number(chainId) !== CHAIN_ID) errors.push(`the fork reports chain ${chainId}`);
  if (Math.abs(Number(localHead) - Number(upstreamHead)) > MAX_HEAD_DRIFT_BLOCKS) {
    errors.push("the fork head is more than 500 blocks from the upstream head");
  }
  if (Number(localNonce) !== Number(upstreamNonce)) {
    errors.push("the fork sender nonce differs from the upstream pending nonce");
  }
  if (BigInt(sentinelBalanceWei ?? 0) !== SENTINEL_BALANCE_WEI) {
    errors.push("the local-only sentinel balance was not applied; refusing to send anything");
  }
  return errors;
}

export function evaluateResumeOutcome({ before, after }) {
  const errors = [];
  if (before?.paused !== true) errors.push("the factory was not paused before the rehearsed resume");
  if (after?.paused !== false) errors.push("the factory is still paused after the rehearsed resume");
  if (String(before?.launchCount) !== String(after?.launchCount)) {
    errors.push("a resume changed the launch count; it must only unpause");
  }
  if (String(before?.totalNativeLiquidity) !== String(after?.totalNativeLiquidity)) {
    errors.push("a resume changed aggregate native liquidity");
  }
  return errors;
}

export function evaluateLaunchOutcome({ before, after, requestedLiquidityWei, observation }) {
  const errors = [];
  if (before?.paused !== false) errors.push("the factory was paused before the rehearsed launch");
  if (BigInt(after?.launchCount ?? 0) !== BigInt(before?.launchCount ?? 0) + 1n) {
    errors.push("the rehearsed launch did not increase the launch count by exactly one");
  }
  const liquidityDelta = BigInt(after?.totalNativeLiquidity ?? 0) - BigInt(before?.totalNativeLiquidity ?? 0);
  if (liquidityDelta !== BigInt(requestedLiquidityWei)) {
    errors.push(`aggregate native liquidity moved by ${liquidityDelta}, expected ${requestedLiquidityWei}`);
  }
  if (after?.paused !== false) errors.push("the factory paused itself during the launch");
  // The rehearsed launch is held to every invariant a real one is.
  for (const failure of observation?.failures ?? []) errors.push(`observer: ${failure}`);
  return errors;
}

/// Turns revert data into something an operator can act on. A plain `Error(string)` is decoded;
/// a custom error is reported by selector, which is enough to find it in the source. Anvil reports
/// a failed gas estimate as "insufficient funds", which is true of the fallback gas limit and
/// says nothing about the real cause — so the reason is always taken from an `eth_call` instead.
export function decodeRevert(data, errorsBySelector = {}) {
  const body = String(data ?? "").replace(/^0x/, "");
  if (!body) return "no revert data";
  if (body.startsWith("08c379a0") && body.length >= 8 + 128) {
    const length = Number(BigInt(`0x${body.slice(72, 136)}`));
    const text = Buffer.from(body.slice(136, 136 + length * 2), "hex").toString("utf8");
    if (text) return text;
  }
  const selector = `0x${body.slice(0, 8)}`;
  const signature = errorsBySelector[selector.toLowerCase()];
  // Custom-error arguments are printed as raw words. Every error in these contracts takes only
  // static types, so the words are the values, and seeing "required 10100000000000000, sent
  // 10000000000000000" is the whole point of rehearsing.
  const words = body.slice(8).match(/.{64}/g) ?? [];
  const args = words.length && words.length <= 8
    ? ` [${words.map(word => BigInt(`0x${word}`).toString()).join(", ")}]`
    : "";
  return signature ? `${signature} ${selector}${args}` : `unknown custom error ${selector}${args}`;
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) {
    const error = new Error(`${method}: ${body.error.message || "RPC error"}`);
    error.data = body.error.data;
    throw error;
  }
  return body.result;
}

export function findFoundry() {
  const executable = process.platform === "win32" ? ".exe" : "";
  const roots = [
    resolve(directory, "../../../.tools/foundry-v1.7.1"),
    resolve(process.env.USERPROFILE || process.env.HOME || "", ".foundry/bin"),
  ];
  for (const root of roots) {
    const found = {
      anvil: resolve(root, `anvil${executable}`),
      forge: resolve(root, `forge${executable}`),
    };
    if (Object.values(found).every(existsSync)) return found;
  }
  throw new Error("Pinned Foundry binaries were not found");
}

/// Selector to signature, so a revert reads as a name instead of four bytes.
export async function loadErrorSelectors(forgePath, contracts) {
  const map = {};
  for (const contract of contracts) {
    const output = await new Promise(done => {
      const child = spawn(forgePath, ["inspect", contract, "errors", "--json"], {
        cwd: projectRoot,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      let text = "";
      child.stdout.on("data", chunk => {
        text += chunk.toString();
      });
      child.on("error", () => done(""));
      child.on("close", () => done(text));
    });
    try {
      for (const [signature, selector] of Object.entries(JSON.parse(output))) {
        map[`0x${String(selector).replace(/^0x/, "").toLowerCase()}`] = signature;
      }
    } catch {
      // A missing selector map costs a readable name, not a failed rehearsal.
    }
  }
  return map;
}

async function waitForAnvil(child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Anvil exited before becoming ready");
    try {
      return await rpc(LOCAL_URL, "web3_clientVersion");
    } catch (error) {
      if (attempt === 79) throw error;
      await new Promise(done => setTimeout(done, 250));
    }
  }
  throw new Error("Anvil did not become ready");
}

async function readFactoryState(url, selectors) {
  const call = data => rpc(url, "eth_call", [{ to: FACTORY, data }, "latest"]);
  return {
    paused: BigInt(await call(selectors.paused)) === 1n,
    launchCount: BigInt(await call(selectors.launchCount)).toString(),
    totalNativeLiquidity: BigInt(await call(selectors.totalNativeLiquidity)).toString(),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.errors.length) throw new Error(options.errors.join("; "));

  const upstream = process.env.ROBINHOOD_RPC_URL || "";
  let upstreamUrl;
  try {
    upstreamUrl = new URL(upstream);
  } catch {
    throw new Error("ROBINHOOD_RPC_URL is missing or invalid");
  }
  if (upstreamUrl.protocol !== "https:") throw new Error("ROBINHOOD_RPC_URL must be HTTPS");
  if (["127.0.0.1", "localhost"].includes(upstreamUrl.hostname)) {
    throw new Error("ROBINHOOD_RPC_URL must be the upstream endpoint, not localhost");
  }

  const planFile = await readJson(resolve(process.cwd(), options.planPath));
  const plan = planFile.plan ?? planFile;
  const planErrors = validatePlanForRehearsal(plan, options.kind);
  if (planErrors.length) throw new Error(`plan is not fit to rehearse: ${planErrors.join("; ")}`);

  const artifact = await readJson(
    resolve(projectRoot, "out/DoomLaunchFactory.sol/DoomLaunchFactory.json"),
  );
  const selectorFor = name => {
    const identifier = artifact.methodIdentifiers?.[name];
    if (!identifier) throw new Error(`the factory artifact has no ${name}`);
    return `0x${identifier}`;
  };
  const selectors = {
    paused: selectorFor("launchesPaused()"),
    launchCount: selectorFor("launchCount()"),
    totalNativeLiquidity: selectorFor("totalNativeLiquidity()"),
  };

  const [upstreamChainId, upstreamHeadHex, upstreamNonceHex, upstreamBalanceHex] = await Promise.all([
    rpc(upstream, "eth_chainId"),
    rpc(upstream, "eth_blockNumber"),
    rpc(upstream, "eth_getTransactionCount", [plan.sender, "pending"]),
    rpc(upstream, "eth_getBalance", [plan.sender, "latest"]),
  ]);
  if (quantity(upstreamChainId) !== CHAIN_ID) {
    throw new Error(`upstream RPC returned chain ${quantity(upstreamChainId)}`);
  }

  const generatedAt = new Date().toISOString();
  const foundry = findFoundry();
  const errorsBySelector = await loadErrorSelectors(foundry.forge, [
    "DoomLaunchFactory",
    "V3LiquidityManager",
    "PositionLocker",
    "GmEscrow",
  ]);
  const anvil = spawn(foundry.anvil, [
    "--fork-url", "robinhood_mainnet",
    "--host", "127.0.0.1",
    "--port", String(LOCAL_PORT),
    "--auto-impersonate",
    "--chain-id", String(CHAIN_ID),
    "--silent",
  ], {
    cwd: projectRoot,
    // The endpoint is passed through the Foundry alias so the URL, which carries an API key, never
    // appears in a process command line.
    env: { ...process.env, ROBINHOOD_RPC_URL: upstream },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let anvilError = "";
  anvil.stderr.on("data", chunk => {
    if (anvilError.length < 16_384) anvilError += chunk.toString();
  });

  try {
    const clientVersion = await waitForAnvil(anvil);
    const [localChainId, localHeadHex, localNonceHex] = await Promise.all([
      rpc(LOCAL_URL, "eth_chainId"),
      rpc(LOCAL_URL, "eth_blockNumber"),
      rpc(LOCAL_URL, "eth_getTransactionCount", [plan.sender, "pending"]),
    ]);
    await rpc(LOCAL_URL, "anvil_setBalance", [plan.sender, toHex(SENTINEL_BALANCE_WEI)]);
    const sentinel = await rpc(LOCAL_URL, "eth_getBalance", [plan.sender, "latest"]);

    const forkErrors = assertLocalFork({
      clientVersion,
      chainId: quantity(localChainId),
      localHead: quantity(localHeadHex),
      upstreamHead: quantity(upstreamHeadHex),
      localNonce: quantity(localNonceHex),
      upstreamNonce: quantity(upstreamNonceHex),
      sentinelBalanceWei: BigInt(sentinel),
    });
    if (forkErrors.length) throw new Error(forkErrors.join("; "));

    const before = await readFactoryState(LOCAL_URL, selectors);
    if (plan.kind === PLAN_KIND.launch && before.paused) {
      throw new Error(
        "the factory is paused on the fork; rehearse and submit the resume first, as its own decision",
      );
    }
    if (plan.kind === PLAN_KIND.resume && !before.paused) {
      throw new Error("the factory is already unpaused upstream; a resume would revert");
    }

    // The rehearsal sends the plan verbatim. Anything this tool adds of its own would be a thing
    // the wallet will not do.
    const call = {
      from: plan.sender,
      to: plan.to,
      value: toHex(plan.valueWei),
      data: plan.data,
    };
    let sendError = null;
    let receipt = null;
    // Simulate first. A failed send reports whatever went wrong with the gas-estimate fallback,
    // which is rarely the real reason; an `eth_call` gives the revert itself.
    try {
      await rpc(LOCAL_URL, "eth_call", [call, "latest"]);
    } catch (error) {
      const detail = typeof error.data === "string" && error.data.startsWith("0x")
        ? decodeRevert(error.data, errorsBySelector)
        : error.message;
      sendError = `the call reverts before it can be mined: ${detail}`;
    }
    if (!sendError) {
      try {
        const hash = await rpc(LOCAL_URL, "eth_sendTransaction", [call]);
        for (let attempt = 0; attempt < 40 && !receipt; attempt += 1) {
          receipt = await rpc(LOCAL_URL, "eth_getTransactionReceipt", [hash]);
          if (!receipt) await new Promise(done => setTimeout(done, 250));
        }
        if (!receipt) sendError = "the local chain produced no receipt";
      } catch (error) {
        sendError = `the local chain refused the transaction: ${error.message}`;
      }
    }

    const succeeded = !sendError && receipt?.status === "0x1";
    const after = succeeded ? await readFactoryState(LOCAL_URL, selectors) : before;

    let observation = null;
    let outcomeErrors = [];
    if (!succeeded) {
      outcomeErrors = [sendError ?? `the rehearsed transaction reverted with status ${receipt?.status}`];
    } else if (plan.kind === PLAN_KIND.resume) {
      outcomeErrors = evaluateResumeOutcome({ before, after });
    } else {
      const decisions = await loadDecisions();
      const deployment = await readJson(
        resolve(projectRoot, "config/robinhood-mainnet-stage4-deployment.json"),
      );
      const addresses = Object.fromEntries(
        Object.entries(deployment.verification.contracts).map(([name, item]) => [name, item.address]),
      );
      observation = await observeLaunch({
        url: LOCAL_URL,
        factory: FACTORY,
        launchId: after.launchCount,
        addresses,
        decisions,
      });
      outcomeErrors = evaluateLaunchOutcome({
        before,
        after,
        requestedLiquidityWei: plan.nativeLiquidityWei,
        observation,
      });
    }

    const stringify = value => (typeof value === "bigint" ? value.toString() : value);
    const report = {
      schemaVersion: 1,
      status: outcomeErrors.length ? "fork_rehearsal_failed" : "fork_rehearsal_passed",
      generatedAt,
      kind: plan.kind,
      planHash: plan.planHash,
      safety: {
        upstreamWrites: false,
        signerLoaded: false,
        mainnetBroadcast: false,
        localImpersonationOnly: true,
        sentinelBalanceApplied: true,
      },
      network: {
        chainId: CHAIN_ID,
        forkBlock: quantity(localHeadHex),
        upstreamHead: quantity(upstreamHeadHex),
        rpcSecretPrinted: false,
      },
      sender: {
        address: plan.sender,
        upstreamPendingNonce: quantity(upstreamNonceHex),
        upstreamBalanceWei: BigInt(upstreamBalanceHex).toString(),
        rehearsalBalanceWei: SENTINEL_BALANCE_WEI.toString(),
      },
      submitted: { to: plan.to, valueWei: String(plan.valueWei), calldataHash: plan.calldataHash },
      result: {
        accepted: !sendError,
        receiptStatus: receipt?.status ?? null,
        gasUsed: receipt?.gasUsed ? BigInt(receipt.gasUsed).toString() : null,
        error: sendError,
      },
      before,
      after,
      observation: observation
        ? {
          launchId: Number(after.launchCount),
          record: Object.fromEntries(
            Object.entries(observation.record).map(([k, v]) => [k, stringify(v)]),
          ),
          positionOwner: observation.positionOwner,
          failures: observation.failures,
        }
        : null,
      failures: outcomeErrors,
      warning:
        "Rehearsal on a local fork. A pass is evidence the plan executes, not authorization to submit it.",
    };
    const path = await writeJson(resolve(outputRoot, `fork-rehearsal-${plan.kind}.json`), report);

    console.log(`\n=== ${plan.kind.toUpperCase()} REHEARSAL (local fork) ===`);
    console.log(`  fork block   ${report.network.forkBlock}`);
    console.log(`  plan hash    ${plan.planHash}`);
    console.log(`  value        ${plan.valueWei} wei`);
    console.log(`  result       ${report.result.accepted ? `status ${report.result.receiptStatus}` : "rejected"}`);
    if (report.result.gasUsed) console.log(`  gas used     ${report.result.gasUsed}`);
    console.log(`  launches     ${before.launchCount} -> ${after.launchCount}`);
    console.log(`  paused       ${before.paused} -> ${after.paused}`);
    console.log(`  report       ${path}`);
    console.log("  upstream balance is reported, not used; the rehearsal spends the sentinel.");

    if (outcomeErrors.length) {
      console.error("\n  REHEARSAL FAILED:");
      for (const failure of outcomeErrors) console.error(`    - ${failure}`);
      throw new Error(`${outcomeErrors.length} rehearsal failure(s); do not submit this plan`);
    }
    console.log("\n  The plan executes and every invariant holds on the fork.");
    console.log("  Nothing was sent to mainnet and no key was loaded. Submitting is still a");
    console.log("  separate decision, made in your own wallet, for this action alone.");
  } finally {
    if (anvil.exitCode === null) anvil.kill();
    if (anvil.exitCode && anvil.exitCode !== 0 && anvilError.trim()) {
      console.error(`Anvil: ${anvilError.trim()}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Fork rehearsal failed: ${error.message}`);
    process.exitCode = 1;
  });
}
