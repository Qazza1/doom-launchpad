import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFeed, feedEvents, toAlert } from "./feed.mjs";
import { sendTelegramAlert } from "../keeper/lib/telegram.mjs";

export const CHAIN_ID = 4663;

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const stateRoot = resolve(directory, "state");
const outputRoot = resolve(directory, "output");
const observedStatePath = resolve(stateRoot, "observed.json");
const broadcastStatePath = resolve(stateRoot, "broadcast.json");

const decodeUint = word => BigInt(word);
const padUint = value => BigInt(value).toString(16).padStart(64, "0");
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function rpc(url, method, params = []) {
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

export async function readChainHead(url) {
  const block = await rpc(url, "eth_getBlockByNumber", ["latest", false]);
  if (
    !block
    || !/^0x[0-9a-f]+$/i.test(block.number || "")
    || !/^0x[0-9a-f]+$/i.test(block.timestamp || "")
  ) {
    throw new Error("latest block is missing a valid number or timestamp");
  }
  const timestamp = Number(BigInt(block.timestamp));
  const blockNumber = Number(BigInt(block.number));
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !Number.isSafeInteger(blockNumber)) {
    throw new Error("latest block number or timestamp is outside the safe integer range");
  }
  return { blockTag: block.number, blockNumber, timestamp };
}

async function selectorOf(contract, signature) {
  const artifact = JSON.parse(
    await readFile(resolve(projectRoot, "out", `${contract}.sol`, `${contract}.json`), "utf8"),
  );
  const identifier = artifact.methodIdentifiers?.[signature];
  if (!identifier) throw new Error(`${contract} has no ${signature}`);
  return `0x${identifier}`;
}

/// Reads every launch and its escrow at one explicit block. Read-only: the watcher never sends a
/// transaction, so it can never check in for a creator or finalise a default on their behalf.
export async function collectLaunches(url, factory, blockTag = "latest") {
  const call = (to, data) => rpc(url, "eth_call", [{ to, data }, blockTag]);
  const launchCount = Number(
    decodeUint(await call(factory, await selectorOf("DoomLaunchFactory", "launchCount()"))),
  );
  if (!Number.isSafeInteger(launchCount) || launchCount < 0) {
    throw new Error("launchCount is outside the safe integer range");
  }

  const getLaunch = await selectorOf("DoomLaunchFactory", "getLaunch(uint256)");
  const escrowSelectors = Object.fromEntries(
    await Promise.all(
      [
        "status()",
        "completedCheckIns()",
        "requiredCheckIns()",
        "committedAmount()",
        "releasedAmount()",
        "nextCheckInAt()",
        "nextDeadline()",
      ].map(async signature => [signature, await selectorOf("GmEscrow", signature)]),
    ),
  );

  const launches = [];
  for (let launchId = 1; launchId <= launchCount; launchId += 1) {
    const raw = await call(factory, `${getLaunch}${padUint(launchId)}`);
    const words = String(raw).replace(/^0x/, "").match(/.{64}/g) || [];
    if (words.length < 4) throw new Error(`launch ${launchId} record is truncated`);
    const token = `0x${words[0].slice(24)}`;
    const creator = `0x${words[1].slice(24)}`;
    const creatorEscrow = `0x${words[3].slice(24)}`;

    const escrowValue = async signature => call(creatorEscrow, escrowSelectors[signature]);
    const [symbol, name] = await Promise.all([
      call(token, "0x95d89b41").then(decodeString).catch(() => null),
      call(token, "0x06fdde03").then(decodeString).catch(() => null),
    ]);

    const [
      status,
      completedCheckIns,
      requiredCheckIns,
      committedAmount,
      releasedAmount,
      nextCheckInAt,
      nextDeadline,
    ] = await Promise.all([
      escrowValue("status()"),
      escrowValue("completedCheckIns()"),
      escrowValue("requiredCheckIns()"),
      escrowValue("committedAmount()"),
      escrowValue("releasedAmount()"),
      escrowValue("nextCheckInAt()"),
      escrowValue("nextDeadline()"),
    ]);

    launches.push({
      launch: { launchId, token, creator, creatorEscrow, symbol, name },
      escrow: {
        status: Number(decodeUint(status)),
        completedCheckIns: Number(decodeUint(completedCheckIns)),
        requiredCheckIns: Number(decodeUint(requiredCheckIns)),
        committedAmount: decodeUint(committedAmount),
        releasedAmount: decodeUint(releasedAmount),
        nextCheckInAt: Number(decodeUint(nextCheckInAt)),
        nextDeadline: Number(decodeUint(nextDeadline)),
      },
    });
  }
  return launches;
}

/// Minimal ABI string decode for name()/symbol(). Untrusted onchain text is never rendered as
/// markup, and the Telegram sender escapes it.
export function decodeString(hex) {
  const body = String(hex || "").replace(/^0x/, "");
  if (body.length < 128) return null;
  const offset = Number(BigInt(`0x${body.slice(0, 64)}`));
  if (offset !== 32) return null;
  const length = Number(BigInt(`0x${body.slice(64, 128)}`));
  if (!length || length > 128 || body.length < 128 + length * 2) return null;
  const bytes = body.slice(128, 128 + length * 2);
  const text = Buffer.from(bytes, "hex").toString("utf8");
  return text.replace(/[\u0000-\u001f\u007f]/g, "").trim() || null;
}

export async function readState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      deliveredEventIds: Array.isArray(parsed.deliveredEventIds) ? parsed.deliveredEventIds : [],
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { entries: [], deliveredEventIds: [] };
    throw new Error(`Death Watch checkpoint is unreadable: ${error.message}`);
  }
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/// Sends all unsent events without advancing the feed checkpoint first. Event IDs are persisted
/// after each successful delivery, so a later failure cannot suppress the remaining alerts.
/// A crash between Telegram accepting a message and the ID checkpoint may duplicate that one
/// message on retry; at-least-once delivery is preferable to silently losing it.
export async function deliverEvents({
  events,
  previousEntries,
  currentEntries,
  deliveredEventIds = [],
  send,
  checkpoint,
}) {
  const delivered = new Set(deliveredEventIds);
  for (const event of events) {
    const alert = toAlert(event);
    if (delivered.has(alert.id)) continue;
    await send(alert);
    delivered.add(alert.id);
    await checkpoint({
      entries: previousEntries,
      deliveredEventIds: [...delivered].sort(),
    });
  }
  await checkpoint({ entries: currentEntries, deliveredEventIds: [] });
}

export async function main(argv = process.argv.slice(2)) {
  const read = flag => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : argv[index + 1];
  };
  const factory = read("--factory");
  if (!factory) throw new Error("--factory <address> is required");
  if (!ADDRESS.test(factory)) throw new Error("--factory must be a 20-byte hex address");
  const url = process.env.ROBINHOOD_RPC_URL || "";
  if (!/^https:\/\//.test(url)) throw new Error("ROBINHOOD_RPC_URL must be an HTTPS endpoint");
  const broadcast = argv.includes("--broadcast");

  const chainId = Number(await rpc(url, "eth_chainId"));
  if (chainId !== CHAIN_ID) throw new Error(`the endpoint returned chain ID ${chainId}`);

  // Workstation time can drift. One explicit block and its chain timestamp define the snapshot.
  const head = await readChainHead(url);
  const now = head.timestamp;
  const launches = await collectLaunches(url, factory, head.blockTag);
  const entries = buildFeed(launches, now);
  const checkpointPath = broadcast ? broadcastStatePath : observedStatePath;
  const previous = await readState(checkpointPath);
  const events = feedEvents(previous.entries, entries);

  const snapshot = {
    schemaVersion: 2,
    generatedAt: new Date(now * 1000).toISOString(),
    chainId: CHAIN_ID,
    blockNumber: head.blockNumber,
    factory,
    live: entries.filter(entry => entry.phase === "waiting" || entry.phase === "window_open").length,
    entries,
  };
  await writeJsonAtomic(resolve(outputRoot, "feed.json"), snapshot);

  console.log(
    `Death Watch: ${entries.length} commitments, ${snapshot.live} still live at block ${head.blockNumber}.`,
  );
  for (const entry of entries) {
    console.log(
      `  #${entry.launchId} ${entry.symbol || entry.token} | ${entry.phase} | `
        + `${entry.checkInsDone}/${entry.checkInsRequired} | ${entry.countdown} | `
        + `at stake ${entry.atStakeFormatted}`,
    );
  }

  if (!events.length) {
    await writeJsonAtomic(checkpointPath, { entries, deliveredEventIds: [] });
    console.log("No new events since the last poll.");
    return;
  }
  console.log(`${events.length} new event(s).`);
  for (const event of events) console.log(`  ${event.kind}: launch #${event.entry.launchId}`);

  if (!broadcast) {
    // Dry-run history is separate from the delivery checkpoint. Testing the watcher must never
    // consume an alert that a later --broadcast run still needs to publish.
    await writeJsonAtomic(observedStatePath, { entries, deliveredEventIds: [] });
    console.log("Not broadcasting. Pass --broadcast with DEATHWATCH_TELEGRAM_* set to publish.");
    return;
  }

  const token = process.env.DEATHWATCH_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.DEATHWATCH_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error("DEATHWATCH_TELEGRAM_BOT_TOKEN and DEATHWATCH_TELEGRAM_CHAT_ID are required");
  }
  await deliverEvents({
    events,
    previousEntries: previous.entries,
    currentEntries: entries,
    deliveredEventIds: previous.deliveredEventIds,
    send: alert => sendTelegramAlert({ token, chatId, alert, observedAt: now }),
    checkpoint: state => writeJsonAtomic(broadcastStatePath, state),
  });
  console.log(`Broadcast ${events.length} event(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Death Watch failed: ${error.message}`);
    process.exitCode = 1;
  });
}
