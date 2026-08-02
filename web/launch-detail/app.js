import { decodeLaunchRecord } from "../../tools/lib/launch-record.mjs";
import {
  describeCommitment,
  describeFreshness,
  describePermanence,
  reconcileAllocation,
} from "./status.mjs";
import { DETAIL_SELECTORS } from "./selectors.mjs";

/// The public page for one launch.
///
/// Everything here is read directly from the chain, pinned to a single block, and every read is a
/// call. There is no send path and the indexer is not required: on 2026-08-02 the indexer had never
/// seen launch 1, and a page that depended on it would have shown nothing about a token that was
/// real, correct, and holding 600 million tokens in escrow.

const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const INDEXER_URL = "https://onchaindiligence-indexer-production.up.railway.app";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const FACTORY = "0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE";
const POSITION_MANAGER = "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3";
const POSITION_LOCKER = "0xdaE01c32131fF283f403b4C1fD71018Fa31cfAC0";

const $ = selector => document.querySelector(selector);
const padUint = value => BigInt(value).toString(16).padStart(64, "0");
const padAddress = value => String(value).replace(/^0x/, "").toLowerCase().padStart(64, "0");
const asAddress = word => `0x${String(word).slice(-40)}`;
const tokens = value => (BigInt(value) / 10n ** 18n).toLocaleString("en-US");
const eth = wei => {
  const whole = BigInt(wei) / 10n ** 18n;
  const fraction = (BigInt(wei) % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${fraction ? `${whole}.${fraction}` : whole} ETH`;
};
const when = seconds => (Number(seconds) ? new Date(Number(seconds) * 1000).toUTCString().replace("GMT", "UTC") : "—");

async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || `${method} failed`);
  return body.result;
}

function rows(table, entries) {
  table.replaceChildren();
  for (const [label, value, className] of entries) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = label;
    const td = document.createElement("td");
    if (className) td.className = className;
    if (value instanceof Node) td.append(value);
    else td.textContent = value;
    tr.append(th, td);
    table.append(tr);
  }
}

function explorerLink(address) {
  const link = document.createElement("a");
  link.href = `${EXPLORER}/address/${address}`;
  link.textContent = address;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  return link;
}

/// Asked separately and allowed to fail. The page is complete without it; it only adds "and the
/// listing you see elsewhere on the site is behind".
async function readIndexerLag(confirmedHead) {
  try {
    const response = await fetch(`${INDEXER_URL}/launchpad/health`, { signal: AbortSignal.timeout(8000) });
    const health = await response.json();
    const cursor = Number(health.cursor);
    if (!Number.isFinite(cursor)) return null;
    return Math.max(0, Number(confirmedHead) - cursor);
  } catch {
    return null;
  }
}

async function load() {
  const launchId = new URLSearchParams(location.search).get("launch") ?? "1";

  // One block for every read, so nothing on the page is a mix of two moments.
  const head = await rpc("eth_getBlockByNumber", ["latest", false]);
  const at = head.number;
  const call = (to, data) => rpc("eth_call", [{ to, data }, at]);

  const record = decodeLaunchRecord(
    await call(FACTORY, `${DETAIL_SELECTORS["getLaunch(uint256)"]}${padUint(launchId)}`),
  );
  if (/^0x0{40}$/i.test(record.token)) throw new Error(`Launch ${launchId} does not exist.`);

  const escrowUint = async signature => BigInt(await call(record.creatorEscrow, DETAIL_SELECTORS[signature]));
  const [status, completed, required, released, nextCheckInAt, nextDeadline] = await Promise.all([
    escrowUint("status()"),
    escrowUint("completedCheckIns()"),
    escrowUint("requiredCheckIns()"),
    escrowUint("releasedAmount()"),
    escrowUint("nextCheckInAt()"),
    escrowUint("nextDeadline()"),
  ]);

  const [ownerWord, poolBalance, escrowBalance, supplyWord] = await Promise.all([
    call(POSITION_MANAGER, `${DETAIL_SELECTORS["ownerOf(uint256)"]}${padUint(record.positionId)}`),
    call(record.token, `${DETAIL_SELECTORS["balanceOf(address)"]}${padAddress(record.pool)}`),
    call(record.token, `${DETAIL_SELECTORS["balanceOf(address)"]}${padAddress(record.creatorEscrow)}`),
    call(record.token, DETAIL_SELECTORS["totalSupply()"]),
  ]);

  const chainTime = Number(BigInt(head.timestamp));
  const blockNumber = Number(BigInt(head.number));
  const indexerBehind = await readIndexerLag(blockNumber);

  render({
    launchId,
    record,
    escrow: { status, completed, required, released, nextCheckInAt, nextDeadline },
    positionOwner: asAddress(ownerWord),
    balances: { pool: BigInt(poolBalance), escrow: BigInt(escrowBalance), supply: BigInt(supplyWord) },
    blockNumber,
    chainTime,
    indexerBehind,
  });
}

function render(data) {
  const { record, escrow } = data;
  $("#title").innerHTML = `LAUNCH #${data.launchId} <span>·</span> ${record.token.slice(0, 10)}…`;
  $("#subtitle").textContent = `${record.token} — created ${when(record.createdAt)}`;

  const commitment = describeCommitment({
    status: escrow.status,
    completedCheckIns: escrow.completed,
    requiredCheckIns: escrow.required,
    nextCheckInAt: escrow.nextCheckInAt,
    nextDeadline: escrow.nextDeadline,
    chainTime: data.chainTime,
  });
  const badge = $("#gmBadge");
  badge.textContent = `${commitment.label} · ${commitment.progress.label}`;
  badge.dataset.tone = commitment.tone;
  $("#gmBar").style.width = `${(commitment.progress.done / commitment.progress.required) * 100}%`;
  $("#gmDetail").textContent = commitment.deadline
    ? `${commitment.detail} Deadline: ${when(commitment.deadline)}.`
    : commitment.detail;

  const steps = $("#gmSteps");
  steps.replaceChildren();
  const perCheckIn = record.escrowTokenAmount / BigInt(escrow.required || 1n);
  for (let index = 0; index < Number(escrow.required); index += 1) {
    const cell = document.createElement("div");
    const done = index < Number(escrow.completed);
    cell.dataset.done = done ? "yes" : "no";
    cell.dataset.now = !done && index === Number(escrow.completed) && commitment.state === "window_open" ? "yes" : "no";
    cell.textContent = `${done ? "✓" : index + 1} · ${tokens(perCheckIn)}`;
    steps.append(cell);
  }

  const permanence = describePermanence({
    recordSaysPermanent: record.liquidityPermanent,
    positionId: record.positionId,
    positionOwner: data.positionOwner,
    expectedLocker: POSITION_LOCKER,
    verifiedAtBlock: data.blockNumber,
  });
  $("#lockBadge").textContent = permanence.label;
  $("#lockBadge").dataset.tone = permanence.tone;
  $("#lockDetail").textContent = permanence.detail;
  rows($("#lockTable"), [
    ["Position ID", String(record.positionId)],
    ["Owner right now", explorerLink(data.positionOwner)],
    ["Pool", explorerLink(record.pool)],
    ["Tokens in the pool", tokens(data.balances.pool)],
  ]);

  const checks = reconcileAllocation(record);
  rows($("#allocTable"), [
    ["Total supply", tokens(record.totalSupply)],
    ["Creator at launch", tokens(record.creatorLiquidAmount)],
    ["Permanent liquidity", tokens(record.liquidityTokenAmountAllocated)],
    ["Escrowed", tokens(record.escrowTokenAmount)],
    ["Released so far", tokens(escrow.released)],
    ["Still held in escrow", tokens(data.balances.escrow)],
  ]);
  const allOk = checks.supplyReconciles && checks.liquidityReconciles && checks.feeReconciles;
  $("#allocCheck").innerHTML = allOk
    ? "<span class=\"ok\">Allocation, liquidity, and fees all reconcile exactly.</span>"
    : "<span class=\"bad\">These figures do not reconcile. Treat this launch as suspect.</span>";

  rows($("#feeTable"), [
    ["Liquidity requested", eth(record.nativeLiquidityAmountRequested)],
    ["Liquidity actually used", eth(record.nativeLiquidityAmountUsed)],
    ["Creation fee", eth(record.creationFee)],
    ["→ treasury", eth(record.treasuryFee)],
    ["→ rewards vault", eth(record.nftRewardFee)],
    ["Token dust to rewards", `${record.liquidityTokenRemainder} wei`],
  ]);

  rows($("#addressTable"), [
    ["Token", explorerLink(record.token)],
    ["Creator", explorerLink(record.creator)],
    ["GM escrow", explorerLink(record.creatorEscrow)],
    ["Locker", explorerLink(POSITION_LOCKER)],
  ]);

  const freshness = describeFreshness({
    blockNumber: data.blockNumber,
    blockTime: data.chainTime,
    wallClock: Math.floor(Date.now() / 1000),
    indexerBehind: data.indexerBehind,
  });
  $("#freshBadge").textContent = `Confidence: ${freshness.confidence}`;
  $("#freshBadge").dataset.tone = freshness.tone;
  $("#freshDetail").textContent = freshness.detail;

  $("#content").hidden = false;
}

load().catch(error => {
  $("#title").innerHTML = "COULD NOT <span>LOAD</span>";
  $("#subtitle").textContent = "";
  const box = $("#error");
  box.style.display = "block";
  box.textContent =
    `${error.message} Nothing on this page is guesswork, so when a read fails the page says so `
    + "rather than showing partial figures.";
});
