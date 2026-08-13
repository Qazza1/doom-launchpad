import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findFoundryBinaries, runCommand } from "../deployment/localhost-preview.mjs";
import { castArgument, constructorSignature } from "../deployment/verification-bundle.mjs";
import { validateV2Manifest } from "./verify-manifest.mjs";

export const CHAIN_ID = 4663;
export const DEPLOYER = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output");
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const strip = hex => (hex.startsWith("0x") ? hex.slice(2) : hex);
const lower = value => String(value ?? "").toLowerCase();
const sha256 = value => createHash("sha256").update(value).digest("hex");

export const STEPS = [
  { order: 0, kind: "CREATE", contract: "DoomLaunchDeployerV2" },
  { order: 1, kind: "CREATE", contract: "PositionLockerV2" },
  { order: 2, kind: "CREATE", contract: "V3GraduationManagerV2" },
  { order: 3, kind: "CALL", contract: "PositionLockerV2", fn: "bindRegistrar(address)", irreversible: true },
  { order: 4, kind: "CREATE", contract: "DoomLaunchFactoryV2" },
  { order: 5, kind: "CALL", contract: "DoomLaunchDeployerV2", fn: "bindFactory(address)", irreversible: true },
  { order: 6, kind: "CALL", contract: "V3GraduationManagerV2", fn: "bindFactory(address)", irreversible: true },
];

const addressWord = data => `0x${strip(data).slice(8).slice(24)}`.toLowerCase();

export function validatePlan(plan) {
  const errors = [];
  const requireValue = (condition, message) => {
    if (!condition) errors.push(message);
  };
  requireValue(plan?.chainId === CHAIN_ID, "the plan must target chain 4663");
  requireValue(plan?.transactions?.length === STEPS.length, "the plan must contain exactly seven transactions");
  if (plan?.transactions?.length !== STEPS.length) return errors;

  for (const [index, step] of STEPS.entries()) {
    const transaction = plan.transactions[index];
    const label = `transaction ${index}`;
    requireValue(transaction.nonce === plan.startingNonce + index, `${label} has a non-sequential nonce`);
    requireValue(lower(transaction.from) === lower(DEPLOYER), `${label} has the wrong sender`);
    requireValue(transaction.value === "0x0", `${label} must not transfer value`);
    requireValue(transaction.kind === step.kind, `${label} has the wrong kind`);
    requireValue(/^0x[0-9a-f]*$/i.test(transaction.data || ""), `${label} has malformed calldata`);
    if (step.kind === "CREATE") {
      requireValue(transaction.to === null, `${label} must be a contract creation`);
      requireValue(ADDRESS.test(transaction.predictedAddress || ""), `${label} is missing its predicted address`);
      requireValue(strip(transaction.data).length > 0, `${label} has empty creation code`);
      requireValue(
        strip(transaction.data).endsWith(strip(transaction.encodedConstructorArguments || "")),
        `${label} creation code does not end with its encoded constructor arguments`,
      );
    } else {
      requireValue(ADDRESS.test(transaction.to || ""), `${label} must call a concrete address`);
      requireValue(transaction.predictedAddress === null, `${label} must not create a contract`);
      requireValue(strip(transaction.data).length === 72, `${label} calldata is not a single address argument`);
    }
  }

  const created = Object.fromEntries(
    plan.transactions.filter(tx => tx.kind === "CREATE").map(tx => [tx.contract, lower(tx.predictedAddress)]),
  );
  const bindings = [
    [3, created.PositionLockerV2, created.V3GraduationManagerV2, "registrar"],
    [5, created.DoomLaunchDeployerV2, created.DoomLaunchFactoryV2, "deployer factory"],
    [6, created.V3GraduationManagerV2, created.DoomLaunchFactoryV2, "manager factory"],
  ];
  for (const [index, target, argument, label] of bindings) {
    requireValue(lower(plan.transactions[index].to) === target, `${label} binding has the wrong target`);
    requireValue(addressWord(plan.transactions[index].data) === argument, `${label} binding has the wrong argument`);
  }
  return errors;
}

export function validateDependencyWiring(plan) {
  const errors = [];
  const created = Object.fromEntries(
    plan.transactions.filter(tx => tx.kind === "CREATE").map(tx => [tx.contract, lower(tx.predictedAddress)]),
  );
  const argumentsOf = name =>
    plan.transactions.find(tx => tx.kind === "CREATE" && tx.contract === name)
      ?.constructorArgumentValues?.flat(Infinity).map(lower) || [];
  if (!argumentsOf("V3GraduationManagerV2").includes(created.PositionLockerV2)) {
    errors.push("V3GraduationManagerV2 was not given the predicted PositionLockerV2 address");
  }
  const factoryArguments = argumentsOf("DoomLaunchFactoryV2");
  for (const name of ["DoomLaunchDeployerV2", "V3GraduationManagerV2"]) {
    if (!factoryArguments.includes(created[name])) {
      errors.push(`DoomLaunchFactoryV2 was not given the predicted ${name} address`);
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
  const manifest = await readJson(resolve(projectRoot, "config/v2-mainnet-deployment-manifest.json"));
  const manifestErrors = validateV2Manifest(manifest);
  if (manifestErrors.length) throw new Error(`the V2 manifest is not fail-closed: ${manifestErrors.join("; ")}`);

  const foundry = findFoundryBinaries();
  const predicted = {};
  for (const step of STEPS.filter(item => item.kind === "CREATE")) {
    predicted[step.contract] = await computeAddress(foundry.cast, startingNonce + step.order);
  }
  const roles = manifest.roles;
  const dependencies = manifest.dependencies;
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
    DoomLaunchFactoryV2: [[
      roles.operator,
      roles.emergencyGuardian,
      roles.initialApprovedCreator,
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
      const encoded = stdout.trim();
      const creationCode = artifact.bytecode?.object || "0x";
      if (!strip(creationCode)) throw new Error(`${step.contract} has no creation code; run the V2 build first`);
      const data = `${creationCode}${strip(encoded)}`;
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
        data,
        dataSha256: sha256(data),
      });
      continue;
    }
    const targetByStep = {
      3: predicted.PositionLockerV2,
      5: predicted.DoomLaunchDeployerV2,
      6: predicted.V3GraduationManagerV2,
    };
    const argument = step.order === 3 ? predicted.V3GraduationManagerV2 : predicted.DoomLaunchFactoryV2;
    const { stdout } = await runCommand(foundry.cast, ["calldata", step.fn, argument]);
    const data = stdout.trim();
    transactions.push({
      order: step.order,
      kind: step.kind,
      contract: step.contract,
      label: `${step.contract}.${step.fn}`,
      irreversible: true,
      from: DEPLOYER,
      to: targetByStep[step.order],
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
    status: "unsigned_v2_transaction_plan",
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
    warning: "Unsigned V2 plan only. Re-plan if the deployer pending nonce changes. Stop after any failed receipt or postcondition.",
  };
  const errors = [...validatePlan(plan), ...validateDependencyWiring(plan)];
  if (errors.length) throw new Error(errors.join("; "));
  return plan;
}

export async function main(argv = process.argv.slice(2)) {
  const nonceFlag = argv.indexOf("--nonce");
  if (nonceFlag === -1) throw new Error("--nonce is required and must be confirmed through both providers");
  const plan = await buildPlan(Number(argv[nonceFlag + 1]));
  await mkdir(outputRoot, { recursive: true });
  const body = `${JSON.stringify(plan, null, 2)}\n`;
  const path = resolve(outputRoot, "transaction-plan.json");
  await writeFile(path, body, "utf8");
  console.log(`Unsigned seven-transaction V2 plan for starting nonce ${plan.startingNonce}.`);
  for (const tx of plan.transactions) {
    const target = tx.to ? `to ${tx.to}` : `creates ${tx.predictedAddress}`;
    console.log(`  nonce ${tx.nonce}: ${tx.label}; ${target}; sha256 ${tx.dataSha256.slice(0, 16)}`);
  }
  console.log(`Plan: ${path}`);
  console.log(`Plan sha256: ${sha256(body)}`);
  console.log("Nothing was signed or broadcast. Re-plan if the pending nonce changes.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`V2 transaction plan failed: ${error.message}`);
    process.exitCode = 1;
  });
}
