import { decodeLaunchRecord } from "../tools/lib/launch-record.mjs";
import { describeCommitment, describeFreshness } from "./lib/status.mjs";
import { categorizeLaunch, describeCountdown, sortByUrgency } from "./lib/feed.mjs";
import { DISCOVERY_SELECTORS } from "./discovery/selectors.mjs";

/// The homepage. Launching leads, the streaks are the proof it means something, and the NFT game
/// keeps its place in the navigation rather than being pushed aside.
///
/// Every number is read from the chain. Nothing here is a marketing figure: if the factory has done
/// one launch, the page says one, and if it cannot be reached the page says that instead of showing
/// a confident zero.

const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const INDEXER_URL = "https://onchaindiligence-indexer-production.up.railway.app";
const FACTORY = "0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE";

const $ = selector => document.querySelector(selector);
const padUint = value => BigInt(value).toString(16).padStart(64, "0");
const tokens = value => (BigInt(value) / 10n ** 18n).toLocaleString("en-US");
const eth = wei => {
  const whole = BigInt(wei) / 10n ** 18n;
  const fraction = (BigInt(wei) % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
};

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

function decodeString(hex) {
  const body = String(hex ?? "").replace(/^0x/, "");
  if (body.length < 128) return null;
  const length = Number(BigInt(`0x${body.slice(64, 128)}`));
  if (!length || body.length < 128 + length * 2) return null;
  const bytes = body.slice(128, 128 + length * 2).match(/.{2}/g) ?? [];
  const text = new TextDecoder().decode(Uint8Array.from(bytes, byte => parseInt(byte, 16)));
  // Token metadata is written by whoever deployed the token. Strip control characters; everything
  // reaches the DOM through textContent regardless.
  return text.replace(/[\u0000-\u001f\u007f]/g, "").trim() || null;
}

/// The design system's colours carry fixed meanings, so the status names the shared modules use are
/// translated here rather than each page inventing its own.
const TONES = { success: "good", pending: "warn", error: "bad", muted: "", partial: "info" };

function stat(container, value, label, tone = "") {
  const cell = document.createElement("div");
  cell.className = "stat";
  if (tone) cell.dataset.tone = tone;
  const number = document.createElement("b");
  number.textContent = value;
  const caption = document.createElement("span");
  caption.textContent = label;
  cell.append(number, caption);
  container.append(cell);
}

async function readIndexerLag(head) {
  try {
    const response = await fetch(`${INDEXER_URL}/launchpad/health`, { signal: AbortSignal.timeout(8000) });
    const health = await response.json();
    const cursor = Number(health.cursor);
    return Number.isFinite(cursor) ? Math.max(0, Number(head) - cursor) : null;
  } catch {
    return null;
  }
}

async function load() {
  const head = await rpc("eth_getBlockByNumber", ["latest", false]);
  const at = head.number;
  const call = (to, data) => rpc("eth_call", [{ to, data }, at]);
  const chainTime = Number(BigInt(head.timestamp));

  const [countWord, pausedWord, liquidityWord, maxWord] = await Promise.all([
    call(FACTORY, DISCOVERY_SELECTORS["launchCount()"]),
    call(FACTORY, DISCOVERY_SELECTORS["launchesPaused()"]),
    call(FACTORY, DISCOVERY_SELECTORS["totalNativeLiquidity()"]),
    call(FACTORY, DISCOVERY_SELECTORS["maxLaunches()"]),
  ]);
  const count = Number(BigInt(countWord));
  const paused = BigInt(pausedWord) === 1n;
  const maxLaunches = Number(BigInt(maxWord));

  const items = [];
  for (let id = 1; id <= count; id += 1) {
    const record = decodeLaunchRecord(
      await call(FACTORY, `${DISCOVERY_SELECTORS["getLaunch(uint256)"]}${padUint(id)}`),
    );
    const escrowValue = async name => BigInt(await call(record.creatorEscrow, DISCOVERY_SELECTORS[name]));
    const [status, done, required, opens, closes, name, symbol] = await Promise.all([
      escrowValue("status()"),
      escrowValue("completedCheckIns()"),
      escrowValue("requiredCheckIns()"),
      escrowValue("nextCheckInAt()"),
      escrowValue("nextDeadline()"),
      call(record.token, DISCOVERY_SELECTORS["name()"]),
      call(record.token, DISCOVERY_SELECTORS["symbol()"]),
    ]);
    const commitment = describeCommitment({
      status,
      completedCheckIns: done,
      requiredCheckIns: required,
      nextCheckInAt: opens,
      nextDeadline: closes,
      chainTime,
    });
    items.push({
      id,
      record,
      commitment,
      name: decodeString(name) ?? "Unnamed token",
      symbol: decodeString(symbol) ?? "???",
      category: categorizeLaunch({ commitment, createdAt: record.createdAt, chainTime }),
    });
  }

  const sorted = sortByUrgency(items);
  const alive = sorted.filter(item => item.category.urgency <= 2);
  const atStake = alive.reduce((sum, item) => sum + item.record.escrowTokenAmount, 0n);

  const stats = $("#stats");
  stats.replaceChildren();
  stat(stats, String(count), "LAUNCHES");
  stat(stats, String(alive.length), "STREAKS ALIVE", alive.length ? "good" : "");
  stat(stats, tokens(atStake), "TOKENS AT STAKE", "calm");
  stat(stats, `${eth(BigInt(liquidityWord))} ETH`, "LOCKED FOREVER");

  const feed = $("#feed");
  feed.replaceChildren();
  for (const item of sorted.slice(0, 3)) {
    const row = document.createElement("li");
    const tone = TONES[item.category.tone] ?? "";
    if (tone) row.dataset.tone = tone;

    const left = document.createElement("div");
    const link = document.createElement("a");
    link.href = `./launch-detail/?launch=${item.id}`;
    link.textContent = `${item.name} (${item.symbol})`;
    const sub = document.createElement("span");
    sub.className = "muted num";
    sub.style.display = "block";
    sub.style.fontSize = "12px";
    sub.textContent = `${item.commitment.progress.label} check-ins · ${tokens(item.record.escrowTokenAmount)} at stake`;
    left.append(link, sub);

    const right = document.createElement("div");
    right.className = "num";
    right.textContent = describeCountdown({ commitment: item.commitment, chainTime });
    row.append(left, right);
    feed.append(row);
  }
  if (!sorted.length) {
    const empty = document.createElement("li");
    empty.textContent = "No launches yet. The factory reports a launch count of zero.";
    feed.append(empty);
  }

  // The honest headline: this factory is a capped test, and the public one does not exist.
  $("#banner").textContent = paused
    ? "Launching is paused. The factory is closed until the operator resumes it."
    : `Canary in progress: ${count} of ${maxLaunches} test launches used, and only the approved test `
      + "account may launch. The public factory is not built yet, so the launch flow is a preview.";

  const freshness = describeFreshness({
    blockNumber: Number(BigInt(head.number)),
    blockTime: chainTime,
    wallClock: Math.floor(Date.now() / 1000),
    indexerBehind: await readIndexerLag(Number(BigInt(head.number))),
  });
  const meta = $("#meta");
  meta.replaceChildren();
  const line = document.createElement("span");
  line.textContent = `Live from the chain · block ${Number(BigInt(head.number)).toLocaleString("en-US")} · ${freshness.ageSeconds}s old`;
  meta.append(line);
  if (freshness.detail.includes("blocks behind")) {
    const warning = document.createElement("span");
    warning.className = "warn";
    warning.textContent = "Indexer behind";
    warning.title = "Everything on this page is read from the chain and does not depend on the indexer.";
    meta.append(warning);
  }
}

load().catch(error => {
  // A page that cannot read the chain says so, rather than showing a confident zero.
  $("#banner").textContent =
    `The chain could not be read, so the numbers below are unknown rather than zero. (${error.message})`;
  $("#stats").replaceChildren();
  $("#feed").replaceChildren();
});
