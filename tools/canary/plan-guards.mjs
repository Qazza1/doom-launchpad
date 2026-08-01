import { createHash } from "node:crypto";
import { CHAIN_ID, FACTORY, MAX_VALUE_WEI, PLAN_KIND, SENDER, planHash } from "./launch-plan.mjs";

/// Stage 5 guards. Every check fails closed and every check is independent, so no single mistake
/// can be masked by another passing. Nothing here signs or sends.

const lower = value => String(value ?? "").toLowerCase();
const same = (left, right) => lower(left) === lower(right);

/// An owner approval is bound to one plan hash and one plan kind. This is what makes the two
/// decisions genuinely separate: a resume approval carries the resume plan's hash, so it can never
/// satisfy a launch plan even if both are presented in the same session.
export function validateApproval(approval, plan) {
  const errors = [];
  if (!approval) return ["no owner approval was supplied"];
  if (approval.kind !== plan.kind) {
    errors.push(`approval is for a ${approval.kind} but the plan is a ${plan.kind}`);
  }
  if (lower(approval.planHash) !== lower(plan.planHash)) {
    errors.push("approval does not match this plan's hash");
  }
  return errors;
}

/// Approving a resume must never carry into a launch. Presenting both at once is refused outright
/// rather than executed in sequence: the window between them is the point at which the owner is
/// meant to stop and look.
export function assertNotBundled(items) {
  const kinds = new Set((items || []).map(item => item?.kind));
  if (kinds.has(PLAN_KIND.resume) && kinds.has(PLAN_KIND.launch)) {
    return ["resume and launch cannot be approved or submitted together"];
  }
  return [];
}

export function validateFreshness(plan, nowSeconds) {
  const now = Number(nowSeconds);
  if (!Number.isFinite(now)) return ["current time is unavailable"];
  if (Number(plan?.expiresAt) <= now) return ["the plan has expired; regenerate it"];
  return [];
}

/// Compares a plan against live chain state read immediately before submission.
export function validateAgainstChain(plan, observed) {
  const errors = [];
  const push = (condition, message) => {
    if (!condition) errors.push(message);
  };

  push(Number(observed?.chainId) === CHAIN_ID, `chain is ${observed?.chainId}, expected ${CHAIN_ID}`);
  push(same(plan?.factory, FACTORY), "plan factory is not the deployed factory");
  push(same(plan?.to, FACTORY), "plan recipient is not the deployed factory");
  push(same(plan?.sender, SENDER), "plan sender is not the approved creator");
  push(Number(observed?.pendingNonce) === Number(plan?.nonce), "pending nonce does not match the plan");

  // Contract identity. A digest or commit change means the deployed contracts and the repository
  // have diverged, and no plan built from the repository can be trusted.
  push(same(observed?.contractDigest, plan?.contractDigest), "contract digest has drifted");
  push(same(observed?.sourceCommit, plan?.sourceCommit), "source commit has drifted");

  push(
    String(observed?.launchCount) === String(plan?.expectedLaunchCount),
    `launch count is ${observed?.launchCount}, plan expects ${plan?.expectedLaunchCount}`,
  );
  push(
    String(observed?.totalNativeLiquidity) === String(plan?.expectedTotalNativeLiquidity),
    "aggregate native liquidity does not match the plan",
  );

  // The factory must be paused before a resume and unpaused before a launch. Checking this here is
  // what stops a launch plan from being submitted against a factory that was never resumed, and a
  // resume from being replayed against one that already is.
  if (plan?.kind === PLAN_KIND.resume) {
    push(observed?.paused === true, "the factory is already unpaused; a resume would revert");
  }
  if (plan?.kind === PLAN_KIND.launch) {
    push(observed?.paused === false, "the factory is paused; it must be resumed first");
  }
  return errors;
}

/// The value about to be sent, checked against the plan rather than against a remembered number.
export function validateValue(plan, valueWei) {
  const errors = [];
  let value;
  try {
    value = BigInt(valueWei);
  } catch {
    return ["submitted value is not an integer"];
  }
  if (value < 0n) errors.push("submitted value is negative");
  if (plan?.kind === PLAN_KIND.resume && value !== 0n) {
    errors.push("a resume must carry no value");
  }
  if (value.toString() !== String(plan?.valueWei)) errors.push("submitted value does not match the plan");
  if (value > BigInt(plan?.maxValueWei ?? 0)) errors.push("submitted value exceeds the plan maximum");
  if (value > MAX_VALUE_WEI) errors.push("submitted value exceeds the canary ceiling");
  return errors;
}

export function validateCalldata(plan, calldata) {
  const supplied = lower(calldata);
  if (!/^0x[0-9a-f]*$/.test(supplied)) return ["submitted calldata is malformed"];
  if (supplied !== lower(plan?.data)) return ["submitted calldata does not match the plan"];
  const hash = `0x${createHash("sha256").update(supplied).digest("hex")}`;
  if (lower(hash) !== lower(plan?.calldataHash)) return ["calldata hash does not match the plan"];
  return [];
}

/// Recomputes the plan hash from the plan's own fields. Catches a plan edited after approval.
export function validateIntegrity(plan) {
  const { planHash: recorded, ...fields } = plan || {};
  if (!recorded) return ["plan carries no hash"];
  return planHash(fields) === recorded ? [] : ["plan contents do not match its hash"];
}

/// The single entry point a submission path would call. Every guard runs; nothing short-circuits, so
/// the operator sees every reason at once rather than fixing them one at a time.
export function guardSubmission({ plan, approval, observed, valueWei, calldata, nowSeconds, alongside = [] }) {
  return [
    ...validateIntegrity(plan),
    ...validateApproval(approval, plan),
    ...assertNotBundled([plan, ...alongside]),
    ...validateFreshness(plan, nowSeconds),
    ...validateAgainstChain(plan, observed),
    ...validateValue(plan, valueWei),
    ...validateCalldata(plan, calldata),
  ];
}
