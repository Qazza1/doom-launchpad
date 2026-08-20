import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findFoundryBinaries, runCommand } from "../deployment/localhost-preview.mjs";
import { castArgument, constructorSignature } from "../deployment/verification-bundle.mjs";

export const CHAIN_ID = 4663;
export const DEPLOYER = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F";
export const FULLSCALE_FACTORY = "DoomFullScaleLaunchFactoryV3";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output");
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const strip = value => (value.startsWith("0x") ? value.slice(2) : value);
const lower = value => String(value ?? "").toLowerCase();
const sha256 = value => createHash("sha256").update(value).digest("hex");

export const STEPS = Object.freeze([
  { order: 0, kind: "CREATE", contract: "DoomLaunchDeployerV2" },
  { order: 1, kind: "CREATE", contract: "PositionLockerV2" },
  { order: 2, kind: "CREATE", contract: "V3GraduationManagerV2" },
  { order: 3, kind: "CALL", contract: "PositionLockerV2", fn: "bindRegistrar(address)" },
  { order: 4, kind: "CREATE", contract: FULLSCALE_FACTORY },
  { order: 5, kind: "CALL", contract: "DoomLaunchDeployerV2", fn: "bindFactory(address)" },
  { order: 6, kind: "CALL", contract: "V3GraduationManagerV2", fn: "bindFactory(address)" },
]);

function addressWord(data) {
  return `0x${strip(data).slice(8).slice(24)}`.toLowerCase();
}

export function validateManifest(manifest) {
  const errors = [];
  if (manifest?.network?.chainId !== CHAIN_ID) errors.push("manifest must target Robinhood Chain ID 4663");
  if (lower(manifest?.roles?.deployer) !== lower(DEPLOYER)) errors.push("manifest deployer is not the approved wallet");
  if (manifest?.safety?.broadcast !== false) errors.push("manifest broadcast must be false");
  if (manifest?.safety?.deploymentAuthorized !== false) errors.push("deployment must remain unauthorized");
  if (manifest?.safety?.factoryResumeAuthorized !== false) errors.push("factory resume must remain unauthorized");
  if (manifest?.safety?.factoryMustRemainPaused !== true) errors.push("factory must remain paused");
  if (manifest?.safety?.tokenLaunchAuthorized !== false) errors.push("token launch must remain unauthorized");
  if (manifest?.economics?.firstLaunchId !== 101 || manifest?.economics?.unboundedLaunches !== true) {
    errors.push("manifest must begin at global ID 101 with no launch cap");
  }
  if (manifest?.creatorPolicy?.permissionlessEoaWallets !== true || manifest?.creatorPolicy?.allowlist !== false) {
    errors.push("manifest must remain permissionless for EOA wallets");
  }
  return errors;
}

export function validatePlan(plan) {
  const errors = [];
  const requireValue = (condition, message) => { if (!condition) errors.push(message); };
  requireValue(plan?.chainId === CHAIN_ID, "plan must target chain 4663");
  requireValue(lower(plan?.deployer) === lower(DEPLOYER), "plan has the wrong deployer");
  requireValue(plan?.transactions?.length === STEPS.length, "plan must contain exactly seven transactions");
  if (plan?.transactions?.length !== STEPS.length) return errors;

  for (const [index, step] of STEPS.entries()) {
    const transaction = plan.transactions[index];
    requireValue(transaction.nonce === plan.startingNonce + index, `transaction ${index} has the wrong nonce`);
    requireValue(lower(transaction.from) === lower(DEPLOYER), `transaction ${index} has the wrong sender`);
    requireValue(transaction.value === "0x0", `transaction ${index} must have zero value`);
    requireValue(transaction.kind === step.kind, `transaction ${index} has the wrong kind`);
    requireValue(transaction.contract === step.contract, `transaction ${index} has the wrong contract`);
    requireValue(/^0x[0-9a-f]*$/i.test(transaction.data || ""), `transaction ${index} has invalid data`);
    if (step.kind === "CREATE") {
      requireValue(transaction.to === null, `transaction ${index} must be CREATE`);
      requireValue(ADDRESS.test(transaction.predictedAddress || ""), `transaction ${index} lacks predicted address`);
      requireValue(strip(transaction.data).length > 0, `transaction ${index} has empty creation code`);
    } else {
      requireValue(ADDRESS.test(transaction.to || ""), `transaction ${index} lacks call target`);
      requireValue(transaction.predictedAddress === null, `transaction ${index} must not predict an address`);
      requireValue(strip(transaction.data).length === 72, `transaction ${index} must contain one address argument`);
    }
  }

  const created = Object.fromEntries(
    plan.transactions.filter(transaction => transaction.kind === "CREATE")
      .map(transaction => [transaction.contract, lower(transaction.predictedAddress)]),
  );
  const bindings = [
    [3, created.PositionLockerV2, created.V3GraduationManagerV2],
    [5, created.DoomLaunchDeployerV2, created[FULLSCALE_FACTORY]],
    [6, created.V3GraduationManagerV2, created[FULLSCALE_FACTORY]],
  ];
  for (const [index, target, argument] of bindings) {
    requireValue(lower(plan.transactions[index].to) === target, `transaction ${index} has the wrong binding target`);
    requireValue(addressWord(plan.transactions[index].data) === argument, `transaction ${index} has the wrong binding argument`);
  }
  return errors;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function computeAddress(cast, nonce) {
  const { stdout } = await runCommand(cast, ["compute-address", DEPLOYER, "--nonce", String(nonce)]);
  const match = stdout.match(/0x[0-9a-fA-F]{40}/);
  if (!match) throw new Error(`could not predict address for nonce ${nonce}`);
  return match[0];
}

export async function buildPlan(startingNonce) {
  if (!Number.isInteger(startingNonce) || startingNonce < 0) throw new Error("starting nonce must be non-negative");
  const manifest = await readJson(resolve(projectRoot, "config/fullscale-v3-mainnet-deployment-manifest.json"));
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length) throw new Error(manifestErrors.join("; "));

  const foundry = findFoundryBinaries();
  const predicted = {};
  for (const step of STEPS.filter(step => step.kind === "CREATE")) {
    predicted[step.contract] = await computeAddress(foundry.cast, startingNonce + step.order);
  }

  const { roles, dependencies } = manifest;
  const values = {
    DoomLaunchDeployerV2: [roles.deployer],
    PositionLockerV2: [
      dependencies.nonfungiblePositionManager,
      dependencies.wrappedNative,
      dependencies.doomRewards,
      roles.treasury,
      roles.deployer,
    ],
    V3GraduationManagerV2: [
      CHAIN_ID,
      roles.deployer,
      dependencies.uniswapV3Factory,
      dependencies.nonfungiblePositionManager,
      dependencies.wrappedNative,
      predicted.PositionLockerV2,
    ],
    [FULLSCALE_FACTORY]: [[
      roles.operator,
      roles.emergencyGuardian,
      roles.treasury,
      dependencies.doomRewards,
      dependencies.wrappedNative,
      predicted.V3GraduationManagerV2,
      predicted.DoomLaunchDeployerV2,
    ]],
  };

  const transactions = [];
  for (const step of STEPS) {
    if (step.kind === "CREATE") {
      const artifact = await readJson(resolve(projectRoot, "v2/out", `${step.contract}.sol`, `${step.contract}.json`));
      const signature = constructorSignature(artifact.abi);
      const { stdout } = await runCommand(foundry.cast, [
        "abi-encode", signature, ...values[step.contract].map(castArgument),
      ]);
      const encodedArguments = stdout.trim();
      const creationCode = artifact.bytecode?.object || "0x";
      if (!strip(creationCode)) throw new Error(`${step.contract} artifact has no creation code`);
      const data = `${creationCode}${strip(encodedArguments)}`;
      transactions.push({
        order: step.order,
        kind: step.kind,
        contract: step.contract,
        label: `Deploy ${step.contract}`,
        from: DEPLOYER,
        to: null,
        value: "0x0",
        nonce: startingNonce + step.order,
        predictedAddress: predicted[step.contract],
        constructorSignature: signature,
        constructorArgumentValues: values[step.contract],
        encodedConstructorArguments: encodedArguments,
        data,
        dataSha256: sha256(data),
      });
      continue;
    }

    const targets = { 3: predicted.PositionLockerV2, 5: predicted.DoomLaunchDeployerV2, 6: predicted.V3GraduationManagerV2 };
    const argument = step.order === 3 ? predicted.V3GraduationManagerV2 : predicted[FULLSCALE_FACTORY];
    const { stdout } = await runCommand(foundry.cast, ["calldata", step.fn, argument]);
    const data = stdout.trim();
    transactions.push({
      order: step.order,
      kind: step.kind,
      contract: step.contract,
      label: `${step.contract}.${step.fn}`,
      from: DEPLOYER,
      to: targets[step.order],
      value: "0x0",
      nonce: startingNonce + step.order,
      predictedAddress: null,
      argument,
      data,
      dataSha256: sha256(data),
    });
  }

  const plan = {
    schemaVersion: 1,
    status: "unsigned_fullscale_v3_transaction_plan",
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
      tokenLaunchAuthorized: false,
    },
    transactions,
    warning: "Unsigned plan only. Re-plan if the pending nonce changes. Deployment leaves the uncapped factory paused.",
  };
  const errors = validatePlan(plan);
  if (errors.length) throw new Error(errors.join("; "));
  return plan;
}

export async function main(argv = process.argv.slice(2)) {
  const nonceFlag = argv.indexOf("--nonce");
  if (nonceFlag === -1) throw new Error("--nonce is required and must be confirmed through both RPC providers");
  const plan = await buildPlan(Number(argv[nonceFlag + 1]));
  await mkdir(outputRoot, { recursive: true });
  const body = `${JSON.stringify(plan, null, 2)}\n`;
  const path = resolve(outputRoot, "transaction-plan.json");
  await writeFile(path, body, "utf8");
  console.log(`Unsigned seven-transaction full-scale V3 plan for starting nonce ${plan.startingNonce}.`);
  for (const transaction of plan.transactions) {
    const target = transaction.to ? `to ${transaction.to}` : `creates ${transaction.predictedAddress}`;
    console.log(`  nonce ${transaction.nonce}: ${transaction.label}; ${target}; sha256 ${transaction.dataSha256.slice(0, 16)}`);
  }
  console.log(`Plan: ${path}`);
  console.log(`Plan sha256: ${sha256(body)}`);
  console.log("Nothing was signed or broadcast.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Full-scale V3 transaction plan failed: ${error.message}`);
    process.exitCode = 1;
  });
}
