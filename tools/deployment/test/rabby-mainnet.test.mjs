import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compareMinedProviders,
  validateMainnetApproval,
  validateReceiptLedger,
} from "../rabby-mainnet-server.mjs";

const deployer = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F";
const txHash = `0x${"ab".repeat(32)}`;
const plan = () => ({
  startingNonce: 0,
  transactions: Array.from({ length: 6 }, (_, order) => ({ order })),
});
const approvalFor = (value, body) => ({
  status: "owner_approved_funding_and_paused_deployment",
  chainId: 4663,
  deployer,
  planSha256: createHash("sha256").update(body).digest("hex"),
  startingNonce: value.startingNonce,
  maximumFundingWei: "100",
  fundingReceipt: {
    status: "success",
    to: deployer,
    valueWei: "100",
    transactionHash: txHash,
  },
  authorization: {
    funding: true,
    sixTransactionsOneAtATime: true,
    stopAndVerifyEveryReceipt: true,
    factoryMustRemainPaused: true,
    factoryResume: false,
    firstCanaryLaunch: false,
  },
});

test("the mainnet executor accepts only the exact approved plan and funding receipt", () => {
  const value = plan();
  const body = `${JSON.stringify(value, null, 2)}\n`;
  assert.deepEqual(validateMainnetApproval(approvalFor(value, body), value, body), []);

  const wrongPlan = approvalFor(value, body);
  wrongPlan.planSha256 = "0".repeat(64);
  assert.ok(validateMainnetApproval(wrongPlan, value, body).some(error => error.includes("plan digest")));

  const overfunded = approvalFor(value, body);
  overfunded.fundingReceipt.valueWei = "101";
  assert.ok(validateMainnetApproval(overfunded, value, body).some(error => error.includes("approved amount")));
});

test("factory resume and the first launch can never be carried by the approval", () => {
  const value = plan();
  const body = JSON.stringify(value);
  const resume = approvalFor(value, body);
  resume.authorization.factoryResume = true;
  assert.ok(validateMainnetApproval(resume, value, body).some(error => error.includes("resume")));

  const launch = approvalFor(value, body);
  launch.authorization.firstCanaryLaunch = true;
  assert.ok(validateMainnetApproval(launch, value, body).some(error => error.includes("launch")));
});

test("each server step requires every earlier receipt and no later receipt", () => {
  const value = plan();
  const ledger = { planSha256: "plan", receipts: [] };
  assert.deepEqual(validateReceiptLedger(value, ledger, 0), []);
  assert.ok(validateReceiptLedger(value, ledger, 1)[0].includes("exactly 1"));

  ledger.receipts.push({
    order: 0,
    planSha256: "plan",
    transactionHash: txHash,
    status: "verified_success",
  });
  assert.deepEqual(validateReceiptLedger(value, ledger, 1), []);
  assert.ok(validateReceiptLedger(value, ledger, 0)[0].includes("exactly 0"));
});

test("provider receipt comparison catches transaction and receipt disagreement", () => {
  const transaction = {
    hash: txHash,
    from: deployer,
    to: null,
    input: "0x1234",
    nonce: "0x0",
    value: "0x0",
  };
  const receipt = {
    status: "0x1",
    from: deployer,
    to: null,
    contractAddress: "0x1111111111111111111111111111111111111111",
    blockHash: `0x${"cd".repeat(32)}`,
    transactionHash: txHash,
  };
  assert.deepEqual(compareMinedProviders(transaction, structuredClone(transaction), receipt, structuredClone(receipt)), []);

  const changedTransaction = structuredClone(transaction);
  changedTransaction.input = "0x5678";
  const changedReceipt = structuredClone(receipt);
  changedReceipt.status = "0x0";
  const errors = compareMinedProviders(transaction, changedTransaction, receipt, changedReceipt);
  assert.ok(errors.some(error => error.includes("transaction input")));
  assert.ok(errors.some(error => error.includes("receipt status")));
});

test("the mainnet client is module-scoped so injected wallets cannot redeclare its helpers", async () => {
  const html = await readFile(new URL("../rabby-mainnet.html", import.meta.url), "utf8");
  const javascript = await readFile(new URL("../rabby-mainnet.js", import.meta.url), "utf8");
  assert.match(html, /<script type="module" src="\/rabby-mainnet\.js"><\/script>/);
  assert.doesNotMatch(javascript, /function rabby\s*\(/);
  assert.match(javascript, /function getDoomRabbyProvider\s*\(/);
});
