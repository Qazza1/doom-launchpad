import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scope = "v2/src/";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

async function git(args) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", projectRoot, "-c", `safe.directory=${projectRoot.replaceAll("\\", "/")}`, ...args],
    { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout;
}

async function contractSummary(ref, excludedPaths = []) {
  const commit = (await git(["rev-parse", `${ref}^{commit}`])).toString("utf8").trim();
  const excluded = new Set(excludedPaths);
  const listing = (await git(["ls-tree", "-r", "--name-only", commit, "--", scope]))
    .toString("utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .filter(path => !excluded.has(path))
    .sort();
  const entries = [];
  for (const path of listing) {
    const blob = await git(["show", `${commit}:${path}`]);
    entries.push({ path, sha256: sha256(blob) });
  }
  const checksumText = `${entries.map(entry => `${entry.sha256}  ./${entry.path}`).join("\n")}\n`;
  return { commit, contractDigest: sha256(checksumText), contractFileCount: entries.length };
}

async function main(args = process.argv.slice(2)) {
  const refIndex = args.indexOf("--ref");
  const ref = refIndex === -1 ? "HEAD" : args[refIndex + 1];
  const verifyIndex = args.indexOf("--verify");
  const excludedPaths = args.flatMap((argument, index) => argument === "--exclude" ? [args[index + 1]] : []);
  if (excludedPaths.some(path => !path?.startsWith(scope))) {
    throw new Error("excluded paths must be explicit files inside v2/src/");
  }
  const summary = await contractSummary(ref, excludedPaths);

  if (verifyIndex !== -1) {
    const artifactPath = resolve(process.cwd(), args[verifyIndex + 1]);
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    if (artifact.contractDigest !== summary.contractDigest) {
      throw new Error(
        `V2 contract digest drifted: expected ${artifact.contractDigest}, received ${summary.contractDigest}`,
      );
    }
    if (artifact.contractFileCount !== summary.contractFileCount) {
      throw new Error(
        `V2 contract file count drifted: expected ${artifact.contractFileCount}, received ${summary.contractFileCount}`,
      );
    }
    console.log(`V2 contract artifact matches ${artifact.candidateCommit}.`);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(`V2 review package failed: ${error.message}`);
  process.exitCode = 1;
});
