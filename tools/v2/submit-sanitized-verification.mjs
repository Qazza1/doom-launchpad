import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CONTRACTS,
  localPathRemappingCount,
  sanitizeLocalRemappings,
  validateCompilerInput,
} from "./verification-bundle.mjs";

const EXPLORER = "https://robinhoodchain.blockscout.com";
const directory = dirname(fileURLToPath(import.meta.url));
const outputRoot = resolve(directory, "output/verification");
const sleep = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

async function responseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function getContract(address) {
  const response = await fetch(`${EXPLORER}/api/v2/smart-contracts/${address}`, {
    headers: { accept: "application/json" },
  });
  const body = await responseBody(response);
  if (!response.ok) return { httpStatus: response.status, is_verified: false, error: body };
  return { httpStatus: response.status, ...body };
}

function publicStatus(contract, address) {
  return {
    address: contract.address_hash || contract.address || address,
    name: contract.name || null,
    isVerified: contract.is_verified === true,
    isFullyVerified: contract.is_fully_verified === true,
    isPartiallyVerified: contract.is_partially_verified === true,
    compilerVersion: contract.compiler_version || null,
    verifiedAt: contract.verified_at || null,
  };
}

async function waitForVerification(address, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await getContract(address);
    if (latest.is_verified === true) return latest;
    await sleep(3_000);
  }
  throw new Error(`Blockscout did not report ${address} verified within ${timeoutMs / 1000} seconds`);
}

function assertSanitized(input, contractName) {
  const errors = validateCompilerInput(input, contractName);
  if (errors.length) throw new Error(`${contractName}: ${errors.join("; ")}`);
  if (localPathRemappingCount(input) !== 0) throw new Error(`${contractName}: local remapping remains`);
  const serialized = JSON.stringify(input);
  if (/[A-Za-z]:[\\/]Users[\\/]/i.test(serialized)) {
    throw new Error(`${contractName}: compiler input still contains a local user path`);
  }
}

async function submit(contract, input) {
  const form = new FormData();
  form.append("compiler_version", contract.compilerVersion);
  form.append("contract_name", contract.name);
  form.append("files[0]", new Blob([`${JSON.stringify(input)}\n`], { type: "application/json" }), `${contract.name}.standard-input.json`);
  form.append("autodetect_constructor_args", "false");
  form.append("constructor_args", contract.encodedConstructorArguments.replace(/^0x/, ""));
  form.append("license_type", "mit");
  const response = await fetch(
    `${EXPLORER}/api/v2/smart-contracts/${contract.deployedAddress}/verification/via/standard-input`,
    { method: "POST", headers: { accept: "application/json" }, body: form },
  );
  const body = await responseBody(response);
  if (!response.ok) {
    await sleep(1_000);
    const current = await getContract(contract.deployedAddress);
    if (current.is_verified === true) {
      return { httpStatus: response.status, body, acceptedDespiteErrorResponse: true };
    }
    throw new Error(`${contract.name}: Blockscout HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return { httpStatus: response.status, body, acceptedDespiteErrorResponse: false };
}

export async function main() {
  const statusOnly = process.argv.includes("--status-only");
  if (!statusOnly && !process.argv.includes("--confirm-publication")) {
    throw new Error("refusing public submission without --confirm-publication");
  }
  const bundle = JSON.parse(await readFile(resolve(outputRoot, "bundle-manifest.json"), "utf8"));
  if (bundle.chainId !== 4663 || bundle.safety?.factoryResumeAuthorized !== false || bundle.safety?.tokenLaunchAuthorized !== false) {
    throw new Error("verification bundle safety posture is not the expected paused V2 deployment");
  }

  const configResponse = await fetch(`${EXPLORER}/api/v2/smart-contracts/verification/config`, {
    headers: { accept: "application/json" },
  });
  if (!configResponse.ok) throw new Error(`Blockscout verification service returned HTTP ${configResponse.status}`);

  const results = [];
  for (const definition of CONTRACTS) {
    const contract = bundle.contracts.find(item => item.name === definition.name);
    if (!contract) throw new Error(`${definition.name} is absent from the bundle`);
    const current = await getContract(contract.deployedAddress);
    if (statusOnly) {
      results.push({ contract: contract.name, submitted: false, status: publicStatus(current, contract.deployedAddress) });
      continue;
    }
    if (current.is_verified === true) {
      results.push({ contract: contract.name, submitted: false, status: publicStatus(current, contract.deployedAddress) });
      continue;
    }

    const exact = JSON.parse(await readFile(resolve(outputRoot, contract.standardInputFile), "utf8"));
    const sanitized = sanitizeLocalRemappings(exact);
    assertSanitized(sanitized, contract.name);
    const submission = await submit(contract, sanitized);
    const verified = await waitForVerification(contract.deployedAddress);
    results.push({ contract: contract.name, submitted: true, submission, status: publicStatus(verified, contract.deployedAddress) });
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    explorer: EXPLORER,
    chainId: 4663,
    publication: "privacy_sanitized_standard_input",
    factoryResumeAuthorized: false,
    tokenLaunchAuthorized: false,
    results,
  };
  await mkdir(outputRoot, { recursive: true });
  const reportFile = statusOnly ? "status-snapshot.json" : "submission-result.json";
  await writeFile(resolve(outputRoot, reportFile), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`V2 Blockscout submission failed: ${error.message}`);
    process.exitCode = 1;
  });
}
