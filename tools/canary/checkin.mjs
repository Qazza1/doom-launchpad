import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readJson } from "../lib/json-file.mjs";
import { CHAIN_ID, SENDER } from "./launch-plan.mjs";

/// Prepares a GM check-in. Read-only: it reads the escrow, decides whether the window is open, and
/// prints the exact transaction to submit from your own wallet. It cannot send anything.
///
/// A check-in is far lower risk than a launch — no value, and only the creator can call it — but
/// the deadline is unforgiving, and the cost of getting it wrong is the whole unreleased
/// allocation. So the tool refuses to print a transaction it believes would revert.

export const ESCROW_STATUS = ["Active", "Completed", "Defaulted"];

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");

export function describeGap(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours >= 1) return `${hours}h ${minutes}m`;
  if (minutes >= 1) return `${minutes}m ${total % 60}s`;
  return `${total}s`;
}

/// Decides whether a check-in can be submitted right now, from state read at one block.
export function evaluateWindow({ status, completedCheckIns, requiredCheckIns, nextCheckInAt, nextDeadline, chainTime }) {
  const now = Number(chainTime);
  const opens = Number(nextCheckInAt);
  const closes = Number(nextDeadline);
  const progress = `${Number(completedCheckIns)}/${Number(requiredCheckIns)}`;

  if (Number(status) === 1) {
    return { ready: false, state: "completed", message: `The streak is complete at ${progress}. Nothing to do.` };
  }
  if (Number(status) === 2) {
    return { ready: false, state: "defaulted", message: "This commitment already defaulted. A check-in would revert." };
  }
  if (now > closes) {
    return {
      ready: false,
      state: "missed",
      message:
        `The window closed ${describeGap(now - closes)} ago, at ${iso(closes)}. A check-in now would `
        + "revert. Anyone can finalise the default from here.",
    };
  }
  if (now < opens) {
    return {
      ready: false,
      state: "early",
      message: `Too early. The window opens in ${describeGap(opens - now)}, at ${iso(opens)}.`,
    };
  }
  return {
    ready: true,
    state: "open",
    // The margin matters more than the fact that it is open: submitting with two minutes left is a
    // different decision from submitting with eight hours left.
    message: `Window is open. ${describeGap(closes - now)} left, closing ${iso(closes)}.`,
    remainingSeconds: closes - now,
  };
}

export function iso(seconds) {
  return `${new Date(Number(seconds) * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC`;
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

export async function main(argv = process.argv.slice(2)) {
  const read = flag => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : argv[index + 1];
  };
  const escrow = read("--escrow");
  if (!escrow) throw new Error("--escrow <address> is required");

  const url = process.env.ROBINHOOD_RPC_URL || "";
  if (!/^https:\/\//.test(url)) throw new Error("ROBINHOOD_RPC_URL must be an HTTPS endpoint");

  const artifact = await readJson(resolve(projectRoot, "out/GmEscrow.sol/GmEscrow.json"));
  const selector = name => {
    const identifier = artifact.methodIdentifiers?.[name];
    if (!identifier) throw new Error(`GmEscrow has no ${name}`);
    return `0x${identifier}`;
  };
  const recordGm = selector("recordGm()");

  const chainId = Number(await rpc(url, "eth_chainId"));
  if (chainId !== CHAIN_ID) throw new Error(`the endpoint reports chain ${chainId}`);
  const block = await rpc(url, "eth_getBlockByNumber", ["latest", false]);
  const at = block.number;
  const call = data => rpc(url, "eth_call", [{ to: escrow, data }, at]);
  const value = async name => BigInt(await call(selector(name)));

  const [status, completed, required, opens, closes, committed, released, creator] = await Promise.all([
    value("status()"),
    value("completedCheckIns()"),
    value("requiredCheckIns()"),
    value("nextCheckInAt()"),
    value("nextDeadline()"),
    value("committedAmount()"),
    value("releasedAmount()"),
    call(selector("creator()")),
  ]);
  const creatorAddress = `0x${creator.slice(-40)}`;
  const chainTime = Number(BigInt(block.timestamp));
  const perCheckIn = committed / (required || 1n);

  const window = evaluateWindow({
    status,
    completedCheckIns: completed,
    requiredCheckIns: required,
    nextCheckInAt: opens,
    nextDeadline: closes,
    chainTime,
  });

  console.log(`\n=== GM CHECK-IN · escrow ${escrow} ===`);
  console.log(`  read at block ${Number(BigInt(block.number))}, chain time ${iso(chainTime)}`);
  console.log(`  status       ${ESCROW_STATUS[Number(status)] ?? status}`);
  console.log(`  check-ins    ${completed}/${required}`);
  console.log(`  releases     ${(perCheckIn / 10n ** 18n).toLocaleString("en-US")} tokens on this check-in`);
  console.log(`  creator      ${creatorAddress}`);
  if (creatorAddress.toLowerCase() !== SENDER.toLowerCase()) {
    console.log(`  NOTE: the approved creator on record is ${SENDER}`);
  }
  console.log(`\n  ${window.message}`);

  if (!window.ready) {
    console.log("\n  No transaction to submit.");
    throw new Error(window.state);
  }

  console.log("\n  Submit exactly this, from the creator account:");
  console.log(`    to        ${escrow}`);
  console.log("    value     0");
  console.log(`    data      ${recordGm}`);
  console.log(`    function  recordGm()`);
  console.log("\n  This tool cannot send. Submit it from your own wallet, then re-run this");
  console.log("  command to confirm the count moved.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`\nCheck-in preparation stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
