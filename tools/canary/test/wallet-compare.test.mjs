import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_VALUE_WEI, NATIVE_LIQUIDITY_WEI, buildLaunchPlan, buildResumePlan } from "../launch-plan.mjs";
import {
  MAX_PREVIEW_SPEND_WEI,
  PREVIEW_CHAIN_ID,
  PRODUCTION_CHAIN_ID,
  SENTINEL_BALANCE_WEI,
  assertIsolatedChain,
  buildPreviewTransaction,
  choosePreviewNonce,
  guardsBeforePrompt,
  isNonceOnlyDrift,
  normalizeOnchainTransaction,
  parseArguments,
  validateReceipt,
  validateSentinelBalance,
  validateWalletSubmission,
} from "../wallet-compare.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(directory, "../wallet-compare.mjs"), "utf8");
const clientSource = await readFile(resolve(directory, "../wallet-compare.js"), "utf8");

const later = () => Math.floor(Date.now() / 1000) + 900;
const launchPlan = () => buildLaunchPlan({
  selector: "0x0a1b2c3d",
  nonce: 8,
  expiresAt: later(),
  name: "DoomStreak Canary Test 2",
  symbol: "DCT2",
  wholeSupply: 1_000_000_000n,
  observedLaunchCount: 1,
  observedTotalNativeLiquidity: NATIVE_LIQUIDITY_WEI.toString(),
});
const resumePlan = () => buildResumePlan({ selector: "0x1a2b3c4d", nonce: 7, expiresAt: later() });

const previewOf = plan => buildPreviewTransaction(plan, choosePreviewNonce(plan.nonce));
const mine = (transaction, overrides = {}) => normalizeOnchainTransaction({
  from: transaction.from,
  to: transaction.to,
  input: transaction.data,
  nonce: `0x${transaction.nonce.toString(16)}`,
  value: transaction.value,
  ...overrides,
});

/// The single guard that makes it safe to let a real wallet sign at all.
test("the harness refuses to run on the production chain", () => {
  assert.throws(() => assertIsolatedChain(PRODUCTION_CHAIN_ID), /refusing to compare on chain 4663/);
  assert.throws(() => assertIsolatedChain(4663), /4663/);
  // 46630 is a real network, so signatures made there would be replayable.
  assert.throws(() => assertIsolatedChain(46630), /replayable/);
  assert.throws(() => assertIsolatedChain(1), /the preview chain must be/);
  assert.notEqual(PREVIEW_CHAIN_ID, PRODUCTION_CHAIN_ID);
  assert.equal(assertIsolatedChain(PREVIEW_CHAIN_ID), true);
});

test("the sentinel balance proves the fork, with a window for the gas signing spends", () => {
  assert.equal(validateSentinelBalance(`0x${SENTINEL_BALANCE_WEI.toString(16)}`), true);
  assert.equal(
    validateSentinelBalance(`0x${(SENTINEL_BALANCE_WEI - MAX_PREVIEW_SPEND_WEI + 1n).toString(16)}`),
    true,
  );
  // A real account's balance, and anything above the sentinel, is not the fork.
  assert.throws(() => validateSentinelBalance("0x12b3f0eb17cbc0"), /sentinel balance/);
  assert.throws(
    () => validateSentinelBalance(`0x${(SENTINEL_BALANCE_WEI + 1n).toString(16)}`),
    /sentinel balance/,
  );
});

test("both guards run before a prompt and neither covers for the other", () => {
  const healthy = { chainId: PREVIEW_CHAIN_ID, balanceWei: SENTINEL_BALANCE_WEI };
  assert.deepEqual(guardsBeforePrompt(healthy), []);

  const wrongChain = guardsBeforePrompt({ ...healthy, chainId: PRODUCTION_CHAIN_ID });
  assert.equal(wrongChain.length, 1);
  assert.match(wrongChain[0], /4663/);

  const wrongFork = guardsBeforePrompt({ ...healthy, balanceWei: 10n ** 15n });
  assert.equal(wrongFork.length, 1);
  assert.match(wrongFork[0], /sentinel/);

  // Both wrong reports both, rather than stopping at the first.
  assert.equal(guardsBeforePrompt({ chainId: 4663, balanceWei: 1n }).length, 2);
});

test("the preview transaction keeps the plan's recipient, value, and calldata", () => {
  const plan = launchPlan();
  const preview = buildPreviewTransaction(plan, 1008);
  assert.equal(preview.to, plan.to);
  assert.equal(preview.data, plan.data);
  assert.equal(BigInt(preview.value), BigInt(plan.valueWei));
  assert.equal(BigInt(preview.value), MAX_VALUE_WEI);
  // Only the nonce differs, and only to stay ahead of a cached wallet counter.
  assert.equal(preview.nonce, 1008);
  assert.notEqual(preview.nonce, plan.nonce);

  const resume = buildPreviewTransaction(resumePlan(), 1007);
  assert.equal(BigInt(resume.value), 0n);
});

test("a plan for another chain, or above the canary ceiling, is never offered to a wallet", () => {
  assert.throws(() => buildPreviewTransaction({ ...launchPlan(), chainId: 1 }, 1008), /chain 1/);
  assert.throws(
    () => buildPreviewTransaction({ ...launchPlan(), valueWei: (MAX_VALUE_WEI + 1n).toString() }, 1008),
    /canary ceiling/,
  );
});

test("the preview nonce clears any cached wallet counter", () => {
  assert.equal(choosePreviewNonce(8), 1008);
  assert.equal(choosePreviewNonce(0), 1000);
});

test("a wallet that signs the plan exactly passes", () => {
  const preview = previewOf(launchPlan());
  assert.deepEqual(validateWalletSubmission(preview, mine(preview)), []);
});

/// The failure this stage exists for: everything looks right except one field.
test("any substituted field is caught, value included", () => {
  const preview = previewOf(launchPlan());
  const cases = [
    [{ to: "0x000000000000000000000000000000000000dEaD" }, /recipient/],
    [{ from: "0x000000000000000000000000000000000000dEaD" }, /sender/],
    [{ input: "0xdeadbeef" }, /calldata/],
    [{ value: "0x2386f26fc10000" }, /value does not match/],
    [{ value: "0x0" }, /value does not match/],
    [{ nonce: "0x1" }, /nonce does not match/],
  ];
  for (const [override, pattern] of cases) {
    const errors = validateWalletSubmission(preview, mine(preview, override));
    assert.ok(errors.some(error => pattern.test(error)), `${Object.keys(override)[0]} must be caught`);
  }
  assert.deepEqual(validateWalletSubmission(preview, null), [
    "the preview chain does not know that transaction",
  ]);
});

test("a wallet-chosen nonce is distinguishable from a substituted field", () => {
  const preview = previewOf(launchPlan());
  assert.equal(isNonceOnlyDrift(preview, mine(preview, { nonce: "0x3f2" })), true);
  // A changed value is never nonce-only drift, even when the nonce also moved.
  assert.equal(isNonceOnlyDrift(preview, mine(preview, { nonce: "0x3f2", value: "0x0" })), false);
  assert.equal(isNonceOnlyDrift(preview, mine(preview, { input: "0xdeadbeef" })), false);
});

test("the receipt must succeed and belong to the planned call", () => {
  const preview = previewOf(launchPlan());
  const receipt = { status: 1, from: preview.from, to: preview.to, gasUsed: "0x1" };
  assert.deepEqual(validateReceipt(preview, receipt), []);
  assert.ok(validateReceipt(preview, { ...receipt, status: 0 }).some(e => /did not succeed/.test(e)));
  assert.ok(validateReceipt(preview, { ...receipt, to: "0x00" }).some(e => /recipient/.test(e)));
  assert.deepEqual(validateReceipt(preview, null), ["no receipt was returned"]);
});

test("one kind per run, defaulting to the prepared plan", () => {
  assert.deepEqual(parseArguments(["--kind", "launch"]).errors, []);
  assert.equal(parseArguments(["--kind", "launch"]).planPath, "tools/canary/output/launch-plan.json");
  assert.ok(
    parseArguments(["--kind", "resume", "--kind", "launch"]).errors
      .some(error => /separate decisions/.test(error)),
  );
});

test("no private key is ever loaded and there is no mainnet send path", () => {
  for (const text of [source, clientSource]) {
    assert.ok(!/privateKey|PRIVATE_KEY|mnemonic|seed phrase|eth_sign\b|personal_sign/i.test(text));
  }
  // The upstream endpoint is read from exactly once, for the pending nonce, and never written to.
  const upstreamCalls = source.match(/rpc\(upstream,\s*"([a-zA-Z_]+)"/g) ?? [];
  assert.deepEqual(upstreamCalls, ['rpc(upstream, "eth_getTransactionCount"']);
  // Every other call, including anything that could change state, goes to the local preview fork.
  assert.ok(!/rpc\(upstream,\s*"eth_send/.test(source));
  assert.ok(source.includes("PREVIEW_RPC_URL"));
  // The page only ever talks to its own origin and the injected wallet.
  assert.ok(!/http:\/\/(?!127\.0\.0\.1)/.test(clientSource));
  assert.ok(clientSource.includes("assertPreviewChain"));
});
