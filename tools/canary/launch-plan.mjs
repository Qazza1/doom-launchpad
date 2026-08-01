import { createHash } from "node:crypto";

/// Stage 5 plan generation. Builds unsigned plans for the two canary decisions and hashes them
/// deterministically. This module reads nothing, signs nothing, and sends nothing.
///
/// `resumeLaunches()` and `launch(params)` are two separate owner decisions. They are represented
/// by two plan kinds that can never be combined, because approving the first must never imply the
/// second: after a resume the factory is open and the approved creator can launch, which is the
/// riskiest window this system will ever have.

export const CHAIN_ID = 4663;
export const FACTORY = "0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE";
export const SENDER = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F";
export const CONTRACT_DIGEST = "7aab9e3b0c0c7066ee31e89807900e63112b0c4815338825e02f5d85fa4684c8";
export const SOURCE_COMMIT = "740a473bd0f2830a17650be7a3b4008be1f82441";

/// Frozen in the deployed factory. Present so a plan states them explicitly and a guard can check
/// them; they are not configurable.
export const NATIVE_LIQUIDITY_WEI = 10_000_000_000_000_000n;
export const MAX_VALUE_WEI = 10_100_000_000_000_000n;
export const MIN_WHOLE_SUPPLY = 1_000_000n;
export const MAX_WHOLE_SUPPLY = 1_000_000_000_000_000n;
export const WEI_PER_TOKEN = 10n ** 18n;

export const PLAN_KIND = { resume: "resume", launch: "launch" };

/// Selectors are supplied by the caller from the compiled artifact rather than hard-coded, so a
/// renamed or re-typed function cannot silently produce plausible-looking calldata.
const SELECTOR = /^0x[0-9a-f]{8}$/;
const HEX = /^0x[0-9a-f]*$/;

const lower = value => String(value ?? "").toLowerCase();

export function encodeResumeCalldata(selector) {
  if (!SELECTOR.test(lower(selector))) throw new Error("resumeLaunches selector is malformed");
  return lower(selector);
}

/// ABI-encodes `launch((string,string,uint256,uint256))`. The struct is dynamic, so the outer tuple
/// is a pointer, and both strings are pointers within it.
export function encodeLaunchCalldata(selector, { name, symbol, supplyWei, nativeLiquidityWei }) {
  if (!SELECTOR.test(lower(selector))) throw new Error("launch selector is malformed");
  const word = value => BigInt(value).toString(16).padStart(64, "0");
  const stringPart = text => {
    const bytes = Buffer.from(String(text), "utf8");
    const padded = Math.ceil(bytes.length / 32) * 32;
    return word(bytes.length) + bytes.toString("hex").padEnd(padded * 2, "0");
  };

  const nameHex = stringPart(name);
  const symbolHex = stringPart(symbol);
  // Struct head: name pointer, symbol pointer, totalSupply, nativeLiquidityAmount.
  const headWords = 4;
  const nameOffset = headWords * 32;
  const symbolOffset = nameOffset + nameHex.length / 2;
  const struct = word(nameOffset) + word(symbolOffset) + word(supplyWei) + word(nativeLiquidityWei)
    + nameHex + symbolHex;
  return `${lower(selector)}${word(32)}${struct}`;
}

export function validateTokenInputs({ name, symbol, wholeSupply }) {
  const errors = [];
  const nameBytes = Buffer.from(String(name ?? ""), "utf8").length;
  const symbolBytes = Buffer.from(String(symbol ?? ""), "utf8").length;
  if (nameBytes === 0 || nameBytes > 64) errors.push("token name must be 1 to 64 bytes");
  if (symbolBytes === 0 || symbolBytes > 12) errors.push("token symbol must be 1 to 12 bytes");

  let supply;
  try {
    supply = BigInt(wholeSupply);
  } catch {
    errors.push("whole-token supply must be an integer");
    return { errors, supplyWei: null };
  }
  if (supply < MIN_WHOLE_SUPPLY || supply > MAX_WHOLE_SUPPLY) {
    errors.push(`whole-token supply must be between ${MIN_WHOLE_SUPPLY} and ${MAX_WHOLE_SUPPLY}`);
  }
  // The deployed factory rejects supplies that are not a whole number of tokens (audit finding L-2).
  return { errors, supplyWei: errors.length ? null : supply * WEI_PER_TOKEN };
}

/// The hash covers every binding field. Changing any one of them changes the hash, so the owner can
/// compare what they approved against what the wallet is about to sign.
export function planHash(plan) {
  const canonical = JSON.stringify(plan, Object.keys(plan).sort());
  return `0x${createHash("sha256").update(canonical).digest("hex")}`;
}

function basePlan(kind, { nonce, expiresAt, observedLaunchCount, observedTotalNativeLiquidity }) {
  if (!Number.isInteger(nonce) || nonce < 0) throw new Error("nonce must be a non-negative integer");
  if (!Number.isInteger(expiresAt) || expiresAt <= 0) throw new Error("expiresAt must be a unix time");
  return {
    kind,
    chainId: CHAIN_ID,
    factory: FACTORY,
    sender: SENDER,
    nonce,
    expiresAt,
    contractDigest: CONTRACT_DIGEST,
    sourceCommit: SOURCE_COMMIT,
    expectedLaunchCount: String(observedLaunchCount ?? 0),
    expectedTotalNativeLiquidity: String(observedTotalNativeLiquidity ?? 0),
  };
}

/// A resume plan carries no token inputs and no value. It cannot be turned into a launch.
export function buildResumePlan({ selector, nonce, expiresAt, observedLaunchCount = 0, observedTotalNativeLiquidity = 0 }) {
  const data = encodeResumeCalldata(selector);
  const plan = {
    ...basePlan(PLAN_KIND.resume, { nonce, expiresAt, observedLaunchCount, observedTotalNativeLiquidity }),
    to: FACTORY,
    valueWei: "0",
    maxValueWei: "0",
    data,
    calldataHash: `0x${createHash("sha256").update(data).digest("hex")}`,
  };
  return { ...plan, planHash: planHash(plan) };
}

export function buildLaunchPlan({
  selector,
  nonce,
  expiresAt,
  name,
  symbol,
  wholeSupply,
  observedLaunchCount = 0,
  observedTotalNativeLiquidity = 0,
}) {
  const { errors, supplyWei } = validateTokenInputs({ name, symbol, wholeSupply });
  if (errors.length) throw new Error(errors.join("; "));

  const data = encodeLaunchCalldata(selector, {
    name,
    symbol,
    supplyWei,
    nativeLiquidityWei: NATIVE_LIQUIDITY_WEI,
  });
  if (!HEX.test(data)) throw new Error("encoded launch calldata is malformed");

  const plan = {
    ...basePlan(PLAN_KIND.launch, { nonce, expiresAt, observedLaunchCount, observedTotalNativeLiquidity }),
    to: FACTORY,
    tokenName: String(name),
    tokenSymbol: String(symbol),
    wholeSupply: String(wholeSupply),
    supplyWei: supplyWei.toString(),
    nativeLiquidityWei: NATIVE_LIQUIDITY_WEI.toString(),
    valueWei: NATIVE_LIQUIDITY_WEI.toString(),
    maxValueWei: MAX_VALUE_WEI.toString(),
    data,
    calldataHash: `0x${createHash("sha256").update(data).digest("hex")}`,
  };
  return { ...plan, planHash: planHash(plan) };
}
