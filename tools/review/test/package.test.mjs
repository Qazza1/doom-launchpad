import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  collectEntries,
  compareChecksums,
  formatChecksumFile,
  isExcluded,
  isInContractScope,
  parseChecksumFile,
  resolveRef,
  summarizeArtifact,
} from "../package.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const entry = (path, content) => ({ path, sha256: hash(content) });
const sample = () => [
  entry("src/DoomRewards.sol", "contract DoomRewards {}"),
  entry("docs/roadmap.md", "# roadmap"),
  entry("src/GmEscrow.sol", "contract GmEscrow {}"),
];

test("the manifest is sorted, round-trips, and uses sha256sum format", () => {
  const text = formatChecksumFile(sample());
  assert.deepEqual(
    text.split("\n").filter(Boolean).map(line => line.split("  ./")[1]),
    ["docs/roadmap.md", "src/DoomRewards.sol", "src/GmEscrow.sol"],
  );
  assert.ok(text.endsWith("\n"));
  assert.deepEqual(
    parseChecksumFile(text),
    [...sample()].sort((left, right) => (left.path < right.path ? -1 : 1)),
  );
  assert.equal(formatChecksumFile(sample()), formatChecksumFile([...sample()].reverse()));
  assert.throws(() => parseChecksumFile("not a checksum line"), /malformed checksum line/);
});

test("checksum files never contain their own hash", () => {
  assert.equal(isExcluded("SHA256SUMS.stage-3.1-audit-candidate"), true);
  assert.equal(isExcluded("SHA256SUMS.review-0423494629fd"), true);
  assert.equal(isExcluded("src/DoomRewards.sol"), false);
});

test("comparison reports changed, missing, and added files separately", () => {
  const expected = sample();
  assert.equal(compareChecksums(expected, sample()).matches, true);

  const drifted = [
    entry("src/DoomRewards.sol", "contract DoomRewards { uint256 x; }"),
    entry("docs/roadmap.md", "# roadmap"),
    entry("src/PositionLocker.sol", "contract PositionLocker {}"),
  ];
  const comparison = compareChecksums(expected, drifted);
  assert.equal(comparison.matches, false);
  assert.deepEqual(comparison.changed, ["src/DoomRewards.sol"]);
  assert.deepEqual(comparison.missing, ["src/GmEscrow.sol"]);
  assert.deepEqual(comparison.added, ["src/PositionLocker.sol"]);
});

test("a line-ending rewrite is a mismatch, not an accepted variation", () => {
  const canonical = [entry("src/DoomRewards.sol", "contract A {}\ncontract B {}\n")];
  const windows = [entry("src/DoomRewards.sol", "contract A {}\r\ncontract B {}\r\n")];
  const comparison = compareChecksums(canonical, windows);
  assert.equal(comparison.matches, false);
  assert.deepEqual(comparison.changed, ["src/DoomRewards.sol"]);
});

test("the contract digest ignores documentation churn and catches source changes", () => {
  const baseline = summarizeArtifact(sample());
  assert.equal(baseline.fileCount, 3);
  assert.equal(baseline.contractFileCount, 2);
  assert.equal(isInContractScope("src/interfaces/IWrappedNative.sol"), true);
  assert.equal(isInContractScope("test/DoomRewards.t.sol"), false);

  const documentationChanged = summarizeArtifact([
    entry("src/DoomRewards.sol", "contract DoomRewards {}"),
    entry("docs/roadmap.md", "# roadmap, revised"),
    entry("src/GmEscrow.sol", "contract GmEscrow {}"),
  ]);
  assert.notEqual(documentationChanged.artifactDigest, baseline.artifactDigest);
  assert.equal(documentationChanged.contractDigest, baseline.contractDigest);

  const contractChanged = summarizeArtifact([
    entry("src/DoomRewards.sol", "contract DoomRewards { uint256 x; }"),
    entry("docs/roadmap.md", "# roadmap"),
    entry("src/GmEscrow.sol", "contract GmEscrow {}"),
  ]);
  assert.notEqual(contractChanged.contractDigest, baseline.contractDigest);
});

test("HEAD's contract sources match the frozen review artifact", async () => {
  // The frozen digest lives in config/review-artifact.json rather than being pinned to a tag, so a
  // deliberate contract change has to re-freeze it in the same diff. An accidental one fails here.
  const frozen = JSON.parse(
    await readFile(new URL("../../../config/review-artifact.json", import.meta.url), "utf8"),
  );
  const head = await resolveRef("HEAD");
  const headEntries = await collectEntries(head.commit);
  const summary = summarizeArtifact(headEntries);

  assert.equal(
    summary.contractDigest,
    frozen.contractDigest,
    "src/ changed without re-freezing: update config/review-artifact.json in the same change, and "
      + "expect the reviewed artifact to need re-review",
  );
  assert.equal(summary.contractFileCount, frozen.contractFileCount);
  assert.notEqual(frozen.contractDigest, frozen.supersedes.contractDigest);
  assert.equal(
    headEntries.some(item => item.path.startsWith("SHA256SUMS.")),
    false,
  );
});

test("the deployment manifest references the exact frozen review artifact", async () => {
  const [frozen, manifest] = await Promise.all([
    readFile(new URL("../../../config/review-artifact.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../../config/stage4-deployment-manifest.json", import.meta.url), "utf8")
      .then(JSON.parse),
  ]);

  assert.equal(
    manifest.source.contractDigest,
    frozen.contractDigest,
    "deployment manifest contractDigest drifted from config/review-artifact.json",
  );
  assert.equal(
    manifest.source.auditCandidateCommit,
    frozen.frozenAtCommit,
    "deployment manifest audit candidate is not the commit whose artifact was frozen",
  );
  assert.equal(manifest.source.auditCandidateTag, frozen.annotatedTag);
});
