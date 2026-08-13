import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  EXPECTED_COMPILER,
  EXPECTED_SETTINGS,
  EXPLORER_API,
  VERIFICATION_ROUTE,
  canonicalType,
  constructorSignature,
} from "../deployment/verification-bundle.mjs";
import { findFoundryBinaries, runCommand } from "../deployment/localhost-preview.mjs";

export const CHAIN_ID = 4663;
const PLACEHOLDER_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output/verification");

export const CONTRACTS = [
  { name: "DoomLaunchDeployerV2", addressKey: "curveDeployer" },
  { name: "PositionLockerV2", addressKey: "positionLocker" },
  { name: "V3GraduationManagerV2", addressKey: "graduationManager" },
  { name: "DoomLaunchFactoryV2", addressKey: "launchFactory" },
];

const sha256 = value => createHash("sha256").update(value).digest("hex");
const lower = value => String(value || "").toLowerCase();
const readJson = async path => JSON.parse(await readFile(path, "utf8"));

export function validateDeploymentEvidence(plan, record, manifest) {
  const errors = [];
  const requireValue = (condition, message) => {
    if (!condition) errors.push(message);
  };
  requireValue(plan?.chainId === CHAIN_ID, "transaction plan chain ID must be 4663");
  requireValue(record?.chainId === CHAIN_ID, "deployment record chain ID must be 4663");
  requireValue(record?.status === "v2_mainnet_deployment_verified_paused", "deployment record must be verified and paused");
  requireValue(record?.verification?.allRuntimeBytecodesMatch === true, "deployment record must confirm all runtime bytecodes");
  requireValue(record?.verification?.factoryPaused === true, "factory must still be recorded as paused");
  requireValue(record?.verification?.factoryLaunchCount === 0, "factory launch count must still be zero");
  requireValue(record?.contractDigest === manifest?.source?.contractDigest, "contract digest differs between deployment records");

  const creates = new Map(
    (plan?.transactions || []).filter(transaction => transaction.kind === "CREATE" || transaction.type === "CREATE")
      .map(transaction => [transaction.contract, transaction]),
  );
  for (const contract of CONTRACTS) {
    const transaction = creates.get(contract.name);
    const address = record?.addresses?.[contract.addressKey];
    requireValue(Boolean(transaction), `${contract.name} CREATE transaction is missing`);
    requireValue(ADDRESS.test(address || ""), `${contract.name} deployed address is malformed`);
    requireValue(lower(transaction?.predictedAddress) === lower(address), `${contract.name} address differs from the frozen transaction plan`);
    requireValue(/^0x[0-9a-fA-F]*$/.test(transaction?.encodedConstructorArguments || ""), `${contract.name} constructor arguments are missing`);
    requireValue(/^constructor\(/.test(transaction?.constructorSignature || ""), `${contract.name} constructor signature is missing`);
  }
  return errors;
}

export function validateCompilerInput(input, contractName) {
  const errors = [];
  const requireValue = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const sourcePath = `src/${contractName}.sol`;
  requireValue(input?.language === "Solidity", "compiler input language must be Solidity");
  requireValue(input?.settings?.optimizer?.enabled === EXPECTED_SETTINGS.optimizer.enabled, "optimizer must stay enabled");
  requireValue(input?.settings?.optimizer?.runs === EXPECTED_SETTINGS.optimizer.runs, "optimizer runs must stay 200");
  requireValue(input?.settings?.viaIR === EXPECTED_SETTINGS.viaIR, "viaIR must stay enabled");
  requireValue(input?.settings?.evmVersion === EXPECTED_SETTINGS.evmVersion, "EVM version must stay cancun");
  requireValue(input?.settings?.metadata?.bytecodeHash === EXPECTED_SETTINGS.bytecodeHash, "metadata hash mode must stay ipfs");
  requireValue(Boolean(input?.sources?.[sourcePath]?.content), `compiler input is missing ${sourcePath}`);
  for (const [path, source] of Object.entries(input?.sources || {})) {
    requireValue(typeof source?.content === "string" && source.content.length > 0, `source ${path} is not inlined`);
    requireValue(!/^[A-Za-z]:[\\/]/.test(path) && !path.startsWith("/"), `source path ${path} is absolute`);
  }
  const serialized = JSON.stringify(input);
  for (const [label, pattern] of [
    ["Alchemy endpoint", /alchemy(api)?\.com/i],
    ["QuickNode endpoint", /qui[ck]?node/i],
    ["Infura endpoint", /infura\.io/i],
    ["API key", /api[_-]?key/i],
    ["Telegram bot token", /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/],
    ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY/],
  ]) {
    requireValue(!pattern.test(serialized), `compiler input appears to contain a ${label}`);
  }
  return errors;
}

export function localPathRemappingCount(input) {
  return (input?.settings?.remappings || []).filter(value => /[A-Za-z]:[\\/]/.test(value)).length;
}

export function validateArtifactAgainstPlan(artifact, transaction) {
  const errors = [];
  const signature = constructorSignature(artifact?.abi || []);
  if (signature !== transaction?.constructorSignature) {
    errors.push(`constructor signature differs: compiled ${signature}, planned ${transaction?.constructorSignature}`);
  }
  const creation = lower(artifact?.bytecode?.object);
  const encoded = lower(transaction?.encodedConstructorArguments).replace(/^0x/, "");
  if (!creation.startsWith("0x") || lower(transaction?.data) !== `${creation}${encoded}`) {
    errors.push("compiled creation bytecode plus constructor arguments differs from the deployed transaction plan");
  }
  return errors;
}

async function generateStandardInput(forge, contractName) {
  const { stdout } = await runCommand(forge, [
    "verify-contract",
    "--root",
    "v2",
    "--show-standard-json-input",
    PLACEHOLDER_ADDRESS,
    `src/${contractName}.sol:${contractName}`,
  ], { cwd: projectRoot });
  const text = stdout.replace(/^\ufeff/, "").trim();
  return { text, input: JSON.parse(text) };
}

export async function main() {
  const [plan, record, manifest] = await Promise.all([
    readJson(resolve(directory, "output/transaction-plan.json")),
    readJson(resolve(projectRoot, "config/v2-mainnet-deployment-record.json")),
    readJson(resolve(projectRoot, "config/v2-mainnet-deployment-manifest.json")),
  ]);
  const evidenceErrors = validateDeploymentEvidence(plan, record, manifest);
  if (evidenceErrors.length) throw new Error(evidenceErrors.join("; "));

  const creates = new Map(
    plan.transactions.filter(transaction => transaction.kind === "CREATE" || transaction.type === "CREATE")
      .map(transaction => [transaction.contract, transaction]),
  );
  const foundry = findFoundryBinaries();
  await mkdir(outputRoot, { recursive: true });
  const generatedAt = new Date().toISOString();
  const contracts = [];

  for (const contract of CONTRACTS) {
    const transaction = creates.get(contract.name);
    const artifact = await readJson(
      resolve(projectRoot, "v2/out", `${contract.name}.sol`, `${contract.name}.json`),
    );
    const compiler = artifact?.metadata?.compiler?.version;
    if (compiler !== EXPECTED_COMPILER) {
      throw new Error(`${contract.name} was compiled with ${compiler}, expected ${EXPECTED_COMPILER}`);
    }
    const artifactErrors = validateArtifactAgainstPlan(artifact, transaction);
    if (artifactErrors.length) throw new Error(`${contract.name}: ${artifactErrors.join("; ")}`);

    const { text, input } = await generateStandardInput(foundry.forge, contract.name);
    const inputErrors = validateCompilerInput(input, contract.name);
    if (inputErrors.length) throw new Error(`${contract.name}: ${inputErrors.join("; ")}`);
    const inputFile = `${contract.name}.standard-input.json`;
    const body = `${text}\n`;
    await writeFile(resolve(outputRoot, inputFile), body, "utf8");
    const runtime = artifact?.deployedBytecode?.object || "0x";
    contracts.push({
      name: contract.name,
      sourcePath: `src/${contract.name}.sol:${contract.name}`,
      deployedAddress: record.addresses[contract.addressKey],
      deploymentTransactionHash: record.transactions.find(item => item.label === `Deploy ${contract.name}`)?.transactionHash || null,
      compilerVersion: `v${EXPECTED_COMPILER}`,
      standardInputFile: inputFile,
      standardInputSha256: sha256(body),
      sourceFileCount: Object.keys(input.sources).length,
      constructorSignature: transaction.constructorSignature,
      constructorArgumentValues: transaction.constructorArgumentValues,
      encodedConstructorArguments: transaction.encodedConstructorArguments,
      artifactRuntimeBytes: (runtime.length - 2) / 2,
      artifactRuntimeSha256: sha256(lower(runtime)),
      localPathRemappingCount: localPathRemappingCount(input),
      submittedToExplorer: false,
      verifiedOnExplorer: false,
    });
  }

  const privacyWarning = contracts.some(contract => contract.localPathRemappingCount > 0);
  const bundle = {
    schemaVersion: 1,
    status: "v2_verification_bundle_ready_for_owner_review",
    generatedAt,
    chainId: CHAIN_ID,
    sourceCommit: manifest.source.candidateCommit,
    contractDigest: record.contractDigest,
    deploymentRecordStatus: record.status,
    safety: {
      networkWrites: false,
      explorerSubmission: false,
      signerLoaded: false,
      factoryResumeAuthorized: false,
      tokenLaunchAuthorized: false,
    },
    explorer: {
      apiHost: EXPLORER_API,
      verificationRoute: VERIFICATION_ROUTE,
      checked: false,
    },
    privacy: {
      containsRpcCredentials: false,
      containsPrivateKeys: false,
      containsLocalBuildPathRemappings: privacyWarning,
      warning: privacyWarning
        ? "The exact deployed compiler metadata contains local build-path remappings. Owner approval is required before public explorer submission."
        : null,
    },
    contracts,
    warning: "Prepared only. Nothing was submitted to Blockscout, the factory remains paused, and no launch was authorized.",
  };
  const bundlePath = resolve(outputRoot, "bundle-manifest.json");
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  console.log("V2 Blockscout verification bundle generated locally.");
  console.log(`Compiler: v${EXPECTED_COMPILER}`);
  console.log(`Contracts: ${contracts.length}`);
  console.log(`Local-path remappings present: ${privacyWarning ? "yes — review before submission" : "no"}`);
  console.log(`Bundle: ${bundlePath}`);
  console.log("Nothing was submitted and no transaction was signed.");
  return bundle;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`V2 verification bundle failed: ${error.message}`);
    process.exitCode = 1;
  });
}
