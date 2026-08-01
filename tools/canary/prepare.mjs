import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PLAN_KIND, buildLaunchPlan, buildResumePlan } from "./launch-plan.mjs";
import { guardSubmission } from "./plan-guards.mjs";
import { buildObserved, compareProviders, readProvider, validateBalance } from "./preflight.mjs";

/// The one command an owner runs to prepare a canary transaction. It reads chain state, builds the
/// plan, runs every guard, prints the plan hash, and stops. There is deliberately no send path:
/// submission happens in the owner's own wallet after they have compared the hash.

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output");
const DEFAULT_TTL_SECONDS = 900;

export function parseArguments(argv) {
  const read = flag => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : argv[index + 1];
  };
  const kind = read("--kind");
  const errors = [];
  if (kind !== PLAN_KIND.resume && kind !== PLAN_KIND.launch) {
    errors.push("--kind must be resume or launch");
  }
  const index = Number(read("--launch") ?? 1);
  if (kind === PLAN_KIND.launch && ![1, 2, 3].includes(index)) {
    errors.push("--launch must be 1, 2, or 3");
  }
  const ttl = Number(read("--ttl") ?? DEFAULT_TTL_SECONDS);
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 3600) {
    errors.push("--ttl must be between 1 and 3600 seconds");
  }
  // Headroom is proportional to the operation. A resume is one storage write and an event, on the
  // order of 30,000 gas; a launch deploys two contracts, creates a pool, and mints a position. A
  // flat default large enough for a launch blocks a resume the balance covers many times over, and
  // a guard that fails on the normal path is one the operator learns to ignore.
  const defaultHeadroom = kind === PLAN_KIND.launch ? "3000000000000000" : "100000000000000";
  const gasHeadroomWei = read("--gas-headroom") ?? defaultHeadroom;
  return { errors, kind, index, ttl, gasHeadroomWei };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.errors.length) throw new Error(options.errors.join("; "));

  const primaryUrl = process.env.ROBINHOOD_RPC_URL || "";
  const fallbackUrl = process.env.ROBINHOOD_FALLBACK_RPC_URL || "";
  if (!/^https:\/\//.test(primaryUrl) || !/^https:\/\//.test(fallbackUrl)) {
    throw new Error("both ROBINHOOD_RPC_URL and ROBINHOOD_FALLBACK_RPC_URL must be HTTPS endpoints");
  }
  if (new URL(primaryUrl).hostname === new URL(fallbackUrl).hostname) {
    throw new Error("the two providers must be independent hosts");
  }

  const artifact = await readJson(resolve(projectRoot, "out/DoomLaunchFactory.sol/DoomLaunchFactory.json"));
  const identityFile = await readJson(resolve(projectRoot, "config/review-artifact.json"));
  const deployment = await readJson(resolve(projectRoot, "config/robinhood-mainnet-stage4-deployment.json"));
  const tokens = await readJson(resolve(projectRoot, "config/canary-token-inputs.json"));
  const identity = {
    contractDigest: identityFile.contractDigest,
    sourceCommit: identityFile.frozenAtCommit,
  };

  const selector = name => `0x${artifact.methodIdentifiers[name]}`;
  const selectors = {
    paused: selector("launchesPaused()"),
    launchCount: selector("launchCount()"),
    totalNativeLiquidity: selector("totalNativeLiquidity()"),
  };
  const addresses = Object.fromEntries(
    Object.entries(deployment.verification.contracts).map(([name, item]) => [name, item.address]),
  );

  const [primary, fallback] = await Promise.all([
    readProvider({ url: primaryUrl, selectors, addresses, label: "primary" }),
    readProvider({ url: fallbackUrl, selectors, addresses, label: "fallback" }),
  ]);
  const disagreements = compareProviders(primary, fallback);
  if (disagreements.length) {
    throw new Error(`providers disagree: ${disagreements.join("; ")}`);
  }
  const observed = buildObserved(primary, identity);
  const expiresAt = Math.floor(Date.now() / 1000) + options.ttl;

  let plan;
  if (options.kind === PLAN_KIND.resume) {
    plan = buildResumePlan({
      selector: selector("resumeLaunches()"),
      nonce: primary.pendingNonce,
      expiresAt,
      observedLaunchCount: primary.launchCount,
      observedTotalNativeLiquidity: primary.totalNativeLiquidity,
    });
  } else {
    const token = tokens.launches.find(item => item.order === options.index);
    if (!token) throw new Error(`no recorded token inputs for launch ${options.index}`);
    plan = buildLaunchPlan({
      selector: selector("launch((string,string,uint256,uint256))"),
      nonce: primary.pendingNonce,
      expiresAt,
      name: token.name,
      symbol: token.symbol,
      wholeSupply: BigInt(token.wholeSupply),
      observedLaunchCount: primary.launchCount,
      observedTotalNativeLiquidity: primary.totalNativeLiquidity,
    });
  }

  // Guards run with the plan's own hash standing in for the approval, which proves every other
  // guard passes. The real approval is the owner comparing this hash before they sign.
  const failures = guardSubmission({
    plan,
    approval: { kind: plan.kind, planHash: plan.planHash },
    observed,
    valueWei: plan.valueWei,
    calldata: plan.data,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  const balanceFailures = validateBalance(primary, plan, options.gasHeadroomWei);

  await mkdir(outputRoot, { recursive: true });
  const path = resolve(outputRoot, `${plan.kind}-plan.json`);
  await writeFile(path, `${JSON.stringify({ plan, observed, generatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");

  console.log(`\n=== ${plan.kind.toUpperCase()} PLAN ===`);
  console.log(`  to           ${plan.to}`);
  console.log(`  from         ${plan.sender}`);
  console.log(`  nonce        ${plan.nonce}`);
  console.log(`  value        ${plan.valueWei} wei (max ${plan.maxValueWei})`);
  if (plan.kind === PLAN_KIND.launch) {
    console.log(`  token        ${plan.tokenName} (${plan.tokenSymbol})`);
    console.log(`  supply       ${plan.wholeSupply} whole tokens`);
  }
  console.log(`  calldata     ${plan.data.length - 2} hex chars, hash ${plan.calldataHash}`);
  console.log(`\n  PLAN HASH    ${plan.planHash}`);
  console.log(`\n  chain ${observed.chainId} · paused ${observed.paused} · launches ${observed.launchCount}`);
  console.log(`  both providers agree · plan expires in ${options.ttl}s`);
  console.log(`  saved to ${path}`);

  const problems = [...failures, ...balanceFailures];
  if (problems.length) {
    console.error("\n  NOT READY:");
    for (const problem of problems) console.error(`    - ${problem}`);
    throw new Error(`${problems.length} guard failure(s)`);
  }

  console.log("\n  All guards pass. STOP HERE.");
  console.log("  This tool cannot send. Submit from your own wallet only after comparing");
  console.log("  the plan hash above, and only with a fresh, explicit decision for this");
  console.log("  action alone. A resume approval never authorizes a launch.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
