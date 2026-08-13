import { spawn } from "node:child_process";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addPolicyHealth, initialDaemonHealth, parseIntervalSeconds, recordCheckResult } from "./lib/daemon.mjs";
import { readKeeperConfig } from "./lib/config.mjs";
import { loadKeeperEnv, requireEnvironment } from "./lib/env.mjs";
import { sendTelegramAlert } from "./lib/telegram.mjs";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--config", "--state"].includes(key) || index + 1 >= argv.length) {
      throw new Error(`Unexpected or incomplete argument: ${key}`);
    }
    result[key.slice(2)] = argv[++index];
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
const configPath = resolve(
  invocationDirectory,
  process.env.KEEPER_CONFIG_PATH?.trim() || args.config || "config/keeper.mainnet.json",
);
const statePath = resolve(
  invocationDirectory,
  process.env.KEEPER_STATE_PATH?.trim() || args.state || "tools/keeper/state/alerts.json",
);
const intervalSeconds = parseIntervalSeconds(process.env.KEEPER_INTERVAL_SECONDS);
const port = Number(process.env.PORT || "8080");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be valid");

const keeperDirectory = dirname(fileURLToPath(import.meta.url));
const monitorPath = resolve(keeperDirectory, "monitor.mjs");
const keeperConfig = await readKeeperConfig(configPath);
let health = addPolicyHealth(initialDaemonHealth(Math.floor(Date.now() / 1000), intervalSeconds), {
  configFile: basename(configPath),
  chainId: keeperConfig.chainId,
  factory: keeperConfig.contracts.factory,
  expectedFactoryPaused: keeperConfig.expectedFactoryPaused,
});
let stopping = false;
let child = null;
let resolveWait = null;
const startupMarkerPath = resolve(dirname(statePath), "production-startup-notified.json");

const server = createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/health") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"error":"not found"}\n');
    return;
  }
  // A failed upstream snapshot is reported in the body and via Telegram. The
  // daemon itself is still healthy, so do not invite a Railway restart loop.
  response.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(health)}\n`);
});

function runCheck() {
  return new Promise((resolveCheck) => {
    const startedAt = Math.floor(Date.now() / 1000);
    health = { ...health, status: "running", last_started_at: startedAt };
    child = spawn(process.execPath, [monitorPath, "--config", configPath, "--state", statePath], {
      cwd: invocationDirectory,
      env: process.env,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", (error) => {
      console.error(`Keeper process failed to start: ${error.message}`);
    });
    child.once("exit", (code, signal) => {
      child = null;
      const completedAt = Math.floor(Date.now() / 1000);
      const exitCode = Number.isInteger(code) ? code : 1;
      const nextRunAt = stopping ? null : Math.max(completedAt, startedAt + intervalSeconds);
      health = recordCheckResult(health, { startedAt, completedAt, exitCode, nextRunAt });
      console.log(
        `Keeper cycle ${health.checks_completed} ${exitCode === 0 ? "passed" : "failed"}`
          + `${signal ? ` (${signal})` : ""}; next run ${nextRunAt ?? "disabled"}.`,
      );
      resolveCheck();
    });
  });
}

async function maybeSendStartupNotice() {
  if (process.env.KEEPER_STARTUP_NOTIFY !== "1") return;
  try {
    await access(startupMarkerPath);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  loadKeeperEnv();
  const observedAt = Math.floor(Date.now() / 1000);
  await sendTelegramAlert({
    token: requireEnvironment("TELEGRAM_BOT_TOKEN"),
    chatId: requireEnvironment("TELEGRAM_CHAT_ID"),
    observedAt,
    alert: {
      id: "keeper:production-online",
      severity: "info",
      title: "DoomStreak production keeper online",
      summary: "Railway started the read-only Robinhood mainnet monitor.",
      details: ["Factory remains expected to be paused.", "No signing key is loaded."],
      action: "No action required. Confirm this one-time delivery and keep the service online.",
    },
  });
  await mkdir(dirname(startupMarkerPath), { recursive: true });
  const temporaryPath = `${startupMarkerPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({ observed_at: observedAt })}\n`, { flag: "wx" });
  await rename(temporaryPath, startupMarkerPath);
  console.log("Sent one-time production keeper startup notification.");
}

async function loop() {
  while (!stopping) {
    try {
      await maybeSendStartupNotice();
    } catch (error) {
      console.error(`Production keeper startup notification failed: ${error.message}`);
    }
    await runCheck();
    if (stopping) break;
    const delayMs = Math.max(0, (health.next_run_at * 1000) - Date.now());
    await new Promise((resolveDelay) => {
      resolveWait = resolveDelay;
      const timer = setTimeout(resolveDelay, delayMs);
      const originalResolve = resolveWait;
      resolveWait = () => {
        clearTimeout(timer);
        originalResolve();
      };
    });
    resolveWait = null;
  }
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Keeper daemon received ${signal}; stopping without broadcasting a transaction.`);
  if (child) child.kill("SIGTERM");
  if (resolveWait) resolveWait();
  server.close();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen(port, "0.0.0.0", () => {
  console.log(`Read-only keeper health listening on port ${port}; interval ${intervalSeconds}s.`);
});
await loop();
