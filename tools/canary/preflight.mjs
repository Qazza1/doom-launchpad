import { createHash } from "node:crypto";
import { CHAIN_ID, FACTORY, SENDER } from "./launch-plan.mjs";

/// Stage 5 preflight. Reads live state through two independent providers and produces the `observed`
/// object the guards consume. Read-only: it issues `eth_chainId`, `eth_getTransactionCount`,
/// `eth_getBalance`, `eth_getCode`, and `eth_call` only. It has no signer and no send path.

const lower = value => String(value ?? "").toLowerCase();
const uintOf = word => BigInt(word ?? 0).toString();
const boolOf = word => BigInt(word ?? 0) === 1n;

export const FACTORY_READS = {
  paused: "launchesPaused()",
  launchCount: "launchCount()",
  totalNativeLiquidity: "totalNativeLiquidity()",
};

export function fingerprint(code) {
  return createHash("sha256").update(lower(code)).digest("hex").slice(0, 16);
}

async function call(fetchImpl, url, method, params) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message || "RPC error"}`);
  return body.result;
}

/// Reads everything a plan is checked against, from one provider.
export async function readProvider({ url, selectors, addresses, fetchImpl = fetch, label = "provider" }) {
  const read = (method, params) => call(fetchImpl, url, method, params);
  const factoryCall = async name =>
    read("eth_call", [{ to: FACTORY, data: selectors[name] }, "latest"]);

  const chainId = Number(await read("eth_chainId"));
  if (chainId !== CHAIN_ID) throw new Error(`${label} reports chain ${chainId}, expected ${CHAIN_ID}`);

  const code = {};
  for (const [name, address] of Object.entries(addresses)) {
    const value = await read("eth_getCode", [address, "latest"]);
    if (!value || value === "0x") throw new Error(`${label} sees no code at ${name}`);
    code[name] = fingerprint(value);
  }

  return {
    label,
    chainId,
    pendingNonce: Number(await read("eth_getTransactionCount", [SENDER, "pending"])),
    balanceWei: BigInt(await read("eth_getBalance", [SENDER, "latest"])).toString(),
    paused: boolOf(await factoryCall("paused")),
    launchCount: uintOf(await factoryCall("launchCount")),
    totalNativeLiquidity: uintOf(await factoryCall("totalNativeLiquidity")),
    code,
  };
}

/// Two independent hosts must agree on every value. One provider can be stale, forked, or wrong;
/// agreement between two is the cheapest defence available before an irreversible action.
export function compareProviders(primary, fallback) {
  const errors = [];
  const check = (field, message) => {
    if (String(primary?.[field]) !== String(fallback?.[field])) errors.push(message);
  };

  check("chainId", "providers disagree on chain ID");
  check("pendingNonce", "providers disagree on the pending nonce");
  check("balanceWei", "providers disagree on the deployer balance");
  check("paused", "providers disagree on whether the factory is paused");
  check("launchCount", "providers disagree on the launch count");
  check("totalNativeLiquidity", "providers disagree on aggregate native liquidity");

  const names = new Set([...Object.keys(primary?.code || {}), ...Object.keys(fallback?.code || {})]);
  for (const name of names) {
    if (primary?.code?.[name] !== fallback?.code?.[name]) {
      errors.push(`providers disagree on deployed bytecode for ${name}`);
    }
  }
  return errors;
}

/// Local identity, not chain identity. The digest and commit come from the repository and are what
/// the plan claims to have been built from; the guards compare plan against these.
export function buildObserved(reading, { contractDigest, sourceCommit }) {
  return {
    chainId: reading.chainId,
    pendingNonce: reading.pendingNonce,
    balanceWei: reading.balanceWei,
    paused: reading.paused,
    launchCount: reading.launchCount,
    totalNativeLiquidity: reading.totalNativeLiquidity,
    contractDigest,
    sourceCommit,
  };
}

/// Enough native balance to pay the plan's value plus a gas headroom the caller states explicitly.
export function validateBalance(reading, plan, gasHeadroomWei) {
  const balance = BigInt(reading?.balanceWei ?? 0);
  const required = BigInt(plan?.valueWei ?? 0) + BigInt(gasHeadroomWei ?? 0);
  return balance >= required
    ? []
    : [`deployer balance ${balance} is below the required ${required} for this plan plus gas`];
}

export async function preflight({ primaryUrl, fallbackUrl, selectors, addresses, identity, fetchImpl = fetch }) {
  const [primary, fallback] = await Promise.all([
    readProvider({ url: primaryUrl, selectors, addresses, fetchImpl, label: "primary" }),
    readProvider({ url: fallbackUrl, selectors, addresses, fetchImpl, label: "fallback" }),
  ]);
  const disagreements = compareProviders(primary, fallback);
  return { primary, fallback, disagreements, observed: buildObserved(primary, identity) };
}
