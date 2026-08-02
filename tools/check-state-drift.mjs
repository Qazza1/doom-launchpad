import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readJson, writeJson } from "./lib/json-file.mjs";
import { checkConfigClaims, checkDocumentClaims, summarize } from "./lib/state-claims.mjs";
import { CHAIN_ID, FACTORY } from "./canary/launch-plan.mjs";

/// Compares what this repository *says* about the chain with what the chain says.
///
/// Read-only, single provider, no secrets required beyond the endpoint. It is not part of the
/// safety chain — a plan is still guarded by two independent providers — so one endpoint is enough
/// to answer "is the documentation lying".

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "..");
const outputRoot = resolve(directory, "canary/output");
const SCAN_ROOTS = ["docs", "README.md"];

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

export async function readLiveState(url) {
  const artifact = await readJson(
    resolve(projectRoot, "out/DoomLaunchFactory.sol/DoomLaunchFactory.json"),
  );
  const selector = name => {
    const identifier = artifact.methodIdentifiers?.[name];
    if (!identifier) throw new Error(`the factory artifact has no ${name}`);
    return `0x${identifier}`;
  };
  const call = data => rpc(url, "eth_call", [{ to: FACTORY, data }, "latest"]);

  const chainId = Number(await rpc(url, "eth_chainId"));
  if (chainId !== CHAIN_ID) throw new Error(`the endpoint reports chain ${chainId}`);
  return {
    chainId,
    paused: BigInt(await call(selector("launchesPaused()"))) === 1n,
    launchCount: BigInt(await call(selector("launchCount()"))).toString(),
    totalNativeLiquidity: BigInt(await call(selector("totalNativeLiquidity()"))).toString(),
  };
}

export async function collectDocuments(root = projectRoot, scanRoots = SCAN_ROOTS) {
  const documents = [];
  const walk = async path => {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.name.endsWith(".md")) {
        documents.push({
          path: relative(root, child).replaceAll("\\", "/"),
          text: await readFile(child, "utf8"),
        });
      }
    }
  };
  for (const item of scanRoots) {
    const path = resolve(root, item);
    if (item.endsWith(".md")) {
      try {
        documents.push({ path: item, text: await readFile(path, "utf8") });
      } catch {
        // A missing optional file is not a finding.
      }
    } else {
      await walk(path);
    }
  }
  return documents;
}

export async function main() {
  const url = process.env.ROBINHOOD_RPC_URL || "";
  if (!/^https:\/\//.test(url)) {
    // Deliberately not a hard failure: CI has no endpoint, and a check that cannot run must say so
    // rather than pass quietly or block every build.
    console.log("State drift check SKIPPED: set ROBINHOOD_RPC_URL to an HTTPS endpoint to run it.");
    console.log("Nothing was verified. Do not treat this as agreement.");
    return { skipped: true };
  }

  const state = await readLiveState(url);
  const allowlistFile = await readJson(resolve(projectRoot, "config/state-claim-allowlist.json"));
  const [keeper, documents] = await Promise.all([
    readJson(resolve(projectRoot, "config/keeper.mainnet.json")),
    collectDocuments(),
  ]);

  const findings = [
    ...checkConfigClaims({ keeper, state }),
    ...checkDocumentClaims({ documents, state, allowlist: allowlistFile.allow }),
  ];
  const report = {
    schemaVersion: 1,
    ...summarize(findings),
    generatedAt: new Date().toISOString(),
    observed: state,
  };
  await writeJson(resolve(outputRoot, "state-drift.json"), report);

  console.log(
    `Chain ${state.chainId}: paused ${state.paused}, launches ${state.launchCount}, `
      + `aggregate liquidity ${state.totalNativeLiquidity} wei`,
  );
  if (!findings.length) {
    console.log(`Every state claim in ${documents.length} documents and the keeper config agrees.`);
    return report;
  }

  console.error(`\n${findings.length} claim(s) disagree with the chain:\n`);
  for (const finding of findings) {
    const where = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    console.error(`  ${where}`);
    console.error(`    says     ${finding.claim}`);
    console.error(`    reality  ${finding.reality}`);
    if (finding.consequence) console.error(`    cost     ${finding.consequence}`);
  }
  console.error(
    "\nFix the claim, or add an allowlist entry with a reason if it is a historical record.",
  );
  throw new Error(`${findings.length} state claim(s) are stale`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`State drift check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
