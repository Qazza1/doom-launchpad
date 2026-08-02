import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAIM_RULES,
  checkConfigClaims,
  checkDocumentClaims,
  exemptLines,
  summarize,
} from "../state-claims.mjs";

const RESUMED = { paused: false, launchCount: "1", totalNativeLiquidity: "10000000000000000" };
const PAUSED = { paused: true, launchCount: "0", totalNativeLiquidity: "0" };

const doc = (path, text) => [{ path, text }];

/// The exact failure of 2026-08-02: the keeper's manifest said the factory should be paused for
/// about twelve hours after it was resumed, and sent a critical alert every five minutes saying so.
test("the keeper config is caught when it disagrees with the live pause state", () => {
  const findings = checkConfigClaims({ keeper: { expectedFactoryPaused: true }, state: RESUMED });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, "config/keeper.mainnet.json");
  assert.match(findings[0].reality, /launchesPaused\(\) is false/);
  assert.match(findings[0].consequence, /alert continuously/);

  assert.deepEqual(checkConfigClaims({ keeper: { expectedFactoryPaused: false }, state: RESUMED }), []);
  assert.deepEqual(checkConfigClaims({ keeper: { expectedFactoryPaused: true }, state: PAUSED }), []);
});

test("a config without the field is not a finding", () => {
  assert.deepEqual(checkConfigClaims({ keeper: {}, state: RESUMED }), []);
  assert.deepEqual(checkConfigClaims({ keeper: null, state: RESUMED }), []);
});

/// The other half of the same failure: five documents still described a paused factory with no
/// launches, including the runbook whose checklist gates the next launch.
test("prose describing a paused factory is caught once the factory is resumed", () => {
  const findings = checkDocumentClaims({
    documents: doc("docs/runbook.md", "All four contracts are deployed and the factory is paused.\n"),
    state: RESUMED,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 1);
  assert.equal(findings[0].id, "factory-paused");
  assert.match(findings[0].reality, /the factory is resumed/);
});

test("prose claiming zero launches is caught once a launch exists", () => {
  const text = [
    "The public API agrees with the zero-launch chain state.",
    "",
    "Both services confirm the launch count is zero.",
  ].join("\n");
  const findings = checkDocumentClaims({ documents: doc("docs/x.md", text), state: RESUMED });
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map(item => item.line), [1, 3]);
});

test("the same prose is not a finding when it is true", () => {
  const text = "The factory is paused and the launch count is zero.\n";
  assert.deepEqual(checkDocumentClaims({ documents: doc("docs/x.md", text), state: PAUSED }), []);
});

/// A check that fires on things that are not claims gets switched off, which is worse than no
/// check. "Paused factory" as a bare noun phrase usually names the mechanism.
test("descriptions of the pause mechanism are not treated as claims", () => {
  const text = [
    "The paused factory, creator gate, and launch caps are all covered by tests.",
    "Flip it back the moment you pause the factory.",
    "`pauseLaunches()` stops new launches.",
  ].join("\n");
  assert.deepEqual(checkDocumentClaims({ documents: doc("docs/x.md", text), state: RESUMED }), []);
});

test("an inline marker exempts its whole paragraph, not just its line", () => {
  const lines = [
    "Confirmed 2026-08-01: the API reported zero launches, matching direct",
    "contract reads taken the same day. <!-- state-claim: historical -->",
    "",
    "The factory is paused.",
  ];
  assert.deepEqual(exemptLines(lines), [true, true, false, false]);

  const findings = checkDocumentClaims({
    documents: doc("docs/x.md", lines.join("\n")),
    state: RESUMED,
  });
  // The dated paragraph is exempt; the bare claim after the blank line is not.
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 4);
});

test("a file can be exempted wholesale, by rule or entirely", () => {
  const text = "The factory is paused with zero launches.\n";
  assert.deepEqual(
    checkDocumentClaims({
      documents: doc("docs/evidence.md", text),
      state: RESUMED,
      allowlist: [{ file: "docs/evidence.md", rule: "*", reason: "dated evidence" }],
    }),
    [],
  );
  // A per-rule exemption is narrower: the pause claim is forgiven, the launch-count claim is not.
  const narrow = checkDocumentClaims({
    documents: doc("docs/evidence.md", text),
    state: RESUMED,
    allowlist: [{ file: "docs/evidence.md", rule: "factory-paused", reason: "dated" }],
  });
  assert.equal(narrow.length, 1);
  assert.equal(narrow[0].id, "zero-launches");
});

test("every rule has an id, a pattern, and both a predicate and a description", () => {
  for (const rule of CLAIM_RULES) {
    assert.ok(rule.id && rule.pattern instanceof RegExp);
    assert.equal(typeof rule.holdsWhen, "function");
    assert.equal(rule.describe(RESUMED).length > 0, true);
  }
});

test("the summary reports a clean run and a dirty one differently", () => {
  assert.equal(summarize([]).status, "state_claims_agree");
  assert.equal(summarize([{ id: "x" }]).status, "state_drift_detected");
  assert.equal(summarize([{ id: "x" }]).count, 1);
});
