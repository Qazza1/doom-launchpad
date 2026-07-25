import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEPLOYER,
  PREVIEW_CHAIN_ID,
  PRODUCTION_CHAIN_ID,
  SENTINEL_BALANCE_WEI,
  assertIsolatedChain,
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
  assert.equal(validateSentinelBalance(`0x${SENTINEL_BALANCE_WEI.toString(16)}`), true);
  assert.throws(() => validateSentinelBalance("0x0"), /not the preview fork/);
  assert.throws(() => validateSentinelBalance("0x6f05b59d3b20000"), /not the preview fork/);
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
    ["nonce does not match the plan"],
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
  assert.ok(page.includes("/rabby-preview.js"));
  assert.equal(/<script(?![^>]*src="\/rabby-preview\.js")/.test(page), false);
});
