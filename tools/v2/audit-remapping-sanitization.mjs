import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONTRACTS, localPathRemappingCount, sanitizeLocalRemappings } from "./verification-bundle.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const bundleRoot = resolve(directory, "output/verification");
const sha256 = value => createHash("sha256").update(value).digest("hex");

function solcPath() {
  if (process.env.SOLC_BINARY) return process.env.SOLC_BINARY;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || resolve(homedir(), "AppData/Roaming");
    return resolve(appData, "svm/0.8.36/solc-0.8.36");
  }
  return "solc";
}

function compile(input) {
  const result = spawnSync(solcPath(), ["--standard-json"], {
    input: JSON.stringify(input),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `solc exited ${result.status}`);
  const output = JSON.parse(result.stdout);
  const failures = (output.errors || []).filter(item => item.severity === "error");
  if (failures.length) throw new Error(failures.map(item => item.formattedMessage || item.message).join("\n"));
  return output;
}

function compiledRuntime(output, contractName) {
  return output.contracts?.[`src/${contractName}.sol`]?.[contractName]?.evm?.deployedBytecode?.object || "";
}

function withoutMetadata(bytecode) {
  if (!/^[0-9a-fA-F]+$/.test(bytecode) || bytecode.length < 4) return bytecode;
  const metadataBytes = Number.parseInt(bytecode.slice(-4), 16) + 2;
  const metadataHexLength = metadataBytes * 2;
  return metadataHexLength <= bytecode.length ? bytecode.slice(0, -metadataHexLength) : bytecode;
}

export async function main() {
  const results = [];
  for (const contract of CONTRACTS) {
    const input = JSON.parse(await readFile(resolve(bundleRoot, `${contract.name}.standard-input.json`), "utf8"));
    const sanitized = sanitizeLocalRemappings(input);
    if (localPathRemappingCount(sanitized) !== 0) throw new Error(`${contract.name} still contains a local remapping`);

    const exact = compile(input);
    const cleaned = compile(sanitized);
    const exactRuntime = compiledRuntime(exact, contract.name);
    const cleanedRuntime = compiledRuntime(cleaned, contract.name);
    const exactCore = withoutMetadata(exactRuntime);
    const cleanedCore = withoutMetadata(cleanedRuntime);
    results.push({
      contract: contract.name,
      exactRuntimeSha256: sha256(exactRuntime),
      sanitizedRuntimeSha256: sha256(cleanedRuntime),
      fullRuntimeMatch: exactRuntime === cleanedRuntime,
      executableRuntimeMatch: exactCore === cleanedCore,
      exactMetadataBytes: (exactRuntime.length - exactCore.length) / 2,
      sanitizedMetadataBytes: (cleanedRuntime.length - cleanedCore.length) / 2,
    });
  }
  console.log(JSON.stringify({ compiler: "0.8.36", results }, null, 2));
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`V2 remapping sanitization audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}
