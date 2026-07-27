import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFeed, feedEvents, toAlert } from "./feed.mjs";
import { sendTelegramAlert } from "../keeper/lib/telegram.mjs";

export const CHAIN_ID = 4663;

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const stateRoot = resolve(directory, "state");
const outputRoot = resolve(directory, "output");

const decodeUint = word => BigInt(word);
const padUint = value => BigInt(value).toString(16).padStart(64, "0");

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
  const artifact = JSON.parse(
    await readFile(resolve(projectRoot, "out", `${contract}.sol`, `${contract}.json`), "utf8"),
  );
  const identifier = artifact.methodIdentifiers?.[signature];
  if (!identifier) throw new Error(`${contract} has no ${signature}`);
  return `0x${identifier}`;
}

/// Reads every launch and its escrow. Read-only: the watcher never sends a transaction, so it can
/// never check in for a creator or finalise a default on their behalf.
export async function collectLaunches(url, factory) {
  const call = (to, data) => rpc(url, "eth_call", [{ to, data }, "latest"]);
  const launchCount = Number(
    decodeUint(await call(factory, await selectorOf("DoomLaunchFactory", "launchCount()"))),
  );

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
    if (words.length < 4) continue;
    const token = `0x${words[0].slice(24)}`;
    const creator = `0x${words[1].slice(24)}`;
    const creatorEscrow = `0x${words[3].slice(24)}`;

    const escrowValue = async signature => call(creatorEscrow, escrowSelectors[signature]);
    const [symbol, name] = await Promise.all([
      // Standard ERC-20 selectors, fixed by the standard.
      call(token, "0x95d89b41").then(decodeString).catch(() => null),
      call(token, "0x06fdde03").then(decodeString).catch(() => null),
    ]);

    launches.push({
      launch: { launchId, token, creator, creatorEscrow, symbol, name },
      escrow: {
        status: Number(decodeUint(await escrowValue("status()"))),
        completedCheckIns: Number(decodeUint(await escrowValue("completedCheckIns()"))),
        requiredCheckIns: Number(decodeUint(await escrowValue("requiredCheckIns()"))),
        committedAmount: decodeUint(await escrowValue("committedAmount()")),
        releasedAmount: decodeUint(await escrowValue("releasedAmount()")),
        nextCheckInAt: Number(decodeUint(await escrowValue("nextCheckInAt()"))),
        nextDeadline: Number(decodeUint(await escrowValue("nextDeadline()"))),
      },
    });
  }
  return launches;
}

/// Minimal ABI string decode for name()/symbol(). Untrusted onchain text: it is never rendered as
/// markup anywhere, and the Telegram sender escapes it.
export function decodeString(hex) {
  const body = String(hex || "").replace(/^0x/, "");
  if (body.length < 128) return null;
  const length = Number(BigInt(`0x${body.slice(64, 128)}`));
  if (!length || length > 128) return null;
  const bytes = body.slice(128, 128 + length * 2);
  const text = Buffer.from(bytes, "hex").toString("utf8");
  // Control characters would let a launch name break a feed line.
  return text.replace(/[\u0000-\u001f\u007f]/g, "").trim() || null;
}

async function readState() {
  try {
    return JSON.parse(await readFile(resolve(stateRoot, "feed.json"), "utf8"));
  } catch {
    return { entries: [] };
  }
}

export async function main(argv = process.argv.slice(2)) {
  const read = flag => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : argv[index + 1];
  };
  const factory = read("--factory");
  if (!factory) throw new Error("--factory <address> is required");
  const url = process.env.ROBINHOOD_RPC_URL || "";
  if (!/^https:\/\//.test(url)) throw new Error("ROBINHOOD_RPC_URL must be an HTTPS endpoint");
  const broadcast = argv.includes("--broadcast");

  const chainId = Number(await rpc(url, "eth_chainId"));
  if (chainId !== CHAIN_ID) throw new Error(`the endpoint returned chain ID ${chainId}`);

  const now = Math.floor(Date.now() / 1000);
  const launches = await collectLaunches(url, factory);
  const entries = buildFeed(launches, now);
  const previous = await readState();
  const events = feedEvents(previous.entries, entries);

  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date(now * 1000).toISOString(),
    chainId: CHAIN_ID,
    factory,
    live: entries.filter(entry => entry.phase === "waiting" || entry.phase === "window_open").length,
    entries,
  };
  await mkdir(outputRoot, { recursive: true });
  await mkdir(stateRoot, { recursive: true });
  await writeFile(resolve(outputRoot, "feed.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await writeFile(resolve(stateRoot, "feed.json"), `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");

  console.log(`Death Watch: ${entries.length} commitments, ${snapshot.live} still live.`);
  for (const entry of entries) {
    console.log(
      `  #${entry.launchId} ${entry.symbol || entry.token} · ${entry.phase} · ` +
        `${entry.checkInsDone}/${entry.checkInsRequired} · ${entry.countdown} · at stake ${entry.atStake}`,
    );
  }

  if (!events.length) {
    console.log("No new events since the last poll.");
    return;
  }
  console.log(`${events.length} new event(s).`);
  for (const event of events) console.log(`  ${event.kind}: launch #${event.entry.launchId}`);

  if (!broadcast) {
    console.log("Not broadcasting. Pass --broadcast with DEATHWATCH_TELEGRAM_* set to publish.");
    return;
  }
  const token = process.env.DEATHWATCH_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.DEATHWATCH_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error("DEATHWATCH_TELEGRAM_BOT_TOKEN and DEATHWATCH_TELEGRAM_CHAT_ID are required");
  }
  for (const event of events) {
    await sendTelegramAlert({ token, chatId, alert: toAlert(event), observedAt: now });
  }
  console.log(`Broadcast ${events.length} event(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Death Watch failed: ${error.message}`);
    process.exitCode = 1;
  });
}
