import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findFoundryBinaries, runCommand } from "./localhost-preview.mjs";
import { validatePredeploymentManifest } from "./verify-manifest.mjs";

export const CHAIN_ID = 4663;
export const EXPECTED_COMPILER = "0.8.36+commit.8a079791";
export const EXPECTED_SETTINGS = {
  optimizer: { enabled: true, runs: 200 },
  viaIR: true,
  evmVersion: "cancun",
  bytecodeHash: "ipfs",
};
export const EXPLORER_API = "https://robinhoodchain.blockscout.com";
export const VERIFICATION_ROUTE = "/api/v2/smart-contracts/{address}/verification/via/standard-input";

/// The verification bundle never derives an address. Blockscout only needs the compiler input,
/// so `--show-standard-json-input` is invoked with an all-zero placeholder that is never stored.
const PLACEHOLDER_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_ADDRESS = PLACEHOLDER_ADDRESS;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output/verification");

export const CONTRACTS = [
  { name: "DoomRewards", path: "src/DoomRewards.sol" },
  { name: "PositionLocker", path: "src/PositionLocker.sol" },
  { name: "V3LiquidityManager", path: "src/V3LiquidityManager.sol" },
  { name: "DoomLaunchFactory", path: "src/DoomLaunchFactory.sol" },
];

const SECRET_PATTERNS = [
  { label: "Alchemy endpoint", pattern: /alchemy(api)?\.com/i },
  { label: "QuickNode endpoint", pattern: /qui[ck]?node/i },
  { label: "Infura endpoint", pattern: /infura\.io/i },
  { label: "API key", pattern: /api[_-]?key/i },
  { label: "Telegram bot token", pattern: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/ },
  { label: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY/ },
  { label: "Windows absolute path", pattern: /[A-Za-z]:\\{1,2}Users/i },
  { label: "POSIX home path", pattern: /\/(home|Users)\/[A-Za-z0-9._-]+\// },
];

const sha256 = value => createHash("sha256").update(value).digest("hex");

/// Renders one ABI input as its canonical Solidity type, expanding structs into tuples.
export function canonicalType(input) {
  if (!input?.type?.startsWith("tuple")) return input?.type;
  const components = (input.components || []).map(canonicalType).join(",");
  return `(${components})${input.type.slice("tuple".length)}`;
}

/// Derives the constructor signature from the compiled ABI. Never hand-write this: `maxLaunches`
/// is a `uint32`, and encoding it as `uint256` silently produces arguments Blockscout rejects.
export function constructorSignature(abi) {
  const entry = (abi || []).find(item => item.type === "constructor");
  if (!entry) throw new Error("the compiled ABI has no constructor");
  return `constructor(${(entry.inputs || []).map(canonicalType).join(",")})`;
}

export function castArgument(value) {
  if (Array.isArray(value)) return `(${value.map(castArgument).join(",")})`;
  return String(value);
}

/// Cross-checks the two committed configuration files so one drifting address cannot reach the
/// encoded constructor arguments unnoticed.
export function resolveDeploymentInputs(manifest, decisions) {
  const errors = [];
  const same = (left, right) => String(left).toLowerCase() === String(right).toLowerCase();
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };

  require(manifest?.network?.chainId === CHAIN_ID, "manifest chain ID must be 4663");
  require(decisions?.network?.chainId === CHAIN_ID, "decisions chain ID must be 4663");
  for (const role of ["deployer", "operator", "treasury", "campaignManager", "emergencyGuardian"]) {
    require(
      same(manifest?.roles?.[role], decisions?.roles?.[role]),
      `roles.${role} differs between the manifest and the canary decisions`,
    );
  }
  require(
    same(manifest?.dependencies?.nftCollection, decisions?.nftRewards?.collection),
    "the NFT collection differs between the manifest and the canary decisions",
  );
  require(
    same(manifest?.dependencies?.excludedNftHolder, decisions?.nftRewards?.excludedHolder),
    "the excluded holder differs between the manifest and the canary decisions",
  );
  require(
    same(manifest?.dependencies?.wrappedNative, decisions?.liquidity?.weth),
    "the wrapped native token differs between the manifest and the canary decisions",
  );
  require(
    same(manifest?.dependencies?.uniswapV3Factory, decisions?.liquidity?.factory),
    "the V3 factory differs between the manifest and the canary decisions",
  );
  require(
    same(
      manifest?.dependencies?.nonfungiblePositionManager,
      decisions?.liquidity?.nonfungiblePositionManager,
    ),
    "the position manager differs between the manifest and the canary decisions",
  );
  require(
    same(manifest?.roles?.approvedCreator, decisions?.pilotLimits?.approvedCreator),
    "the approved creator differs between the manifest and the canary decisions",
  );
  if (errors.length) return { errors, inputs: null };

  return {
    errors,
    inputs: {
      chainId: CHAIN_ID,
      deployer: manifest.roles.deployer,
      operator: manifest.roles.operator,
      treasury: manifest.roles.treasury,
      campaignManager: manifest.roles.campaignManager,
      emergencyGuardian: manifest.roles.emergencyGuardian,
      approvedCreator: manifest.roles.approvedCreator,
      nftCollection: manifest.dependencies.nftCollection,
      wrappedNative: manifest.dependencies.wrappedNative,
      uniswapV3Factory: manifest.dependencies.uniswapV3Factory,
      nonfungiblePositionManager: manifest.dependencies.nonfungiblePositionManager,
      minimumClaimWindowSeconds: decisions.rewardCampaigns.minimumClaimWindowSeconds,
      maxLaunches: decisions.pilotLimits.maxLaunches,
      maxNativeLiquidityPerLaunchWei: decisions.pilotLimits.maxNativeLiquidityPerLaunchWei,
      maxNativeLiquidityGlobalWei: decisions.pilotLimits.maxNativeLiquidityGlobalWei,
    },
  };
}

/// Builds the constructor argument values for every contract. `deployed` carries the three
/// addresses that only exist after transactions 1-3, so this fails closed when any is missing.
export function planConstructorArguments(inputs, deployed) {
  const errors = [];
  for (const name of ["DoomRewards", "PositionLocker", "V3LiquidityManager"]) {
    const value = deployed?.[name];
    if (!ADDRESS.test(value || "")) {
      errors.push(`${name} address is missing or malformed`);
    } else if (value.toLowerCase() === ZERO_ADDRESS) {
      errors.push(`${name} address must not be the zero address`);
    }
  }
  if (errors.length) return { errors, values: null };

  return {
    errors,
    values: {
      DoomRewards: [
        inputs.campaignManager,
        inputs.nftCollection,
        inputs.treasury,
        inputs.wrappedNative,
        String(inputs.minimumClaimWindowSeconds),
      ],
      PositionLocker: [
        inputs.nonfungiblePositionManager,
        inputs.wrappedNative,
        deployed.DoomRewards,
        inputs.treasury,
        inputs.deployer,
      ],
      V3LiquidityManager: [
        String(inputs.chainId),
        inputs.deployer,
        inputs.uniswapV3Factory,
        inputs.nonfungiblePositionManager,
        inputs.wrappedNative,
        deployed.PositionLocker,
      ],
      DoomLaunchFactory: [[
        inputs.operator,
        inputs.emergencyGuardian,
        inputs.approvedCreator,
        inputs.treasury,
        deployed.DoomRewards,
        inputs.wrappedNative,
        deployed.V3LiquidityManager,
        deployed.PositionLocker,
        String(inputs.maxLaunches),
        String(inputs.maxNativeLiquidityPerLaunchWei),
        String(inputs.maxNativeLiquidityGlobalWei),
      ]],
    },
  };
}

/// A settings mismatch is the most common cause of a failed Blockscout verification, so the
/// generated compiler input is checked against the frozen pins before it can leave the tool.
export function validateStandardJsonInput(input, contractPath, rawText = "") {
  const errors = [];
  const require = (condition, message) => {
    if (!condition) errors.push(message);
  };

  require(input?.language === "Solidity", "compiler input language must be Solidity");
  require(
    input?.settings?.optimizer?.enabled === EXPECTED_SETTINGS.optimizer.enabled,
    "optimizer must stay enabled",
  );
  require(
    input?.settings?.optimizer?.runs === EXPECTED_SETTINGS.optimizer.runs,
    `optimizer runs must be ${EXPECTED_SETTINGS.optimizer.runs}`,
  );
  require(input?.settings?.viaIR === EXPECTED_SETTINGS.viaIR, "viaIR must stay enabled");
  require(
    input?.settings?.evmVersion === EXPECTED_SETTINGS.evmVersion,
    `evmVersion must be ${EXPECTED_SETTINGS.evmVersion}`,
  );
  require(
    input?.settings?.metadata?.bytecodeHash === EXPECTED_SETTINGS.bytecodeHash,
    `metadata bytecodeHash must be ${EXPECTED_SETTINGS.bytecodeHash}`,
  );

  const sources = input?.sources || {};
  require(Object.keys(sources).length > 0, "compiler input contains no sources");
  require(
    Object.prototype.hasOwnProperty.call(sources, contractPath),
    `compiler input is missing ${contractPath}`,
  );
  for (const [path, source] of Object.entries(sources)) {
    if (typeof source?.content !== "string" || source.content.length === 0) {
      errors.push(`source ${path} has no inlined content`);
    }
    if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/")) {
      errors.push(`source path ${path} is absolute and will not verify`);
    }
  }

  if (rawText.charCodeAt(0) === 0xfeff) {
    errors.push("compiler input starts with a byte-order mark and Blockscout will reject it");
  }
  errors.push(...findSecrets(rawText || JSON.stringify(input)));

  return errors;
}

export function findSecrets(text) {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => `compiler input appears to contain a ${label}`);
}

/// Zeroes every immutable range so deployed code can be compared with the compiled artifact.
/// Immutables are written at construction time, so an unmasked comparison always fails.
export function maskImmutables(code, immutableReferences) {
  const body = (code || "").startsWith("0x") ? code.slice(2) : code || "";
  if (body.length % 2 !== 0 || /[^0-9a-fA-F]/.test(body)) {
    throw new Error("runtime bytecode is not a hex string");
  }
  const bytes = Buffer.from(body, "hex");
  for (const references of Object.values(immutableReferences || {})) {
    for (const { start, length } of references) {
      if (start < 0 || start + length > bytes.length) {
        throw new Error("an immutable reference lies outside the runtime bytecode");
      }
      bytes.fill(0, start, start + length);
    }
  }
  return `0x${bytes.toString("hex")}`;
}

export function compareRuntimeBytecode(onchainCode, artifactCode, immutableReferences) {
  const onchain = (onchainCode || "").toLowerCase();
  const artifact = (artifactCode || "").toLowerCase();
  if (onchain === "0x" || onchain === "") {
    return { matches: false, reason: "no runtime bytecode was returned for the address" };
  }
  if (onchain.length !== artifact.length) {
    return { matches: false, reason: "deployed runtime length differs from the compiled artifact" };
  }
  const maskedOnchain = maskImmutables(onchain, immutableReferences);
  const maskedArtifact = maskImmutables(artifact, immutableReferences);
  if (maskedOnchain !== maskedArtifact) {
    return { matches: false, reason: "runtime bytecode differs outside the immutable ranges" };
  }
  return { matches: true, reason: "runtime bytecode matches once immutables are masked" };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function generateStandardJsonInput(forge, contract) {
  const { stdout } = await runCommand(forge, [
    "verify-contract",
    "--show-standard-json-input",
    PLACEHOLDER_ADDRESS,
    `${contract.path}:${contract.name}`,
  ]);
  const text = stdout.replace(/^﻿/, "").trim();
  return { text, input: JSON.parse(text) };
}

async function encodeConstructorArguments(cast, signature, values) {
  const { stdout } = await runCommand(cast, [
    "abi-encode",
    signature,
    ...values.map(castArgument),
  ]);
  const encoded = stdout.trim();
  if (!/^0x[0-9a-fA-F]*$/.test(encoded)) {
    throw new Error("cast did not return encoded constructor arguments");
  }
  return encoded;
}

export async function checkExplorerSupport(fetchImpl = fetch) {
  const response = await fetchImpl(`${EXPLORER_API}/api/v2/smart-contracts/verification/config`, {
    method: "GET",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`explorer returned HTTP ${response.status}`);
  const config = await response.json();
  const options = config?.verification_options || [];
  const compilers = config?.solidity_compiler_versions || [];
  const errors = [];
  if (!options.includes("standard-input")) {
    errors.push("the explorer does not offer standard-input verification");
  }
  if (!compilers.includes(`v${EXPECTED_COMPILER}`)) {
    errors.push(`the explorer does not offer solc v${EXPECTED_COMPILER}`);
  }
  return {
    errors,
    standardInputSupported: options.includes("standard-input"),
    compilerAvailable: compilers.includes(`v${EXPECTED_COMPILER}`),
    compilerCount: compilers.length,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const addressesFlag = argv.indexOf("--addresses");
  const addressesPath = addressesFlag === -1 ? null : argv[addressesFlag + 1];
  const checkExplorer = argv.includes("--check-explorer");

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

  let deployed;
  let addressSource;
  let addressesAreFinal;
  if (addressesPath) {
    deployed = await readJson(resolve(process.cwd(), addressesPath));
    addressSource = "operator_supplied_addresses";
    addressesAreFinal = deployed.final === true;
    delete deployed.final;
  } else {
    const report = await readJson(resolve(directory, "output/latest-report.json"));
    deployed = Object.fromEntries(
      report.transactions
        .filter(transaction => transaction.type === "CREATE")
        .map(transaction => [transaction.contract, transaction.predictedAddress]),
    );
    addressSource = `localhost_preview_snapshot:${report.sourceCommit}`;
    addressesAreFinal = false;
  }
  const { errors: argumentErrors, values } = planConstructorArguments(inputs, deployed);
  if (argumentErrors.length) throw new Error(argumentErrors.join("; "));

  const foundry = findFoundryBinaries();
  await mkdir(outputRoot, { recursive: true });
  const generatedAt = new Date().toISOString();
  const contracts = [];

  for (const contract of CONTRACTS) {
    const { text, input } = await generateStandardJsonInput(foundry.forge, contract);
    const inputProblems = validateStandardJsonInput(input, contract.path, text);
    if (inputProblems.length) {
      throw new Error(`${contract.name}: ${inputProblems.join("; ")}`);
    }

    const artifact = await readJson(
      resolve(projectRoot, "out", `${contract.name}.sol`, `${contract.name}.json`),
    );
    const compiler = artifact?.metadata?.compiler?.version;
    if (compiler !== EXPECTED_COMPILER) {
      throw new Error(`${contract.name} was compiled with ${compiler}, expected ${EXPECTED_COMPILER}`);
    }

    const signature = constructorSignature(artifact.abi);
    const encoded = await encodeConstructorArguments(
      foundry.cast,
      signature,
      values[contract.name],
    );
    const inputFile = `${contract.name}.standard-input.json`;
    const body = `${text}\n`;
    await writeFile(resolve(outputRoot, inputFile), body, "utf8");

    const runtime = artifact.deployedBytecode?.object || "0x";
    const immutableReferences = artifact.deployedBytecode?.immutableReferences || {};
    contracts.push({
      name: contract.name,
      sourcePath: `${contract.path}:${contract.name}`,
      compilerVersion: `v${EXPECTED_COMPILER}`,
      standardInputFile: inputFile,
      standardInputSha256: sha256(body),
      sourceFileCount: Object.keys(input.sources).length,
      constructorSignature: signature,
      constructorArgumentValues: values[contract.name],
      encodedConstructorArguments: encoded,
      artifactRuntimeBytes: (runtime.length - 2) / 2,
      artifactRuntimeSha256: sha256(runtime.toLowerCase()),
      immutableRangeCount: Object.values(immutableReferences).flat().length,
      immutableReferences,
      deployedAddress: null,
      runtimeBytecodeCompared: false,
      submittedToExplorer: false,
      verifiedOnExplorer: false,
    });
  }

  let explorer = {
    apiHost: EXPLORER_API,
    apiHostSource: "linked by https://explorer.mainnet.chain.robinhood.com",
    verificationRoute: VERIFICATION_ROUTE,
    checked: false,
    standardInputSupported: null,
    compilerAvailable: null,
  };
  if (checkExplorer) {
    const support = await checkExplorerSupport();
    if (support.errors.length) throw new Error(support.errors.join("; "));
    explorer = {
      ...explorer,
      checked: true,
      checkedAt: generatedAt,
      standardInputSupported: support.standardInputSupported,
      compilerAvailable: support.compilerAvailable,
      offeredCompilerCount: support.compilerCount,
    };
  }

  const bundle = {
    schemaVersion: 1,
    status: "verification_bundle_rehearsal",
    generatedAt,
    safety: {
      networkWrites: false,
      explorerSubmission: false,
      signerLoaded: false,
      addressesAreFinal,
      mainnetDeploymentApproved: false,
    },
    addressSource,
    chainId: CHAIN_ID,
    explorer,
    contracts,
    warning:
      "Rehearsal bundle. Regenerate from the final reviewed commit with the real deployed addresses before verifying anything on the explorer.",
  };
  const bundlePath = resolve(outputRoot, "bundle-manifest.json");
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  console.log("Blockscout verification bundle generated.");
  console.log(`Compiler: v${EXPECTED_COMPILER}`);
  console.log(`Address source: ${addressSource}`);
  for (const contract of contracts) {
    console.log(
      `  ${contract.name}: ${contract.sourceFileCount} sources, ` +
        `${contract.artifactRuntimeBytes} runtime bytes, ` +
        `${contract.immutableRangeCount} immutable ranges, ` +
        `args ${contract.encodedConstructorArguments.length - 2} hex chars`,
    );
  }
  if (explorer.checked) {
    console.log(`Explorer offers standard-input verification and solc v${EXPECTED_COMPILER}.`);
  } else {
    console.log("Explorer support was not checked; rerun with --check-explorer.");
  }
  console.log(`Bundle: ${bundlePath}`);
  console.log("Nothing was submitted. This tool never posts to the explorer.");
  if (!addressesAreFinal) {
    console.log("Addresses are a rehearsal snapshot; regenerate them after the real deployment.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Verification bundle failed: ${error.message}`);
    process.exitCode = 1;
  });
}
