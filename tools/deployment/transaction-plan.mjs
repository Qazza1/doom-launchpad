import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findFoundryBinaries, runCommand } from "./localhost-preview.mjs";
import {
  CONTRACTS,
  castArgument,
  constructorSignature,
  planConstructorArguments,
  resolveDeploymentInputs,
} from "./verification-bundle.mjs";
import { validatePredeploymentManifest } from "./verify-manifest.mjs";

export const CHAIN_ID = 4663;
export const DEPLOYER = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output");
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/// The exact production order. Steps 3 and 5 are irreversible one-time bindings.
export const STEPS = [
  { order: 0, kind: "CREATE", contract: "DoomRewards" },
  { order: 1, kind: "CREATE", contract: "PositionLocker" },
  { order: 2, kind: "CREATE", contract: "V3LiquidityManager" },
  { order: 3, kind: "CALL", contract: "PositionLocker", fn: "bindRegistrar(address)", irreversible: true },
  { order: 4, kind: "CREATE", contract: "DoomLaunchFactory" },
  { order: 5, kind: "CALL", contract: "V3LiquidityManager", fn: "bindFactory(address)", irreversible: true },
];

const sha256 = value => createHash("sha256").update(value).digest("hex");
const strip = hex => (hex.startsWith("0x") ? hex.slice(2) : hex);

/// Every transaction in the plan must be a plain value-free deployment or binding call sent by the
/// approved deployer at a known nonce. Anything else is refused rather than rendered for signing.
export function validatePlan(plan) {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };

  require(plan?.chainId === CHAIN_ID, "the plan must target chain 4663");
  require(plan?.transactions?.length === STEPS.length, "the plan must contain exactly six transactions");
  if (plan?.transactions?.length !== STEPS.length) return errors;

  for (const [index, step] of STEPS.entries()) {
    const transaction = plan.transactions[index];
    const label = `transaction ${index}`;
    require(transaction.nonce === plan.startingNonce + index, `${label} has a non-sequential nonce`);
    require(transaction.from?.toLowerCase() === DEPLOYER.toLowerCase(), `${label} has the wrong sender`);
    require(transaction.value === "0x0", `${label} must not transfer value`);
    require(transaction.kind === step.kind, `${label} has the wrong kind`);
    require(/^0x[0-9a-f]*$/i.test(transaction.data || ""), `${label} has malformed calldata`);

    if (step.kind === "CREATE") {
      require(transaction.to === null, `${label} must be a contract creation with no recipient`);
      require(
        ADDRESS.test(transaction.predictedAddress || ""),
        `${label} is missing its predicted address`,
      );
      require(strip(transaction.data).length > 0, `${label} has empty creation code`);
      if (transaction.encodedConstructorArguments) {
        require(
          strip(transaction.data).endsWith(strip(transaction.encodedConstructorArguments)),
          `${label} creation code does not end with its encoded constructor arguments`,
        );
      }
    } else {
      require(ADDRESS.test(transaction.to || ""), `${label} must call a concrete address`);
      require(transaction.predictedAddress === null, `${label} must not create a contract`);
      require(strip(transaction.data).length === 8 + 64, `${label} calldata is not a single address argument`);
    }
  }

  const created = Object.fromEntries(
    plan.transactions
      .filter(transaction => transaction.kind === "CREATE")
      .map(transaction => [transaction.contract, transaction.predictedAddress?.toLowerCase()]),
  );
  const bindRegistrar = plan.transactions[3];
  const bindFactory = plan.transactions[5];
  require(
    bindRegistrar.to?.toLowerCase() === created.PositionLocker,
    "bindRegistrar must target the predicted PositionLocker",
  );
  require(
    `0x${strip(bindRegistrar.data).slice(8).slice(24)}` === created.V3LiquidityManager,
    "bindRegistrar must pass the predicted V3LiquidityManager",
  );
  require(
    bindFactory.to?.toLowerCase() === created.V3LiquidityManager,
    "bindFactory must target the predicted V3LiquidityManager",
  );
  require(
    `0x${strip(bindFactory.data).slice(8).slice(24)}` === created.DoomLaunchFactory,
    "bindFactory must pass the predicted DoomLaunchFactory",
  );

  return errors;
}

/// Confirms the predicted addresses were actually threaded into the later constructors. A plan that
/// deploys correct code with stale dependency addresses would still pass a naive review.
export function validateDependencyWiring(plan) {
  const errors = [];
  const created = Object.fromEntries(
    plan.transactions
      .filter(transaction => transaction.kind === "CREATE")
      .map(transaction => [transaction.contract, transaction.predictedAddress?.toLowerCase()]),
  );
  const argumentsOf = name =>
    plan.transactions
      .find(transaction => transaction.contract === name && transaction.kind === "CREATE")
      ?.constructorArgumentValues?.flat()
      .map(value => String(value).toLowerCase()) || [];

  if (!argumentsOf("PositionLocker").includes(created.DoomRewards)) {
    errors.push("PositionLocker was not given the predicted DoomRewards address");
  }
  if (!argumentsOf("V3LiquidityManager").includes(created.PositionLocker)) {
    errors.push("V3LiquidityManager was not given the predicted PositionLocker address");
  }
  const factoryArguments = argumentsOf("DoomLaunchFactory");
  for (const [name, address] of Object.entries(created)) {
    if (name === "DoomLaunchFactory") continue;
    if (!factoryArguments.includes(address)) {
      errors.push(`DoomLaunchFactory was not given the predicted ${name} address`);
    }
  }
  return errors;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function computeAddress(cast, nonce) {
  const { stdout } = await runCommand(cast, ["compute-address", DEPLOYER, "--nonce", String(nonce)]);
  const match = stdout.match(/0x[0-9a-fA-F]{40}/);
  if (!match) throw new Error(`could not predict the address for nonce ${nonce}`);
  return match[0];
}

export async function buildPlan(startingNonce) {
  if (!Number.isInteger(startingNonce) || startingNonce < 0) {
    throw new Error("the starting nonce must be a non-negative integer");
  }

  const manifest = await readJson(resolve(projectRoot, "config/stage4-deployment-manifest.json"));
  const manifestErrors = validatePredeploymentManifest(manifest);
  if (manifestErrors.length) {
    throw new Error(`the deployment manifest is not fail-closed: ${manifestErrors.join("; ")}`);
  }
  const decisions = await readJson(
    resolve(projectRoot, "config/robinhood-mainnet-canary.decisions.json"),
  );
  const { errors: inputErrors, inputs } = resolveDeploymentInputs(manifest, decisions);
  if (inputErrors.length) throw new Error(inputErrors.join("; "));

  const foundry = findFoundryBinaries();
  const predicted = {};
  for (const step of STEPS.filter(item => item.kind === "CREATE")) {
    predicted[step.contract] = await computeAddress(foundry.cast, startingNonce + step.order);
  }
  const { errors: argumentErrors, values } = planConstructorArguments(inputs, predicted);
  if (argumentErrors.length) throw new Error(argumentErrors.join("; "));

  const transactions = [];
  for (const step of STEPS) {
    if (step.kind === "CREATE") {
      const contract = CONTRACTS.find(item => item.name === step.contract);
      const artifact = await readJson(
        resolve(projectRoot, "out", `${contract.name}.sol`, `${contract.name}.json`),
      );
      const signature = constructorSignature(artifact.abi);
      const { stdout } = await runCommand(foundry.cast, [
        "abi-encode",
        signature,
        ...values[step.contract].map(castArgument),
      ]);
      const encoded = stdout.trim();
      const creationCode = artifact.bytecode?.object || "0x";
      if (strip(creationCode).length === 0) {
        throw new Error(`${step.contract} has no creation code; run forge build first`);
      }
      transactions.push({
        order: step.order,
        kind: step.kind,
        contract: step.contract,
        label: `Deploy ${step.contract}`,
        irreversible: false,
        from: DEPLOYER,
        to: null,
        value: "0x0",
        nonce: startingNonce + step.order,
        predictedAddress: predicted[step.contract],
        constructorSignature: signature,
        constructorArgumentValues: values[step.contract],
        encodedConstructorArguments: encoded,
        data: `${creationCode}${strip(encoded)}`,
        dataSha256: sha256(`${creationCode}${strip(encoded)}`),
      });
    } else {
      const target = step.contract === "PositionLocker"
        ? predicted.PositionLocker
        : predicted.V3LiquidityManager;
      const argument = step.contract === "PositionLocker"
        ? predicted.V3LiquidityManager
        : predicted.DoomLaunchFactory;
      const { stdout } = await runCommand(foundry.cast, ["calldata", step.fn, argument]);
      const data = stdout.trim();
      transactions.push({
        order: step.order,
        kind: step.kind,
        contract: step.contract,
        label: `${step.contract}.${step.fn}`,
        irreversible: true,
        from: DEPLOYER,
        to: target,
        value: "0x0",
        nonce: startingNonce + step.order,
        predictedAddress: null,
        argument,
        data,
        dataSha256: sha256(data),
      });
    }
  }

  const plan = {
    schemaVersion: 1,
    status: "unsigned_transaction_plan",
    generatedAt: new Date().toISOString(),
    chainId: CHAIN_ID,
    deployer: DEPLOYER,
    startingNonce,
    safety: {
      signerLoaded: false,
      signed: false,
      broadcast: false,
      mainnetDeploymentApproved: false,
      factoryMustRemainPaused: true,
    },
    transactions,
    warning:
      "Unsigned plan only. The predicted addresses are valid solely for this exact starting nonce; re-plan if the nonce moves, and stop the sequence on any receipt or postcondition mismatch.",
  };

  const planErrors = [...validatePlan(plan), ...validateDependencyWiring(plan)];
  if (planErrors.length) throw new Error(planErrors.join("; "));
  return plan;
}

export async function main(argv = process.argv.slice(2)) {
  const nonceFlag = argv.indexOf("--nonce");
  if (nonceFlag === -1) {
    throw new Error(
      "--nonce is required; read the deployer's pending nonce from both providers immediately before planning",
    );
  }
  const plan = await buildPlan(Number(argv[nonceFlag + 1]));
  const { transactions, startingNonce } = plan;

  await mkdir(outputRoot, { recursive: true });
  const planPath = resolve(outputRoot, "transaction-plan.json");
  const body = `${JSON.stringify(plan, null, 2)}\n`;
  await writeFile(planPath, body, "utf8");

  console.log(`Unsigned six-transaction plan for starting nonce ${startingNonce}.`);
  for (const transaction of transactions) {
    const target = transaction.to
      ? `to ${transaction.to}`
      : `creates ${transaction.predictedAddress}`;
    const flag = transaction.irreversible ? " [IRREVERSIBLE]" : "";
    console.log(
      `  nonce ${transaction.nonce}: ${transaction.label}${flag}; ${target}; ` +
        `${strip(transaction.data).length / 2} bytes; sha256 ${transaction.dataSha256.slice(0, 16)}`,
    );
  }
  console.log(`Plan: ${planPath}`);
  console.log(`Plan sha256: ${sha256(body)}`);
  console.log("Nothing was signed or broadcast. Gas is deliberately absent; estimate it per step.");
  console.log("Predicted addresses depend on this nonce. Re-plan if the pending nonce changes.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Transaction plan failed: ${error.message}`);
    process.exitCode = 1;
  });
}
