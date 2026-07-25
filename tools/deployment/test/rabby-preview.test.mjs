import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEPLOYER,
  MAX_PREVIEW_SPEND_WEI,
  PREVIEW_CHAIN_ID,
  PRODUCTION_CHAIN_ID,
  SENTINEL_BALANCE_WEI,
  assertIsolatedChain,
  isNonceOnlyDrift,
  normalizeOnchainTransaction,
  validateReceipt,
  validateSentinelBalance,
  validateStepSubmission,
} from "../rabby-preview-server.mjs";

const locker = "0xdaE01c32131fF283f403b4C1fD71018Fa31cfAC0";
const manager = "0xbf36be8861ca4fe9920B10fc526E3fD039F88519";
const plan = {
  startingNonce: 7,
  transactions: [
    {
      order: 0,
      kind: "CREATE",
      contract: "DoomRewards",
      from: DEPLOYER,
      to: null,
      value: "0x0",
      nonce: 7,
      data: "0x60806040aabb",
      predictedAddress: locker,
    },
    {
      order: 1,
      kind: "CALL",
      contract: "PositionLocker",
      from: DEPLOYER,
      to: locker,
      value: "0x0",
      nonce: 8,
      data: `0x1a2b3c4d${manager.toLowerCase().slice(2).padStart(64, "0")}`,
      predictedAddress: null,
    },
  ],
};
const submission = index => ({
  from: plan.transactions[index].from,
  to: plan.transactions[index].to,
  value: plan.transactions[index].value,
  nonce: plan.transactions[index].nonce,
  data: plan.transactions[index].data,
});

test("the rehearsal refuses to run on the production chain", () => {
  assert.throws(
    () => assertIsolatedChain(PRODUCTION_CHAIN_ID),
    /valid mainnet transaction/,
  );
  assert.notEqual(PREVIEW_CHAIN_ID, PRODUCTION_CHAIN_ID);
  assert.equal(assertIsolatedChain(PREVIEW_CHAIN_ID), true);
  assert.throws(() => assertIsolatedChain(1), /preview chain must be 46630/);
});

test("the sentinel balance proves the connected network is the preview fork", () => {
  const hex = value => `0x${value.toString(16)}`;
  assert.equal(validateSentinelBalance(hex(SENTINEL_BALANCE_WEI)), true);
  assert.throws(() => validateSentinelBalance("0x0"), /not the preview fork/);
  // The real deployer balance on mainnet, 0.0005 ETH.
  assert.throws(() => validateSentinelBalance("0x1c6bf52634000"), /not the preview fork/);
});

test("gas spent by a confirmed step does not invalidate the sentinel guard", () => {
  const hex = value => `0x${value.toString(16)}`;
  // A step costs on the order of 1e15 wei. An exact-equality guard rejected every step after the
  // first, and rejected a page reload as the wrong network.
  const afterOneStep = SENTINEL_BALANCE_WEI - 1_899_909_494_736_000n;
  const afterSixSteps = SENTINEL_BALANCE_WEI - 6n * 1_899_909_494_736_000n;
  assert.equal(validateSentinelBalance(hex(afterOneStep)), true);
  assert.equal(validateSentinelBalance(hex(afterSixSteps)), true);
  assert.equal(validateSentinelBalance(hex(SENTINEL_BALANCE_WEI - MAX_PREVIEW_SPEND_WEI)), true);

  assert.throws(
    () => validateSentinelBalance(hex(SENTINEL_BALANCE_WEI - MAX_PREVIEW_SPEND_WEI - 1n)),
    /not the preview fork/,
  );
  assert.throws(
    () => validateSentinelBalance(hex(SENTINEL_BALANCE_WEI + 1n)),
    /not the preview fork/,
  );
});

test("the wallet's own transaction is what gets checked, not the page's payload", () => {
  const mined = normalizeOnchainTransaction({
    from: DEPLOYER,
    to: null,
    input: plan.transactions[0].data,
    nonce: "0x7",
    value: "0x0",
  });
  assert.deepEqual(mined, {
    from: DEPLOYER,
    to: null,
    data: plan.transactions[0].data,
    nonce: 7,
    value: "0x0",
  });
  assert.deepEqual(validateStepSubmission(plan, 0, mined), []);
  assert.equal(normalizeOnchainTransaction(null), null);

  // The documented failure mode: the wallet silently substitutes its own nonce.
  const substituted = normalizeOnchainTransaction({
    from: DEPLOYER,
    to: null,
    input: plan.transactions[0].data,
    nonce: "0x9",
    value: "0x0",
  });
  assert.deepEqual(validateStepSubmission(plan, 0, substituted), [
    "nonce does not match the plan (wallet used 9, plan expects 7)",
  ]);
});

test("a wallet-chosen nonce is distinguished from a wallet that rewrote the payload", () => {
  const mined = extra => normalizeOnchainTransaction({
    from: DEPLOYER,
    to: null,
    input: plan.transactions[0].data,
    nonce: "0x9",
    value: "0x0",
    ...extra,
  });

  // Only the nonce moved: Rabby caches a pending nonce per chain and address, so a second preview
  // session against a fresh fork starts ahead of the chain. The fork realigns instead of failing.
  assert.equal(isNonceOnlyDrift(plan.transactions[0], mined()), true);

  // Anything else differing is a real finding and must never be realigned away.
  assert.equal(isNonceOnlyDrift(plan.transactions[0], mined({ input: "0x60806040dead" })), false);
  assert.equal(isNonceOnlyDrift(plan.transactions[0], mined({ to: locker })), false);
  assert.equal(isNonceOnlyDrift(plan.transactions[0], mined({ from: locker })), false);
  assert.equal(isNonceOnlyDrift(plan.transactions[0], mined({ value: "0x2386f26fc10000" })), false);

  // The planned nonce is not drift.
  assert.equal(isNonceOnlyDrift(plan.transactions[0], mined({ nonce: "0x7" })), false);
  assert.equal(isNonceOnlyDrift(null, mined()), false);
});

test("a submitted payload must be byte-identical to the plan", () => {
  assert.deepEqual(validateStepSubmission(plan, 0, submission(0)), []);
  assert.deepEqual(validateStepSubmission(plan, 1, submission(1)), []);

  assert.deepEqual(
    validateStepSubmission(plan, 0, { ...submission(0), data: "0x60806040aabc" }),
    ["calldata does not match the plan"],
  );
  assert.deepEqual(
    validateStepSubmission(plan, 0, { ...submission(0), nonce: 9 }),
    ["nonce does not match the plan (wallet used 9, plan expects 7)"],
  );
  assert.deepEqual(
    validateStepSubmission(plan, 1, { ...submission(1), to: manager }),
    ["recipient does not match the plan"],
  );
  assert.deepEqual(
    validateStepSubmission(plan, 0, { ...submission(0), from: manager }),
    ["sender does not match the plan"],
  );
  assert.deepEqual(
    validateStepSubmission(plan, 0, { ...submission(0), value: "0x2386f26fc10000" }),
    ["a preview step must carry no value"],
  );
  assert.deepEqual(validateStepSubmission(plan, 5, submission(0)), ["unknown step"]);
});

test("a creation receipt must land at the predicted address", () => {
  assert.deepEqual(
    validateReceipt(plan.transactions[0], {
      status: "0x1",
      from: DEPLOYER,
      contractAddress: locker.toLowerCase(),
    }),
    [],
  );
  assert.deepEqual(
    validateReceipt(plan.transactions[0], { status: "0x1", from: DEPLOYER, contractAddress: manager }),
    ["the created address differs from the predicted address"],
  );
  assert.deepEqual(
    validateReceipt(plan.transactions[1], { status: "0x0", from: DEPLOYER, to: locker }),
    ["the transaction did not succeed"],
  );
  assert.deepEqual(
    validateReceipt(plan.transactions[1], { status: "0x1", from: manager, to: locker }),
    ["the receipt has the wrong sender"],
  );
  assert.deepEqual(validateReceipt(plan.transactions[0], null), ["no receipt was returned"]);
});

test("the preview client never contacts a remote endpoint or hard-codes production", async () => {
  const client = await readFile(new URL("../rabby-preview.js", import.meta.url), "utf8");
  const page = await readFile(new URL("../rabby-preview.html", import.meta.url), "utf8");

  assert.equal(/https?:\/\/(?!127\.0\.0\.1)/.test(client), false);
  assert.equal(client.includes(String(PRODUCTION_CHAIN_ID)), false);
  assert.equal(/eth_sendRawTransaction|wallet_addEthereumChain|personal_sign/.test(client), false);
  assert.ok(client.includes("assertPreviewChain"));
  // A step that was signed but failed verification must be re-checked, never re-signed: the nonce
  // is already spent, so resending would produce a second transaction that can never confirm.
  assert.ok(client.includes("submitted.get(transaction.order)"));
  assert.ok(client.includes("submitted.set(transaction.order, txHash)"));
  assert.ok(page.includes("/rabby-preview.js"));
  assert.equal(/<script(?![^>]*src="\/rabby-preview\.js")/.test(page), false);
});
