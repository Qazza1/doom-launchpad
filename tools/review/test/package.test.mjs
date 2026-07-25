import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("the audit-candidate tag and HEAD still share identical contract sources", async () => {
  const tag = await resolveRef("stage-3.1-audit-candidate");
  const head = await resolveRef("HEAD");
  const [taggedEntries, headEntries] = await Promise.all([
    collectEntries(tag.commit),
    collectEntries(head.commit),
  ]);

  const taggedContracts = summarizeArtifact(taggedEntries);
  const headContracts = summarizeArtifact(headEntries);
  assert.equal(
    headContracts.contractDigest,
    taggedContracts.contractDigest,
    "src/ changed since the audit candidate; the review artifact must be re-frozen and re-reviewed",
  );
  assert.ok(headContracts.contractFileCount >= 11);
  assert.equal(
    headEntries.some(item => item.path.startsWith("SHA256SUMS.")),
    false,
  );
});
