import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FUNDING_BUFFER_BPS, calculateFunding, runCommand } from "./localhost-preview.mjs";
import { compareReports, inspectProvider, validateEndpointPair } from "./network-preflight.mjs";
import { buildPlan } from "./transaction-plan.mjs";

export const CHAIN_ID = 4663;
export const DEPLOYER = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F";
/// Fees, nonce, and balance all move. A worksheet older than this must be regenerated rather than
/// approved, because funding from stale numbers either strands the deployment mid-sequence or
/// overfunds a hot wallet.
export const WORKSHEET_VALID_SECONDS = 900;

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output/funding");

const NONCE_KEYS = [
  "doomRewards",
  "positionLocker",
  "v3LiquidityManager",
  "bindRegistrar",
  "doomLaunchFactory",
  "bindFactory",
];

/// EIP-1559 ceiling: enough headroom for the base fee to double before the sequence finishes.
export function chooseFeeCeiling({ gasPriceWei, baseFeeWei, maxPriorityFeeWei }) {
  const gasPrice = BigInt(gasPriceWei || 0);
  const eip1559 = BigInt(baseFeeWei || 0) * 2n + BigInt(maxPriorityFeeWei || 0);
  return (eip1559 > gasPrice ? eip1559 : gasPrice).toString();
}

/// Providers see slightly different fee markets. Funding from the cheaper one is the failure that
/// strands a half-deployed system, so the higher ceiling wins.
export function combineFeeCeilings(primaryCeilingWei, fallbackCeilingWei) {
  const primary = BigInt(primaryCeilingWei);
  const fallback = BigInt(fallbackCeilingWei);
  return (primary > fallback ? primary : fallback).toString();
}

export function buildNoncePlan(startingNonce, observedAtBlock) {
  if (!Number.isInteger(startingNonce) || startingNonce < 0) {
    throw new Error("the starting nonce must be a non-negative integer");
  }
  const plan = { observedAtBlock, startingNonce };
  for (const [index, key] of NONCE_KEYS.entries()) plan[key] = startingNonce + index;
  return plan;
}

export function buildGasPlan({ simulatedAtBlock, totalPlannedGas, feeCeilingWei }) {
  const { baseCostWei, requiredBalanceWei } = calculateFunding(totalPlannedGas, feeCeilingWei);
  return {
    simulatedAtBlock,
    simulatedGasPriceWei: String(feeCeilingWei),
    totalEstimatedGas: String(totalPlannedGas),
    fundingBufferBps: Number(FUNDING_BUFFER_BPS),
    maxCostBeforeBufferWei: baseCostWei.toString(),
    requiredDeployerBalanceWei: requiredBalanceWei.toString(),
  };
}

/// The funding numbers are only meaningful for the exact code that produced the gas figures, at the
/// exact nonce that produced the addresses. Either drifting invalidates the worksheet.
export function assertPreviewIsCurrent(report, headCommit, observedPendingNonce) {
  const errors = [];
  if (!report) return ["no localhost preview report was found; run the preview first"];
  if (report.status !== "localhost_preview_passed") {
    errors.push("the localhost preview report does not record a passing run");
  }
  if (report.sourceCommit !== headCommit) {
    errors.push(
      `the localhost preview was produced from ${String(report.sourceCommit).slice(0, 12)} but HEAD ` +
        `is ${headCommit.slice(0, 12)}; re-run the preview from the commit being deployed`,
    );
  }
  if (Number(report.deployer?.observedPendingNonce) !== observedPendingNonce) {
    errors.push(
      `the localhost preview ran at nonce ${report.deployer?.observedPendingNonce} but the deployer ` +
        `is now at ${observedPendingNonce}; every predicted address changed`,
    );
  }
  return errors;
}

/// A funding worksheet is a proposal. It may carry fresh nonce and gas values, and nothing else.
export function validateFundingProposal(manifest, { predictedAddresses } = {}) {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };

  require(manifest?.status === "draft_fail_closed", "status must stay draft_fail_closed");
  require(manifest?.safety?.enabled === false, "deployment must remain disabled");
  require(manifest?.safety?.broadcast === false, "broadcast must remain false");
  require(
    manifest?.safety?.mainnetDeploymentApproved === false,
    "a funding worksheet must not record deployment approval",
  );
  require(
    manifest?.safety?.finalOwnerApprovalRecorded === false,
    "a funding worksheet must not record owner approval",
  );
  require(
    manifest?.safety?.factoryMustRemainPaused === true,
    "factoryMustRemainPaused must stay true",
  );
  require(
    Object.values(manifest?.verification || {}).every(value => value === false),
    "a funding worksheet must not record any verification",
  );
  require(
    Object.values(manifest?.transactions || {}).every(
      value => value && Object.values(value).every(item => item === null),
    ),
    "a funding worksheet must not record deployed transactions",
  );
  require(
    Object.entries(manifest?.independentReview || {}).every(([key, value]) =>
      key === "allFindingsRemediated" || key === "focusedReReviewComplete"
        ? value === false
        : value === null
    ),
    "a funding worksheet cannot record an independent review",
  );

  const noncePlan = manifest?.noncePlan || {};
  const startingNonce = noncePlan.startingNonce;
  require(Number.isInteger(startingNonce) && startingNonce >= 0, "the nonce plan needs a starting nonce");
  require(Number.isInteger(noncePlan.observedAtBlock), "the nonce plan needs the block it was read at");
  for (const [index, key] of NONCE_KEYS.entries()) {
    require(noncePlan[key] === startingNonce + index, `noncePlan.${key} is not sequential`);
  }

  const gasPlan = manifest?.gasPlan || {};
  require(Number.isInteger(gasPlan.simulatedAtBlock), "the gas plan needs the block it was simulated at");
  require(gasPlan.fundingBufferBps === Number(FUNDING_BUFFER_BPS), "the funding buffer must stay 25%");
  const total = BigInt(gasPlan.totalEstimatedGas || 0);
  const ceiling = BigInt(gasPlan.simulatedGasPriceWei || 0);
  require(total > 0n, "the gas plan needs a positive gas total");
  require(ceiling > 0n, "the gas plan needs a positive fee ceiling");
  if (total > 0n && ceiling > 0n) {
    const expected = calculateFunding(total, ceiling);
    require(
      gasPlan.maxCostBeforeBufferWei === expected.baseCostWei.toString(),
      "the pre-buffer cost does not equal gas multiplied by the fee ceiling",
    );
    require(
      gasPlan.requiredDeployerBalanceWei === expected.requiredBalanceWei.toString(),
      "the required balance does not match the buffered arithmetic",
    );
  }

  if (predictedAddresses) {
    for (const [name, address] of Object.entries(predictedAddresses)) {
      require(
        /^0x[0-9a-fA-F]{40}$/.test(address || ""),
        `the predicted address for ${name} is malformed`,
      );
    }
  }
  return errors;
}

async function readFeeState(label, url) {
  const call = async (method, params = []) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`${label} ${method} returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`${label} ${method}: ${body.error.message || "RPC error"}`);
    return body.result;
  };

  const [gasPriceHex, priorityHex, block] = await Promise.all([
    call("eth_gasPrice"),
    call("eth_maxPriorityFeePerGas").catch(() => "0x0"),
    call("eth_getBlockByNumber", ["latest", false]),
  ]);
  const state = {
    label,
    gasPriceWei: BigInt(gasPriceHex).toString(),
    baseFeeWei: BigInt(block?.baseFeePerGas || gasPriceHex).toString(),
    maxPriorityFeeWei: BigInt(priorityHex || "0x0").toString(),
  };
  return { ...state, feeCeilingWei: chooseFeeCeiling(state) };
}

const weiToEth = value => {
  const wei = BigInt(value);
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
};

export async function main() {
  const primary = process.env.ROBINHOOD_RPC_URL || "";
  const fallback = process.env.ROBINHOOD_FALLBACK_RPC_URL || "";
  const endpointErrors = validateEndpointPair(primary, fallback);
  if (endpointErrors.length) throw new Error(endpointErrors.join("; "));

  const [primaryReport, fallbackReport] = await Promise.all([
    inspectProvider("primary", primary),
    inspectProvider("fallback", fallback),
  ]);
  const comparisonErrors = compareReports(primaryReport, fallbackReport);
  if (comparisonErrors.length) throw new Error(comparisonErrors.join("; "));
  if (primaryReport.deployerBalanceWei !== fallbackReport.deployerBalanceWei) {
    throw new Error("providers disagree on the deployer balance");
  }

  const [primaryFees, fallbackFees] = await Promise.all([
    readFeeState("primary", primary),
    readFeeState("fallback", fallback),
  ]);
  const feeCeilingWei = combineFeeCeilings(primaryFees.feeCeilingWei, fallbackFees.feeCeilingWei);

  const { stdout: headOut } = await runCommand("git", [
    "-c", `safe.directory=${projectRoot.replaceAll("\\", "/")}`,
    "rev-parse", "HEAD",
  ]);
  const headCommit = headOut.trim();
  const { stdout: statusOut } = await runCommand("git", [
    "-c", `safe.directory=${projectRoot.replaceAll("\\", "/")}`,
    "status", "--porcelain",
  ]);
  if (statusOut.trim()) {
    throw new Error("the working tree is dirty; funding must be planned from a committed tree");
  }

  const observedPendingNonce = primaryReport.pendingNonce;
  let preview = null;
  try {
    preview = JSON.parse(await readFile(resolve(directory, "output/latest-report.json"), "utf8"));
  } catch {
    preview = null;
  }
  const previewErrors = assertPreviewIsCurrent(preview, headCommit, observedPendingNonce);
  if (previewErrors.length) throw new Error(previewErrors.join("; "));

  const totalPlannedGas = preview.transactions.reduce(
    (sum, transaction) => sum + BigInt(transaction.localGasLimit),
    0n,
  );
  const plan = await buildPlan(observedPendingNonce);
  const predictedAddresses = Object.fromEntries(
    plan.transactions
      .filter(transaction => transaction.kind === "CREATE")
      .map(transaction => [transaction.contract, transaction.predictedAddress]),
  );
  for (const transaction of preview.transactions) {
    if (!transaction.predictedAddress) continue;
    if (
      predictedAddresses[transaction.contract]?.toLowerCase() !==
      transaction.predictedAddress.toLowerCase()
    ) {
      throw new Error(
        `the planner and the localhost preview disagree on the ${transaction.contract} address`,
      );
    }
  }

  const canonical = JSON.parse(
    await readFile(resolve(projectRoot, "config/stage4-deployment-manifest.json"), "utf8"),
  );
  const proposal = {
    ...canonical,
    noncePlan: buildNoncePlan(observedPendingNonce, primaryReport.blockNumber),
    gasPlan: buildGasPlan({
      simulatedAtBlock: primaryReport.blockNumber,
      totalPlannedGas,
      feeCeilingWei,
    }),
  };
  const proposalErrors = validateFundingProposal(proposal, { predictedAddresses });
  if (proposalErrors.length) throw new Error(proposalErrors.join("; "));

  const required = BigInt(proposal.gasPlan.requiredDeployerBalanceWei);
  const balance = BigInt(primaryReport.deployerBalanceWei);
  const shortfall = required > balance ? required - balance : 0n;
  const observedAt = new Date().toISOString();

  const worksheet = {
    schemaVersion: 1,
    status: "funding_proposal_pending_owner_approval",
    observedAt,
    validForSeconds: WORKSHEET_VALID_SECONDS,
    sourceCommit: headCommit,
    chainId: CHAIN_ID,
    deployer: DEPLOYER,
    providers: {
      agreed: true,
      primaryBlock: primaryReport.blockNumber,
      fallbackBlock: fallbackReport.blockNumber,
      pendingNonce: observedPendingNonce,
      deployerBalanceWei: primaryReport.deployerBalanceWei,
      deployerBalanceEth: weiToEth(balance),
    },
    fees: {
      primary: primaryFees,
      fallback: fallbackFees,
      chosenCeilingWei: feeCeilingWei,
      rule: "max(gasPrice, 2 x baseFee + maxPriorityFee), taken from whichever provider is higher",
    },
    predictedAddresses,
    funding: {
      totalPlannedGas: totalPlannedGas.toString(),
      maxCostBeforeBufferWei: proposal.gasPlan.maxCostBeforeBufferWei,
      maxCostBeforeBufferEth: weiToEth(proposal.gasPlan.maxCostBeforeBufferWei),
      fundingBufferBps: Number(FUNDING_BUFFER_BPS),
      requiredDeployerBalanceWei: proposal.gasPlan.requiredDeployerBalanceWei,
      requiredDeployerBalanceEth: weiToEth(required),
      shortfallWei: shortfall.toString(),
      shortfallEth: weiToEth(shortfall),
    },
    safety: {
      secretsPrinted: false,
      walletFunded: false,
      ownerApprovalRecorded: false,
      broadcastAuthorized: false,
    },
    warning:
      "Proposal only. Funding the deployer is an owner decision taken after independent review, and "
      + "the worksheet must be regenerated if the nonce, block, fees, balance, or commit move.",
  };

  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    resolve(outputRoot, "funding-worksheet.json"),
    `${JSON.stringify(worksheet, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    resolve(outputRoot, "stage4-deployment-manifest.proposal.json"),
    `${JSON.stringify(proposal, null, 2)}\n`,
    "utf8",
  );

  console.log(`Funding worksheet for commit ${headCommit.slice(0, 12)} at block ${primaryReport.blockNumber}.`);
  console.log(`Both providers agree: chain ${CHAIN_ID}, pending nonce ${observedPendingNonce}.`);
  console.log(`Fee ceiling: ${feeCeilingWei} wei`);
  console.log(`Planned gas: ${totalPlannedGas}`);
  console.log(`Required balance with 25% buffer: ${weiToEth(required)} ETH`);
  console.log(`Current balance: ${weiToEth(balance)} ETH`);
  console.log(`Shortfall: ${weiToEth(shortfall)} ETH`);
  for (const [name, address] of Object.entries(predictedAddresses)) {
    console.log(`  ${name}: ${address}`);
  }
  console.log(`Worksheet: ${resolve(outputRoot, "funding-worksheet.json")}`);
  console.log("The canonical manifest was not modified. The proposal is a separate copy.");
  console.log(`Valid for ${WORKSHEET_VALID_SECONDS} seconds; regenerate if anything moves.`);
  console.log("No wallet was funded. Funding and deployment remain owner decisions.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Funding refresh failed: ${error.message}`);
    process.exitCode = 1;
  });
}
