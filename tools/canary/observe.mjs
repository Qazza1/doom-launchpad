import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readJson, writeJson } from "../lib/json-file.mjs";
import { LAUNCH_FIELDS, decodeLaunchRecord, splitWords } from "../../web/lib/launch-record.mjs";

export const CHAIN_ID = 4663;
export const BPS = 10_000n;

// Re-exported so existing callers and tests keep their import path. The decoder itself lives in
// tools/lib because the public launch page loads it in the browser.
export { LAUNCH_FIELDS, decodeLaunchRecord, splitWords };

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output");

const same = (left, right) => String(left).toLowerCase() === String(right).toLowerCase();

/// Every invariant a canary launch must satisfy on chain. Failing any of these means pausing and
/// investigating before the next launch, not proceeding and hoping.
export function evaluateLaunch({ record, economics, limits, escrow, balances, positionOwner, addresses }) {
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const supply = record.totalSupply;

  // Allocation percentages come from the frozen decisions file, so the observer cannot drift from
  // the contract when the economics change.
  const pct = bps => `${Number(bps) / 100}%`;
  const expectedCreator = (supply * BigInt(economics.creatorLiquidBps)) / BPS;
  const expectedLiquidity = (supply * BigInt(economics.liquidityBps)) / BPS;
  // The factory gives all division dust to escrow so the three allocations always reconcile
  // exactly to total supply.
  const expectedEscrow = supply - expectedCreator - expectedLiquidity;
  check(
    record.creatorLiquidAmount === expectedCreator,
    `creator allocation is not ${pct(economics.creatorLiquidBps)} of supply`,
  );
  check(
    record.liquidityTokenAmountAllocated === expectedLiquidity,
    `liquidity allocation is not ${pct(economics.liquidityBps)} of supply`,
  );
  check(
    record.escrowTokenAmount === expectedEscrow,
    `escrow allocation is not ${pct(economics.gmEscrowBps)} of supply`,
  );
  check(
    record.creatorLiquidAmount + record.liquidityTokenAmountAllocated + record.escrowTokenAmount
      === supply,
    "allocations do not sum to total supply",
  );

  // Liquidity actually used, plus the remainder routed to rewards, must equal what was allocated.
  check(
    record.liquidityTokenAmountUsed + record.liquidityTokenRemainder
      === record.liquidityTokenAmountAllocated,
    "used liquidity plus remainder does not equal the allocation",
  );
  check(record.liquidityPermanent === true, "the launch is not recorded as permanent liquidity");
  check(
    same(positionOwner, addresses.PositionLocker),
    `the LP position is owned by ${positionOwner}, not the permanent locker`,
  );
  check(record.positionId > 0n, "no LP position id was recorded");
  check(!/^0x0{40}$/i.test(record.pool), "no pool address was recorded");

  // Creation fee percentage and recipient split come from the frozen decisions file.
  const expectedFee = (record.nativeLiquidityAmountUsed * BigInt(economics.creationFeeBps)) / BPS;
  check(
    record.creationFee === expectedFee,
    `the creation fee is not ${pct(economics.creationFeeBps)} of the native liquidity used`,
  );
  check(
    record.treasuryFee + record.nftRewardFee === record.creationFee,
    "fee split does not reconcile with the creation fee",
  );
  check(
    record.nftRewardFee === (record.creationFee * BigInt(economics.nftRewardsShareBps)) / BPS,
    "the DoomRewards fee share is not 50%",
  );

  // Canary caps.
  check(
    record.nativeLiquidityAmountRequested === BigInt(limits.maxNativeLiquidityPerLaunchWei),
    "native liquidity is not exactly the canary amount",
  );
  check(
    BigInt(limits.launchCount) <= BigInt(limits.maxLaunches),
    "the launch count exceeds the canary cap",
  );
  check(
    BigInt(limits.totalNativeLiquidity) <= BigInt(limits.maxNativeLiquidityGlobalWei),
    "aggregate native liquidity exceeds the canary cap",
  );

  // GM commitment.
  check(same(escrow.creator, record.creator), "the escrow creator does not match the launch creator");
  check(same(escrow.token, record.token), "the escrow token does not match the launch token");
  check(
    escrow.committedAmount === record.escrowTokenAmount,
    "the escrow committed amount does not match the recorded allocation",
  );
  check(
    Number(escrow.requiredCheckIns) === Number(economics.requiredCheckIns),
    "the required check-in count is not the frozen value",
  );
  check(
    Number(escrow.cadenceSeconds) === Number(economics.cadenceSeconds),
    "the check-in cadence is not the frozen value",
  );
  check(
    Number(escrow.gracePeriodSeconds) === Number(economics.gracePeriodSeconds),
    "the grace period is not the frozen value",
  );
  check(
    BigInt(escrow.nextDeadline) > BigInt(escrow.startTime),
    "the first deadline is not after the start time",
  );
  check(
    same(escrow.doomRewards, addresses.DoomRewards),
    "the escrow does not route defaults to DoomRewards",
  );

  // Token custody. The escrow releases one share per honoured check-in, so what it should still be
  // holding is the allocation minus whatever has already been released — not the whole allocation.
  const released = BigInt(escrow.releasedAmount ?? 0n);
  check(released <= record.escrowTokenAmount, "the escrow released more than it ever held");
  if (Number(escrow.completedCheckIns) < Number(escrow.requiredCheckIns)) {
    check(
      balances.escrow === record.escrowTokenAmount - released,
      "the escrow does not hold the unreleased part of the escrowed allocation",
    );
  }
  check(
    balances.pool >= record.liquidityTokenAmountUsed,
    "the pool holds fewer tokens than the liquidity actually used",
  );
  check(
    balances.tokenTotalSupply === supply,
    "the token's total supply does not match the launch record",
  );

  return failures;
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

async function selectorOf(contract, signature) {
  const artifact = await readJson(resolve(projectRoot, "out", `${contract}.sol`, `${contract}.json`));
  const identifier = artifact.methodIdentifiers?.[signature];
  if (!identifier) throw new Error(`${contract} has no ${signature}`);
  return `0x${identifier}`;
}

const padAddress = address => String(address).replace(/^0x/, "").toLowerCase().padStart(64, "0");
const padUint = value => BigInt(value).toString(16).padStart(64, "0");

export async function loadDecisions() {
  return readJson(resolve(projectRoot, "config/robinhood-mainnet-canary.decisions.json"));
}

/// Reads one launch and evaluates every invariant against it. The endpoint is a parameter so the
/// Stage D fork rehearsal judges a rehearsed launch by exactly the same rules as a mainnet one;
/// a second implementation would be a second set of bugs.
export async function observeLaunch({ url, factory, launchId, addresses, decisions }) {
  const call = (to, data) => rpc(url, "eth_call", [{ to, data }, "latest"]);
  const getLaunch = await selectorOf("DoomLaunchFactory", "getLaunch(uint256)");
  const record = decodeLaunchRecord(await call(factory, `${getLaunch}${padUint(launchId)}`));

  const factoryValue = async signature =>
    BigInt(await call(factory, await selectorOf("DoomLaunchFactory", signature)));
  const escrowValue = async signature =>
    call(record.creatorEscrow, await selectorOf("GmEscrow", signature));
  const escrowUint = async signature => BigInt(await escrowValue(signature));
  const escrowAddress = async signature => `0x${(await escrowValue(signature)).slice(-40)}`;

  const escrow = {
    creator: await escrowAddress("creator()"),
    token: await escrowAddress("token()"),
    doomRewards: await escrowAddress("doomRewards()"),
    committedAmount: await escrowUint("committedAmount()"),
    releasedAmount: await escrowUint("releasedAmount()"),
    requiredCheckIns: await escrowUint("requiredCheckIns()"),
    completedCheckIns: await escrowUint("completedCheckIns()"),
    remainingCheckIns: await escrowUint("remainingCheckIns()"),
    cadenceSeconds: await escrowUint("cadenceSeconds()"),
    gracePeriodSeconds: await escrowUint("gracePeriodSeconds()"),
    startTime: await escrowUint("startTime()"),
    nextCheckInAt: await escrowUint("nextCheckInAt()"),
    nextDeadline: await escrowUint("nextDeadline()"),
    status: await escrowUint("status()"),
  };

  // ERC-20 and ERC-721 reads use the standard selectors, which are fixed by the standards.
  const balanceOf = async (token, holder) =>
    BigInt(await call(token, `0x70a08231${padAddress(holder)}`));
  const balances = {
    tokenTotalSupply: BigInt(await call(record.token, "0x18160ddd")),
    creator: await balanceOf(record.token, record.creator),
    escrow: await balanceOf(record.token, record.creatorEscrow),
    pool: await balanceOf(record.token, record.pool),
  };
  const positionOwner = `0x${(
    await call(
      decisions.liquidity.nonfungiblePositionManager,
      `0x6352211e${padUint(record.positionId)}`,
    )
  ).slice(-40)}`;

  const limits = {
    maxLaunches: await factoryValue("maxLaunches()"),
    launchCount: await factoryValue("launchCount()"),
    totalNativeLiquidity: await factoryValue("totalNativeLiquidity()"),
    maxNativeLiquidityPerLaunchWei: decisions.pilotLimits.maxNativeLiquidityPerLaunchWei,
    maxNativeLiquidityGlobalWei: decisions.pilotLimits.maxNativeLiquidityGlobalWei,
  };

  const failures = evaluateLaunch({
    record,
    economics: {
      creatorLiquidBps: decisions.tokenEconomics.creatorLiquidBps,
      liquidityBps: decisions.tokenEconomics.liquidityBps,
      gmEscrowBps: decisions.tokenEconomics.gmEscrowBps,
      creationFeeBps: decisions.creationFee.feeBps,
      nftRewardsShareBps: decisions.creationFee.nftRewardsShareBps,
      requiredCheckIns: decisions.gmCommitment.requiredCheckIns,
      cadenceSeconds: decisions.gmCommitment.cadenceSeconds,
      gracePeriodSeconds: decisions.gmCommitment.gracePeriodSeconds,
    },
    limits,
    escrow,
    balances,
    positionOwner,
    addresses,
  });

  return { record, escrow, balances, positionOwner, limits, failures };
}

export async function main(argv = process.argv.slice(2)) {
  const read = flag => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : argv[index + 1];
  };
  const factory = read("--factory");
  const launchId = read("--launch");
  const addressesPath = read("--addresses");
  if (!factory || !launchId || !addressesPath) {
    throw new Error("--factory, --launch, and --addresses are required");
  }
  const url = process.env.ROBINHOOD_RPC_URL || "";
  if (!/^https:\/\//.test(url)) throw new Error("ROBINHOOD_RPC_URL must be an HTTPS endpoint");

  const chainId = Number(await rpc(url, "eth_chainId"));
  if (chainId !== CHAIN_ID) throw new Error(`the endpoint returned chain ID ${chainId}`);

  const addresses = await readJson(resolve(process.cwd(), addressesPath));
  const decisions = await loadDecisions();

  const { record, escrow, balances, positionOwner, failures } = await observeLaunch({
    url,
    factory,
    launchId,
    addresses,
    decisions,
  });

  const stringify = value => (typeof value === "bigint" ? value.toString() : value);
  const report = {
    schemaVersion: 1,
    status: failures.length ? "canary_launch_failed" : "canary_launch_passed",
    generatedAt: new Date().toISOString(),
    chainId: CHAIN_ID,
    factory,
    launchId: Number(launchId),
    record: Object.fromEntries(Object.entries(record).map(([k, v]) => [k, stringify(v)])),
    escrow: Object.fromEntries(Object.entries(escrow).map(([k, v]) => [k, stringify(v)])),
    balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, stringify(v)])),
    positionOwner,
    failures,
    warning:
      "Read-only observation. A pass does not authorize the next launch; review each one first.",
  };
  await writeJson(resolve(outputRoot, `launch-${launchId}.json`), report);

  console.log(`Launch ${launchId} token ${record.token}`);
  console.log(`  pool ${record.pool} position ${record.positionId} owned by ${positionOwner}`);
  console.log(`  escrow ${record.creatorEscrow} holds ${balances.escrow}`);
  console.log(`  check-ins ${escrow.completedCheckIns}/${escrow.requiredCheckIns}, next deadline ${escrow.nextDeadline}`);
  if (failures.length) {
    for (const failure of failures) console.error(`  FAIL ${failure}`);
    throw new Error(`${failures.length} launch invariants failed; pause and investigate`);
  }
  console.log("Every launch invariant holds.");
  console.log("Review this launch before permitting the next one.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Canary observation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
