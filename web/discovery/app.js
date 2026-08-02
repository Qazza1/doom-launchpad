import { decodeLaunchRecord } from "../../tools/lib/launch-record.mjs";
import { describeCommitment, describeFreshness } from "../lib/status.mjs";
import {
  TABS,
  categorizeLaunch,
  defaultTab,
  describeCountdown,
  describeEmpty,
  filterByTab,
  sortByUrgency,
  summarizeFeed,
} from "../lib/feed.mjs";
import { DISCOVERY_SELECTORS } from "./selectors.mjs";

/// The discovery list.
///
/// Launches are enumerated from the factory's own `launchCount`, then read one by one, all pinned to
/// a single block. That is O(n) calls and fine for a three-launch cap; a public factory would read
/// this from the indexer and keep this path as the fallback for when the indexer is down. It was
/// down for the whole of 2026-08-02, which is why the fallback is the thing built first.

const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const INDEXER_URL = "https://onchaindiligence-indexer-production.up.railway.app";
const FACTORY = "0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE";

const $ = selector => document.querySelector(selector);
const padUint = value => BigInt(value).toString(16).padStart(64, "0");
const tokens = value => (BigInt(value) / 10n ** 18n).toLocaleString("en-US");

// The tab is chosen once the launches are known: urgent if anything is urgent, otherwise all.
const state = { items: [], tab: "all", chainTime: 0, totalLaunches: 0, loadFailed: false };

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

/// The token's own name and symbol, read from the token contract. Both are dynamic strings, so the
/// return data is an offset, a length, and the bytes.
function decodeString(hex) {
  const body = String(hex ?? "").replace(/^0x/, "");
  if (body.length < 128) return null;
  const length = Number(BigInt(`0x${body.slice(64, 128)}`));
  if (!length || body.length < 128 + length * 2) return null;
  const bytes = body.slice(128, 128 + length * 2).match(/.{2}/g) ?? [];
  const text = new TextDecoder().decode(Uint8Array.from(bytes, byte => parseInt(byte, 16)));
  // Token metadata is attacker-controlled text. Strip control characters before it reaches the DOM;
  // everything is inserted with textContent, so this is the second layer rather than the only one.
  return text.replace(/[\u0000-\u001f\u007f]/g, "").trim() || null;
}

async function load() {
  const head = await rpc("eth_getBlockByNumber", ["latest", false]);
  const at = head.number;
  const call = (to, data) => rpc("eth_call", [{ to, data }, at]);
  state.chainTime = Number(BigInt(head.timestamp));

  const count = Number(BigInt(await call(FACTORY, DISCOVERY_SELECTORS["launchCount()"])));
  state.totalLaunches = count;

  const items = [];
  for (let id = 1; id <= count; id += 1) {
    const record = decodeLaunchRecord(
      await call(FACTORY, `${DISCOVERY_SELECTORS["getLaunch(uint256)"]}${padUint(id)}`),
    );
    const escrowUint = async signature =>
      BigInt(await call(record.creatorEscrow, DISCOVERY_SELECTORS[signature]));
    const [status, completed, required, nextCheckInAt, nextDeadline, name, symbol] = await Promise.all([
      escrowUint("status()"),
      escrowUint("completedCheckIns()"),
      escrowUint("requiredCheckIns()"),
      escrowUint("nextCheckInAt()"),
      escrowUint("nextDeadline()"),
      call(record.token, DISCOVERY_SELECTORS["name()"]),
      call(record.token, DISCOVERY_SELECTORS["symbol()"]),
    ]);

    const commitment = describeCommitment({
      status,
      completedCheckIns: completed,
      requiredCheckIns: required,
      nextCheckInAt,
      nextDeadline,
      chainTime: state.chainTime,
    });
    items.push({
      id,
      record,
      commitment,
      name: decodeString(name) ?? "Unnamed token",
      symbol: decodeString(symbol) ?? "???",
      category: categorizeLaunch({ commitment, createdAt: record.createdAt, chainTime: state.chainTime }),
    });
  }

  state.items = sortByUrgency(items);
  state.tab = defaultTab(state.items);
  const indexerBehind = await readIndexerLag(Number(BigInt(head.number)));
  const freshness = describeFreshness({
    blockNumber: Number(BigInt(head.number)),
    blockTime: state.chainTime,
    wallClock: Math.floor(Date.now() / 1000),
    indexerBehind,
  });
  $("#fresh").innerHTML = `<b>Confidence: ${freshness.confidence}.</b> `;
  $("#fresh").append(document.createTextNode(freshness.detail));
  state.indexerBehind = indexerBehind;
  render();
}

function renderTabs() {
  const counts = summarizeFeed(state.items);
  const container = $("#tabs");
  container.replaceChildren();
  for (const tab of Object.values(TABS)) {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.ariaSelected = String(tab.key === state.tab);
    button.textContent = `${tab.label} `;
    const count = document.createElement("span");
    count.className = "n";
    count.textContent = counts[tab.key];
    button.append(count);
    button.addEventListener("click", () => {
      state.tab = tab.key;
      render();
    });
    container.append(button);
  }
}

function render() {
  renderTabs();
  const visible = filterByTab(state.items, state.tab);
  const feed = $("#feed");
  feed.replaceChildren();

  $("#empty").hidden = visible.length > 0;
  if (!visible.length) {
    $("#empty").textContent = describeEmpty({
      tab: state.tab,
      totalLaunches: state.totalLaunches,
      loadFailed: state.loadFailed,
      indexerBehind: state.indexerBehind,
    });
    return;
  }

  for (const item of visible) {
    const row = document.createElement("li");
    row.className = "row";
    row.dataset.tone = item.category.tone;

    const left = document.createElement("div");
    const name = document.createElement("p");
    name.className = "name";
    const link = document.createElement("a");
    link.href = `../launch-detail/?launch=${item.id}`;
    // textContent, never innerHTML: the name comes from a token contract anyone can deploy.
    link.textContent = `${item.name} (${item.symbol})`;
    name.append(link);
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = `#${item.id} · ${item.record.token}`;
    const progress = document.createElement("p");
    progress.className = "progress";
    progress.textContent = `${item.commitment.progress.label} check-ins · `
      + `${tokens(item.record.escrowTokenAmount)} at stake`;
    left.append(name, meta, progress);

    const right = document.createElement("div");
    right.className = "right";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.dataset.tone = item.category.tone;
    badge.textContent = item.category.label;
    right.append(badge);
    if (item.category.fresh) {
      const isNew = document.createElement("span");
      isNew.className = "badge new";
      isNew.textContent = "NEW";
      right.append(isNew);
    }
    const countdown = document.createElement("p");
    countdown.className = "count";
    countdown.textContent = describeCountdown({ commitment: item.commitment, chainTime: state.chainTime });
    right.append(countdown);

    row.append(left, right);
    feed.append(row);
  }
}

load().catch(error => {
  state.loadFailed = true;
  render();
  $("#empty").hidden = false;
  $("#empty").textContent = `${describeEmpty({ tab: state.tab, totalLaunches: 0, loadFailed: true })} (${error.message})`;
});
