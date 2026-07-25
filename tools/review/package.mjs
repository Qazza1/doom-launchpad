import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../..");
const outputRoot = resolve(directory, "output");

/// Paths whose bytes define the reviewed contract artifact. A change here invalidates a completed
/// review and requires focused re-review.
export const CONTRACT_SCOPE = ["src/"];
/// The checksum files are excluded because a manifest cannot contain its own hash.
export const EXCLUDED_PREFIXES = ["SHA256SUMS."];

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

async function git(args, options = {}) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", projectRoot, "-c", `safe.directory=${projectRoot.replaceAll("\\", "/")}`, ...args],
    { maxBuffer: 64 * 1024 * 1024, encoding: "buffer", ...options },
  );
  return stdout;
}

export function isExcluded(path) {
  return EXCLUDED_PREFIXES.some(prefix => path.startsWith(prefix));
}

export function isInContractScope(path) {
  return CONTRACT_SCOPE.some(prefix => path.startsWith(prefix));
}

/// Renders the manifest in `sha256sum` format, sorted by byte order so any platform reproduces the
/// same file. Hashes cover canonical Git blob bytes, never working-tree bytes: a Windows checkout
/// rewrites line endings, and hashing those bytes produces a manifest no Linux reviewer can match.
export function formatChecksumFile(entries) {
  return `${[...entries]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map(entry => `${entry.sha256}  ./${entry.path}`)
    .join("\n")}\n`;
}

export function parseChecksumFile(text) {
  return text
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => {
      const match = line.match(/^([0-9a-f]{64})\s+\.\/(.+)$/);
      if (!match) throw new Error(`malformed checksum line: ${line}`);
      return { sha256: match[1], path: match[2] };
    });
}

export function compareChecksums(expectedEntries, actualEntries) {
  const expected = new Map(expectedEntries.map(entry => [entry.path, entry.sha256]));
  const actual = new Map(actualEntries.map(entry => [entry.path, entry.sha256]));
  const missing = [...expected.keys()].filter(path => !actual.has(path));
  const added = [...actual.keys()].filter(path => !expected.has(path));
  const changed = [...expected.entries()]
    .filter(([path, hash]) => actual.has(path) && actual.get(path) !== hash)
    .map(([path]) => path);
  return { missing, added, changed, matches: !missing.length && !added.length && !changed.length };
}

/// One value per artifact so a reviewer can quote a single digest. The contract digest covers only
/// `src/`, which makes "did any reviewed contract byte change?" a mechanical check.
export function summarizeArtifact(entries) {
  const contractEntries = entries.filter(entry => isInContractScope(entry.path));
  return {
    fileCount: entries.length,
    artifactDigest: sha256(formatChecksumFile(entries)),
    contractFileCount: contractEntries.length,
    contractDigest: sha256(formatChecksumFile(contractEntries)),
  };
}

export async function collectEntries(ref) {
  const listing = (await git(["ls-tree", "-r", "--name-only", ref])).toString("utf8");
  const paths = listing.split("\n").map(line => line.trim()).filter(Boolean).filter(path => !isExcluded(path));
  const entries = [];
  for (const path of paths) {
    const blob = await git(["show", `${ref}:${path}`]);
    entries.push({ path, sha256: sha256(blob) });
  }
  return entries;
}

export async function resolveRef(ref) {
  const commit = (await git(["rev-parse", `${ref}^{commit}`])).toString("utf8").trim();
  const describe = (await git(["describe", "--tags", "--always", commit])).toString("utf8").trim();
  return { commit, describe };
}

export async function main(argv = process.argv.slice(2)) {
  const refFlag = argv.indexOf("--ref");
  const ref = refFlag === -1 ? "HEAD" : argv[refFlag + 1];
  const verifyFlag = argv.indexOf("--verify");
  const verifyPath = verifyFlag === -1 ? null : argv[verifyFlag + 1];
  const outFlag = argv.indexOf("--out");

  const { commit, describe } = await resolveRef(ref);
  const entries = await collectEntries(commit);
  const summary = summarizeArtifact(entries);

  if (verifyPath) {
    const expected = parseChecksumFile(await readFile(resolve(process.cwd(), verifyPath), "utf8"));
    const comparison = compareChecksums(expected, entries);
    console.log(`Reviewed artifact: ${describe} (${commit})`);
    for (const path of comparison.changed) console.log(`  changed: ${path}`);
    for (const path of comparison.missing) console.log(`  missing: ${path}`);
    for (const path of comparison.added) console.log(`  added:   ${path}`);
    if (!comparison.matches) {
      const contractsTouched = [...comparison.changed, ...comparison.missing, ...comparison.added]
        .filter(isInContractScope);
      if (contractsTouched.length) {
        console.error("Contract sources changed. A completed review is invalid until re-review.");
      }
      throw new Error("the artifact does not match the checksum manifest");
    }
    console.log(`Artifact digest: ${summary.artifactDigest}`);
    console.log("Every file matches the checksum manifest.");
    return;
  }

  const outputPath = outFlag === -1
    ? resolve(outputRoot, `SHA256SUMS.review-${commit.slice(0, 12)}`)
    : resolve(process.cwd(), argv[outFlag + 1]);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, formatChecksumFile(entries), "utf8");

  console.log(`Reviewed artifact: ${describe} (${commit})`);
  console.log(`Files: ${summary.fileCount} (${summary.contractFileCount} under src/)`);
  console.log(`Artifact digest: ${summary.artifactDigest}`);
  console.log(`Contract digest: ${summary.contractDigest}`);
  console.log(`Manifest: ${outputPath}`);
  console.log("Hashes cover canonical Git blob bytes and reproduce on any platform.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Review package failed: ${error.message}`);
    process.exitCode = 1;
  });
}
