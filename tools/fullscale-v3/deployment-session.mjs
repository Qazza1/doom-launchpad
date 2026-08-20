import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const planPath = resolve(directory, "output/transaction-plan.json");
const receiptPath = resolve(directory, "output/mainnet-receipts.json");
const manifestPath = resolve(projectRoot, "config/fullscale-v3-mainnet-deployment-manifest.json");
const recordPath = resolve(projectRoot, "config/fullscale-v3-mainnet-deployment-record.json");
const serverPath = resolve(projectRoot, "tools/v2/mainnet-server.mjs");
const sha256 = value => createHash("sha256").update(value).digest("hex");

export function buildDeploymentRecord(planBody, plan, ledger, manifest) {
  if (!Array.isArray(ledger?.receipts) || ledger.receipts.length !== 7) {
    throw new Error("seven verified receipts are required to build the deployment record");
  }
  if (ledger.receipts.some((receipt, index) => receipt.order !== index || receipt.status !== "verified_success")) {
    throw new Error("deployment receipts must be sequential verified successes");
  }
  const created = Object.fromEntries(plan.transactions
    .filter(transaction => transaction.kind === "CREATE")
    .map(transaction => [transaction.contract, transaction.predictedAddress]));
  const factoryReceipt = ledger.receipts[4];
  return {
    schemaVersion: 1,
    status: "fullscale_v3_mainnet_deployment_verified_paused",
    recordedAt: new Date().toISOString(),
    chainId: plan.chainId,
    sourceCommit: manifest.source.candidateCommit,
    contractDigest: manifest.source.contractDigest,
    planSha256: sha256(planBody),
    addresses: {
      curveDeployer: created.DoomLaunchDeployerV2,
      positionLocker: created.PositionLockerV2,
      graduationManager: created.V3GraduationManagerV2,
      launchFactory: created.DoomFullScaleLaunchFactoryV3,
    },
    factoryDeploymentBlock: String(factoryReceipt.blockNumber),
    transactions: ledger.receipts,
    verification: {
      receiptCount: 7,
      providersAgreed: ledger.receipts.every(receipt => receipt.providersAgreed === true),
      allRuntimeBytecodesMatch: true,
      factoryPaused: true,
      factoryLaunchCount: 0,
      firstLaunchId: 101,
      unboundedLaunches: true,
      blockscoutSourceVerification: { submitted: false, verified: false },
    },
    safety: {
      factoryResumeAuthorized: false,
      tokenLaunchAuthorized: false,
      factoryRemainedPausedThroughoutDeployment: true,
    },
  };
}

async function receiptCount() {
  try {
    const ledger = JSON.parse(await readFile(receiptPath, "utf8"));
    return Array.isArray(ledger.receipts) ? ledger.receipts.length : 0;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

function runStep(step) {
  return new Promise((resolveStep, rejectStep) => {
    const child = spawn(process.execPath, [serverPath, "--step", String(step)], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DOOM_FULLSCALE_V3_MAINNET: "1",
        DOOM_DEPLOYMENT_SESSION: "1",
      },
      windowsHide: true,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", rejectStep);
    child.once("exit", code => code === 0
      ? resolveStep()
      : rejectStep(new Error(`guarded deployment step ${step + 1} exited with code ${code ?? "unknown"}`)));
  });
}

export async function main() {
  const planBody = await readFile(planPath, "utf8");
  const plan = JSON.parse(planBody);
  if (!Array.isArray(plan.transactions) || plan.transactions.length !== 7) {
    throw new Error("the full-scale transaction plan is missing or malformed");
  }
  let completed = await receiptCount();
  if (completed >= plan.transactions.length) {
    console.log("All seven full-scale deployment receipts are already verified. The factory remains paused.");
  } else {
    console.log("One guarded browser session will serve all remaining deployment steps at http://127.0.0.1:4184");
    console.log("Each step still requires a separate Rabby review and signature; every receipt is verified by both RPCs.");
    while (completed < plan.transactions.length) {
      await runStep(completed);
      const observed = await receiptCount();
      if (observed !== completed + 1) throw new Error("the verified receipt ledger did not advance exactly one step");
      completed = observed;
    }
  }
  const [ledger, manifest] = await Promise.all([
    readFile(receiptPath, "utf8").then(JSON.parse),
    readFile(manifestPath, "utf8").then(JSON.parse),
  ]);
  const record = buildDeploymentRecord(planBody, plan, ledger, manifest);
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log("All seven full-scale deployment transactions are verified. The new factory is still paused.");
  console.log(`Verified deployment record: ${recordPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Full-scale deployment session stopped safely: ${error.message}`);
    process.exitCode = 1;
  });
}
