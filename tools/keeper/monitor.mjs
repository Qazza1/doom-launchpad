import { resolve } from "node:path";
import { createPublicClient, http } from "viem";
import { EMPTY_ALERT_STATE, readAlertState, reconcileAlerts, writeAlertState } from "./lib/alerts.mjs";
import { collectKeeperState } from "./lib/collect.mjs";
import { readKeeperConfig } from "./lib/config.mjs";
import { safeErrorClass } from "./lib/diagnostics.mjs";
import { loadKeeperEnv, requireEnvironment } from "./lib/env.mjs";
import { evaluateKeeperState } from "./lib/rules.mjs";
import { sendTelegramAlert, validateBotToken, validateChatId } from "./lib/telegram.mjs";

function parseArgs(argv) {
  const result = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") result.dryRun = true;
    else if (value === "--config" || value === "--state") {
      if (index + 1 >= argv.length) throw new Error(`Missing value for ${value}`);
      result[value.slice(2)] = argv[++index];
    } else throw new Error(`Unexpected argument: ${value}`);
  }
  return result;
}

function publicClient(rpcUrl) {
  return createPublicClient({
    transport: http(rpcUrl, { timeout: 10_000, retryCount: 1 }),
  });
}

function collectionFailure(error) {
  return {
    id: "keeper:collection-failed",
    severity: "critical",
    title: "Keeper could not collect on-chain state",
    summary: "The RPC snapshot or a required contract read failed.",
    details: [`Failure class: ${safeErrorClass(error)}`],
    action: "Check both RPCs. Do not rely on deadline or lock freshness until monitoring recovers.",
  };
}

loadKeeperEnv();
const args = parseArgs(process.argv.slice(2));
const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
const configPath = resolve(invocationDirectory, args.config ?? "config/keeper.json");
const statePath = resolve(invocationDirectory, args.state ?? "tools/keeper/state/alerts.json");
const config = await readKeeperConfig(configPath);
if (!config.enabled) {
  console.log("Keeper configuration is disabled. No RPC or Telegram request was made.");
  process.exit(0);
}

let token;
let chatId;
if (!args.dryRun) {
  token = validateBotToken(requireEnvironment("TELEGRAM_BOT_TOKEN"));
  chatId = validateChatId(requireEnvironment("TELEGRAM_CHAT_ID"));
}

const primaryUrl = requireEnvironment(config.rpcUrlEnvironmentVariable);
const fallbackUrl = process.env[config.fallbackRpcUrlEnvironmentVariable]?.trim();
const observedAt = Math.floor(Date.now() / 1000);
let alerts;
let collectionFailed = false;

try {
  let state;
  try {
    state = await collectKeeperState(publicClient(primaryUrl), config, observedAt);
  } catch (primaryError) {
    console.error(`Primary RPC snapshot failed [${safeErrorClass(primaryError)}].`);
    if (!fallbackUrl) throw primaryError;
    try {
      state = await collectKeeperState(publicClient(fallbackUrl), config, observedAt);
    } catch (fallbackError) {
      console.error(`Fallback RPC snapshot failed [${safeErrorClass(fallbackError)}].`);
      throw fallbackError;
    }
    alerts = [
      {
        id: "rpc:primary-failed",
        severity: "warning",
        title: "Primary Robinhood RPC failed",
        summary: "The primary endpoint failed during the keeper snapshot.",
        details: ["The fallback RPC returned a complete keeper snapshot."],
        action: "Investigate or replace the primary RPC endpoint.",
      },
    ];
  }
  alerts = [...(alerts ?? []), ...evaluateKeeperState(state, config)];
  console.log(`Collected block ${state.headNumber} on chain ${state.chainId}; ${alerts.length} active alert(s).`);
} catch (error) {
  collectionFailed = true;
  alerts = [collectionFailure(error)];
}

let previous;
try {
  previous = await readAlertState(statePath);
} catch {
  previous = structuredClone(EMPTY_ALERT_STATE);
  alerts.push({
    id: "keeper:state-invalid",
    severity: "critical",
    title: "Keeper alert state is invalid",
    summary: "The persisted deduplication state could not be read safely.",
    details: [],
    action: "Inspect the local state file and persistent disk. Duplicate alerts may be sent during recovery.",
  });
}
const { notifications, nextState } = reconcileAlerts(alerts, previous, observedAt, config.thresholds);

if (args.dryRun) {
  console.log(JSON.stringify({ alerts, notifications }, null, 2));
  console.log("Dry run complete. No Telegram message or state file was written.");
  process.exit(alerts.some((item) => item.severity === "critical") ? 2 : 0);
}

for (const notification of notifications) {
  await sendTelegramAlert({ token, chatId, alert: notification, observedAt });
  console.log(`Sent ${notification.notificationKind} Telegram alert: ${notification.id}`);
}
await writeAlertState(statePath, nextState);
console.log(`Keeper check complete; ${notifications.length} notification(s) sent.`);
if (collectionFailed) process.exitCode = 1;
