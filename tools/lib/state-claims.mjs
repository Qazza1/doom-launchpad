/// Documentation and configuration drift detection.
///
/// This repository keeps saying things about the chain — "the factory is paused", "zero launches",
/// `expectedFactoryPaused: true` — and the chain keeps moving underneath them. On 2026-08-02 five
/// documents and one production config were stale at once, and the config had been sending a
/// critical alert every five minutes for twelve hours because of it.
///
/// Every claim below is evaluated against a live read. Prose claims are matched by pattern and can
/// be exempted only with a stated reason, because a historical record of a past state is a
/// legitimate thing for a document to contain.

export const CLAIM_RULES = [
  {
    id: "factory-paused",
    // "paused factory" as a bare noun phrase is dropped deliberately: it usually names the
    // pause *mechanism* rather than asserting the current state, and a check that cries wolf
    // gets switched off.
    pattern: /factory (is|remains|stays) (deliberately )?paused|factory is PAUSED/i,
    holdsWhen: state => state.paused === true,
    describe: state => `the factory is ${state.paused ? "paused" : "resumed"}`,
  },
  {
    id: "zero-launches",
    pattern: /zero[- ]launch|zero launches|launch count (is |of )?(zero|0)|no launches (have )?(yet )?(happened|occurred)/i,
    holdsWhen: state => Number(state.launchCount) === 0,
    describe: state => `the launch count is ${state.launchCount}`,
  },
  {
    id: "first-launch-pending",
    pattern: /the first (canary )?launch (has not|remains|is still)|before (the |any )first launch/i,
    holdsWhen: state => Number(state.launchCount) === 0,
    describe: state => `${state.launchCount} launch(es) have happened`,
  },
];

/// Structural claims a config file makes, compared field to field. No pattern matching, no
/// judgement: the file states a value and the chain either matches it or does not.
export function checkConfigClaims({ keeper, state }) {
  const findings = [];
  if (keeper && typeof keeper.expectedFactoryPaused === "boolean") {
    if (keeper.expectedFactoryPaused !== state.paused) {
      findings.push({
        id: "keeper-expected-paused",
        file: "config/keeper.mainnet.json",
        claim: `expectedFactoryPaused: ${keeper.expectedFactoryPaused}`,
        reality: `launchesPaused() is ${state.paused}`,
        // The keeper alerts on this mismatch, so leaving it stale is not a silent problem: it is a
        // critical alert that repeats until somebody stops reading them.
        consequence: "the keeper will alert continuously on a difference that is not a fault",
      });
    }
  }
  return findings;
}

const EXEMPT_LINE = /state-claim:\s*historical/i;

/// The marker exempts its whole paragraph, not just its own line. Prose wraps, and a claim
/// frequently sits on a different line from the sentence's end; forcing the marker onto the exact
/// matching line means mangling a sentence to place a comment mid-clause.
export function exemptLines(lines) {
  const exempt = new Array(lines.length).fill(false);
  let start = 0;
  const close = end => {
    if (lines.slice(start, end).some(line => EXEMPT_LINE.test(line))) {
      for (let index = start; index < end; index += 1) exempt[index] = true;
    }
  };
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") {
      close(index);
      start = index + 1;
    }
  }
  close(lines.length);
  return exempt;
}

/// Scans prose for claims about live state. A line may opt out with a `state-claim: historical`
/// marker, and a file may be exempted wholesale by the allowlist, but both leave a trace someone
/// can read and challenge.
export function checkDocumentClaims({ documents, state, allowlist = [] }) {
  const exempt = new Map(allowlist.map(entry => [`${entry.file}:${entry.rule}`, entry.reason]));
  const findings = [];

  for (const { path, text } of documents) {
    const lines = String(text).split(/\r?\n/);
    const exemptLine = exemptLines(lines);
    for (const rule of CLAIM_RULES) {
      if (rule.holdsWhen(state)) continue;
      if (exempt.has(`${path}:${rule.id}`) || exempt.has(`${path}:*`)) continue;
      for (const [index, line] of lines.entries()) {
        if (!rule.pattern.test(line) || exemptLine[index]) continue;
        findings.push({
          id: rule.id,
          file: path,
          line: index + 1,
          claim: line.trim().slice(0, 120),
          reality: rule.describe(state),
        });
      }
    }
  }
  return findings;
}

export function summarize(findings) {
  return {
    status: findings.length ? "state_drift_detected" : "state_claims_agree",
    count: findings.length,
    findings,
  };
}
